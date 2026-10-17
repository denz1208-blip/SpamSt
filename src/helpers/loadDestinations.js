/*
 * File: src/helpers/loadDestinations.js
 * Project: SpamSt
 *
 * Читает destinations.txt и приводит каждую строку к объекту адресата { raw, processed, type }.
 */

const fs        = require("fs");
const steamIDResolver = require("steamid-resolver");


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

module.exports.EIdTypes = EIdTypes;


/**
 * Резолвит строку (URL / vanity / steamID64) в steamID64 и определяет её тип
 * @param {string} str Строка из destinations.txt
 * @returns {Promise<{ id: string, type: string }>} Отрезолвленный id и тип
 */
function resolveDestination(str) {
    return new Promise((resolve, reject) => {
        steamIDResolver.getIDTypeAndID(str, null, (err, id, idType) => {
            if (err || !id) return reject(err || new Error(`Could not resolve '${str}'`));

            // Для review формат id: `userID/appID`, для discussion - полный URL - оставляем как есть
            resolve({ id: String(id), type: idType });
        });
    });
}


/**
 * Загружает и разбирает список адресатов из destinations.txt
 * @param {number} delay Задержка между запросами резолва, мс
 * @returns {Promise<Array<{ raw: string, processed: string, type: string }>>} Список адресатов
 */
module.exports.loadDestinations = async function(delay = 1000) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const destinations = [];

    let rawList = [];

    try {
        rawList = fs.readFileSync("./destinations.txt", "utf8").split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("//"));
    } catch (err) {
        global.logger("error", `Failed to read destinations.txt! ${err}`);
        return [];
    }

    for (const line of rawList) {
        try {
            const { id, type } = await resolveDestination(line);

            if (!Object.values(EIdTypes).includes(type)) {
                global.logger("warn", `Unsupported destination type '${type}' for entry '${line}'! Skipping...`);
            } else {
                destinations.push({ raw: line, processed: id, type });
            }
        } catch (err) {
            global.logger("warn", `Failed to resolve destination '${line}'! ${err.message} Skipping...`);
        }

        await wait(delay);
    }

    return destinations;
};
