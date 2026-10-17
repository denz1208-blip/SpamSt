/*
 * File: src/sessions/sessionHandler.js
 * Project: steam-mass-comment-bot
 *
 * Упрощённый обработчик сессий: логинит аккаунт по паролю (с поддержкой Steam Guard /
 * email-кода и QR-входа) и кэширует refreshToken в tokens.json, чтобы не вводить 2FA каждый раз.
 */

const fs        = require("fs");
const SteamUser = require("steam-user");

const TOKENS_FILE = "./tokens.json";


class SessionHandler {

    /**
     * @param {SteamUser} bot Экземпляр steam-user
     * @param {string} accountName Имя аккаунта
     * @param {number} id ID аккаунта (для совместимости, не используется)
     * @param {{ accountName: string, password: string, sharedSecret?: string }} logininfo Данные для входа
     */
    constructor(bot, accountName, id, logininfo) {
        this.bot       = bot;
        this.accountName = accountName || logininfo.accountName;
        this.id        = id;
        this.logininfo = logininfo;
    }

    /**
     * Читает сохраненные токены из tokens.json
     * @returns {object} Карта accountName -> refreshToken
     */
    _loadTokenStorage() {
        try {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
        } catch (err) {
            return {};
        }
    }

    /**
     * Сохраняет refreshToken в tokens.json
     * @param {string} token refreshToken
     */
    _saveTokenToStorage(token) {
        const storage = this._loadTokenStorage();

        storage[this.accountName] = token;
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(storage, null, 4));
    }

    /**
     * Удаляет сохраненный refreshToken (например если он оказался невалидным)
     */
    invalidateTokenInStorage() {
        const storage = this._loadTokenStorage();

        delete storage[this.accountName];
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(storage, null, 4));
    }

    /**
     * Возвращает сохраненный refreshToken или совершает полный вход с паролем и 2FA для получения нового
     * @returns {Promise<string|null>} refreshToken или null при неудаче
     */
    async getToken() {
        const storage = this._loadTokenStorage();

        if (storage[this.accountName]) {
            global.logger("info", "Found saved refresh token, trying to log in with it...");

            return storage[this.accountName];
        }

        return this._loginWithPassword();
    }

    /**
     * Задает вопрос в консоли (для ввода Steam Guard кода).
     * Использует ui.ask если интерфейс был закрыт перед запуском комментирования,
     * иначе создает временный readline.
     * @param {string} question Текст вопроса
     * @returns {Promise<string>} Ответ
     */
    async _prompt(question) {
        const ui = require("../ui.js");

        try {
            return await ui.ask(question);
        } catch (err) {
            const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });

            return new Promise((resolve) => rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim());
            }));
        }
    }

    /**
     * Совершает вход по логину/паролю из logininfo.json, запрашивает 2FA код при необходимости
     * @returns {Promise<string|null>} refreshToken или null при неудаче
     */
    _loginWithPassword() {
        return new Promise(async (resolve) => {
            const { accountName, password, sharedSecret } = this.logininfo;
            const useQr = password.toLowerCase() == "qrcode";

            if (!accountName && !useQr) {
                global.logger("error", "No accountName provided in logininfo.json! Please fill it in. Exiting...");
                return resolve(null);
            }

            const tempBot = new SteamUser();
            let settled = false;

            const finish = (token) => {
                if (settled) return;
                settled = true;

                tempBot.logOff();

                if (token) {
                    this._saveTokenToStorage(token);
                    global.logger("info", "Got refresh token, saving it for next time!");
                }

                resolve(token);
            };

            // Запрашиваем код через консоль (интерфейс в это время свободен)
            tempBot.on("steamGuard", (domain, callback, lastWrongCode) => {
                if (lastWrongCode) global.logger("warn", "The code you entered didn't work previously. Try again!");

                const askCode = async () => {
                    let code;

                    if (sharedSecret) {
                        code = require("steam-totp").generateAuthCode(sharedSecret);
                        global.logger("info", `Generated AuthCode from sharedSecret: ${code}`);
                    } else {
                        code = await this._prompt(`> Введите Steam Guard код${domain ? " для " + domain : ""}: `);
                    }

                    callback(code);
                };

                askCode();
            });

            tempBot.on("loggedOn", () => {
                global.logger("info", "Login successful, extracting refresh token...");
            });

            tempBot.on("webSession", (sessionID, cookies, refreshToken) => {
                finish(refreshToken || null);
            });

            tempBot.on("error", (err) => {
                global.logger("error", `Failed to log in for token retrieval! ${err}`);

                if (err.eresult == SteamUser.EResult.InvalidPassword) this.invalidateTokenInStorage();

                finish(null);
            });

            setTimeout(() => {
                if (!settled) {
                    global.logger("error", "Login timed out after 60 seconds! Exiting...");
                    finish(null);
                }
            }, 60000);

            if (useQr) {
                global.logger("info", "Attempting QR login - please scan the QR code with your Steam Mobile App...");

                tempBot.appCreateInstantLoginUrl().then(({ url }) => {
                    require("qrcode").toString(url, { type: "utf8" }, (err, qr) => {
                        if (err) return finish(null);

                        console.log(qr);

                        const poll = setInterval(() => {
                            tempBot.getAccessToken({ authProvider: SteamUser.EAuthTokenProvider.SteamApp }).then((res) => {
                                clearInterval(poll);
                                finish(res.refreshToken);
                            }).catch(() => { /* Пользователь еще не подтвердил вход */ });
                        }, 3000);

                        setTimeout(() => { clearInterval(poll); finish(null); }, 60000);
                    });
                }).catch((err) => {
                    global.logger("error", `Failed to create QR login url! ${err}`);
                    finish(null);
                });
            } else {
                global.logger("info", `Logging in as '${accountName}' with password to retrieve a refresh token...`);

                tempBot.logOn({ accountName, password });
            }
        });
    }
}

module.exports = SessionHandler;
