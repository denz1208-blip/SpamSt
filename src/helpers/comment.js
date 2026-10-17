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
            hint = " Причина: у аккаунта нет прав писать в эту группу (закрытая/инвайт-группа, комментарии только для участников, либо аккаунт не может комментировать - например нет покупки в Steam / семейный режим / ограничение Steam). Попробуйте вступить в группу этим аккаунтом или выберите открытую группу.";
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
        global.logger("info", `Commenting on 'group' '${dest.processed}': ${quote.split("\n")[0]}`, false, false, global.logger.animation("loading"));

        return postGroupCommentChecked(dest.processed, quote, community, (err) => {
            if (err) global.logger("warn", `Failed to comment on 'group' '${dest.processed}'! ${err}`);

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
