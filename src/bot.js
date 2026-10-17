/*
 * File: src/bot.js
 * Project: SpamSt
 *
 * Ядро бота: логин в Steam и цикл комментирования.
 * Поддержка мультиаккаунтов: комментарии пишутся со всех аккаунтов из accounts.json,
 * каждый аккаунт - отдельная сессия (отдельный логин/2FA/токен), циклы идут параллельно.
 * Поддерживает запуск из интерфейса (menuMode) и повтор цикла (config.loopRepeats / config.loopDelay).
 */

const logger         = require("output-logger");
const SteamUser      = require("steam-user");
const SteamCommunity = require("steamcommunity");
const SteamTotp      = require("steam-totp");
const SteamID        = require("steamid");
const EResult        = SteamUser.EResult;

const pkgVersion    = (() => { try { return require("../package.json").version; } catch (err) { return "unknown"; } })();
const { ask }       = require("./ui.js");

let config;


/**
 * Запускает процесс комментирования для ОДНОГО аккаунта: логин по токену и цикл комментариев.
 * Адресаты и комментарии уже загружены заранее (общие для всех аккаунтов).
 * @param {{accountName: string, password: string, sharedSecret?: string}} acc Данные аккаунта
 * @param {Array<object>} destinations Список адресатов (общий для всех аккаунтов)
 * @param {Array<string>} quotes Список комментариев (общий для всех аккаунтов)
 * @param {boolean} menuMode Если true - не завершать процесс после окончания (управление через интерфейс)
 * @returns {Promise<boolean>} true если аккаунт успешно отработал весь цикл
 */
