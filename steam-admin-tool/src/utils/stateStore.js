/**
 * stateStore.js — persistent application state backed by lowdb (JSON file).
 *
 * Stores:
 *  - per-account lastActionAt, next human pause, backoff step/until
 *  - per-group last action timestamp (cross-account gap)
 *  - comment history (account+group+timestamp) for hourly limits & daily reports
 *  - used text indices per session (random-without-repeat)
 *  - task statuses mirrored from tasks.json
 *
 * NOTE on lowdb v7: it is ESM-only. We load it via dynamic import() inside an
 * async init function so the rest of the codebase can stay CommonJS.
 */

const fs = require('fs');
const path = require('path');

/** Local copy to avoid circular dependency with rateLimiter.js. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const EMPTY = { accounts: {}, groups: {}, comments: [], texts: {}, stats: {} };

class StateStore {
  /**
   * @param {string} dbPath - absolute or cwd-relative path to state.json
   * @param {object} postingCfg - config.posting (for human pause ranges)
   */
  constructor(dbPath, postingCfg) {
    this.dbPath = path.resolve(process.cwd(), dbPath);
    this.posting = postingCfg;
    this.db = null;
  }

  /** Dynamic-import lowdb (ESM) and open/create the DB. Call once at startup. */
  async init() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify(EMPTY, null, 2));
      fs.chmodSync(this.dbPath, 0o600); // state may contain session tokens
    }

    const { Low } = await import('lowdb');

    // lowdb v7: new Low(adapter, defaults). We use our own FileAdapter so the
    // state file is written atomically and chmod-600'd (it may hold session data).
    const adapter = new FileAdapter(this.dbPath);
    this.db = new Low(adapter, EMPTY);
    await this.db.read();
    this.db.data = deepMerge(structuredClone(EMPTY), this.db.data || {});
    await this.db.write();
  }

  /** Persist current data to disk. */
  async save() {
    await this.db.write();
  }

  /** Ensure an account record exists and return it. */
  acct(accountId) {
    if (!this.db.data.accounts[accountId]) {
      this.db.data.accounts[accountId] = {
        lastActionAt: 0,
        nextPauseMs: 0,
        backoffStep: 0,
        backoffUntil: 0,
        lastError: null,
        online: false,
      };
    }
    return this.db.data.accounts[accountId];
  }

  grp(groupId) {
    if (!this.db.data.groups[groupId]) {
      this.db.data.groups[groupId] = { lastActionAt: 0 };
    }
    return this.db.data.groups[groupId];
  }

  // ---- getters used by RateLimiter -------------------------------------

  async getBackoffUntil(accountId) {
    return this.acct(accountId).backoffUntil || 0;
  }

  async setBackoffUntil(accountId, ts) {
    this.acct(accountId).backoffUntil = ts;
    await this.save();
  }

  async incrementBackoffStep(accountId) {
    const a = this.acct(accountId);
    a.backoffStep = (a.backoffStep || 0) + 1;
    await this.save();
    return a.backoffStep;
  }

  async resetBackoff(accountId) {
    const a = this.acct(accountId);
    a.backoffStep = 0;
    a.backoffUntil = 0;
    await this.save();
  }

  async getLastActionAt(accountId) {
    return this.acct(accountId).lastActionAt || 0;
  }

  async getLastGroupActionAt(groupId) {
    return this.grp(groupId).lastActionAt || 0;
  }

  /** Stable pseudo-random pause reused until the next action happens. */
  async getNextHumanPause(accountId) {
    const a = this.acct(accountId);
    if (!a.nextPauseMs) {
      a.nextPauseMs = randInt(this.posting.humanPauseMinMs, this.posting.humanPauseMaxMs);
      await this.save();
    }
    return a.nextPauseMs;
  }

  /** Count comments by account in group within the last hour. */
  async countCommentsInLastHour(accountId, groupId) {
    const cutoff = Date.now() - 3600000;
    return this.db.data.comments.filter(
      (c) => c.accountId === accountId && c.groupId === groupId && c.at >= cutoff,
    ).length;
  }

  /** Timestamp of the oldest comment still inside the rolling 1h window. */
  async oldestCommentInWindow(accountId, groupId) {
    const cutoff = Date.now() - 3600000;
    const inWindow = this.db.data.comments
      .filter((c) => c.accountId === accountId && c.groupId === groupId && c.at >= cutoff)
      .sort((x, y) => x.at - y.at);
    return inWindow.length ? inWindow[0].at : 0;
  }

  /** Record a successful comment/action. */
  async recordAction(accountId, groupId, at = Date.now()) {
    const a = this.acct(accountId);
    a.lastActionAt = at;
    a.nextPauseMs = randInt(this.posting.humanPauseMinMs, this.posting.humanPauseMaxMs);
    this.grp(groupId).lastActionAt = at;
    this.db.data.comments.push({ accountId, groupId, at });
    this.trimComments();
    await this.save();
  }

  /** Keep only the last 30 days of comment history. */
  trimComments() {
    const cutoff = Date.now() - 30 * 86400000;
    this.db.data.comments = this.db.data.comments.filter((c) => c.at >= cutoff);
  }

  // ---- QR refresh tokens (persisted so QR login happens once) ----------

  async setQrTokens(accountId, tokens) {
    const a = this.acct(accountId);
    // Only keep the long-lived refresh token; access tokens are short-lived.
    a.qrRefreshToken = tokens.refreshToken || null;
    await this.save();
  }

  getQrTokens(accountId) {
    const a = this.acct(accountId);
    return a.qrRefreshToken ? { refreshToken: a.qrRefreshToken } : null;
  }

  // ---- session online/offline flags & errors ---------------------------

  async setOnline(accountId, online, errMsg = null) {
    const a = this.acct(accountId);
    a.online = online;
    a.lastError = errMsg;
    await this.save();
  }

  // ---- text selection without repeats ----------------------------------

  /**
   * Pick a random unused text index for the given session key.
   * When all indices are used, the pool resets (new "cycle").
   *
   * @param {string} sessionKey - e.g. accountId
   * @param {number} total - number of available texts
   * @returns {Promise<number>} chosen index
   */
  async pickTextIndex(sessionKey, total) {
    if (!this.db.data.texts[sessionKey]) this.db.data.texts[sessionKey] = [];
    let used = this.db.data.texts[sessionKey];
    if (used.length >= total) {
      used = []; // cycle complete — start over
    }
    const pool = [];
    for (let i = 0; i < total; i++) if (!used.includes(i)) pool.push(i);
    const idx = pool[randInt(0, pool.length - 1)];
    used.push(idx);
    this.db.data.texts[sessionKey] = used;
    await this.save();
    return idx;
  }

  // ---- daily report helpers ---------------------------------------------

  /** Comments written since `sinceTs` (ms epoch). */
  commentsSince(sinceTs) {
    return this.db.data.comments.filter((c) => c.at >= sinceTs);
  }

  offlineAccounts() {
    return Object.entries(this.db.data.accounts)
      .filter(([, a]) => !a.online)
      .map(([id, a]) => ({ id, lastError: a.lastError }));
  }

  async bumpStat(key, delta = 1) {
    this.db.data.stats[key] = (this.db.data.stats[key] || 0) + delta;
    await this.save();
  }

  stat(key) {
    return this.db.data.stats[key] || 0;
  }
}

/**
 * Minimal lowdb v7 JSONFile-compatible adapter (sync fs, atomic-ish write).
 * Implements parse/stringify/read/write as required by Low.
 */
class FileAdapter {
  constructor(filename) {
    this.filename = filename;
  }
  async read() {
    try {
      const raw = await fs.promises.readFile(this.filename, 'utf8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
      this.data = undefined;
    }
    return this.data;
  }
  async write(data) {
    const tmp = this.filename + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmp, this.filename);
    await fs.promises.chmod(this.filename, 0o600);
  }
}

/** Shallow-recursive merge of defaults with persisted data. */
function deepMerge(defaults, data) {
  const out = { ...defaults };
  for (const k of Object.keys(data || {})) {
    if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]) && defaults[k]) {
      out[k] = deepMerge(defaults[k], data[k]);
    } else {
      out[k] = data[k];
    }
  }
  return out;
}

module.exports = { StateStore };
