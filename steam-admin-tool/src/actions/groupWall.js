/**
 * groupWall.js — posting comments to a group's wall via steamcommunity.
 *
 * Legitimate use only: post to walls of groups YOU own/moderate.
 */

const logger = require('../utils/logger');

/**
 * Post a comment on the group wall (forum "Latest Activity" / wall feed).
 * @param {object} community - Logged-in SteamCommunity instance.
 * @param {string} permalinkOrGroupId - Group URLID or 64-bit group id.
 * @param {string} text - Comment body.
 * @returns {Promise<object>} Resolves with response data on success.
 */
function postToGroupWall(community, permalinkOrGroupId, text) {
  return new Promise((resolve, reject) => {
    if (!community || typeof community.postGroupComment !== 'function') {
      return reject(new Error('Invalid SteamCommunity instance'));
    }
    if (!permalinkOrGroupId || !text) {
      return reject(new Error('Missing required arguments for group wall comment'));
    }

    const gid = /^\d{17}$/.test(permalinkOrGroupId)
      ? permalinkOrGroupId
      : null; // numeric groupid64 vs urlid handled below

    const cb = (err, data) => {
      if (err) {
        const e = new Error(err.message || String(err));
        e.rateLimited = /rate\s?limit|too\s?many|429/i.test(e.message);
        e.captcha = /captcha/i.test(e.message);
        return reject(e);
      }
      logger.info(`Posted comment to group wall ${permalinkOrGroupId}`);
      resolve(data || {});
    };

    if (gid) {
      community.postGroupComment(gid, text, cb);
    } else {
      // Resolve urlid -> groupid64 first, then post.
      community.getGroup(permalinkOrGroupId, {}, (err, group) => {
        if (err) return reject(new Error(`Cannot resolve group "${permalinkOrGroupId}": ${err.message}`));
        community.postGroupComment(group.groupID64.toString(), text, cb);
      });
    }
  });
}

module.exports = { postToGroupWall };
