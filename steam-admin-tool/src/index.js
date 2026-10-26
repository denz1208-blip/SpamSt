/**
 * index.js — application entry point.
 *
 * Modes:
 *   node src/index.js                — normal run: login pool + start scheduler
 *   node src/index.js --login-qr     — interactive QR login for one account,
 *                                      then persist refresh tokens and exit
 *   node src/index.js --report-only  — print the daily report from state and exit
 */

const fs = require('fs');
const path = require('path');
const { initLogger, getLogger } = require('./utils/logger');
const { StateStore } = require('./utils/stateStore');
const { AccountPool } = require('./accounts/pool');
const { TaskRunner } = require('./scheduler/taskRunner');
const { qrLogin } = require('./auth/qrLogin');

const CONFIG_PATH = 'config/config.json';

async function main() {
  const args = process.argv.slice(2);

  // ---- config -------------------------------------------------------------
  const cfgFile = path.resolve(process.cwd(), CONFIG_PATH);
  if (!fs.existsSync(cfgFile)) {
    console.error(`Missing ${CONFIG_PATH}. Copy from documentation and edit first.`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

  initLogger(cfg.logging);
  const log = getLogger('system');
  log.info('=== steam-admin-tool starting ===');
  log.warn('Reminder: use ONLY with groups and discussions you own or moderate.');

  // ---- state --------------------------------------------------------------
  const state = new StateStore(cfg.state.dbFile, cfg.posting);
  await state.init();

  // ---- --report-only ------------------------------------------------------
  if (args.includes('--report-only')) {
    const pool = new AccountPool(cfg, state);
    pool.loadAccounts(); // no logins, just metadata for the report
    const runner = new TaskRunner(cfg, state, pool);
    runner.reportNow();
    process.exit(0);
  }

  // ---- --login-qr <accountId>: one-shot interactive QR login --------------
  if (args.includes('--login-qr')) {
    const poolTmp = new AccountPool(cfg, state);
    const accounts = poolTmp.loadAccounts();
    const idIdx = args.indexOf('--account');
    const wantedId = idIdx !== -1 ? args[idIdx + 1] : null;
    const target = wantedId
      ? accounts.find((a) => a.id === wantedId)
      : accounts.find((a) => a.authMethod === 'qr' && !state.getQrTokens(a.id));

    if (!target) {
      log.error(`No matching account for QR login (use --account <id>).`);
      process.exit(1);
    }

    log.info(`Performing interactive QR login for "${target.id}"...`);
    const tokens = await qrLogin(target, cfg);
    await state.setQrTokens(target.id, tokens);
    log.info(`QR login OK for ${target.id} (steamid=${tokens.steamId}). Tokens saved — future runs log in silently.`);
    process.exit(0);
  }

  // ---- normal run -----------------------------------------------------------
  const pool = new AccountPool(cfg, state);
  pool.loadAccounts();

  const runner = new TaskRunner(cfg, state, pool);

  // Kick off logins without blocking the scheduler (tasks have their own timing).
  pool.startAll().catch((err) => log.error(`Pool startup error: ${err.message}`, { error: err }));
  runner.start();

  // ---- graceful shutdown ----------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${sig}, shutting down gracefully...`);
    runner.stop();
    await pool.shutdown();
    await state.save();
    log.info('Bye.');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Last-resort handlers: log, but never crash mid-action silently.
  process.on('uncaughtException', (err) => {
    log.error(`Uncaught exception (process kept alive): ${err.message}`, { error: err });
  });
  process.on('unhandledRejection', (reason) => {
    log.error(`Unhandled rejection: ${reason && reason.message ? reason.message : reason}`);
  });

  log.info('Startup complete. Scheduler is active.');
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
