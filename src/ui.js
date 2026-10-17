/*
 * File: src/ui.js
 * Project: SpamSt
 *
 * Интерфейс программы: консольное меню для управления ботом.
 * Позволяет задавать комментарии (в т.ч. писать их в цикле - по одному за каждый проход),
 * управлять списком адресатов, настройками и запуском/остановкой комментирования.
 */

const readline = require("readline");

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
 * Выводит главное меню интерфейса
 */
function printMenu() {
    console.log("");
    console.log("*-=-=-=-=-=-=-=-=-= МЕНЮ =-=-=-=-=-=-=-=-=-*");
    console.log("> 1. Написать комментарий (можно в цикле - по одному за каждый проход)");
    console.log("> 2. Показать список комментариев");
    console.log("> 3. Удалить комментарий");
    console.log("> 4. Очистить все комментарии");
    console.log("> 5. Показать / изменить настройки (задержка, повтор цикла)");
    console.log("> 6. Управление destinations.txt (адресаты)");
    console.log("> 7. Аккаунты (мультиаккаунты: добавить / удалить)");
    console.log("> 8. Запустить комментирование");
    console.log("> 9. Обновить программу с GitHub (без переустановки)");
    console.log("> 10. Выход");
    console.log("*-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-*");
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


module.exports = { ask, printMenu, close };
