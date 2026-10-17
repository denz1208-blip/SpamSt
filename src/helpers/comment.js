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
 * Использует тот же ajax-эндпоинт что и настоящая публикация, но с пустым комментарием:
 * Steam сначала проверяет права - если их нет, вернет "you do not have permission";
 * если права есть - вернет ошибку про пустой текст (значит постить можно).
 * @param {string} gid64 Числовой SteamID64 группы (103582...)
 * @param {object} community Экземпляр SteamCommunity
 * @param {Function} callback Вызывается как callback(err, canPost, reasonText)
 */
function checkGroupPostingRights(gid64, community, callback) {
    const options = {
        uri: `https://steamcommunity.com/comment/Clan/post/${gid64}/-1/`,
        form: {
            comment: "",
            count: 6,
            sessionid: community.getSessionID(),
        },
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://steamcommunity.com/groups/${gid64}`,
        },
        json: true,
    };

    community.httpRequestPost(options, (err, response, body) => {
        if (err) return callback(err);
        if (typeof body !== "object" || body === null) return callback(null, true, ""); // Не смогли проверить - считаем что можно, реальный пост сам разберется

        const msg = String(body.message || "");

        // Права ЕСТЬ: Steam дошел до валидации текста (пустой комментарий)
        if (/empty/i.test(msg)) return callback(null, true, "");

        // Steam прямо говорит что нет прав публиковать
        if (/permission|not allowed|banned|blocked/i.test(msg)) return callback(null, false, msg);

        // Другие причины (например "The settings on this account do not allow you to add comments")
        if (body.success !== true && msg.length > 0) return callback(null, false, msg);

        return callback(null, true, "");
    }, "steamcommunity");
}


/**
 * Пытается вступить в группу (для открытых групп это мгновенное действие;
 * для групп по заявке - отправляет заявку, которую модератор должен одобрить).
 * @param {string} gid64 Числовой SteamID64 группы
 * @param {object} community Экземпляр SteamCommunity
 * @param {Function} callback Вызывается как callback(err)
 */
function tryJoinGroup(gid64, community, callback) {
    try {
        community.joinGroup(gid64, (err) => callback(err || null));
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
        if (typeof body !== "object" || body === null) return callback(new Error("Неожиданный ответ Steam (не JSON) - возможно аккаунт не авторизован или страница требует входа"));

        // Steam возвращает success:true либо success:false + сообщение о причине
        if (body.success) return callback(null);

        const reason = body.message || (typeof body === "object" ? JSON.stringify(body).slice(0, 200) : String(body));

        // Расшифровываем частые причины отказа для групп
        let hint = "";

        if (String(reason).includes("do not allow you to add comments")) {
            hint = " Причина: у аккаунта нет прав писать в эту группу (аккаунт не состоит в группе / закрытая группа / комментарии только для участников / ограниченная учетная запись Steam без покупок). Включите авто-вступление (autoJoinGroups=true) или вступите вручную.";
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

    // Группы комментируем собственной функцией с проверкой ответа Steam (см. начало файла)
    if (dest.type == "group") {
        const gid64 = dest.processed;

        // Пред-проверка прав на публикацию (без отправки текста). Если прав нет -
        // при включенном autoJoinGroups пробуем вступить в группу и проверить снова.
        const precheck = await new Promise((resolve) => checkGroupPostingRights(gid64, community, (err, canPost, reason) => resolve({ err, canPost, reason })));

        if (!precheck.err && !precheck.canPost) {
            global.logger("warn", `Группа '${gid64}': Steam не даёт писать комментарии (${precheck.reason}).`);

            const autoJoin = require("../../config.json").autoJoinGroups !== false;

            if (autoJoin) {
                global.logger("info", `Пробую вступить в группу '${gid64}' автоматически...`);

                const joinErr = await new Promise((resolve) => tryJoinGroup(gid64, community, resolve));

                if (joinErr) {
                    return callback(new Error(`Не удалось вступить в группу: ${joinErr}. Причина отказа: ${precheck.reason}`), null);
                }

                // Даём Steam секунду применить членство и проверяем права заново
                await new Promise((r) => setTimeout(r, 1000));

                const recheck = await new Promise((resolve) => checkGroupPostingRights(gid64, community, (err, canPost2, reason2) => resolve({ err, canPost: canPost2, reason: reason2 })));

                if (!recheck.err && !recheck.canPost) {
                    return callback(new Error(`Вступил в группу '${gid64}', но Steam всё равно запрещает комментарии (${recheck.reason}). Возможно группа требует одобрения заявки модератором, либо аккаунт ограничен (нет покупок в Steam).`), null);
                }

                global.logger("info", `Вступление в группу '${gid64}' помогло - права на комментарии получены!`);
            } else {
                return callback(new Error(`Нет прав на комментарии в группе '${gid64}' (${precheck.reason}). Авто-вступление выключено (autoJoinGroups=false) - вступите вручную.`), null);
            }
        }

        global.logger("info", `Commenting on 'group' '${gid64}': ${quote.split("\n")[0]}`, false, false, global.logger.animation("loading"));

        return postGroupCommentChecked(gid64, quote, community, (err) => {
            if (err) global.logger("warn", `Failed to comment on 'group' '${gid64}'! ${err}`);

            callback(err, quote);
        });
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
