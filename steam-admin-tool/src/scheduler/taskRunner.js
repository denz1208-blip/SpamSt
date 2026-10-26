/**
 * taskRunner.js — the scheduler: reads config/tasks.json, executes due tasks
 * through the account pool with full rate-limiting, and writes results back.
 *
 * Task lifecycle: pending -> running -> done | failed (retryable) | skipped.
 * The runner is crash-safe: state (cooldowns, attempts) lives in data/state.json,
 * task statuses live in config/tasks.json (written atomically).
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { postToDiscussion } = require('../actions/discussions');
const { postToGroupWall } = require('../actions/groupWall');
const { RateLimiter } = require('../utils/rateLimiter');
const { TextProvider } = require('../utils/textProvider');
const { getLogger } = require('../utils/logger');

const log = getLogger('scheduler');

class TaskRunner {
  /**
   * @param {object} cfg - full config
   * @param {object} state - StateStore
   * @param {object} pool - AccountPool
   */
  constructor(cfg, state, pool) {
    this.cfg = cfg;
    this.state = state;
    this.pool = pool;
    this.limiter = new RateLimiter(cfg, state);
    this.texts = new TextProvider(cfg.texts.file, state);
    this.tasksFile = path.resolve(process.cwd(), cfg.state.tasksFile);
    this.timer = null;
    this.running = false;   // guard against overlapping ticks
    this.stopped = false;
  }

  /** Start periodic queue processing + daily report cron. */
  start() {
    this.stopped = false;
    this.timer = setInterval(() => {
      this.processQueue().catch((err) => log.error(`Tick crashed: ${err.message}`, { error: err }));
    }, this.cfg.scheduler.tickIntervalMs);
    this.timer.unref?.();

    cron.schedule(this.cfg.scheduler.dailyReportCron, () => this.printDailyReport());

    log.info(`TaskRunner started (tick every ${this.cfg.scheduler.tickIntervalMs / 1000}s)`);
    // First pass shortly after boot so we don't wait a full tick.
    setTimeout(() => this.processQueue().catch(() => {}), 5000).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    log.info('TaskRunner stopped');
  }

  // ---- tasks.json access --------------------------------------------------

  readTasks() {
    try {
      const raw = fs.readFileSync(this.tasksFile, 'utf8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) throw new Error('tasks.json must be an array');
      return arr;
    } catch (err) {
      log.error(`Cannot read tasks.json: ${err.message}`);
      return [];
    }
  }

  writeTasks(tasks) {
    const tmp = this.tasksFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    fs.renameSync(tmp, this.tasksFile);
  }

  // ---- main loop -----------------------------------------------------------

  async processQueue() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const tasks = this.readTasks();
      const now = Date.now();

      for (const task of tasks) {
        if (this.stopped) break;
        if (task.status !== 'pending') continue;
        if (new Date(task.scheduledAt).getTime() > now) continue;

        await this.executeTask(task, tasks);
        this.writeTasks(tasks); // persist status after each task
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Execute one task end-to-end: pick account -> respect limits -> render text
   * -> post -> record. Never throws; failures update task status instead.
   */
  async executeTask(task, allTasks) {
    const mark = (status, errMsg = null) => {
      task.status = status;
      task.attempts = (task.attempts || 0) + (status !== 'done' ? 1 : 0);
      task.lastError = errMsg;
    };

    if (!['discussion', 'wall'].includes(task.type)) {
      mark('skipped', `Unknown task type: ${task.type}`);
      return;
    }
    if (task.type === 'discussion' && !task.topicId) {
      mark('skipped', 'Discussion task missing topicId');
      return;
    }

    // 1. Choose an account (respect explicit assignment if provided).
    let session = null;
    if (task.assignedAccount) {
      const s = this.pool.sessions.get(task.assignedAccount);
      if (s && s.online) session = s;
    }
    if (!session) session = await this.pool.pickForGroup(task.groupId);

    if (!session) {
      log.warn(`No online account for group ${task.groupId}; task ${task.id} stays pending`);
      return; // leave pending — will retry on next tick
    }
    const accountId = session.id;

    // 2. Rate limiting: waits out human pauses, cross-account gaps, hourly caps,
    //    and any active backoff. This is intentionally blocking but bounded.
    const waitMs = await this.limiter.timeUntilAllowed(accountId, task.groupId);
    if (waitMs > this.cfg.scheduler.tickIntervalMs * 4) {
      // Too far in the future — reschedule instead of freezing the runner.
      task.scheduledAt = new Date(Date.now() + waitMs + 60000).toISOString();
      log.info(`Task ${task.id} deferred to ${task.scheduledAt} (rate limit)`);
      return;
    }
    await this.limiter.waitForSlot(accountId, task.groupId);

    // 3. Text selection (random without repeats per account-session) + placeholders.
    const groupName = task.groupPermalink || task.groupId;
    let body;
    try {
      const preferred = Number.isInteger(task.textKey) ? task.textKey : null;
      body = await this.texts.nextText(accountId, { groupName, now: new Date() }, preferred);
    } catch (err) {
      mark('failed_retryable', `textProvider: ${err.message}`);
      return;
    }

    // 4. Post it.
    task.status = 'running';
    try {
      if (task.type === 'discussion') {
        await postToDiscussion(session.community, groupName, task.topicId, body);
      } else {
        await postToGroupWall(session.community, groupName, body);
      }

      // 5. Success bookkeeping.
      await this.limiter.recordAction(accountId, task.groupId);
      await this.state.bumpStat('comments_posted');
      await this.state.bumpStat(`comments_posted_${accountId}`);
      mark('done');
      log.info(`Task ${task.id} done by ${accountId} (${task.type} @ ${groupName})`, { accountId });
    } catch (err) {
      if (RateLimiter.isCaptchaError(err)) {
        // We never bypass captchas. Park the account+task until manual check.
        mark('blocked_captcha', err.message);
        await this.state.setOnline(accountId, false, 'CAPTCHA required — manual check needed');
        log.error(
          `Account ${accountId} hit CAPTCHA on task ${task.id}. Action required: open steamcommunity.com ` +
          `in a browser as this account and resolve it manually. Task not retried automatically.`,
          { accountId, error: err },
        );
      } else if (RateLimiter.isRateLimitError(err)) {
        const backoffMs = await this.limiter.applyBackoff(accountId);
        task.scheduledAt = new Date(Date.now() + backoffMs).toISOString();
        mark('pending', `429/TooManyRequests — backing off ${Math.round(backoffMs / 60000)} min`);
        log.warn(`Rate limited on task ${task.id}; ${accountId} paused. Retry at ${task.scheduledAt}`);
      } else {
        mark('failed_retryable', err.message);
        log.error(`Task ${task.id} failed: ${err.message}`, { error: err });
      }
      await this.state.bumpStat('tasks_failed');
    }
  }

  // ---- reporting ------------------------------------------------------------

  /** Console + actions.log summary of the last 24 hours. */
  printDailyReport() {
    const since = Date.now() - 24 * 3600000;
    const comments = this.state.commentsSince(since);
    const perAccount = {};
    for (const c of comments) perAccount[c.accountId] = (perAccount[c.accountId] || 0) + 1;

    const tasks = this.readTasks();
    const counts = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;

    const offline = this.pool.offlineIds();
    const lines = [
      '==================== DAILY REPORT ====================',
      `Comments posted (24h): ${comments.length}`,
      ...Object.entries(perAccount).map(([id, n]) => `  - ${id}: ${n}`),
      `Accounts online:  ${this.pool.onlineIds().join(', ') || '(none)'}`,
      `Accounts offline: ${offline.join(', ') || '(none)'}`,
      `Task queue: ${JSON.stringify(counts)}`,
      '======================================================',
    ];
    lines.forEach((l) => log.info(l));
    // Also force a console print regardless of winston level.
    console.log('\n' + lines.join('\n') + '\n');
  }

  /** --report-only mode helper. */
  reportNow() {
    this.printDailyReport();
  }
}

module.exports = { TaskRunner };
