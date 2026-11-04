/**
 * Dead Letter Queue (DLQ)
 * ============================================================
 * Jobs that exceed MAX_RETRIES land here for manual inspection.
 *
 * WHY DLQ matters (interview):
 * "Without a DLQ, poison messages (jobs that always fail) block the queue
 *  forever in a retry loop. DLQ isolates them so healthy jobs keep flowing.
 *  In production, we'd alert on DLQ depth and provide a UI to retry/delete."
 * ============================================================
 */

const { REDIS_KEYS, JOB_STATUS } = require('../config/constants');
const { updateJob } = require('./jobStore');
const { removeFromProcessing } = require('./consumer');
const logger = require('../utils/logger');

async function moveToDLQ(redis, job, errorMessage) {
  const dlqEntry = {
    jobId: job.id,
    type: job.type,
    priority: job.priority,
    retries: job.retries,
    lastError: errorMessage,
    movedAt: Date.now(),
  };

  await redis.pipeline()
    .lpush(REDIS_KEYS.DLQ, JSON.stringify(dlqEntry))
    .srem(REDIS_KEYS.PROCESSING_SET, job.id)
    .incr(REDIS_KEYS.METRICS_FAILED)
    .exec();

  await updateJob(redis, job.id, {
    status: JOB_STATUS.DLQ,
    lastError: errorMessage,
    history: [...(job.history || []), { status: JOB_STATUS.DLQ, timestamp: Date.now(), error: errorMessage }],
  });

  logger.warn('Job moved to DLQ', { jobId: job.id, retries: job.retries, error: errorMessage });
}

async function getDLQEntries(redis, count = 50) {
  const entries = await redis.lrange(REDIS_KEYS.DLQ, 0, count - 1);
  return entries.map(e => JSON.parse(e));
}

async function getDLQSize(redis) {
  return redis.llen(REDIS_KEYS.DLQ);
}

module.exports = { moveToDLQ, getDLQEntries, getDLQSize };
