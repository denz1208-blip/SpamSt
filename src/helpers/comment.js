/*
 * File: src/helpers/comment.js
 * Project: SpamSt
 *
 * Отправляет один комментарий на указанный адресат (профиль/группу/sharedfile/обсуждение/review).
 * Логика публикации взята из эталонного проекта steam-mass-comment-bot (steamcommunity.postGroupComment),
 * но с проверкой реального JSON-ответа Steam, чтобы показывать настоящую причину отказа.
 *
 * ВАЖНО про sessionid: steamcommunity хранит куки в jar по хосту. getSessionID() без аргумента
 * читает "http://steamcommunity.com", а webSession-логин кладёт куки в https-jar. Если jar пуст,
 * библиотека ГЕНЕРИРУЕТ случайный sessionid - Steam отвечает "Missing or invalid form session key".
 * Поэтому ниже используется getCurrentSessionID(community) - он перебирает оба банка (https/http)
 * и берёт НАСТОЯЩИЙ sessionid из кук сессии.
 */

const randomstring = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Заглушка чтобы errback вызывался ровно один раз даже если библиотека дернет callback дважды
const once = (fn) => { let done = false; return (...args) => { if (done) return; done = true; fn(...args); }; };

/**
 * Возвращает РЕАЛЬНЫЙ sessionid из cookie-jar библиотеки steamcommunity.
 * Перебирает https- и http-варианты хоста; никогда не возвращает сгенерированную заглушку.
 * @param {object} community Экземпляр SteamCommunity
 * @returns {string|null}
 */
function getCurrentSessionID(community) {
    for (const host of ["https://steamcommunity.com", "http://steamcommunity.com"]) {
        try {
            const cookies = String(community._jar.getCookieString(host) || "");
            const m = cookies.match(/(?:^|;\s*)sessionid=([^;]+)/);
            if (m) return decodeURIComponent(m[1].trim());
        } catch (e) { /* пробуем следующий банк */ }
    }
    return null;
}


/**
 * Проверяет права аккаунта на публикацию комментариев в группе БЕЗ реальной отправки текста.
 * Используем GET-эндпоинт Steam comment/Clan/canPost/<gid64>/ - он отвечает на вопрос
 * "можно ли этому аккаунту писать в группу" и НИЧЕГО не публикует (в отличие от POST с пустым
 * текстом, который у некоторых типов групп мог создать скрытый/мусорный пост).
 * Ответ: {"success":true,"can_post":true} либо {"success":true,"can_post":false,"message":"причина"}.
 * @param {string} gid64 Числовой SteamID64 группы (103582...)
 * @param {object} community Экземпляр SteamCommunity
 * @param {Function} callback Вызывается как callback(err, canPost, reasonText)
 */
function checkGroupPostingRights(gid64, community, callback) {
    const uri = `https://steamcommunity.com/comment/Clan/canPost/${gid64}/?ajax=1`;

    // ВАЖНО: сигнатура httpRequestGet у steamcommunity - (uri, options, callback, source).
    // Если передать вторым аргументом строку "steamcommunity", библиотека примет её за callback
    // и упадёт с "callback.apply is not a function". Поэтому источник указываем 4-м аргументом.
    community.httpRequestGet({
        uri: uri,
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://steamcommunity.com/groups/${gid64}`,
        },
    }, null, (err, response, body) => {
        if (err) return callback(err);

        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { /* не JSON */ }

        // Не смогли разобрать ответ - считаем что права есть, реальная публикация сама всё проверит
        if (parsed === null || typeof parsed !== "object") return callback(null, true, "");

        if (parsed.can_post === true) return callback(null, true, "");
        if (parsed.can_post === false) return callback(null, false, String(parsed.message || "Steam не разрешает этому аккаунту писать комментарии в эту группу"));

        // Формат ответа неизвестен - не блокируем, пусть пробует реальный пост
        return callback(null, true, "");
    });
}


