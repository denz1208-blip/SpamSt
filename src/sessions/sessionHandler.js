/*
 * File: src/sessions/sessionHandler.js
 * Project: SpamSt
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

            // Явный флаг завершения: не даёт таймауту 60 сек "убить" вход, пока пользователь
            // ещё сканирует QR или вводит Steam Guard код (ждём до 15 минут)
            let done = false;

            const finish = (token) => {
                if (settled) return;
                settled = true;
                done    = true;

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

            // Общий лимит ожидания входа: 15 минут (QR-сканирование и ручной ввод кода могут занять время)
            setTimeout(() => {
                if (!done) {
                    global.logger("error", "Login timed out after 15 minutes! Exiting...");
                    finish(null);
                }
            }, 900000);

            if (useQr) {
                return this._loginWithQR().then(finish).catch((err) => {
                    global.logger("error", `Failed to create QR login! ${err}`);
                    finish(null);
                });
            } else {
                global.logger("info", `Logging in as '${accountName}' with password to retrieve a refresh token...`);

                tempBot.logOn({ accountName, password });
            }
        });
    }

    /**
     * Совершает вход по QR-коду через steam-session (LoginSession.startWithQR):
     * печатает QR в консоли, пользователь сканирует его мобильным приложением Steam,
     * после подтверждения возвращается refreshToken. Пароль и 2FA-код при этом не нужны.
     * @returns {Promise<string>} refreshToken
     */
    _loginWithQR() {
        return new Promise((resolve, reject) => {
            const { LoginSession, EAuthTokenPlatformType } = require("steam-session");

            global.logger("info", "Attempting QR login - please scan the QR code with your Steam Mobile App...");

            const qrSession = new LoginSession(EAuthTokenPlatformType.SteamClient);

            // Если аккаунт известен и есть sharedSecret - автоматически подтверждаем DeviceCode
            const { accountName, sharedSecret } = this.logininfo;

            if (accountName && sharedSecret) qrSession.accountName = accountName;

            qrSession.on("timeout", () => reject(new Error("QR login timed out - please try again")));

            qrSession.on("error", (err) => reject(err));

            qrSession.on("authenticated", () => {
                global.logger("info", "QR login confirmed! Got refresh token.");
                resolve(qrSession.refreshToken);
            });

            qrSession.submitSteamGuardCode = async () => {};

            qrSession.startWithQR().then((response) => {
                if (!response.qrChallengeUrl) return reject(new Error("Steam did not return a QR challenge url"));

                require("qrcode").toString(response.qrChallengeUrl, { type: "utf8" }, (err, qr) => {
                    if (err) return reject(err);

                    console.log("\n" + qr + "\n");
                    global.logger("info", "Отсканируйте этот QR-код в мобильном приложении Steam (внизу экрана кнопка со штрих-кодом) и подтвердите вход.");

                    // Если есть sharedSecret и известен аккаунт - можно подтвердить кодом автоматически
                    if (accountName && sharedSecret) {
                        setTimeout(() => {
                            try {
                                const code = require("steam-totp").generateAuthCode(sharedSecret);

                                qrSession.submitSteamGuardCode(code).catch(() => { /* Ждём подтверждения QR */ });
                            } catch (err) { /* Игнорируем - основной путь это сканирование QR */ }
                        }, 2000);
                    }
                });
            }).catch(reject);

            // Защита от зависания
            setTimeout(() => {
                try { qrSession.cancelLoginAttempt(); } catch (err) { /* noop */ }
            }, 90000);
        });
    }
}

module.exports = SessionHandler;
