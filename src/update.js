/*
 * File: src/update.js
 * Project: SpamSt
 * Author: denz1208-blip
 *
 * Модуль самообновления: скачивает свежую версию с GitHub (zip main-ветки)
 * и обновляет файлы программы на месте, сохраняя личные файлы
 * (config.json, logininfo.json, comments.txt, destinations.txt, токены).
 * Работает без git и без переустановки - достаточно одной команды `npm update-bot`.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");

const REPO_URL = "https://github.com/denz1208-blip/SpamSt";
const ZIP_URL  = `${REPO_URL}/archive/refs/heads/main.zip`;

// Файлы/папки, которые НЕ перезаписываем при обновлении (личные данные пользователя)
const KEEP_FILES = [
    "config.json",
    "logininfo.json",
    "accounts.json",
    "tokens.json",
    "comments.txt",
    "destinations.txt",
    "tokenStorage.db",
    "output.txt",
    ".git",
    "node_modules"
];


/**
 * Скачивает файл по URL (следует редиректам GitHub)
 * @param {string} url Адрес для скачивания
 * @param {string} dest Куда сохранить
 * @returns {Promise<void>}
 */
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { "User-Agent": "SpamSt-updater" } }, (res) => {
            // GitHub может ответить редиректом - идем за ним
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(downloadFile(res.headers.location, dest));
            }

            if (res.statusCode != 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} при скачивании ${url}`));
            }

            const stream = fs.createWriteStream(dest);

            res.pipe(stream);
            stream.on("finish", () => stream.close(() => resolve()));
            stream.on("error", reject);
        });

        request.on("error", reject);
        request.setTimeout(60000, () => request.destroy(new Error("Таймаут скачивания (60 сек)")));
    });
}


/**
 * Распаковывает zip-архив в папку dest (Windows: PowerShell; Linux/macOS: unzip)
 * @param {string} zipPath Путь к архиву
 * @param {string} dest Целевая папка
 * @returns {Promise<void>}
 */
function extractZip(zipPath, dest) {
    return new Promise((resolve, reject) => {
        let cmd, args;

        if (process.platform == "win32") {
            cmd = "powershell";
            args = ["-NoProfile", "-NonInteractive", "-Command",
                    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`];
        } else {
            cmd = "unzip";
            args = ["-q", "-o", zipPath, "-d", dest];
        }

        execFile(cmd, args, { windowsHide: true }, (err) => err ? reject(err) : resolve());
    });
}


/**
 * Рекурсивно копирует содержимое src в dst, пропуская файлы из keepList
 * @param {string} src Откуда копировать
 * @param {string} dst Куда копировать
 * @param {string[]} keepList Имена верхнеуровневых файлов, которые не перезаписывать
 */
function copyFiles(src, dst, keepList) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath  = path.join(src, entry.name);
        const dstPath  = path.join(dst, entry.name);

        // Личные файлы пользователя не трогаем
        if (keepList.includes(entry.name)) continue;

        if (entry.isDirectory()) {
            if (!fs.existsSync(dstPath)) fs.mkdirSync(dstPath, { recursive: true });

            copyFiles(srcPath, dstPath, []);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}


/**
 * Проверяет наличие PowerShell (для распаковки zip на Windows) или unzip на Unix
 * @returns {boolean}
 */
function hasUnzipCapability() {
    return process.platform == "win32" || fs.existsSync("/usr/bin/unzip") || !!process.env.PATH;
}


/**
 * Основная функция обновления: скачать свежий zip с GitHub и заменить файлы программы.
 * @param {string} rootDir Корневая папка программы
 * @returns {Promise<{updated: boolean, localVersion: string, remoteVersion: string}>}
 */
async function updateFromGitHub(rootDir) {
    if (!hasUnzipCapability()) throw new Error("Не найдено средство распаковки zip (PowerShell / unzip)!");

    const os = require("os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spamst-update-"));
    const zipPath = path.join(tmpDir, "main.zip");

    try {
        console.log("> Скачиваю свежую версию с GitHub...");
        await downloadFile(ZIP_URL, zipPath);

        console.log("> Распаковываю архив...");
        await extractZip(zipPath, tmpDir);

        const extractedRoot = path.join(tmpDir, "SpamSt-main");

        if (!fs.existsSync(extractedRoot)) throw new Error("В архиве не найдена папка SpamSt-main!");

        const localVersion  = (() => { try { return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version; } catch (err) { return "unknown"; } })();
        const remoteVersion = (() => { try { return JSON.parse(fs.readFileSync(path.join(extractedRoot, "package.json"), "utf8")).version; } catch (err) { return "unknown"; } })();

        console.log(`> Текущая версия: ${localVersion}, версия на GitHub: ${remoteVersion}`);

        console.log("> Обновляю файлы программы (личные файлы сохраняются)...");
        copyFiles(extractedRoot, rootDir, KEEP_FILES);

        console.log("> Готово! Файлы программы обновлены.");

        if (localVersion != remoteVersion) console.log("> Изменилась версия - рекомендуем также запустить 'npm install' для обновления зависимостей.");

        return { updated: true, localVersion, remoteVersion };
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { /* не критично */ }
    }
}


module.exports = { updateFromGitHub, ZIP_URL, KEEP_FILES };
