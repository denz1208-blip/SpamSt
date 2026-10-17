/*
 * File: src/bot.js
 * Project: steam-mass-comment-bot
 *
 * Ядро бота: логин в Steam и цикл комментирования.
 * Поддерживает запуск из интерфейса (menuMode): по завершении управления меню,
 * а также повтор цикла комментирования (config.loopRepeats / config.loopDelay).
 */

const logger         = require("output-logger");
const SteamUser      = require("steam-user");
const SteamCommunity = require("steamcommunity");
const SteamTotp      = require("steam-totp");
const SteamID        = require("steamid");
const EResult        = SteamUser.EResult;

const data          = require("../data.json");
const { ask }       = require("./ui.js");

let config;
let logininfo;


/**
 * Запускает процесс комментирования: логин, загрузка адресатов и цикл комментариев
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

    const bot       = new SteamUser({ renewRefreshTokens: true });
    const community = new SteamCommunity();

    // Печатаем стартовые сообщения
    logger("", "\n", true);
    logger("info", `Starting steam-mass-comment-bot v${data.version} by 3urobeat`, true);
    logger("", "---------------------------------------------------------\n", true);

    // Показываем предупреждение если commentdelay слишком низкий
    if (config.commentdelay < 5000) logger("warn", "I strongly advise not setting the commentdelay below 5000ms!\n       You might be running in danger of getting banned for spamming or will at least get a cooldown rather quickly.", true);
    if (config.commentdelay <= 500) {
        logger("error", "Your commentdelay is way too low! This will either give you a cooldown instantly or outright ban you for spamming! Aborting...");

        if (!menuMode) process.exit(1);
        return false;
    }

    let session;

    /**
     * Пытается залогинить аккаунт
     */
    async function login() {
        logger("info", "Logging in...", false, false);

        // Генерируем auth code из sharedSecret если он предоставлен
        if (logininfo.sharedSecret) {
            logger("info", "Found sharedSecret, generating AuthCode and adding it to logOnOptions...");
            logininfo.steamGuardCode = SteamTotp.generateAuthCode(logininfo.sharedSecret);
        }

        session     = new (require("./sessions/sessionHandler.js"))(bot, logininfo.accountName, 0, logininfo);
        const token = await session.getToken();

        if (!token) {
            if (!menuMode) process.exit(1);
            return;
        }

        bot.logOn({ refreshToken: token });
    }

    login();

    bot.on("loggedOn", () => {
        logger("", "", true);
        logger("info", "Account logged in!");
    });

    // Устанавливаем cookies и запускаем загрузку адресатов
    bot.on("webSession", async (sessionID, cookies) => {
        community.setCookies(cookies);

        // Игровые сессии если включено
        if (config.playingGames.length > 0) bot.gamesPlayed(config.playingGames);

        logger("info", "Loading comment destinations from destinations.txt...", false, true, logger.animation("loading"));

        const { loadDestinations } = require("./helpers/loadDestinations.js");
        const destinations = await loadDestinations(config.destinationResolveDelay);

        if (destinations.length == 0) {
            logger("error", "No valid destinations found to comment on! Exiting...");

            if (!menuMode) process.exit(1);
            return;
        }

        const { getQuote } = require("./helpers/getQuote.js");

        getQuote((err, quotes) => {

            // Проверяем, что комментарии предоставлены
            if (err || quotes.length == 0) {
                logger("error", "No comments found in comments.txt! Please provide messages I can choose from in comments.txt! Exiting...");

                if (!menuMode) process.exit(1);
                return;
            }

            const loopRepeats = Math.max(1, parseInt(config.loopRepeats) || 1); // Сколько раз пройтись циклом по всем адресатам
            const loopDelay   = Math.max(config.commentdelay, parseInt(config.loopDelay) || 0); // Пауза между полными циклами

            // Show ready message
            logger("", "", true);
            logger("", "*-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-*", true);
            logger("", `> Logged in as ${logininfo.accountName}!`, true);
            logger("", `> Found ${destinations.length} destinations in config!`, true);
            logger("", `> Loaded ${quotes.length} quotes from comments.txt!`, true);
            logger("", `> Starting to comment in 5 seconds with ${config.commentdelay}ms delay!`, true);
            if (loopRepeats > 1) logger("", `> Loop mode ON: repeating the whole cycle ${loopRepeats} time(s) with ${loopDelay}ms pause between cycles!`, true);
            logger("", "*-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-*", true);
            logger("", "", true);

            // Создаем progress bar когда ниже стартует цикл
            setTimeout(() => logger.createProgressBar(), config.commentdelay);

            const { comment } = require("./helpers/comment.js");

            const failed = [];
            let http429err = false;
            let totalSent  = 0;
            const totalAll = destinations.length * loopRepeats;

            /**
             * Один проход цикла: комментирует все адреса по одному разу
             * @param {number} repeatIndex Номер текущего прохода цикла (с 1)
             * @returns {Promise<void>} Резолвится когда весь цикл завершится
             */
            function runCycle(repeatIndex) {
                return new Promise((resolve) => {
                    destinations.forEach((e, i) => {
                        setTimeout(() => {
                            if (http429err) return resolve(); // Блок дальнейших выполнений при кулдауне

                            comment(e, quotes, community, (err) => {
                                if (err) {
                                    failed.push(e.raw);

                                    if (String(err).includes("HTTP error 429") || String(err).includes("You've been posting too frequently, and can't make another post right now")) {
                                        logger("", "", true);
                                        logger("error", "Cooldown error detected! Aborting as all other comments from this IP will fail too! Please wait before trying again.\n        Exiting in 5 seconds...", true);

                                        http429err = true;
                                        if (!menuMode) setTimeout(() => process.exit(1), 5000);

                                        return resolve();
                                    }
                                }

                                totalSent++;

                                // Пересчитываем прогресс и обновляем progress bar
                                logger.setProgressBar(totalSent / totalAll * 100);

                                // Последний адресат этого прохода цикла?
                                if (i + 1 == destinations.length) {
                                    if (repeatIndex < loopRepeats && !http429err) {
                                        logger("info", `Finished cycle ${repeatIndex}/${loopRepeats}! Waiting ${loopDelay}ms before next cycle...`);

                                        setTimeout(() => {
                                            runCycle(repeatIndex + 1).then(resolve);
                                        }, loopDelay);
                                    } else {
                                        resolve();
                                    }
                                }
                            });
                        }, config.commentdelay * (i + 1)); // + 1 чтобы отложить и первую итерацию
                    });
                });
            }

            // Запускаем цикл комментирования (проходится loopRepeats раз)
            runCycle(1).then(() => {
                logger("info", "Finished commenting!\n");

                if (failed.length > 0) {
                    logger("info", "Failed: \n" + failed.join("\n"));
                    logger("", "", true);
                }

                if (!menuMode) {
                    logger("info", "Exiting in 5 seconds...");
                    setTimeout(() => process.exit(0), 5000);
                }
            });
        });
    });

    // Отвечает afkMessage если включено в конфиге
    bot.chat.on("friendMessage", (msg) => {
        const message = msg.message_no_bbcode;
        const steamID = msg.steamid_friend;
        const steamID64 = new SteamID(String(steamID)).getSteamID64();
        const username = bot.users[steamID64].player_name;

        logger("info", `Friend message from '${username}' (${steamID64}): ${message}`);

        if (config.afkMessage.length > 0) {
            logger("info", "Responding with: " + config.afkMessage);

            bot.chat.sendFriendMessage(steamID, config.afkMessage);
        }
    });

    // Эмитится когда refreshToken авто-обновлен SteamUser
    bot.on("refreshToken", (newToken) => {
        logger("info", "SteamUser auto renewed this refresh token, updating database entry...");

        session._saveTokenToStorage(newToken);
    });

    // Обрабатывает ошибку логина
    bot.on("error", (err) => {
        // Инвалидируем токен чтобы получить новую сессию если ошибка вызвана невалидным refreshToken
        if (err.eresult == EResult.InvalidPassword || err.eresult == EResult.AccessDenied || err == "Error: InvalidSignature") {
            logger("debug", "Token login error: Calling SessionHandler's _invalidateTokenInStorage() function to get a new session when retrying this login attempt");

            if (err.eresult == EResult.AccessDenied) logger("warn", "Detected an AccessDenied login error! This is usually caused by an invalid login token. Deleting login token, please re-submit your Steam Guard code.");

            session.invalidateTokenInStorage();

            setTimeout(() => login(), 5000);
            return;
        }

        logger("error", `Failed to log in! ${err}`);
    });

    return true;
}


