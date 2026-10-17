/*
 * File: src/accounts.js
 * Project: SpamSt
 * Author: denz1208-blip
 *
 * Поддержка мультиаккаунтов: хранение списка Steam-аккаунтов в accounts.json.
 * Каждый аккаунт содержит accountName, password и (опционально) sharedSecret для 2FA.
 * Миграция: если accounts.json отсутствует, данные автоматически переносятся из старого logininfo.json.
 */

const fs = require("fs");

const ACCOUNTS_FILE   = "./accounts.json";
const LEGACY_INFOFILE = "./logininfo.json";


/**
 * Читает список аккаунтов из accounts.json.
 * Если файла нет - переносит данные из старого logininfo.json (одноразовая миграция).
 * @returns {Array<{accountName: string, password: string, sharedSecret?: string}>} Список аккаунтов
 */
function loadAccounts() {
    try {
        const list = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));

        return Array.isArray(list) ? list : [];
    } catch (err) {
        // accounts.json отсутствует или битый - пробуем мигрировать из logininfo.json
        let migrated = [];

        try {
            const legacy = JSON.parse(fs.readFileSync(LEGACY_INFOFILE, "utf8"));

            if (legacy.accountName && legacy.accountName.trim().length > 0) {
                migrated = [ {
                    accountName:    legacy.accountName.trim(),
                    password:       legacy.password || "",
                    sharedSecret:   legacy.sharedSecret || ""
                } ];

                saveAccounts(migrated);
                console.log(`> Мигрирован аккаунт '${migrated[0].accountName}' из logininfo.json в accounts.json`);
            }
        } catch (e) { /* Старого файла нет - начинаем с пустого списка */ }

        return migrated;
    }
}


/**
 * Сохраняет список аккаунтов в accounts.json
 * @param {Array<object>} list Список аккаунтов
 */
function saveAccounts(list) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 4));
}


/**
 * Добавляет или обновляет аккаунт (по совпадению accountName)
 * @param {{accountName: string, password: string, sharedSecret?: string}} acc Аккаунт
 */
function upsertAccount(acc) {
    const list = loadAccounts();
    const idx  = list.findIndex((a) => a.accountName.toLowerCase() == acc.accountName.toLowerCase());

    if (idx >= 0) list[idx] = acc; else list.push(acc);

    saveAccounts(list);
}


/**
 * Удаляет аккаунт по имени
 * @param {string} name Имя аккаунта
 * @returns {boolean} true если аккаунт был найден и удален
 */
function removeAccount(name) {
    const list = loadAccounts();
    const filtered = list.filter((a) => a.accountName.toLowerCase() != name.toLowerCase());

    if (filtered.length == list.length) return false;

    saveAccounts(filtered);
    return true;
}


/**
 * Возвращает имена всех аккаунтов
 * @returns {string[]} Имена аккаунтов
 */
function getAccountNames() {
    return loadAccounts().map((a) => a.accountName);
}


module.exports = { loadAccounts, saveAccounts, upsertAccount, removeAccount, getAccountNames, ACCOUNTS_FILE };
