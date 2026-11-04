/**
 * Worker — Job Consumer with Retry + Exponential Backoff + DLQ
 * ============================================================
 * This module can run as:
 *   1. Standalone process: node src/workers/worker.js
 *   2. Inline with server: imported by server.js
 *
 * RETRY STRATEGY (Exponential Backoff):
 *   Delay = 2^retries × BASE_BACKOFF_MS
 *   Retry 1: 2^1 × 1000 = 2000ms
 *   Retry 2: 2^2 × 1000 = 4000ms
 *   Retry 3: exceeds MAX_RETRIES → DLQ
 *
 * WHY exponential backoff?
 * "If a downstream service is overloaded, hammering it with retries
 *  makes things worse. Exponential backoff gives it time to recover.
 *  Jitter prevents synchronized retries from multiple workers."
 *
 * INTERVIEW: "This implements at-least-once delivery. A job might be
 * processed twice if the worker crashes after processing but before
 * acknowledging. For exactly-once, you need idempotent operations."
 * ============================================================
 */

const { getRedisClient } = require('../config/redis');
const { dequeueJob, removeFromProcessing } = require('../queue/consumer');
const { getJob, updateJob } = require('../queue/jobStore');
const { moveToDLQ } = require('../queue/dlq');
const { REDIS_KEYS, JOB_STATUS, WORKER_CONFIG, PRIORITIES } = require('../config/constants');
const logger = require('../utils/logger');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let running = true;

/**
 * Simulates job execution. In production, this would call external
 * APIs, process data, send emails, etc.
 *
 * 30% failure rate for demo — shows retry + DLQ in action.
 */
async function executeJob(job) {
  const SUPPORTED_JOB_TYPES = [
    'email', 
    'analytics', 
    'report_generation', 
    'resize-image', 
    'generate-report', 
    'data-sync', 
    'send-notification', 
    'fail-test'
  ];

  if (!SUPPORTED_JOB_TYPES.includes(job.type)) {
    logger.error(`Unknown job type encountered`, { jobId: job.id, type: job.type });
    throw new Error(`Unsupported job type: "${job.type}"`);
  }

  const duration = 800 + Math.random() * 1500;
  await sleep(duration);

  switch (job.type) {
    case 'fail-test':
      // "fail-test" jobs ALWAYS fail — use this to demonstrate retry + DLQ
      throw new Error(`Guaranteed failure: job type="fail-test" always fails (retry ${job.retries || 0}/${job.maxRetries})`);

    case 'email':
    case 'analytics':
    case 'report_generation':
    case 'resize-image':
    case 'generate-report':
    case 'data-sync':
    case 'send-notification':
      // Normal jobs: 30% random failure rate for demo
      if (Math.random() < 0.3) {
        throw new Error(`Simulated failure for job type="${job.type}"`);
      }
      break;

    default:
      // Fallback in case of unexpected bypass
      logger.error(`Unknown job type in switch`, { jobId: job.id, type: job.type });
      throw new Error(`Unsupported job type: "${job.type}"`);
  }

  return { processedAt: Date.now(), duration: Math.round(duration) };
}

/**
 * Re-enqueue a failed job with a future timestamp for delayed retry.
 * The consumer's Lua script only picks jobs with score <= Date.now(),
 * so this job becomes "invisible" until the backoff period expires.
 */
async function retryJob(redis, job) {
  const delay = Math.pow(2, job.retries) * WORKER_CONFIG.BASE_BACKOFF_MS;
  const retryAt = Date.now() + delay;
  const queueKey = PRIORITIES[job.priority].queue;

  // Update job metadata
  const updatedJob = await updateJob(redis, job.id, {
    status: JOB_STATUS.PENDING,
    retries: job.retries,
    lastError: job.lastError,
    nextRetryAt: retryAt,
    history: [
      ...(job.history || []),
      { status: 'retry', timestamp: Date.now(), retryNumber: job.retries, delay },
    ],
  });

  // Re-enqueue with future score + remove from processing
  await redis.pipeline()
    .zadd(queueKey, retryAt, job.id)
    .srem(REDIS_KEYS.PROCESSING_SET, job.id)
    .exec();

  logger.info(`Job scheduled for retry`, {
    jobId: job.id,
    retry: job.retries,
    delay: `${delay}ms`,
    retryAt: new Date(retryAt).toISOString(),
  });
}

/**
 * Main worker loop — polls Redis for jobs and processes them.
 */
async function startWorker() {
  const redis = getRedisClient();
  const workerId = `worker-${process.pid}`;

  logger.info(`${workerId} started — polling every ${WORKER_CONFIG.POLL_INTERVAL_MS}ms`);

  while (running) {
    try {
      const jobId = await dequeueJob(redis);

      if (!jobId) {
        await sleep(WORKER_CONFIG.POLL_INTERVAL_MS);
        continue;
      }

      const job = await getJob(redis, jobId);
      if (!job) {
        await removeFromProcessing(redis, jobId);
        logger.warn('Dequeued job not found in store — skipping', { jobId });
        continue;
      }

      // Mark as processing
      await updateJob(redis, job.id, {
        status: JOB_STATUS.PROCESSING,
        workerId,
        startedAt: Date.now(),
        history: [...(job.history || []), { status: JOB_STATUS.PROCESSING, timestamp: Date.now(), workerId }],
      });

      try {
        // Execute the job
        const result = await executeJob(job);

        // Mark as done
        await updateJob(redis, job.id, {
          status: JOB_STATUS.DONE,
          result,
          completedAt: Date.now(),
          history: [...(job.history || []), { status: JOB_STATUS.DONE, timestamp: Date.now(), result }],
        });
        await removeFromProcessing(redis, job.id);
        await redis.incr(REDIS_KEYS.METRICS_PROCESSED);

        logger.info('Job completed', { jobId: job.id, duration: result.duration });

      } catch (err) {
        // Job failed — retry or DLQ
        const retries = (job.retries || 0) + 1;

        if (retries >= WORKER_CONFIG.MAX_RETRIES) {
          await moveToDLQ(redis, { ...job, retries }, err.message);
          logger.error('Job exhausted retries → DLQ', { jobId: job.id, retries });
        } else {
          await retryJob(redis, { ...job, retries, lastError: err.message });
        }
      }

    } catch (err) {
      logger.error('Worker loop error', { error: err.message });
      await sleep(WORKER_CONFIG.POLL_INTERVAL_MS);
    }
  }

  logger.info('Worker stopped');
}

function stopWorker() {
  running = false;
}

// Run standalone if executed directly
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
  startWorker();

  process.on('SIGTERM', stopWorker);
  process.on('SIGINT', stopWorker);
}

module.exports = { startWorker, stopWorker };