/**
 * Пытается вступить в группу напрямую POST-запросом на страницу группы.
 * ВАЖНО: steamcommunity.joinGroup НЕПРИГОДЕН - внутри он делает new SteamID(gid),
 * который падает и на текстовом имени группы ("Unknown SteamID input format").
 * Поэтому шлём запрос сами точно так же,
 * как это делает веб-интерфейс Steam: POST https://steamcommunity.com/groups/NAME
 * с form-полями action=join, acceptage=agree (согласие с правилами группы) и sessionid.
 * Для открытых групп это мгновенное вступление; для групп по заявке - отправка заявки.
 * @param {string} groupName Текстовое имя группы из URL (tradecenter2016)
 * @param {string} gid64 Числовой SteamID64 группы (для Referer и запаса)
 * @param {object} community Экземпляр SteamCommunity (нужен для cookies/sessionid)
 * @param {Function} callback Вызывается как callback(err)
 */
function tryJoinGroup(groupName, gid64, community, callback) {
    callback = once(callback);
    if (!groupName) return callback(new Error("неизвестно текстовое имя группы"));

    // Таймер защиты от зависания: любой HTTP-шаг не может держать нас дольше 30 секунд
    const watchdog = setTimeout(() => callback(new Error("таймаут 30с при попытке вступления в группу")), 30000);
    const finish = (err) => { clearTimeout(watchdog); callback(err); };

    // Сначала GET-запросом открываем страницу группы: Steam отдаёт в куки СВОЙ sessionid,
    // а в HTML - <input name="sessionid">. Используем именно его (как это делает браузер при
    // нажатии кнопки "Join") - это исключает "Missing or invalid form session key".
    community.httpRequestGet({
        uri: `https://steamcommunity.com/groups/${groupName}`,
        headers: { "Referer": "https://steamcommunity.com/" },
        timeout: 20000,
    }, null, (err, response, body) => {
        if (err) return finish(err);

        let sid = getCurrentSessionID(community); // настоящий sessionid из jar после сохранения кук ответа

        // запасной вариант - значение из формы на странице
        if (!sid && body) {
            const m = String(body).match(/name="sessionid"\s+value="([^"]+)"/i) || String(body).match(/g_sessionID\s*=\s*"([^"]+)"/);
            if (m) sid = m[1];
        }

        if (!sid) return finish(new Error("не удалось получить sessionid (куки сессии не найдены - перелогиньтесь)"));

        const options = {
            uri: `https://steamcommunity.com/groups/${groupName}`,
            form: {
                action: "join",
                acceptage: "agree",
                sessionid: sid,
            },
            headers: {
                "Referer": `https://steamcommunity.com/groups/${groupName}`,
            },
            timeout: 20000,
        };

        community.httpRequestPost(options, (err2, response2, body2) => {
            if (err2) return finish(err2);
            if (!response2 || response2.statusCode >= 400) return finish(new Error(`HTTP error ${response2 ? response2.statusCode : "?"}`));

            // Steam не возвращает явного JSON при вступлении - проверяем страницу ответа:
            // если там есть кнопка "Leave"/"Покинуть" или запись участника - мы в группе.
            const text = String(body2 || (response2.body ? String(response2.body) : ""));

            if (/leavegroup|leave group|покинуть/i.test(text)) return finish(null);

            if (/this group is private|requires approval|invite-only|закрыт/i.test(text)) {
                return finish(new Error("группа закрыта для свободного вступления (требует приглашения/одобрения заявки модератором)"));
            }

            // Не уверены - перечитаем страницу группы: наличие кнопки выхода = участник
            community.httpRequestGet({ uri: `https://steamcommunity.com/groups/${groupName}`, timeout: 20000 }, null, (err3, res3, body3) => {
                if (err3) return finish(null); // считаем запрос выполненным, решение примет повторная публикация
                const t3 = String(body3 || "");
                if (/leavegroup|leave group|покинуть/i.test(t3)) return finish(null);
                finish(new Error("вступление не подтверждено (страница группы не показывает членство - возможно группа по заявке/инвайту)"));
            });
        }, "steamcommunity");
    });
}


