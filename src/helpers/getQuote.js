/*
 * File: src/helpers/getQuote.js
 * Project: SpamSt
 *
 * Читает список комментариев из comments.txt (по одному на строку).
 */

const fs = require("fs");


/**
 * Считывает комментарии из comments.txt
 * @param {Function} callback Вызывается как callback(err, quotes)
 */
module.exports.getQuote = (callback) => {
    try {
        const raw = fs.readFileSync("./comments.txt", "utf8");

        const quotes = raw.split("\n")
            .map((l) => l.replace(/\r$/, "").trim()) // Убираем \r и пробелы по краям
            .filter((l) => l.length > 0 && !l.startsWith("//")); // Пустые строки и строки-комментарии пропускаем

        callback(null, quotes);
    } catch (err) {
        callback(err, []);
    }
};
