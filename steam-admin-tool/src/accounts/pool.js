/**
 * pool.js — account pool with staggered logins, rotation and graceful shutdown.
 *
 * Responsibilities:
 *  - Load config/accounts.json (enforce chmod 600 when configured).
 *  - Login accounts in small batches (maxConcurrentLogins) with a fixed
 *    stagger between batches — never all 50 at once.
 *  - Provide sessions to the scheduler using least-recently-used rotation,
 *    so no single helper account does all the work.
 *  - Persist QR refresh tokens into state so QR login happens only once.
 *  - Clean shutdown of every session.
 */

const fs = require('fs');
const path = require('path');
const { AccountSession } = require('./session');
const { getLogger } = require('../utils/logger');

const log = getLogger('pool');

class AccountPool {
  /**
   * @param {object} cfg - full config.json object
   * @param {object} state - StateStore instance
   */
  constructor(cfg, state) {
    this.cfg = cfg;
    this.state = state;
    this.accounts = [];            // raw entries from accounts.json
    this.sessions = new Map();     // accountId -> AccountSession
    this._shuttingDown = false;
  }

  /**
   * Read + validate accounts.json. Refuses world-readable credentials files
   * when security.enforceAccountsChmod is true.
   */
  loadAccounts() {
    const file = path.resolve(process.cwd(), this.cfg.pool.accountsFile);
    if (!fs.existsSync(file)) {
      throw new Error(`Accounts file not found: ${file}. Copy accounts.json.example first.`);
    }

    if (this.cfg.security && this.cfg.security.enforceAccountsChmod) {
      const mode = fs.statSync(file).mode & 0o777;
      if (mode !== 0o600) {
        throw new Error(
          `Insecure permissions on ${file}: ${(mode & 0o777).toString(8)} (expected 600). ` +
          `Run: chmod 600 ${this.cfg.pool.accountsFile}`,
        );
      }
    }

    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(arr)) throw new Error('accounts.json must be an array');
    if (arr.length > 50) log.warn('More than 50 accounts configured — consider trimming.');

    const ids = new Set();
    for (const a of arr) {
      if (!a.id || ids.has(a.id)) throw new Error(`Duplicate or missing account id: ${a.id}`);
      ids.add(a.id);
      if (!['sda', 'qr'].includes(a.authMethod)) {
        throw new Error(`Account ${a.id}: authMethod must be "sda" or "qr"`);
      }
      if (a.authMethod === 'sda' && !a.maFile) {
        throw new Error(`Account ${a.id}: sda method requires maFile path`);
      }
    }

    this.accounts = arr.filter((a) => a.enabled !== false);
    log.info(`Loaded ${this.accounts.length} enabled accounts`);
    return this.accounts;
  }

  /**
   * Login all accounts in staggered batches. Failures are logged but do not
   * abort the whole pool — bad accounts simply stay offline and will retry
   * via their own reconnect logic.
   */
  async startAll() {
    const { maxConcurrentLogins, loginStaggerMs } = this.cfg.pool;

    for (let i = 0; i < this.accounts.length; i += maxConcurrentLogins) {
      if (this._shuttingDown) break;

      const batch = this.accounts.slice(i, i + maxConcurrentLogins);
      log.info(`Login batch: ${batch.map((a) => a.id).join(', ')}`);

      await Promise.allSettled(batch.map((acc) => this._loginOne(acc)));

      // Stagger before next batch (skip after final batch).
      if (i + maxConcurrentLogins < this.accounts.length) {
        await new Promise((r) => setTimeout(r, loginStaggerMs));
      }
    }

    const online = [...this.sessions.values()].filter((s) => s.online).length;
    log.info(`Pool started: ${online}/${this.accounts.length} accounts online`);
  }

  async _loginOne(account) {
    if (this.sessions.has(account.id)) return; // already live

    const savedTokens = this.state.getQrTokens(account.id);
    const session = new AccountSession(account, this.cfg, this.state, savedTokens);

    session.on('gaveUp', (reason) => {
      log.error(`Account ${account.id} gave up reconnecting: ${reason}`, { accountId: account.id });
    });
    session.on('kicked', () => {
      // Do NOT auto-reconnect aggressively; session.js already applies a long pause.
      log.warn(`Account ${account.id} was kicked (session replaced elsewhere).`, { accountId: account.id });
    });

    try {
      await session.connect();
      this.sessions.set(account.id, session);
      // Persist QR tokens right away so the scan happens only once ever.
      if (account.authMethod === 'qr' && session.savedTokens) {
        await this.state.setQrTokens(account.id, session.savedTokens);
      }
    } catch (err) {
      log.error(`Initial login failed for ${account.id}: ${err.message}`, { accountId: account.id, error: err });
      await this.state.setOnline(account.id, false, err.message);
      // Keep the session object around so its internal reconnect timer works.
      this.sessions.set(account.id, session);
    }
  }

  /** All groups an account is assigned to (group ids + permalinks). */
  groupsOf(accountId) {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc) return [];
    return (acc.groups || []).map((g) => g.groupId);
  }

  /**
   * Pick an online session that is assigned to the given group.
   * Rotation strategy: least-recently-used (the account whose last action in
   * ANY group is oldest gets the task), which naturally spreads the load.
   *
   * @param {string} groupId
   * @param {string} [excludeAccountId] - skip this account (e.g. after a failure)
   * @returns {Promise<AccountSession|null>}
   */
  async pickForGroup(groupId, excludeAccountId = null) {
    const candidates = [];
    for (const [id, session] of this.sessions) {
      if (id === excludeAccountId) continue;
      if (!session.online || !session.community) continue;
      if (!this.groupsOf(id).includes(groupId)) continue;
      candidates.push({ id, session, last: await this.state.getLastActionAt(id) });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.last - b.last);
    return candidates[0].session;
  }

  /** Sessions that are currently usable, for reporting. */
  onlineIds() {
    return [...this.sessions.entries()].filter(([, s]) => s.online).map(([id]) => id);
  }

  offlineIds() {
    return [...this.sessions.entries()].filter(([, s]) => !s.online).map(([id]) => id);
  }

  /** Graceful shutdown of every session. */
  async shutdown() {
    this._shuttingDown = true;
    log.info('Shutting down account pool...');
    const closes = [...this.sessions.values()].map((s) => s.close().catch(() => {}));
    await Promise.all(closes);
    this.sessions.clear();
  }
}

module.exports = { AccountPool };