async function runAccount(acc, destinations, quotes, menuMode) {
    const tag       = acc.accountName;
    const bot       = new SteamUser({ renewRefreshTokens: true });
    const community = new SteamCommunity();

    let session;
    let resolveOnce = () => {}; // Присваивается ниже, когда создаётся промис комментирования

    /**
     * Пытается залогинить аккаунт
     */
    async function login() {
        logger("info", `[${tag}] Logging in...`, false, false);

        // Генерируем auth code из sharedSecret если он предоставлен
        if (acc.sharedSecret) {
            logger("info", `[${tag}] Found sharedSecret, generating AuthCode...`);
            acc.steamGuardCode = SteamTotp.generateAuthCode(acc.sharedSecret);
        }

        session     = new (require("./sessions/sessionHandler.js"))(bot, acc.accountName, 0, acc);
        const token = await session.getToken();

        if (!token) {
            logger("error", `[${tag}] Не удалось получить токен входа - аккаунт пропущен.`);
            resolveOnce(false); // Освобождаем общий запуск чтобы другие аккаунты не ждали вечно
            return;
        }

        bot.logOn({ refreshToken: token });
    }

    login();

    bot.on("loggedOn", () => {
        logger("info", `[${tag}] Account logged in!`);
    });

    // Устанавливаем cookies и запускаем цикл комментирования
    const commentingDone = new Promise((resolve) => {
        let resolved = false;

        // Разрешает промис ровно один раз (нужно чтобы ошибка логина не "вешала" общий запуск)
        resolveOnce = (value) => {
            if (resolved) return;
            resolved = true;
            resolve(value);
        };
        bot.on("webSession", async (sessionID, cookies) => {
            community.setCookies(cookies);

            // Игровые сессии если включено
            if (config.playingGames.length > 0) bot.gamesPlayed(config.playingGames);

            const loopRepeats = Math.max(1, parseInt(config.loopRepeats) || 1); // Сколько раз пройтись циклом по всем адресатам
            const loopDelay   = Math.max(config.commentdelay, parseInt(config.loopDelay) || 0); // Пауза между полными циклами
            const postDelay   = Math.max(0, parseInt(config.postDelay ?? config.commentdelay));  // Задержка МЕЖДУ отдельными постами

            logger("", "", true);
            logger("", `> [${tag}] Начинаю комментирование через 3 секунды (${postDelay}ms delay между постами)!`, true);
            if (loopRepeats > 1) logger("", `> [${tag}] Loop mode ON: ${loopRepeats} проход(ов) цикла с паузой ${loopDelay}ms!`, true);

            // Ждём 3 секунды чтобы все аккаунты успели залогиниться перед стартом
            await new Promise((r) => setTimeout(r, 3000));

            const { comment } = require("./helpers/comment.js");

            const failed = [];
            let http429err = false;
            let permDenied = false; // Steam явно запретил постить (комментарии выключены / нет прав) - цикл бессмысленен
            let sentOk     = 0;
            let sentFail   = 0;

            /**
             * Один проход цикла: комментирует все адреса ПОСЛЕДОВАТЕЛЬНО с паузой postDelay между постами
             * @param {number} repeatIndex Номер текущего прохода цикла (с 1)
             * @returns {Promise<void>} Резолвится когда весь цикл завершится
             */
            async function runCycle(repeatIndex) {
                for (let i = 0; i < destinations.length; i++) {
                    if (http429err) return; // Блок дальнейших выполнений при кулдауне

                    // eslint-disable-next-line no-await-in-loop
                    const err = await new Promise((resolve) => comment(destinations[i], quotes, community, resolve));

                    if (err) {
                        failed.push(`${tag}: ${destinations[i].raw} (${err})`);
                        sentFail++;

                        const errMsg = String(err);

                        if (errMsg.includes("HTTP error 429") || errMsg.includes("You've been posting too frequently")) {
                            logger("", "", true);
                            logger("error", `[${tag}] Cooldown/limitation error detected! Aborting as all other comments from this IP will fail too! Please wait before trying again.`);

                            http429err = true;

                            return;
                        }

                        // Постоянный отказ Steam (не кулдаун): комментарии запрещены или аккаунту запрещено писать.
                        // Повторять цикл бесполезно - выходим сразу, чтобы не плодить ошибки и не ловить лимиты.
                        if (errMsg.includes("do not allow you to add comments") || errMsg.includes("posting comments is currently disabled") || errMsg.includes("not permitted to post")) {
                            logger("", "", true);
                            logger("error", `[${tag}] Steam на постоянной основе отказывает в публикации (${errMsg.slice(0, 160)}). Прерываю комментирование этим аккаунтом.`);
                            permDenied = true;

                            return;
                        }
                    } else {
                        sentOk++;
                    }

                    // Пересчитываем общий прогресс (по всем аккаунтам)
                    global.updateProgress();

                    // Пауза между постами (не после последнего в проходе)
                    if (i + 1 < destinations.length && postDelay > 0) {
                        // eslint-disable-next-line no-await-in-loop
                        await new Promise((r) => setTimeout(r, postDelay));
                    }
                }

                // Все адресаты этого прохода обработаны - нужен ли следующий проход цикла?
                if (!http429err && !permDenied && repeatIndex < loopRepeats) {
                    logger("info", `[${tag}] Finished cycle ${repeatIndex}/${loopRepeats}! Waiting ${loopDelay}ms before next cycle...`);

                    await new Promise((r) => setTimeout(r, loopDelay));

                    return runCycle(repeatIndex + 1);
                }
            }

            // Запускаем цикл комментирования (проходится loopRepeats раз)
            await runCycle(1);

            logger("info", `[${tag}] Finished commenting! Успешно: ${sentOk}, с ошибками: ${sentFail}\n`);

            if (failed.length > 0) logger("info", `Failed for ${tag}: \n` + failed.join("\n"));

            bot.logOff();
            // Аккаунт считается успешным только если ХОТЬ ОДИН комментарий реально опубликован
            // и не было постоянных отказов Steam (иначе "Success" был бы ложным)
            resolve(sentOk > 0 && !permDenied);
        });
    });

    // Отвечает afkMessage если включено в конфиге
    bot.chat.on("friendMessage", (msg) => {
        const message = msg.message_no_bbcode;
        const steamID = msg.steamid_friend;
        const steamID64 = new SteamID(String(steamID)).getSteamID64();
        const username = bot.users[steamID64] ? bot.users[steamID64].player_name : steamID64;

        logger("info", `[${tag}] Friend message from '${username}' (${steamID64}): ${message}`);

        if (config.afkMessage.length > 0) {
            logger("info", `[${tag}] Responding with: ${config.afkMessage}`);

            bot.chat.sendFriendMessage(steamID, config.afkMessage);
        }
    });

    // Эмитится когда refreshToken авто-обновлен SteamUser
    bot.on("refreshToken", (newToken) => {
        logger("info", `[${tag}] SteamUser auto renewed this refresh token, updating database entry...`);

        session._saveTokenToStorage(newToken);
    });

    // Обрабатывает ошибку логина
    bot.on("error", (err) => {
        // Инвалидируем токен чтобы получить новую сессию если ошибка вызвана невалидным refreshToken
        if (err.eresult == EResult.InvalidPassword || err.eresult == EResult.AccessDenied || err == "Error: InvalidSignature") {
            logger("debug", `[${tag}] Token login error: invalidating stored token, retrying...`);

            if (err.eresult == EResult.AccessDenied) logger("warn", `[${tag}] Detected an AccessDenied login error! This is usually caused by an invalid login token. Deleting it, please re-submit your Steam Guard code.`);

            session.invalidateTokenInStorage();

            // Если пароля нет (например аккаунт добавлен как 'qrcode') - перелогин возможен только через QR/пароль заново
            setTimeout(() => login(), 5000);
            return;
        }

        logger("error", `[${tag}] Failed to log in! ${err}`);

        // Аккаунт не смог войти entirely - завершаем его цикл, чтобы не вешать общий запуск
        resolveOnce(false);
    });

    return commentingDone;
}


