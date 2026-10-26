/**
 * rateLimiter.js — human-like pacing and Steam-safe throttling.
 *
 * Responsibilities:
 *  1. Per-account cooldown between actions (60–180 s random by default).
 *  2. Per-group cross-account gap (15–40 min random): two different helper
 *     accounts must not comment in the same group too close together.
 *  3. Hard Steam limit: max N comments per hour per account per group.
 *  4. Exponential backoff on HTTP 429 / TooManyRequests: 5 → 15 → 45 → 135 min.
 *
 * All state is persisted through the injected `state` object (lowdb wrapper),
 * so restarts do not reset cooldowns (important for safety).
 */

const { getLogger } = require('./logger');

const log = getLogger('ratelimit');

/** Random integer in [min, max]. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class RateLimiter {
  /**
   * @param {object} cfg - full config.json object
   * @param {object} state - StateStore instance (see src/utils/stateStore.js)
   */
  constructor(cfg, state) {
    this.cfg = cfg.posting;
    this.state = state;
  }

  /**
   * When is the next action allowed for this account+group combo?
   * Returns 0 if it is allowed right now.
   *
   * @param {string} accountId
   * @param {string} groupId
   * @returns {Promise<number>} milliseconds to wait
   */
  async timeUntilAllowed(accountId, groupId) {
    const now = Date.now();
    const waits = [];

    // 1. Backoff after rate-limit errors (global per account).
    const backoffUntil = await this.state.getBackoffUntil(accountId);
    if (backoffUntil > now) waits.push(backoffUntil - now);

    // 2. Human pause since this account's last action (any group).
    const lastAction = await this.state.getLastActionAt(accountId);
    if (lastAction) {
      const pause = await this.state.getNextHumanPause(accountId);
      waits.push(lastAction + pause - now);
    }

    // 3. Cross-account gap within the same group.
    const lastGroupAction = await this.state.getLastGroupActionAt(groupId);
    if (lastGroupAction) {
      const gapMin = this.cfg.crossAccountGroupGapMinMs;
      const gapMax = this.cfg.crossAccountGroupGapMaxMs;
      waits.push(lastGroupAction + randInt(gapMin, gapMax) - now);
    }

    // 4. Hard hourly limit per account per group.
    const count = await this.state.countCommentsInLastHour(accountId, groupId);
    if (count >= this.cfg.maxCommentsPerHourPerAccountPerGroup) {
      const oldest = await this.state.oldestCommentInWindow(accountId, groupId);
      if (oldest) waits.push(oldest + 3600000 - now);
    }

    const wait = Math.max(0, ...waits);
    return Number.isFinite(wait) ? wait : 0;
  }

  /**
   * Block until the action is allowed. Logs long waits at debug level.
   * @returns {Promise<void>}
   */
  async waitForSlot(accountId, groupId) {
    let wait = await this.timeUntilAllowed(accountId, groupId);
    if (wait > 0) {
      log.info(`Rate-limited: ${accountId} waiting ${(wait / 1000).toFixed(0)}s for group ${groupId}`, { accountId });
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /**
   * Record a successful action. Must be called after a post succeeds.
   * Resets the backoff counter for the account.
   */
  async recordAction(accountId, groupId) {
    const now = Date.now();
    await this.state.recordAction(accountId, groupId, now);
    await this.state.resetBackoff(accountId);
  }

  /**
   * Detect whether an error from steamcommunity/steam-user means "too many requests".
   * @param {Error|{message?:string,statusCode?:number}} err
   * @returns {boolean}
   */
  static isRateLimitError(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    return (
      err.statusCode === 429 ||
      /Too Many Requests|TooManyRequests|rate limit|Status code 429/i.test(msg)
    );
  }

  /**
   * Detect captcha-required errors (should NOT be bypassed — we skip and alert).
   * @param {Error} err
   */
  static isCaptchaError(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    return /captcha|locked|ConfirmationRequired/i.test(msg);
  }

  /**
   * Apply exponential backoff after a rate-limit error.
   * Sequence from config: e.g. [5, 15, 45, 135] minutes.
   *
   * @param {string} accountId
   * @returns {Promise<number>} applied backoff in ms
   */
  async applyBackoff(accountId) {
    const seq = this.cfg.backoffSequenceMin;
    const step = await this.state.incrementBackoffStep(accountId);
    const minutes = seq[Math.min(step - 1, seq.length - 1)];
    const ms = minutes * 60000;
    await this.state.setBackoffUntil(accountId, Date.now() + ms);
    log.warn(`Backoff applied for ${accountId}: ${minutes} min (step ${step}/${seq.length})`, { accountId });
    return ms;
  }
}

module.exports = { RateLimiter, randInt };
