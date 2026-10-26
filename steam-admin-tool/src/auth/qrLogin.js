/**
 * qrLogin.js — QR-code login flow using steam-user v5 auth API.
 *
 * Protocol (IAuthenticationService):
 *   1. init()               -> fetches the list of device "gts" tokens from
 *                              the local SDA maFile (if provided) so that a
 *                              previously-authorized phone can auto-approve,
 *                              and requests a fresh QR challenge URL.
 *   2. getQrUrl()           -> returns the `steam://qr/...` URL to encode.
 *   3. renderQr()           -> prints an ASCII QR to the console via
 *                              qrcode-terminal (or hands the raw URL to a
 *                              caller that renders it in a web UI).
 *   4. poll()               -> checks scan/denied/expired state and, once the
 *                              mobile app approves, obtains access+refresh
 *                              tokens suitable for SteamUser#logOn.
 *
 * No credentials are ever stored by this module; the refresh token is
 * returned to the session layer which persists it in data/state.json (0600).
 */

const fs = require('fs');
const path = require('path');
const SteamUser = require('steam-user');
const qrcodeTerminal = require('qrcode-terminal');
const { getLogger } = require('../utils/logger');

const log = getLogger('auth');

/**
 * @param {object} account - entry from config/accounts.json
 * @param {object} cfg     - full parsed config.json
 * @returns {Promise<{accessToken:string, refreshToken:string, steamId:string}>}
 */
async function qrLogin(account, cfg) {
  const user = new SteamUser({ autoTrust: false, support: false });
  const timeoutMs = (cfg.auth && cfg.auth.qrTimeoutMs) || 180000;

  try {
    // ---- 1. Initialize the auth API with optional saved device tokens ----
    const gts = loadGtsFromMaFile(account.maFile);
    await initAuth(user, gts);

    // ---- 2/3. Obtain QR and render it ----
    const qrUrl = await getQrUrl(user);
    log.info(`[${account.id}] QR generated. Open Steam Mobile -> QR scanner.`);
    renderQr(qrUrl);

    // ---- 4. Poll until scanned+approved or timeout ----
    const tokens = await pollUntilApproved(user, qrUrl, timeoutMs, account.id);

    log.info(`[${account.id}] QR approved, got tokens (steamid=${tokens.steamId})`);
    return tokens;
  } finally {
    try { user.logOff(); } catch (_) { /* ignore */ }
  }
}

/**
 * Read previously-granted device "gts" tokens from an SDA maFile's
 * `session` block if present. Enables silent re-approval on the phone.
 * Returns [] when unavailable — the QR still works, the user just has to
 * tap "Approve" manually.
 */
function loadGtsFromMaFile(maFilePath) {
  if (!maFilePath) return [];
  const abs = path.resolve(process.cwd(), maFilePath);
  if (!fs.existsSync(abs)) return [];
  try {
    const ma = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const deviceId = (ma.device_id || '').toString();
    const secret = (ma.session && ma.session.token_secret) || '';
    if (!deviceId || !secret) return [];
    return [{ device_id: deviceId, token_secret: secret }];
  } catch (err) {
    log.warn(`Could not read maFile for gts: ${err.message}`);
    return [];
  }
}

/** Call IAuthenticationService#init with our device list. */
function initAuth(user, gts) {
  return new Promise((resolve, reject) => {
    user.webapi.call(
      'IAuthenticationService',
      'init',
      'v1',
      { device_ids: gts.map((g) => g.device_id) },
      (err, body) => (err ? reject(err) : resolve(body)),
    );
  });
}

/** Request a fresh QR challenge URL. */
function getQrUrl(user) {
  return new Promise((resolve, reject) => {
    user.webapi.call(
      'IAuthenticationService',
      'pollauth_session_via_qr',
      'v1',
      {},
      (err, body) => {
        if (err) return reject(err);
        const url =
          body.response &&
          (body.response.challenge_url ||
            `steam://qr/${encodeURIComponent(body.response.qr_token || '')}`);
        if (!url) return reject(new Error('QR response missing challenge_url'));
        // Stash polling params on the object for later calls.
        getQrUrl._params = {
          qr_token: body.response.qr_token,
          poll_interval: body.response.poll_interval || 5,
          steamid: body.response.steamid,
        };
        resolve(url);
      },
    );
  });
}

/** Render QR to console; also print the raw URL for web-UI integrations. */
function renderQr(url) {
  qrcodeTerminal.generate(url, { small: true }, (qr) => {
    process.stdout.write('\n' + qr + '\n');
    process.stdout.write(`Raw URL (for web UI): ${url}\n\n`);
  });
}

/**
 * Long-poll the QR status until APPROVED / DENIED / EXPIRED / timeout.
 * On approval we call accessToken → then request a refresh token for future logins.
 */
function pollUntilApproved(user, initialUrl, timeoutMs, accountId) {
  const started = Date.now();
  const params = getQrUrl._params || {};

  const step = async () => {
    if (Date.now() - started > timeoutMs) {
      throw Object.assign(new Error('QR login timed out'), { code: 'QRExpired' });
    }

    const status = await new Promise((resolve, reject) => {
      user.webapi.call(
        'IAuthenticationService',
        'pollauth_session_via_qr',
        'v1',
        { qr_token: params.qr_token },
        (err, body) => (err ? reject(err) : resolve(body.response || {})),
      );
    });

    switch (status.state) {
      case 'APPROVED': {
        const token = await requestAccessToken(user, status);
        const refreshed = await requestRefreshToken(user, token.accessToken);
        return {
          accessToken: token.accessToken,
          refreshToken: refreshed.refreshToken || token.refreshToken,
          steamId: String(status.steamid || params.steamid || ''),
        };
      }
      case 'DENIED':
        throw Object.assign(new Error('QR login denied on mobile device'), { code: 'QRDenied' });
      case 'EXPIRED':
        throw Object.assign(new Error('QR code expired, restart login'), { code: 'QRExpired' });
      default: {
        const waitSec = Math.min(status.interval || params.poll_interval || 5, 10);
        log.debug(`[${accountId}] QR state=${status.state || 'WAITING'}, next poll in ${waitSec}s`);
        await sleep(waitSec * 1000);
        return step();
      }
    }
  };

  return step();
}

/** Exchange the approved QR session for a client access token. */
function requestAccessToken(user, status) {
  return new Promise((resolve, reject) => {
    user.webapi.call(
      'IAuthenticationService',
      'access_token',
      'v1',
      {
        steamid: String(status.steamid || ''),
        token_type: 'device',
        auth_code: status.auth_code,
        webhook_url: null,
        device_id: 'steam-admin-tool-' + process.pid,
      },
      (err, body) => {
        if (err) return reject(err);
        const r = body.response || {};
        resolve({ accessToken: r.access_token, refreshToken: r.refresh_token });
      },
    );
  });
}

/** Use the access token to obtain a long-lived refresh token. */
function requestRefreshToken(user, accessToken) {
  return new Promise((resolve) => {
    user.webapi.call(
      'IAuthenticationService',
      'refresh_token',
      'v1',
      {
        refresh_token: accessToken, // API quirk: current token goes in this field
        get_access_token: true,
      },
      (err, body) => {
        if (err) {
          log.warn(`refresh_token step failed (continuing with access token): ${err.message}`);
          return resolve({});
        }
        resolve({ refreshToken: (body.response || {}).new_refresh_token });
      },
    );
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { qrLogin, renderQr };