/**
 * Загружает данные аккаунтов: список из accounts.json (мультиаккаунты),
 * с автоматической миграцией из старого logininfo.json если accounts.json нет.
 * @returns {Array<{accountName: string, password: string, sharedSecret?: string}>} Список аккаунтов
 */
function loadAccountsInfo() {
    return require("./accounts.js").loadAccounts();
}


/**
 * Запускает процесс комментирования: проверка данных, логин всех аккаунтов и цикл комментариев
 * @param {boolean} menuMode Если true - не завершать процесс после окончания (управление через интерфейс)
 */
async function startCommenting(menuMode = false) {
    logger.options({
        msgstructure: `[${logger.Const.ANIMATION}] [${logger.Const.DATE} | ${logger.Const.TYPE}] ${logger.Const.MESSAGE}`,
        paramstructure: [logger.Const.TYPE, logger.Const.MESSAGE, "nodate", "remove", logger.Const.ANIMATION],
        outputfile: "./output.txt",
        animationdelay: 250,
        printdebug: false
    });

    global.logger = logger; // Делаем logger доступным в helper-модулях

    // Печатаем стартовые сообщения
    logger("", "\n", true);
    logger("info", `Starting SpamSt v${pkgVersion} by denz1208-blip`, true);
    logger("", "---------------------------------------------------------\n", true);

    // Показываем предупреждение если commentdelay слишком низкий
    if (config.commentdelay < 5000) logger("warn", "I strongly advise not setting the commentdelay below 5000ms!\n       You might be running in danger of getting banned for spamming or will at least get a cooldown rather quickly.", true);
    if (config.commentdelay <= 500) {
        logger("error", "Your commentdelay is way too low! This will either give you a cooldown instantly or outright ban you for spamming! Aborting...");

        if (!menuMode) process.exit(1);
        return false;
    }

    // Мультиаккаунты: читаем accounts.json (при отсутствии мигрирует из logininfo.json)
    const accounts = loadAccountsInfo();

    if (accounts.length == 0) {
        logger("error", "No Steam accounts found! Add one via the interface (menu item 7 -> add) or fill in accounts.json. Aborting...");

        if (!menuMode) process.exit(1);
        return false;
    }

    logger("info", `Found ${accounts.length} account(s): ${accounts.map((a) => a.accountName).join(", ")}`);

    // Загружаем адресаты и комментарии один раз (общие для всех аккаунтов)
    logger("info", "Loading comment destinations from destinations.txt...", false, true, logger.animation("loading"));

    const { loadDestinations } = require("./helpers/loadDestinations.js");
    const destinations = await loadDestinations(config.destinationResolveDelay);

    if (destinations.length == 0) {
        logger("error", "No valid destinations found to comment on! Exiting...");

        if (!menuMode) process.exit(1);
        return false;
    }

    const { getQuote } = require("./helpers/getQuote.js");

    const quotes = await new Promise((resolve) => getQuote((err, q) => resolve(err ? [] : q)));

    if (quotes.length == 0) {
        logger("error", "No comments found in comments.txt! Please provide messages I can choose from in comments.txt! Exiting...");

        if (!menuMode) process.exit(1);
        return false;
    }

    const loopRepeats = Math.max(1, parseInt(config.loopRepeats) || 1);

    // Задержки: postDelay - между отдельными постами одного аккаунта, accountStartDelay - между стартами аккаунтов
    const postDelay         = Math.max(0, parseInt(config.postDelay ?? config.commentdelay));
    const accountStartDelay = Math.max(0, parseInt(config.accountStartDelay ?? 2000));

    // Show ready message
    logger("", "", true);
    logger("", "*-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-*", true);
    logger("", `> Аккаунты: ${accounts.map((a) => a.accountName).join(", ")} (${accounts.length})`, true);
    logger("", `> Адресатов: ${destinations.length}`, true);
    logger("", `> Комментариев в списке (comments.txt): ${quotes.length}`, true);
    logger("", `> Задержка между постами: ${postDelay} мс | между аккаунтами: ${accountStartDelay} мс`, true);
    if (loopRepeats > 1) logger("", `> Режим цикла: ${loopRepeats} проход(ов), пауза между проходами ${config.loopDelay ?? 0} мс`, true);
    logger("", "*-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-*", true);
    logger("", "", true);

    // Общий progress bar по всем аккаунтам
    const totalAll = destinations.length * loopRepeats * accounts.length;
    let totalSent  = 0;

    logger.createProgressBar();
    global.updateProgress = () => {
        totalSent++;
        logger.setProgressBar(totalSent / totalAll * 100);
    };

    // Стартуем аккаунты с задержкой accountStartDelay между запусками (каждый со своей сессией и 2FA при необходимости)
    const results = [];

    for (let i = 0; i < accounts.length; i++) {
        if (i > 0 && accountStartDelay > 0) await new Promise((r) => setTimeout(r, accountStartDelay));

        logger("info", `Запускаю аккаунт ${i + 1}/${accounts.length}: ${accounts[i].accountName}`);
        results.push(await runAccount(accounts[i], destinations, quotes, menuMode));
    }

    const okCount = results.filter(Boolean).length;

    logger("info", `Все аккаунты завершили работу! Успешно опубликовано хотя бы одного комментария: ${okCount}/${accounts.length}`);
    if (okCount < accounts.length) logger("warn", "Внимание: статус «успешно» означает, что комментарий РЕАЛЬНО принят Steam. Если он ниже общего числа - смотрите сообщения «Failed for ...» выше (например, группа закрыта для не-участников или аккаунту запрещено писать комментарии).\n");

    if (!menuMode) {
        logger("info", "Exiting in 5 seconds...");
        setTimeout(() => process.exit(0), 5000);
    }

    return true;
}


