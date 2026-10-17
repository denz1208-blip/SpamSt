/*
 * File: src/helpers/handleFamilyView.js
 * Project: SpamSt
 *
 * Проверяет включён ли на аккаунте Family View (родительский контроль) - если да,
 * комментарии поститься не будут, пока пользователь не введёт код разблокировки.
 */


/**
 * Проверяет есть ли у аккаунта активная Family View сессия
 * @param {object} community Экземпляр SteamCommunity
 * @returns {Promise<boolean>} true если Family View включена
 */
module.exports.checkForFamilyView = function(community) {
    return new Promise((resolve) => {
        try {
            community.isSubscribedToFamilyRestrictedFeature(null, null, (err, isBanned) => {
                // err == "not logged in to family view" означает Family View НЕ активна
                if (err) return resolve(String(err).toLowerCase().includes("family") ? false : false);

                resolve(Boolean(isBanned));
            });
        } catch (err) {
            resolve(false);
        }
    });
};


/**
 * Запрашивает код разблокировки Family View у пользователя и авторизует полную версию
 * @param {object} community Экземпляр SteamCommunity
 * @returns {Promise<void>}
 */
module.exports.unlockFamilyView = async function(community) {
    const ui = require("../ui.js");

    const code = await ui.ask("> Введите код разблокировки Family View (Steam -> Настройки -> Семейный режим): ");

    await new Promise((resolve, reject) => {
        community.authorizeFamilyView(code, (err) => {
            if (err) {
                global.logger("error", `Failed to unlock family view! ${err}`);
                return reject(err);
            }

            global.logger("info", "Family view unlocked successfully!");
            resolve();
        });
    }).catch(() => { /* Ошибка уже залогирована, продолжим - комментирование упадёт с понятной ошибкой */ });
};
