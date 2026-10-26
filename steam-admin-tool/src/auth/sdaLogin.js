/**
 * sdaLogin.js — login via Steam Desktop Authenticator maFile + steam-totp.
 *
 * What we do:
 *   1. Load and validate the maFile JSON (shared_secret, identity_secret,
 *      account_name; optional `session` with web cookies).
 *   2. Generate a time-based 2FA code with steam-totp.
 *   3. Hand {accountName, twoFactorCode} to the session layer, which calls
 *      SteamUser#logOn.
 *   4. Provide an authenticated steamcommunity instance (cookies from
 *      maFile.session when present) for community actions.
 *
 * Security notes:
 *   - maFile must live outside config/ in ./secrets (chmod 600, gitignored).
 *   - We never log secret material.
 */

const fs = require('fs');
const path = require('path');
const SteamTotp = require('steam-totp');
const SteamCommunity = require('steamcommunity');
const { getLogger } = require('../utils/logger');

const log = getLogger('auth');

/**
 * Read + sanity-check a maFile.
 * @param {string} maFilePath - relative to cwd or absolute
 * @returns {object} parsed maFile
 * @throws {Error} if missing fields / unreadable
 */
function loadMaFile(maFilePath) {
  if (!maFilePath) throw new Error('maFile path not specified in accounts.json');
  const abs = path.resolve(process.cwd(), maFilePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`maFile not found: ${abs}. Import it from SDA ("More... > Export session") first.`);
  }

  const stat = fs.statSync(abs);
  if ((stat.mode & 0o077) !== 0 && process.platform !== 'win32') {
    log.warn(`maFile ${abs} has loose permissions (${(stat.mode & 0o777).toString(8)}); run: chmod 600 "${abs}"`);
  }

  let ma;
  try {
    ma = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`maFile ${abs} is not valid JSON: ${err.message}`);
  }

  // Encrypted maFiles are common in newer SDA versions — detect and guide user.
  if (ma.shared_secret && typeof ma.shared_secret === 'object' && ma.shared_secret.iv) {
    throw new Error(`maFile ${abs} is encrypted. Decrypt it in SDA before use.`);
  }

  const required = ['shared_secret', 'identity_secret', 'account_name'];
  const missing = required.filter((k) => !ma[k]);
  if (missing.length) {
    throw new Error(`maFile ${abs} is missing field(s): ${missing.join(', ')}`);
  }
  return ma;
}

/**
 * Produce login credentials for steam-user from an maFile.
 *
 * @param {object} account - accounts.json entry
 * @returns {Promise<{accountName:string, twoFactorCode:string, maFile:object}>}
 */
async function getCredentials(account) {
  const ma = loadMaFile(account.maFile);
  const twoFactorCode = await new Promise((resolve, reject) => {
    SteamTotp.getAuthCode(ma.shared_secret, (err, code) =>
      err ? reject(err) : resolve(code),
    );
  });
  log.info(`[${account.id}] Generated 2FA code from maFile (account_name=${ma.account_name})`, {
    accountId: account.id,
  });
  return { accountName: ma.account_name, twoFactorCode, maFile: ma };
}

/**
 * Create a steamcommunity instance pre-authenticated via the web session
 * stored in the maFile (if present). Falls back to an anonymous instance —
 * the caller should then login with accountName/password or refresh token.
 *
 * @param {object} ma - parsed maFile
 * @returns {SteamCommunity}
 */
function createCommunity(ma) {
  const community = new SteamCommunity();
  if (ma.session && ma.session.cookies && Array.isArray(ma.session.cookies)) {
    const jar = community._jar || null; // steamcommunity manages its own cookie jar
    try {
      community.setCookies(
        ma.session.cookies.map((c) => `${c.Name}=${c.Value}; Domain=.steamcommunity.com; Path=/`).join('; '),
      );
      log.debug('Applied web session cookies from maFile.session');
    } catch (err) {
      log.warn(`Could not apply maFile session cookies: ${err.message}`);
    }
  }
  void jar;
  return community;
}

/**
 * Full SDA login helper used by session.js:
 * returns fresh 2FA code on demand (codes rotate every 30s).
 *
 * @param {object} account
 * @returns {Promise<{accountName:string, getTwoFactorCode:Function, maFile:object}>}
 */
async function sdaLogin(account) {
  const ma = loadMaFile(account.maFile);
  return {
    accountName: ma.account_name,
    maFile: ma,
    /** Fresh TOTP code — call right before each logOn attempt. */
    getTwoFactorCode: () =>
      new Promise((resolve, reject) => {
        SteamTotp.getAuthCode(ma.shared_secret, (err, code) => (err ? reject(err) : resolve(code)));
      }),
  };
}

module.exports = { sdaLogin, getCredentials, loadMaFile, createCommunity };
