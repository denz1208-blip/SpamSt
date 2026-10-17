/*
 * File: src/ui.js
 * Project: SpamSt
 *
 * Интерфейс программы: консольное меню для управления ботом.
 * Позволяет задавать комментарии (в т.ч. писать их в цикле - по одному за каждый проход),
 * управлять списком адресатов, аккаунтами, настройками и запуском/остановкой комментирования.
 * Поддерживает цветной вывод (ANSI), автоматически отключается при перенаправлении вывода в файл.
 */

const readline = require("readline");

// ANSI цвета (отключаются если вывод не в терминал или включён NO_COLOR)
const colorOn = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    reset:  "\x1b[0m",
    bold:   "\x1b[1m",
    dim:    "\x1b[2m",
    cyan:   "\x1b[36m",
    green:  "\x1b[32m",
    yellow: "\x1b[33m",
    red:    "\x1b[31m",
    blue:   "\x1b[34m",
    magenta:"\x1b[35m",
};
const paint = (color, text) => colorOn ? `${c[color]}${text}${c.reset}` : text;

let rl = null;


/**
 * Создает (или возвращает существующее) readline-подключение для ввода с клавиатуры
 * @returns {object} readline interface
 */
function getInterface() {
    if (!rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }

    return rl;
}


/**
 * Задает вопрос в интерфейсе и ожидает ответ пользователя
 * @param {string} question Текст вопроса
 * @returns {Promise<string>} Ответ пользователя (без пробелов по краям)
 */
function ask(question) {
    return new Promise((resolve) => getInterface().question(question, (answer) => resolve(answer.trim())));
}


/**
 * Считает непустые строки в текстовом файле (для счётчиков в меню)
 * @param {string} file Путь к файлу
 * @returns {number} Количество строк (0 если файла нет)
 */
function countLines(file) {
    try {
        return require("fs").readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0).length;
    } catch (err) {
        return 0;
    }
}


/**
 * Печатает строку-разделитель
 */
function line(char = "-") {
    console.log(paint("dim", char.repeat(57)));
}


/**
 * Выводит шапку программы
 */
function printHeader() {
    let version = "unknown";

    try { version = require("../package.json").version; } catch (err) { /* ignore */ }

    console.log("");
    const box = (text) => paint("cyan", paint("bold", "  ║ " + text.padEnd(51) + " ║"));

    console.log(paint("cyan", paint("bold", "  ╔═══════════════════════════════════════════════════╗")));
    console.log(box(`SpamSt v${version} - Steam Comment Bot`));
    console.log(box("Мультиаккаунты • Комментарии в цикле • GitHub update"));
    console.log(paint("cyan", paint("bold", "  ╚═══════════════════════════════════════════════════╝")));
}


/**
 * Выводит главное меню интерфейса (с текущими счётчиками комментариев/адресатов/аккаунтов)
 */
function printMenu() {
    const comments    = countLines("./comments.txt");
    const destinations = countLines("./destinations.txt");

    let accountsCount = 0;

    try { accountsCount = require("./accounts.js").loadAccounts().length; } catch (err) { /* ignore */ }

    console.log("");
    line("=");
    console.log(paint("bold", "  МЕНЮ"));
    line("=");
    console.log(`  ${paint("green", " 1.")} Написать комментарий ${paint("dim", "(в цикле - по одному за проход)")}`);
    console.log(`  ${paint("green", " 2.")} Показать список комментариев      ${paint("dim", `[${comments}]`)}`);
    console.log(`  ${paint("green", " 3.")} Удалить комментарий`);
    console.log(`  ${paint("green", " 4.")} Очистить все комментарии`);
    console.log(`  ${paint("yellow", " 5.")} Настройки (задержки, повтор цикла)`);
    console.log(`  ${paint("yellow", " 6.")} Управление адресатами             ${paint("dim", `[${destinations}]`)}`);
    console.log(`  ${paint("yellow", " 7.")} Аккаунты (добавить / удалить)     ${paint("dim", `[${accountsCount}]`)}`);
    console.log(`  ${paint("cyan", paint("bold", " 8."))} ${paint("bold", "▶ Запустить комментирование")}`);
    console.log(`  ${paint("blue", " 9.")} Обновить программу с GitHub`);
    console.log(`  ${paint("red", "10.")} Выход`);
    line("=");
}


/**
 * Выводит сообщение об успехе / ошибке / info цветным префиксом
 * @param {"ok"|"err"|"info"} kind Тип сообщения
 * @param {string} text Текст
 */
function msg(kind, text) {
    const prefix = kind == "ok" ? paint("green", " ✔ ") : kind == "err" ? paint("red", " ✖ ") : paint("cyan", " ℹ ");

    console.log(prefix + text);
}


/**
 * Закрывает интерфейс и освобождает поток ввода
 */
function close() {
    if (rl) {
        rl.close();
        rl = null;
    }
}


module.exports = { ask, printMenu, printHeader, close, msg, line, paint, countLines };