/**
 * Сохраняет config.json с текущими значениями
 */
function saveConfig() {
    require("fs").writeFileSync("./config.json", JSON.stringify(config, null, 4));
}


/**
 * Меню управления аккаунтами (мультиаккаунты): показать / добавить / удалить
 * @returns {Promise<void>}
 */
async function accountsMenu() {
    const ui = require("./ui.js");
    const { loadAccounts, upsertAccount, removeAccount } = require("./accounts.js");

    /* eslint-disable no-constant-condition */
    while (true) {
        const list = loadAccounts();

        console.log("");
        ui.line("=");
        console.log(ui.paint("bold", `  АККАУНТЫ (${list.length})`));
        ui.line("=");
        list.forEach((a, i) => console.log(`   ${i + 1}. ${ui.paint("green", a.accountName)}${a.sharedSecret ? ui.paint("dim", " [2FA-ключ]") : ""}`));
        if (list.length == 0) console.log(ui.paint("dim", "   (список пуст - добавьте аккаунт)"));
        console.log(`   ${ui.paint("green", "a.")} Добавить / обновить аккаунт`);
        console.log(`   ${ui.paint("red", "d.")} Удалить аккаунт`);
        console.log(`   ${ui.paint("yellow", "b.")} Назад в главное меню`);
        ui.line("=");

        const choice = await ui.ask("Выбор: ");

        if (choice == "b" || choice == "") return;

        if (choice == "a") {
            const name = await ui.ask("Логин Steam (accountName): ");

            if (!name) {
                ui.msg("info", "Пустое имя - отменено.");
                continue;
            }

            const pass = await ui.ask("Пароль (или 'qrcode' для входа по QR без пароля): ");
            const secret = await ui.ask("sharedSecret из Steam Guard (Enter = не использовать, обычный ввод кода): ");

            upsertAccount({ accountName: name, password: pass || "", sharedSecret: secret || "" });
            ui.msg("ok", `Аккаунт '${name}' сохранен в accounts.json!`);
            ui.msg("info", "При следующем запуске комментирования будет выполнен вход (QR / код Steam Guard / sharedSecret),");
            ui.msg("info", "после чего токен сохранится и вводить пароль/код повторно не потребуется.");
        } else if (choice == "d") {
            const name = await ui.ask("Имя аккаунта для удаления: ");

            if (removeAccount(name)) ui.msg("ok", `Аккаунт '${name}' удален!`);
            else ui.msg("err", "Аккаунт не найден!");
        }
    }
}