/**
 * Постит комментарий в группу напрямую через тот же эндпоинт что и profile-комментарии,
 * но с проверкой успешности ответа Steam (success / message).
 * @param {string} gid64 Числовой SteamID64 группы (103582...)
 * @param {string} quote Текст комментария
 * @param {object} community Экземпляр SteamCommunity (для cookies/sessionid/httpRequestPost)
 * @param {Function} callback Вызывается как callback(err)
 */
function postGroupCommentChecked(gid64, quote, community, callback) {
    callback = once(callback);

    // ВАЖНО: sessionid берём ТОЛЬКО из настоящих кук сессии (getCurrentSessionID).
    // Никогда не вызываем getSessionID() - при пустом jar он генерирует случайный id,
    // и Steam отвечает "Missing or invalid form session key".
    const sid = getCurrentSessionID(community);
    if (!sid) return callback(new Error("куки сессии потеряны (sessionid не найден) - удалите сохранённый токен и залогиньтесь заново"));

    // Формируем запрос точно как эталонная steamcommunity.postGroupComment (из steam-mass-comment-bot),
    // но добавляем json:true чтобы разобрать ответ Steam и проверить success
    const options = {
        uri: `https://steamcommunity.com/comment/Clan/post/${gid64}/-1/`,
        form: {
            comment: quote,
            count: 6,
            sessionid: sid,
        },
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://steamcommunity.com/gid/${gid64}`,
        },
        json: true,
        timeout: 20000,
    };

    // Защита от зависания: если Steam не ответит - колбэк придёт через таймер
    const watchdog = setTimeout(() => callback(new Error("таймаут 30с при публикации комментария в группу")), 30000);
    const finish = (...args) => { clearTimeout(watchdog); callback(...args); };

    community.httpRequestPost(options, (err, response, body) => {
        if (err) return finish(err);
        if (!response || response.statusCode >= 400) return finish(new Error(`HTTP error ${response ? response.statusCode : "?"}`));
        // ВАЖНО: steamcommunity сам разбирает JSON если options.json=true и кладёт объект в response.body,
        // а аргумент body может быть строкой - проверяем оба варианта
        const parsed = (body && typeof body === "object") ? body
            : ((response.body && typeof response.body === "object") ? response.body
                : (() => { try { return JSON.parse(body); } catch (e) { return null; } })());

        if (parsed === null || typeof parsed !== "object") return finish(new Error("Неожиданный ответ Steam (не JSON) - возможно аккаунт не авторизован или страница требует входа"));

        // Steam возвращает success:true либо success:false + сообщение о причине
        if (parsed.success) return finish(null);

        const reason = parsed.message || (typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 200) : String(parsed));

        // Расшифровываем частые причины отказа для групп
        let hint = "";

        if (String(reason).includes("do not allow you to add comments")) {
            hint = " Причина: у аккаунта нет прав писать в эту группу (аккаунт не состоит в группе / закрытая группа / комментарии только для участников / ограниченная учетная запись Steam без покупок). Бот автоматически попробовал вступить (autoJoinGroups) - если это не помогло, группа закрыта для новых участников / требует одобрения заявки модератором, либо аккаунт ограничен (нет покупок в Steam).";
        } else if (String(reason).includes("posting comments is currently disabled")) {
            hint = " Причина: в этой группе отключены комментарии.";
        } else if (String(reason).includes("form session key")) {
            hint = " Причина: куки сессии устарели - выполните повторный вход (пункт меню «Аккаунты» → перелогин).";
        }

        return finish(new Error(`Steam отказал в публикации: ${reason}${hint}`));
    }, "steamcommunity");
}


/**
 * Комментирует одну страницу Steam
 * @param {{ raw: string, processed: string, type: string }} dest Адресат из loadDestinations
 * @param {Array<string>} quotes Список комментариев
 * @param {object} community Экземпляр SteamCommunity
 * @param {Function} callback Вызывается как callback(err, sentText)
 */
