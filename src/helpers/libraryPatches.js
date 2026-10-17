/*
 * File: src/helpers/libraryPatches.js
 * Project: SpamSt
 *
 * Патчи сторонних библиотек. Нужны чтобы steamcommunity не падал с ошибкой
 * "Cannot read properties of undefined (reading 'startsWith')" при постинге комментариев -
 * библиотека ожидает строку в option.pollid, а мы его не передаём.
 */

const SteamCommunity = require("steamcommunity");


// Патч postComment: pollid может быть undefined - приводим к пустой строке
if (SteamCommunity.prototype.postComment) {
    const origPostComment = SteamCommunity.prototype.postComment;

    SteamCommunity.prototype.postComment = function(...args) {
        if (args[1] && typeof args[1] === "object" && args[1].pollid === undefined) args[1].pollid = "";

        return origPostComment.apply(this, args);
    };
}


// Патч _startRequest: formitemValue тоже может прийти undefined
try {
    const proto = SteamCommunity.prototype;

    if (proto._startRequest) {
        const origStartRequest = proto._startRequest;

        proto._startRequest = function(options, callback) {
            try {
                if (options && options.form && Array.isArray(options.form)) {
                    options.form.forEach((f) => {
                        if (f && typeof f === "object" && f.value === undefined) f.value = "";
                    });
                }
            } catch (err) { /* Не критично - продолжаем без патча */ }

            return origStartRequest.call(this, options, callback);
        };
    }
} catch (err) { /* noop */ }
