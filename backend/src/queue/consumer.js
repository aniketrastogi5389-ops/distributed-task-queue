/**
 * Consumer — Atomically dequeues jobs from priority Sorted Sets
 * ============================================================
 * Uses a Lua script for atomic ZRANGEBYSCORE + ZREM + SADD.
 *
 * WHY Lua script instead of ZPOPMIN?
 * - ZPOPMIN doesn't support score thresholds (we need score <= now for delayed retries)
 * - Lua runs atomically on Redis — no race conditions between workers
 * - Two workers can't grab the same job (ZREM returns 0 for the loser)
 *
 * WHY check score <= now?
 * - Retry jobs are re-enqueued with future timestamp scores
 * - They become "visible" only after their backoff delay expires
 * - This mimics SQS's VisibilityTimeout concept
 * ============================================================
 */

const { REDIS_KEYS, PRIORITIES } = require('../config/constants');
const logger = require('../utils/logger');

// Lua: atomically pop the oldest ready job and track it as processing
const DEQUEUE_LUA = `
local result = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #result > 0 then
  redis.call('ZREM', KEYS[1], result[1])
  redis.call('SADD', KEYS[2], result[1])
  return result[1]
end
return nil
`;

/**
 * Tries to dequeue one job, checking high → medium → low priority.
 * Returns jobId or null if all queues are empty.
 */
async function dequeueJob(redis) {
  const now = Date.now();

  for (const level of ['high', 'medium', 'low']) {
    const queueKey = PRIORITIES[level].queue;

    const jobId = await redis.eval(
      DEQUEUE_LUA,
      2,
      queueKey,
      REDIS_KEYS.PROCESSING_SET,
      now
    );

    if (jobId) {
      logger.debug(`Dequeued job from ${level} queue`, { jobId });
      return jobId;
    }
  }

  return null;
}

/** Remove job from processing set after completion or DLQ move */
async function removeFromProcessing(redis, jobId) {
  await redis.srem(REDIS_KEYS.PROCESSING_SET, jobId);
}

module.exports = { dequeueJob, removeFromProcessing };