/**
 * Интерфейс программы: меню, написание комментариев в цикле, аккаунты и запуск бота
 */
async function runInterface() {
    const fs = require("fs");
    const ui = require("./ui.js");

    console.log("");
    ui.printHeader();

    /* eslint-disable no-constant-condition */
    while (true) {
        ui.printMenu();

        const choice = await ui.ask("Выберите пункт меню: ");

        switch (choice) {
            case "1": { // Написать комментарий (в цикле)
                const countRaw = await ui.ask("Сколько комментариев написать в цикле? (число, или Enter = 1): ");
                const count = Math.max(1, parseInt(countRaw) || 1);

                for (let i = 1; i <= count; i++) { // Цикл написания комментариев
                    const text = await ui.ask(`Комментарий #${i}/${count} (пустая строка = отмена): `);

                    if (!text) {
                        ui.msg("info", "Отменено пользователем.");
                        break;
                    }

                    fs.appendFileSync("./comments.txt", text + "\n"); // Сохраняем в comments.txt
                    ui.msg("ok", `Комментарий #${i} добавлен в comments.txt!`);
                }

                break;
            }
            case "2": { // Показать список комментариев
                const quotes = fs.existsSync("./comments.txt") ? fs.readFileSync("./comments.txt", "utf8").split("\n").filter((l) => l.trim().length > 0) : [];

                if (quotes.length == 0) { ui.msg("err", "comments.txt пуст или не найден!"); break; }

                ui.msg("info", `Комментарии (${quotes.length}):`);
                quotes.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));

                break;
            }
            case "3": { // Удалить комментарий
                const lines0 = fs.existsSync("./comments.txt") ? fs.readFileSync("./comments.txt", "utf8").split("\n").filter((l) => l.trim().length > 0) : [];

                if (lines0.length == 0) { ui.msg("err", "comments.txt пуст или не найден!"); break; }

                lines0.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));

                const idxRaw = await ui.ask("Введите номер комментария для удаления (0 = отмена): ");
                const idx = parseInt(idxRaw) || 0;

                if (idx <= 0) break;

                const lines = fs.readFileSync("./comments.txt", "utf8").split("\n").filter((l) => l.trim().length > 0);

                if (idx > lines.length) {
                    ui.msg("err", "Комментарий с таким номером не найден!");
                    break;
                }

                lines.splice(idx - 1, 1);
                fs.writeFileSync("./comments.txt", lines.join("\n") + "\n");
                ui.msg("ok", "Комментарий удален!");

                break;
            }
            case "4": { // Очистить все комментарии
                const confirm = await ui.ask("Точно очистить ВСЕ комментарии? (y/N): ");

                if (confirm.toLowerCase() == "y") {
                    fs.writeFileSync("./comments.txt", "");
                    ui.msg("ok", "comments.txt очищен!");
                } else {
                    ui.msg("info", "Отменено.");
                }

                break;
            }
            case "5": { // Настройки
                console.log("");
                ui.msg("info", ui.paint("bold", "Текущие настройки:"));
                console.log(`    commentdelay        = ${config.commentdelay} мс ${ui.paint("dim", "(базовая задержка)")}`);
                console.log(`    postDelay           = ${config.postDelay ?? config.commentdelay} мс ${ui.paint("dim", "(пауза МЕЖДУ отдельными постами одного аккаунта)")}`);
                console.log(`    accountStartDelay   = ${config.accountStartDelay ?? 2000} мс ${ui.paint("dim", "(пауза между стартами аккаунтов)")}`);
                console.log(`    loopRepeats         = ${config.loopRepeats ?? 1} ${ui.paint("dim", "(сколько раз пройти по всем адресатам)")}`);
                console.log(`    loopDelay           = ${config.loopDelay ?? 0} мс ${ui.paint("dim", "(пауза между проходами цикла)")}`);

                const cd = await ui.ask("Новый commentdelay, мс (Enter = оставить): ");
                if (cd && !isNaN(parseInt(cd))) config.commentdelay = parseInt(cd);

                const pd = await ui.ask("Новая пауза между постами postDelay, мс (Enter = оставить): ");
                if (pd && !isNaN(parseInt(pd))) config.postDelay = parseInt(pd);

                const asd = await ui.ask("Новая пауза между аккаунтами accountStartDelay, мс (Enter = оставить): ");
                if (asd && !isNaN(parseInt(asd))) config.accountStartDelay = parseInt(asd);

                const lr = await ui.ask("Новое число повторов цикла loopRepeats (Enter = оставить): ");
                if (lr && !isNaN(parseInt(lr))) config.loopRepeats = parseInt(lr);

                const ld = await ui.ask("Новая пауза между циклами loopDelay, мс (Enter = оставить): ");
                if (ld && !isNaN(parseInt(ld))) config.loopDelay = parseInt(ld);

                saveConfig();
                ui.msg("ok", "Настройки сохранены в config.json!");

                break;
            }
            case "6": { // Destinations
                const list = fs.existsSync("./destinations.txt") ? fs.readFileSync("./destinations.txt", "utf8").split("\n").filter((l) => l.trim().length > 0) : [];

                ui.msg("info", `Адресатов в destinations.txt: ${list.length}`);
                list.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));

                const action = await ui.ask("Действие: add (добавить) / del N (удалить по номеру) / back: ");

                if (action.startsWith("add")) {
                    const dest = (action.slice(3).trim()) || await ui.ask("URL / vanity / steamID64: ");

                    if (dest) {
                        fs.appendFileSync("./destinations.txt", dest + "\n");
                        ui.msg("ok", "Адресат добавлен!");
                    }
                } else if (action.startsWith("del")) {
                    const idx = parseInt(action.slice(3)) || 0;

                    if (idx >= 1 && idx <= list.length) {
                        list.splice(idx - 1, 1);
                        fs.writeFileSync("./destinations.txt", list.join("\n") + (list.length ? "\n" : ""));
                        ui.msg("ok", "Адресат удален!");
                    } else {
                        ui.msg("err", "Неверный номер!");
                    }
                }

                break;
            }
            case "7": { // Аккаунты (мультиаккаунты)
                await accountsMenu();

                break;
            }
            case "8": { // Запустить комментирование
                ui.close(); // Освобождаем stdin для possible 2FA-ввода внутри sessionHandler

                ui.msg("info", "Запускаю комментирование... После завершения нажмите Enter для возврата в меню");
                await startCommenting(true);

                console.log("");
                await ask("Нажмите Enter чтобы вернуться в меню...");

                break;
            }
            case "9": { // Обновление с GitHub
                const confirm = await ui.ask("> Обновить программу до свежей версии с GitHub? Ваши настройки, комментарии и адресаты сохранятся. (y/N): ");

                if (confirm.toLowerCase() != "y") {
                    ui.msg("info", "Отменено.");
                    break;
                }

                try {
                    const path = require("path");
                    const { updateFromGitHub } = require("./update.js");

                    await updateFromGitHub(path.join(__dirname, ".."));
                    ui.msg("ok", "Обновление завершено! Перезапустите программу (npm start), чтобы применить новые файлы.");
                } catch (err) {
                    ui.msg("err", `Ошибка обновления: ${err.message}`);
                    ui.msg("info", "Убедитесь, что есть доступ в интернет (github.com).");
                }

                break;
            }
            case "10": // Выход
                ui.close();
                ui.msg("info", "Пока!");
                process.exit(0);
                break;
            default:
                ui.msg("err", "Неизвестный пункт меню, попробуйте еще раз.");
        }
    }
}


