/*
 * File: src/helpers/comment.js
 * Project: SpamSt
 *
 * Отправляет один комментарий на указанный адресат (профиль/группу/sharedfile/обсуждение/review).
 * Для профилей и групп проверяет реальный ответ Steam: библиотека steamcommunity у postGroupComment
 * НЕ проверяет содержимое ответа (комментарий может не пройти - например группа с ограничением
 * "только участники"), поэтому мы сами разбираем JSON-ответ и показываем причину отказа.
 */

const randomstring = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Заглушка чтобы errback вызывался ровно один раз даже если библиотека дернет callback дважды
const once = (fn) => { let done = false; return (...args) => { if (done) return; done = true; fn(...args); }; };


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
 * Пытается вступить в группу (для открытых групп это мгновенное действие;
 * для групп по заявке - отправляет заявку, которую модератор должен одобрить).
 * ВАЖНО: steamcommunity.joinGroup принимает ТОЛЬКО текстовое имя группы (tradecenter2016)
 * или формат [gid:103582...] - числовой gid64 без скобок Steam не находит и отвечает
 * "There was an error retrieving information about the specified group".
 * @param {string} gid64 Числовой SteamID64 группы (103582...) - используется как запасной вариант
 * @param {string|null} groupName Текстовое имя группы из URL (tradecenter2016), если известно
 * @param {object} community Экземпляр SteamCommunity
 * @param {Function} callback Вызывается как callback(err)
 */
function tryJoinGroup(gid64, groupName, community, callback) {
    const target = groupName || `[gid:${gid64}]`;
    try {
        community.joinGroup(target, (err) => callback(err || null));
    } catch (e) {
        callback(e);
    }
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
    const options = {
        uri: `https://steamcommunity.com/comment/Clan/post/${gid64}/-1/`,
        form: {
            comment: quote,
            count: 6,
            sessionid: community.getSessionID(),
        },
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://steamcommunity.com/gid/${gid64}`,
        },
        json: true,
    };

    community.httpRequestPost(options, (err, response, body) => {
        if (err) return callback(err);
        if (!response || response.statusCode >= 400) return callback(new Error(`HTTP error ${response ? response.statusCode : "?"}`));
        // ВАЖНО: steamcommunity сам разбирает JSON если options.json=true и кладёт объект в response.body,
        // а аргумент body может быть строкой - проверяем оба варианта
        const parsed = (body && typeof body === "object") ? body
            : ((response.body && typeof response.body === "object") ? response.body
                : (() => { try { return JSON.parse(body); } catch (e) { return null; } })());

        if (parsed === null || typeof parsed !== "object") return callback(new Error("Неожиданный ответ Steam (не JSON) - возможно аккаунт не авторизован или страница требует входа"));

        // Steam возвращает success:true либо success:false + сообщение о причине
        if (parsed.success) return callback(null);

        const reason = parsed.message || (typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 200) : String(parsed));

        // Расшифровываем частые причины отказа для групп
        let hint = "";

        if (String(reason).includes("do not allow you to add comments")) {
            hint = " Причина: у аккаунта нет прав писать в эту группу (аккаунт не состоит в группе / закрытая группа / комментарии только для участников / ограниченная учетная запись Steam без покупок). Бот автоматически попробовал вступить (autoJoinGroups) - если это не помогло, группа закрыта для новых участников / требует одобрения заявки модератором, либо аккаунт ограничен (нет покупок в Steam).";
        } else if (String(reason).includes("posting comments is currently disabled")) {
            hint = " Причина: в этой группе отключены комментарии.";
        }

        return callback(new Error(`Steam отказал в публикации: ${reason}${hint}`));
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

            const joinErr = await new Promise((resolve) => tryJoinGroup(gid64, dest.groupName || null, community, resolve));

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