/**
 * Сохраняет config.json с текущими значениями
 */
function saveConfig() {
    require("fs").writeFileSync("./config.json", JSON.stringify(config, null, 4));
}


/**
 * Интерфейс программы: меню, написание комментариев в цикле и запуск бота
 */
async function runInterface() {
    const fs = require("fs");
    const ui = require("./ui.js");

    console.log("");
    console.log("=====================================");
    console.log(" steam-mass-comment-bot - ИНТЕРФЕЙС ");
    console.log("=====================================");

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
                        console.log("> Отменено пользователем.");
                        break;
                    }

                    fs.appendFileSync("./comments.txt", text + "\n"); // Сохраняем в comments.txt
                    console.log(`> Комментарий #${i} добавлен в comments.txt!`);
                }

                break;
            }
            case "2": { // Показать список комментариев
                const { getQuote } = require("./helpers/getQuote.js");

                getQuote((err, quotes) => {
                    if (err || quotes.length == 0) return console.log("> comments.txt пуст или не найден!");

                    console.log(`> Комментарии (${quotes.length}):`);
                    quotes.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));
                });

                break;
            }
            case "3": { // Удалить комментарий
                const { getQuote } = require("./helpers/getQuote.js");

                getQuote((err, quotes) => {
                    if (err || quotes.length == 0) return console.log("> comments.txt пуст или не найден!");

                    quotes.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));
                });

                const idxRaw = await ui.ask("Введите номер комментария для удаления (0 = отмена): ");
                const idx = parseInt(idxRaw) || 0;

                if (idx <= 0) break;

                const lines = fs.readFileSync("./comments.txt", "utf8").split("\n").filter((l) => l.trim().length > 0);

                if (idx > lines.length) {
                    console.log("> Комментарий с таким номером не найден!");
                    break;
                }

                lines.splice(idx - 1, 1);
                fs.writeFileSync("./comments.txt", lines.join("\n") + "\n");
                console.log("> Комментарий удален!");

                break;
            }
            case "4": { // Очистить все комментарии
                const confirm = await ui.ask("Точно очистить ВСЕ комментарии? (y/N): ");

                if (confirm.toLowerCase() == "y") {
                    fs.writeFileSync("./comments.txt", "");
                    console.log("> comments.txt очищен!");
                } else {
                    console.log("> Отменено.");
                }

                break;
            }
            case "5": { // Настройки
                console.log(`> commentdelay (мс между комментариями): ${config.commentdelay}`);
                console.log(`> loopRepeats (сколько раз цикл проходит по списку): ${config.loopRepeats ?? 1}`);
                console.log(`> loopDelay (мс пауза между циклами): ${config.loopDelay ?? 0}`);

                const cd = await ui.ask("Новый commentdelay (Enter = оставить): ");
                if (cd && !isNaN(parseInt(cd))) config.commentdelay = parseInt(cd);

                const lr = await ui.ask("Новое число повторов цикла loopRepeats (Enter = оставить): ");
                if (lr && !isNaN(parseInt(lr))) config.loopRepeats = parseInt(lr);

                const ld = await ui.ask("Новая пауза между циклами loopDelay в мс (Enter = оставить): ");
                if (ld && !isNaN(parseInt(ld))) config.loopDelay = parseInt(ld);

                saveConfig();
                console.log("> Настройки сохранены в config.json!");

                break;
            }
            case "6": { // Destinations
                const list = fs.existsSync("./destinations.txt") ? fs.readFileSync("./destinations.txt", "utf8").split("\n").filter((l) => l.trim().length > 0) : [];

                console.log(`> Адресатов в destinations.txt: ${list.length}`);
                list.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));

                const action = await ui.ask("Действие: add (добавить) / del N (удалить по номеру) / back: ");

                if (action.startsWith("add")) {
                    const dest = (action.slice(3).trim()) || await ui.ask("URL / vanity / steamID64: ");

                    if (dest) {
                        fs.appendFileSync("./destinations.txt", dest + "\n");
                        console.log("> Адресат добавлен!");
                    }
                } else if (action.startsWith("del")) {
                    const idx = parseInt(action.slice(3)) || 0;

                    if (idx >= 1 && idx <= list.length) {
                        list.splice(idx - 1, 1);
                        fs.writeFileSync("./destinations.txt", list.join("\n") + (list.length ? "\n" : ""));
                        console.log("> Адресат удален!");
                    } else {
                        console.log("> Неверный номер!");
                    }
                }

                break;
            }
            case "7": { // Запустить комментирование
                ui.close(); // Освобождаем stdin для possible 2FA-ввода внутри sessionHandler

                console.log("> Запускаю комментирование... (по завершении вернитесь в меню кнопкой Enter)");
                await startCommenting(true);

                console.log("");
                await ask("Нажмите Enter чтобы вернуться в меню...");

                break;
            }
            case "8": // Выход
                ui.close();
                console.log("> Пока!");
                process.exit(0);
                break;
            default:
                console.log("> Неизвестный пункт меню, попробуйте еще раз.");
        }
    }
}


