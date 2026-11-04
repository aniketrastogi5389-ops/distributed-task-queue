/**
 * Producer — Enqueues jobs into priority Sorted Sets
 * ============================================================
 * Uses Redis Pipeline for atomic store + enqueue.
 * Score = enqueue timestamp → FIFO ordering within each priority.
 *
 * INTERVIEW: "Pipeline batches multiple commands into one TCP round-trip.
 * Without pipelining, 2 commands = 2 round-trips (~1ms each to Upstash).
 * With pipelining, 2 commands = 1 round-trip. At 10K jobs/sec, this halves latency."
 * ============================================================
 */

const { v4: uuidv4 } = require('uuid');
const { PRIORITIES, JOB_STATUS, WORKER_CONFIG } = require('../config/constants');
const { createJob } = require('./jobStore');
const logger = require('../utils/logger');

async function enqueueJob(redis, { type, payload, priority = 'medium' }) {
  if (!PRIORITIES[priority]) {
    const err = new Error(`Invalid priority: "${priority}". Must be: high, medium, low`);
    err.statusCode = 400;
    throw err;
  }

  const job = {
    id: uuidv4(),
    type: type || 'default',
    payload: payload || {},
    priority,
    status: JOB_STATUS.PENDING,
    retries: 0,
    maxRetries: WORKER_CONFIG.MAX_RETRIES,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [{ status: JOB_STATUS.PENDING, timestamp: Date.now() }],
  };

  const queueKey = PRIORITIES[priority].queue;

  // Atomic: store job data + add to priority queue
  await redis.pipeline()
    .hset('dtq:jobs', job.id, JSON.stringify(job))
    .zadd(queueKey, Date.now(), job.id)
    .exec();

  logger.info('Job enqueued', { jobId: job.id, type: job.type, priority });
  return job;
}

module.exports = { enqueueJob };
