/**
 * Job Store — Redis Hash-backed CRUD for job metadata
 * ============================================================
 * Each job is stored as a JSON string in a Redis Hash (dtq:jobs).
 * Hash key = jobId, Hash value = serialized job object.
 *
 * WHY Redis Hash over separate keys?
 * - HGETALL retrieves all jobs in one round-trip (O(N))
 * - Namespace isolation — all jobs under one key
 * - HSCAN for pagination at scale
 * ============================================================
 */

const { REDIS_KEYS } = require('../config/constants');

async function createJob(redis, job) {
  await redis.hset(REDIS_KEYS.JOB_STORE, job.id, JSON.stringify(job));
  return job;
}

async function getJob(redis, jobId) {
  const data = await redis.hget(REDIS_KEYS.JOB_STORE, jobId);
  return data ? JSON.parse(data) : null;
}

async function updateJob(redis, jobId, updates) {
  const job = await getJob(redis, jobId);
  if (!job) return null;
  const updated = { ...job, ...updates, updatedAt: Date.now() };
  await redis.hset(REDIS_KEYS.JOB_STORE, jobId, JSON.stringify(updated));
  return updated;
}

async function getAllJobs(redis, limit = 100) {
  const all = await redis.hgetall(REDIS_KEYS.JOB_STORE);
  return Object.values(all)
    .map(json => JSON.parse(json))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * Efficient metrics using Redis pipeline — one round-trip for all counts.
 * INTERVIEW: "I avoid HGETALL for metrics because it's O(N). Instead,
 * I use ZCARD/SCARD/LLEN which are all O(1) operations."
 */
async function getJobCounts(redis) {
  const results = await redis.pipeline()
    .zcard(REDIS_KEYS.QUEUE_HIGH)
    .zcard(REDIS_KEYS.QUEUE_MEDIUM)
    .zcard(REDIS_KEYS.QUEUE_LOW)
    .scard(REDIS_KEYS.PROCESSING_SET)
    .llen(REDIS_KEYS.DLQ)
    .get(REDIS_KEYS.METRICS_PROCESSED)
    .get(REDIS_KEYS.METRICS_FAILED)
    .exec();

  const val = (i) => results[i][1] || 0;

  return {
    pending: val(0) + val(1) + val(2),
    processing: val(3),
    completed: parseInt(val(5) || '0', 10),
    failed: parseInt(val(6) || '0', 10),
    dlq: val(4),
    byPriority: { high: val(0), medium: val(1), low: val(2) },
  };
}

module.exports = { createJob, getJob, updateJob, getAllJobs, getJobCounts };
