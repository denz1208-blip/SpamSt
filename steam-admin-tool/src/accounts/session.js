/**
 * session.js — one live session per account.
 *
 * Owns:
 *   - a SteamUser instance (CS connection, presence)
 *   - a SteamCommunity instance (web actions: comments) authenticated by
 *     reusing the web session that steam-user obtained at logon
 *     (user.webSession -> cookies + loginKey).
 *
 * Handles:
 *   - disconnect / kicked-for-elsewhere with exponential auto-reconnect
 *   - fresh TOTP codes for every attempt (SDA mode)
 *   - refreshToken-based re-login (QR mode, tokens persisted by pool)
 */

const EventEmitter = require('events');
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const { sdaLogin } = require('../auth/sdaLogin');
const { qrLogin } = require('../auth/qrLogin');
const { getLogger } = require('../utils/logger');

const log = getLogger('session');

class AccountSession extends EventEmitter {
  /**
   * @param {object} account - accounts.json entry
   * @param {object} cfg - full config
   * @param {object} state - StateStore
   * @param {object|null} savedTokens - {refreshToken,...} from previous QR login
   */
  constructor(account, cfg, state, savedTokens = null) {
    super();
    this.account = account;
    this.cfg = cfg;
    this.state = state;
    this.savedTokens = savedTokens;

    this.user = null;
    this.community = null;
    this.online = false;
    this.closing = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.sda = null; // populated for SDA accounts
  }

  get id() {
    return this.account.id;
  }

  /**
   * Establish the session. Resolves when SteamUser is 'loggedOn' AND the
   * community instance has an authenticated web session.
   */
  async connect() {
    if (this.user) throw new Error(`Session ${this.id} already created`);

    const user = new SteamUser({
      dataDirectory: false, // we persist tokens ourselves in state.json
      autoTrust: true,      // trust own devices to reduce repeated 2FA prompts
      support: false,
    });
    this.user = user;
    this._bindUserEvents(user);

    const details = await this._buildLoginDetails();
    log.info(`[${this.id}] Logging on (method=${this.account.authMethod})`, { accountId: this.id });
    user.logOn(details);

    return new Promise((resolve, reject) => {
      const onSuccess = () => {
        cleanup();
        resolve(this);
      };
      const onFail = (err) => {
        cleanup();
        reject(err);
      };
      this.once('connected', onSuccess);
      this.once('connectFailed', onFail);
      const cleanup = () => {
        this.removeListener('connected', onSuccess);
        this.removeListener('connectFailed', onFail);
      };
    });
  }

  /** Compose logOn details depending on auth method. */
  async _buildLoginDetails() {
    const method = this.account.authMethod || this.cfg.auth.defaultMethod;

    if (method === 'qr') {
      // Prefer a stored refresh token for silent re-login.
      if (this.savedTokens && this.savedTokens.refreshToken) {
        log.info(`[${this.id}] Using stored refresh token (QR-mode account)`, { accountId: this.id });
        return { refreshToken: this.savedTokens.refreshToken };
      }
      // First run: interactive QR scan to obtain tokens.
      const tokens = await qrLogin(this.account, this.cfg);
      this.savedTokens = tokens;
      await this.state.setQrTokens(this.id, tokens);
      return { refreshToken: tokens.refreshToken };
    }

    // SDA path. steam-user v5 can drive the mobile-app confirmation flow via
    // SteamGuardAccount (from steam-totp). We build it from the maFile so that
    // first-ever logins get auto-confirmed when "Confirmations" are enabled.
    if (!this.sda) this.sda = await sdaLogin(this.account);
    if (!this.steamGuard) {
      try {
        const { SteamGuardAccount } = require('steam-totp');
        this.steamGuard = new SteamGuardAccount({ shared_secret: this.sda.maFile.shared_secret });
      } catch (_) {
        this.steamGuard = null; // older steam-totp without SteamGuardAccount
      }
    }
    const twoFactorCode = await this.sda.getTwoFactorCode();
    const details = { accountName: this.sda.accountName, twoFactorCode };
    if (this.steamGuard) details.SteamGuardAccount = this.steamGuard;
    return details;
  }

