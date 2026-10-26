/**
 * logger.js — winston-based structured logging.
 *
 * Produces three rotating log streams:
 *   logs/auth.log    — login / reconnect / QR / SDA events
 *   logs/actions.log — posting actions (successes, scheduled runs)
 *   logs/errors.log  — errors only
 * Plus a console transport at a configurable level.
 *
 * Usage:
 *   const { initLogger, getLogger } = require('../utils/logger');
 *   initLogger(cfg.logging);
 *   const log = getLogger('auth');
 */

const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

let initialized = false;

/** Directory for log files, resolved relative to project root. */
let logsDir = path.join(__dirname, '..', '..', 'logs');

/** Console verbosity, can be overridden by config. */
let consoleLevel = 'info';

/** Named child loggers cache: category -> winston logger. */
const loggers = {};

/**
 * Initialize the global logger configuration. Safe to call once from index.js.
 *
 * @param {object} cfg - config.logging section
 * @param {string} [cfg.dir] - logs directory (default: ./logs)
 * @param {string} [cfg.level] - file level (default: 'info')
 * @param {string} [cfg.consoleLevel] - console level (default: 'info')
 */
function initLogger(cfg = {}) {
  logsDir = path.resolve(process.cwd(), cfg.dir || 'logs');
  consoleLevel = cfg.consoleLevel || cfg.level || 'info';
  initialized = true;
}

/** File transport factory with daily rotation. */
function fileTransport(filename, level) {
  return new winston.transports.DailyRotateFile({
    dirname: logsDir,
    filename,
    level,
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    auditFile: path.join(logsDir, `.audit-${filename}.json`),
  });
}

/** Map of category -> which log file it belongs to. */
const CATEGORY_FILES = {
  auth: 'auth',
  pool: 'auth',
  session: 'auth',
  actions: 'actions',
  scheduler: 'actions',
  texts: 'actions',
  ratelimit: 'actions',
  system: 'actions',
};

/** All transport instances, keyed by target file name. */
const transports = {};

/** Lazily create the three rotating file transports + console. */
function ensureTransports() {
  if (transports.auth) return;
  transports.auth = fileTransport('auth.log', 'silly');
  transports.actions = fileTransport('actions.log', 'silly');
  transports.errors = fileTransport('errors.log', 'error');
  transports.console = new winston.transports.Console({
    level: consoleLevel,
    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
  });
}

/** Log formatter shared by all categories. */
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, category, stack, accountId }) => {
    const cat = category ? `[${category}]` : '';
    const acc = accountId ? `{${accountId}}` : '';
    return `${timestamp} ${level.toUpperCase()} ${cat}${acc} ${stack || message}`;
  }),
);

/**
 * Get a categorized logger. Categories:
 *   'auth', 'pool', 'session'  -> logs/auth.log
 *   'actions','scheduler','texts','ratelimit','system' -> logs/actions.log
 * Errors additionally go to logs/errors.log.
 *
 * @param {string} category
 * @returns {{debug:Function,info:Function,warn:Function,error:Function}}
 */
function getLogger(category = 'system') {
  if (loggers[category]) return loggers[category];

  ensureTransports();
  const fileKey = CATEGORY_FILES[category] || 'actions';

  const fileLogger = winston.createLogger({
    level: 'silly',
    format: logFormat,
    transports: [transports[fileKey], transports.errors, transports.console],
    exitOnError: false,
  });

  const wrap = (lvl) => (msg, meta = {}) =>
    fileLogger.log({ level: lvl, category, message: msg, ...meta });

  const child = { category, debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
  loggers[category] = child;
  return child;
}

module.exports = { initLogger, getLogger };