/**
 * Точка входа: загружает файлы конфигурации и решает, запускаться ли через интерфейс или как раньше
 */
module.exports.run = async () => {

    // Если задан флаг --update (или команда `npm update-bot`) - обновляемся с GitHub и выходим.
    // Делается ДО загрузки config/logininfo, чтобы обновление работало даже при битых личных файлах.
    if (process.argv.includes("--update")) {
        const path = require("path");
        const { updateFromGitHub } = require("./update.js");

        console.log("SpamSt - обновление с GitHub");
        console.log("-----------------------------");

        return updateFromGitHub(path.join(__dirname, ".."))
            .then(() => console.log("\nОбновление завершено! Запустите программу заново: npm start"))
            .catch((err) => {
                console.error(`Ошибка обновления: ${err.message}`);
                console.error("Убедитесь, что есть доступ в интернет (github.com).");
                process.exit(1);
            });
    }

    // Пробуем загрузить файлы и показываем кастомную ошибку если не получилось
    try {
        config = require("../config.json");
    } catch (err) {
        console.log(`Failed to read config.json! Did you make a syntax mistake?\n        ${err}\n        Exiting...`);
        process.exit(1);
    }

    // Значения по умолчанию для режима цикла и задержек
    if (typeof config.loopRepeats === "undefined") config.loopRepeats = 1;
    if (typeof config.loopDelay === "undefined") config.loopDelay = 0;
    if (typeof config.postDelay === "undefined") config.postDelay = config.commentdelay;
    if (typeof config.accountStartDelay === "undefined") config.accountStartDelay = 2000;

    // Если задан флаг --no-ui (или env NO_UI=1) - работаем как раньше, без интерфейса
    const noUi = process.argv.includes("--no-ui") || process.env.NO_UI == "1";

    if (noUi) {
        global.logger = logger; // заглушка чтобы helpers не падали до инициализации
        return startCommenting(false);
    }

    runInterface();
};
