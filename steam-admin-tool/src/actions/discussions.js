/**
 * discussions.js — posting comments to group discussion topics via steamcommunity.
 *
 * Legitimate use only: post to discussions in groups YOU own/moderate.
 */

const logger = require('../utils/logger');

/**
 * Post a comment to a discussion topic.
 * @param {object} community - Logged-in SteamCommunity instance (has cookies).
 * @param {string} permalinkOrGroupId - Group URLID or 64-bit group id.
 * @param {string} topicId - Discussion topic id (from the topic page URL).
 * @param {string} text - Comment body.
 * @returns {Promise<object>} Resolves with response data on success.
 */
function postToDiscussion(community, permalinkOrGroupId, topicId, text) {
  return new Promise((resolve, reject) => {
    if (!community || typeof community.commentOnDiscussion !== 'function') {
      return reject(new Error('Invalid SteamCommunity instance'));
    }
    if (!permalinkOrGroupId || !topicId || !text) {
      return reject(new Error('Missing required arguments for discussion comment'));
    }

    community.commentOnDiscussion(
      `https://steamcommunity.com/groups/${permalinkOrGroupId}/discussions/${topicId}/`,
      text,
      (err, data) => {
        if (err) {
          const e = new Error(err.message || String(err));
          e.rateLimited = /rate\s?limit|too\s?many|429/i.test(e.message);
          e.captcha = /captcha/i.test(e.message);
          return reject(e);
        }
        logger.info(`Posted comment to discussion ${topicId} in group ${permalinkOrGroupId}`);
        resolve(data || {});
      }
    );
  });
}

module.exports = { postToDiscussion };