module.exports.comment = async function(dest, quotes, community, callback) {
    callback = once(callback);

    // Выбираем случайный комментарий из списка
    const quote = randomstring(quotes);

    // Группы комментируем собственной функцией с проверкой ответа Steam (см. начало файла).
    // Публикуем сразу; если Steam отказал из-за прав - при включенном autoJoinGroups
    // автоматически вступаем в группу и повторяем публикацию один раз.
    if (dest.type == "group") {
        const gid64 = dest.processed;

        global.logger("info", `Commenting on 'group' '${gid64}': ${quote.split("\n")[0]}`, false, false, global.logger.animation("loading"));

        const firstErr = await new Promise((resolve) => postGroupCommentChecked(gid64, quote, community, resolve));

        if (!firstErr) return callback(null, quote);

        const isRightsError = String(firstErr.message || firstErr).includes("do not allow you to add comments");
        const autoJoin = require("../../config.json").autoJoinGroups !== false;

        // Пробуем спасти публикацию авто-вступлением только при отказе по правам
        if (isRightsError && autoJoin) {
            global.logger("warn", `Группа '${gid64}' отказала в правах - пробую вступить автоматически...`);

            const joinErr = await new Promise((resolve) => tryJoinGroup(dest.groupName || null, gid64, community, resolve));

            if (joinErr) {
                global.logger("warn", `Не удалось вступить в группу '${gid64}': ${joinErr}`);
            } else {
                // Даём Steam секунду применить членство и повторяем публикацию
                await new Promise((r) => setTimeout(r, 1000));

                const retryErr = await new Promise((resolve) => postGroupCommentChecked(gid64, quote, community, resolve));

                if (!retryErr) {
                    global.logger("info", `Вступление в группу '${gid64}' помогло - комментарий опубликован!`);
                    return callback(null, quote);
                }

                global.logger("warn", `После вступления Steam всё равно отказал '${gid64}': ${retryErr}. Возможно группа требует одобрения заявки модератором, либо аккаунт ограничен (нет покупок в Steam).`);
                return callback(retryErr, null);
            }
        }

        global.logger("warn", `Failed to comment on 'group' '${gid64}'! ${firstErr}`);
        return callback(firstErr, null);
    }

    // Определяем функцию и аргументы в зависимости от типа адресата
    let postComment;
    let commentArgs = {};

    switch (dest.type) {
        case "profile":
            postComment = community.postUserComment;
            commentArgs = { receiverSteamID64: dest.processed, quote: null };
            break;
        case "sharedfile":
            postComment = community.postSharedFileComment;
            commentArgs = { sharedfileOwnerId: null, sharedfileId: dest.processed, quote: null };

            // Получаем sharedfileOwnerId скрейпингом DOM
            await (() => new Promise((resolve) => {
                community.getSteamSharedFile(dest.processed, (err, obj) => {
                    if (err) return callback(err);

                    commentArgs.sharedfileOwnerId = obj.owner.getSteamID64();
                    resolve();
                });
            }))();
            break;
        case "discussion":
            postComment = community.postDiscussionComment;
            commentArgs = { topicOwner: null, gidforum: null, discussionId: null, quote: null };

            // Получаем topicOwner и gidforum скрейпингом DOM
            await (() => new Promise((resolve) => {
                community.getSteamDiscussion(dest.processed, (err, obj) => {
                    if (err) return callback(err);

                    commentArgs.topicOwner = obj.topicOwner;
                    commentArgs.gidforum = obj.gidforum;
                    commentArgs.discussionId = obj.id;
                    resolve();
                });
            }))();
            break;
        case "review": {
            const idArr = dest.processed.split("/");

            postComment = community.postReviewComment;
            commentArgs = { receiverSteamID64: idArr[0], appID: idArr[1], quote: null };
            break;
        }
        default:
            return callback(new Error(`Unsupported destination type '${dest.type}' for entry '${dest.raw}'`));
    }

    // Выбираем случайный комментарий из списка
    commentArgs.quote = quote;

    global.logger("info", `Commenting on '${dest.type}' '${dest.processed}': ${commentArgs.quote.split("\n")[0]}`, false, false, global.logger.animation("loading"));

    // Вызываем функцию, сохраняя контекст (this.) через call()
    postComment.call(community, ...Object.values(commentArgs), (err) => {
        if (err) global.logger("warn", `Failed to comment on '${dest.type}' '${dest.processed}'! ${err}`);

        callback(err, commentArgs.quote);
    });
};
