/*
 * File: src/helpers/resolveDestination.js
 * Project: SpamSt
 *
 * Собственный резолвер адресатов для destinations.txt.
 * Заменяет steamid-resolver, у которого отсутствует метод getIDTypeAndID (падал с ошибкой
 * "steamIDResolver.getIDTypeAndID is not a function").
 *
 * Определяет тип адресата по URL и приводит vanity-ссылки профиля к steamID64 через публичные
 * эндпоинты Steam Community / Web API (без API-ключа).
 */

const https = require("https");

/**
 * Поддерживаемые типы адресатов
 * @enum {string}
 */
const EIdTypes = {
    "profile": "profile",
    "group": "group",
    "sharedfile": "sharedfile",
    "discussion": "discussion",
    "curator": "curator",
    "review": "review"
};


/**
 * Делает HTTPS GET-запрос и возвращает тело ответа как строку
 * @param {string} url Полный URL
 * @returns {Promise<string>} Тело ответа
 */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
            // Обработка редиректов (Steam часто редиректит на www/community)
            if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
                res.resume();
                return resolve(httpGet(res.headers.location));
            }

            let body = "";

            res.setEncoding("utf8");
            res.on("data", (chunk) => body += chunk);
            res.on("end", () => resolve(body));
            res.on("error", reject);
        }).on("error", reject);
    });
}


/**
 * Резолвит vanity-имя профиля в steamID64 скрейпингом страницы профиля (не требует API-ключа)
 * @param {string} vanity Vanity-имя профиля (без ссылки)
 * @returns {Promise<string>} steamID64
 */
async function scrapeProfileSteamID64(vanity) {
    const body = await httpGet(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}`);

    // Steam кладёт steamID64 владельца на страницу: g_steamID, steamid/... или канонический profile-ссылка
    const m = body.match(/g_steamID\s*=\s*"(\d{17})"/) || body.match(/"steamid":"(\d{17})"/) || body.match(/(?:profile-|steamid\/)(\d{17})/i) || body.match(/(\d{17})/);

    if (!m) throw new Error(`Could not resolve profile '${vanity}' (vanity name not found or page blocked?)`);

    return m[1];
}


/**
 * Резолвит vanity-имя профиля в steamID64 через ISteamUser/ResolveVanityURL (нужен API-ключ),
 * с фолбэком на скрейпинг страницы профиля
 * @param {string} vanity Vanity-имя профиля (без ссылки)
 * @returns {Promise<string>} steamID64
 */
async function resolveProfileToSteamID64(vanity) {
    // Если у пользователя есть webapi key в config.json - пробуем официальный эндпоинт
    try {
        const cfgKey = (() => { try { return require("../../config.json").webApiKey; } catch (err) { return null; } })();

        if (cfgKey) {
            const body = await httpGet(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(cfgKey)}&vanityurl=${encodeURIComponent(vanity)}`);
            const json = JSON.parse(body);
            const id = json.response && json.response.steamid;

            if (json.response && json.response.success == 1 && id) return String(id);
        }
    } catch (err) { /* Фолбэк на скрейпинг */ }

    return scrapeProfileSteamID64(vanity);
}


/**
 * Извлекает vanity-имя профиля из полного URL вида https://steamcommunity.com/id/JDOFFF/ или /profiles/765...
 * @param {string} str Строка из destinations.txt
 * @returns {string|null} Имя для резолва или null если это не профиль
 */
function extractProfileName(str) {
    const m = str.match(/steamcommunity\.com\/(?:id|profiles)\/([^\/?#\s]+)/i);

    return m ? m[1] : null;
}


/**
 * Резолвит строку (URL / vanity / steamID64) в объект { id, type }.
 * - profile: vanity -> steamID64; чистый steamID64 (7656...) остаётся как есть
 * - group: оставляем имя группы
 * - sharedfile: оставляем числовой id
 * - discussion: оставляем полный URL
 * - curator: оставляем id
 * - review: оставляем userID/appID
 * @param {string} str Строка из destinations.txt
 * @returns {Promise<{ id: string, type: string }>} Отрезолвленный id и тип
 */
module.exports.resolveDestination = async function(str) {
    const s = str.trim();

    // Профиль: vanity-ссылка или profiles-ссылка
    if (/steamcommunity\.com\/(id|profiles)\//i.test(s)) {
        const name = extractProfileName(s);
        const id = /^7656\d{11}$/.test(name) ? name : await resolveProfileToSteamID64(name);

        return { id, type: EIdTypes.profile };
    }

    // Чистый steamID64
    if (/^7656\d{11}$/.test(s)) return { id: s, type: EIdTypes.profile };

    // Группа: steamcommunity.com/groups/NAME
    if (/steamcommunity\.com\/groups\//i.test(s)) {
        const m = s.match(/groups\/([^\/?#\s]+)/i);

        if (!m) throw new Error(`Could not parse group URL '${s}'`);

        return { id: m[1], type: EIdTypes.group };
    }

    // Sharedfile: .../sharedfiles/FILEID или .../file/FILEID
    if (/steamcommunity\.com\/(?:sharedfiles|file)\/(\d+)/i.test(s)) {
        const m = s.match(/(?:sharedfiles|file)\/(\d+)/i);

        return { id: m[1], type: EIdTypes.sharedfile };
    }

    // Discussion: .../discussions/...
    if (/steamcommunity\.com\/.*discussions\//i.test(s)) return { id: s, type: EIdTypes.discussion };

    // Curator: .../curator/ID
    if (/steamcommunity\.com\/curator\/(\d+)/i.test(s)) {
        const m = s.match(/curator\/(\d+)/i);

        return { id: m[1], type: EIdTypes.curator };
    }

    // Review: .../reviews/USERID/APPID или .../app/APPID/userreviews/...
    if (/steamcommunity\.com\/(?:id|profiles)\/[^\/]+\/review/i.test(s) || /\/review/i.test(s)) {
        const m = s.match(/reviews?\/([0-9A-Za-z]+)\/(\d+)/i);

        if (m) return { id: `${m[1]}/${m[2]}`, type: EIdTypes.review };
    }

    throw new Error(`Unsupported destination format '${s}'`);
};

module.exports.EIdTypes = EIdTypes;