/**
 * Точка входа: загружает файлы конфигурации и решает, запускаться ли через интерфейс или как раньше
 */
module.exports.run = async () => {

    // data.json может оказаться поврежденным (например это GIF) - подстраховываемся
    try {
        data.version = require("../data.json").version || "unknown";
    } catch (err) {
        data.version = "unknown";
    }

    // Пробуем загрузить файлы и показываем кастомную ошибку если не получилось
    try {
        config = require("../config.json");
    } catch (err) {
        console.log(`Failed to read config.json! Did you make a syntax mistake?\n        ${err}\n        Exiting...`);
        process.exit(1);
    }

    try {
        logininfo = require("../logininfo.json");
    } catch (err) {
        console.log(`Failed to read logininfo.json! Did you make a syntax mistake?\n        ${err}\n        Exiting...`);
        process.exit(1);
    }

    // Значения по умолчанию для режима цикла
    if (typeof config.loopRepeats === "undefined") config.loopRepeats = 1;
    if (typeof config.loopDelay === "undefined") config.loopDelay = 0;

    // Если задан флаг --no-ui (или env NO_UI=1) - работаем как раньше, без интерфейса
    const noUi = process.argv.includes("--no-ui") || process.env.NO_UI == "1";

    if (noUi) {
        global.logger = logger; // заглушка чтобы helpers не падали до инициализации
        return startCommenting(false);
    }

    runInterface();
};