  /** Wire all steam-user lifecycle events. Never let them crash the process. */
  _bindUserEvents(user) {
    user.on('loggedOn', (details) => {
      log.info(`[${this.id}] loggedOn as ${details.clientSteamid}`, { accountId: this.id });
      user.setPersona(SteamUser.EPersonaState.Online);
      this._setupCommunity(user);
    });

    user.on('webSession', (sessionId, cookies) => {
      // Refresh community cookies whenever Steam rotates the web session.
      if (this.community) {
        try {
          this.community.setCookies(cookies);
          this.community.setSessionID(sessionId);
          this._clearOldSession(this.community);
        } catch (err) {
          log.warn(`[${this.id}] webSession cookie refresh failed: ${err.message}`);
        }
      }
    });

    user.on('disconnected', (eresult) => {
      this.online = false;
      const msg = `Disconnected: ${SteamUser.EResult[eresult] || eresult}`;
      log.warn(`[${this.id}] ${msg}`, { accountId: this.id });
      this.emit('disconnected', eresult);
      this._scheduleReconnect(msg);
    });

    // Kicked because another login happened with the same account.
    const kicked = (name) => (eresult) => {
      this.online = false;
      const msg = `${name} (${SteamUser.EResult[eresult] || eresult}). ` +
        `Another client logged in with this account — pausing reconnect for manual check.`;
      log.error(`[${this.id}] ${msg}`, { accountId: this.id, error: new Error(msg) });
      this.emit('kicked', name);
      // Back off much longer than a normal disconnect: logging back in would
      // kick the other client and start a war of sessions.
      this._scheduleReconnect(msg, 15 * 60 * 1000);
    };
    user.on('logOnFailure', (err) => {
      const replacedCodes = [
        SteamUser.EResult.LogonSessionReplaced,
        SteamUser.EResult.AlreadyLoggedInSameSteamID,
      ];
      if (replacedCodes.includes(err.eresult)) {
        kicked('LogonSessionReplaced')(err.eresult);
      } else if (
        err.eresult === SteamUser.EResult.AlreadyLoggedInElsewhere ||
        /LoggedInElsewhere/i.test(err.message || '')
      ) {
        kicked('LoggedInElsewhere')(err.eresult);
      } else {
        this.online = false;
        const msg = `logOnFailure: ${err.message} (eresult=${err.eresult})`;
        log.error(`[${this.id}] ${msg}`, { accountId: this.id, error: err });
        this.emit('logOnFailure', err);
        this._scheduleReconnect(msg);
      }
    });

    user.on('error', (err) => {
      // Catch-all so nothing crashes the process.
      this.online = false;
      log.error(`[${this.id}] steam-user error: ${err.message}`, { accountId: this.id, error: err });
      if (err.message && /Captch|TooManyRequests|RateLimit/i.test(err.message)) {
        this.emit('authThrottled', err);
        this._scheduleReconnect(err.message, 30 * 60 * 1000);
      } else {
        this._scheduleReconnect(err.message || 'unknown');
      }
    });

    // Connected event we use for initial handshake success detection.
    user.on('friendsList', () => {
      if (!this.online) {
        this.online = true;
        this.reconnectAttempts = 0;
        this.state.setOnline(this.id, true, null);
        this.emit('connected');
      }
    });
  }

  /** Build an authenticated SteamCommunity from steam-user's web session. */
  _setupCommunity(user) {
    const community = new SteamCommunity();
    this.community = community;

    if (user.webSession) {
      try {
        community.setCookies(user.webSession.cookies);
        community.setSessionID(user.webSession.sessionID);
        if (user.webSession.loginKey) community.setLoginKey(user.webSession.loginKey);
      } catch (err) {
        log.warn(`[${this.id}] community cookie setup failed: ${err.message}`);
      }
    }

    community.on('sessionExpired', () => {
      log.warn(`[${this.id}] Community session expired — refreshing via steam-user`, { accountId: this.id });
      try {
        user.requestWebAPIAccessToken?.(() => {});
        // Re-request a websession; steam-user emits 'webSession' which updates cookies.
        user.logOff();
        this._reconnectNow();
      } catch (err) {
        log.error(`[${this.id}] session refresh failed`, { accountId: this.id, error: err });
      }
    });

    // Mark fully connected even if friendsList already fired.
    this.online = true;
    this.reconnectAttempts = 0;
    this.state.setOnline(this.id, true, null);
    this.emit('connected');
  }

  /** steamcommunity keeps old anonymous cookies around; clear leftovers. */
  _clearOldSession(community) {
    try {
      if (community._jar && typeof community._jar.reset === 'function') {
        // jar is shared per-instance only; nothing to reset here. Kept for safety.
      }
    } catch (_) { /* no-op */ }
  }

  /** Exponential reconnect with cap; honors config.auth.reconnect. */
  _scheduleReconnect(reason, overrideDelayMs = null) {
    if (this.closing || !this.cfg.auth.reconnect.enabled) return;
    if (this.reconnectTimer) return; // already scheduled

    if (this.reconnectAttempts >= this.cfg.auth.reconnect.maxAttempts) {
      const msg = `[${this.id}] Giving up after ${this.reconnectAttempts} reconnect attempts (${reason}). Needs manual attention.`;
      log.error(msg, { accountId: this.id, error: new Error(msg) });
      this.state.setOnline(this.id, false, reason);
      this.emit('gaveUp', reason);
      return;
    }

    const base = overrideDelayMs ?? this.cfg.auth.reconnect.baseDelayMs;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempts), this.cfg.auth.reconnect.maxDelayMs);
    this.reconnectAttempts++;
    log.info(`[${this.id}] Reconnect #${this.reconnectAttempts} in ${(delay / 1000).toFixed(0)}s`, { accountId: this.id });
    this.state.setOnline(this.id, false, reason);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._reconnectNow();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  _reconnectNow() {
    if (this.closing) return;
    // Fresh 2FA code each attempt for SDA accounts.
    this._buildLoginDetails()
      .then((details) => this.user.logOn(details))
      .catch((err) => {
        log.error(`[${this.id}] Reconnect build failed`, { accountId: this.id, error: err });
        this._scheduleReconnect(err.message);
      });
  }

  /** Graceful shutdown. */
  async close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.user && this.user.logOff(); } catch (_) { /* ignore */ }
    try { this.community && this.community.reset ? this.community.reset() : null; } catch (_) { /* ignore */ }
    this.online = false;
    await this.state.setOnline(this.id, false, 'closed by pool');
    this.removeAllListeners();
  }
}

module.exports = { AccountSession };
