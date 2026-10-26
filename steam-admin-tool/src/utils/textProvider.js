/**
 * textProvider.js — loads config/texts.json, picks random texts without
 * repeats within a session, and expands placeholders.
 *
 * Supported placeholders:
 *   {group_name}    — resolved group name (falls back to permalink)
 *   {date}          — today's date in locale format (ru by default)
 *   {random_emoji}  — one emoji from a small safe set
 */

const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const log = getLogger('texts');

/** Small neutral emoji set — no political/religious symbols. */
const EMOJIS = ['👍', '✨', '🔥', '💡', '👏', '🙂', '⭐', '✅'];

class TextProvider {
  /**
   * @param {string} textsFile - path to texts.json
   * @param {object} state - StateStore instance (persists used indices)
   */
  constructor(textsFile, state) {
    this.textsFile = path.resolve(process.cwd(), textsFile);
    this.state = state;
    this.texts = [];
    this.reload();
  }

  /** Re-read texts.json from disk (call after manual edits). */
  reload() {
    try {
      const raw = fs.readFileSync(this.textsFile, 'utf8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0 || arr.some((x) => typeof x !== 'string')) {
        throw new Error('texts.json must be a non-empty array of strings');
      }
      this.texts = arr;
      log.info(`Loaded ${this.texts.length} texts from ${this.textsFile}`);
    } catch (err) {
      log.error(`Failed to load texts.json`, { error: err });
      this.texts = [];
      throw err;
    }
  }

  get count() {
    return this.texts.length;
  }

  /**
   * Pick a random text for the given session (account), avoiding repeats
   * until the whole pool is exhausted (then it cycles).
   *
   * @param {string} sessionKey - usually accountId
   * @param {number|null} preferredIndex - task.textKey if explicitly set
   * @returns {Promise<string>} raw template string
   */
  async pick(sessionKey, preferredIndex = null) {
    if (this.texts.length === 0) throw new Error('No texts available');

    let idx;
    if (preferredIndex !== null && preferredIndex !== undefined) {
      idx = Number(preferredIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.texts.length) {
        log.warn(`Invalid textKey ${preferredIndex}, falling back to random pick`);
        idx = await this.state.pickTextIndex(sessionKey, this.texts.length);
      }
    } else {
      idx = await this.state.pickTextIndex(sessionKey, this.texts.length);
    }
    return this.texts[idx];
  }

  /**
   * Expand placeholders in a template.
   *
   * @param {string} template
   * @param {object} vars
   * @param {string} [vars.groupName]
   * @param {Date}   [vars.now]
   * @param {string} [vars.locale]
   * @returns {string}
   */
  static render(template, vars = {}) {
    const now = vars.now || new Date();
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    return template
      .replaceAll('{group_name}', vars.groupName || 'группе')
      .replaceAll('{date}', now.toLocaleDateString(vars.locale || 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }))
      .replaceAll('{random_emoji}', emoji);
  }

  /** Convenience: pick + render in one call. */
  async nextText(sessionKey, vars, preferredIndex = null) {
    const tpl = await this.pick(sessionKey, preferredIndex);
    return TextProvider.render(tpl, vars);
  }
}

module.exports = { TextProvider };
