/**
 * Status & Metrics Routes — Dashboard API
 * ============================================================
 * GET /api/metrics  → Aggregated queue metrics (for dashboard cards)
 * GET /api/dlq      → Dead Letter Queue entries
 * POST /api/flush   → Clear all data (dev only)
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { getRedisClient } = require('../config/redis');
const { getJobCounts } = require('../queue/jobStore');
const { getDLQEntries } = require('../queue/dlq');
const { asyncHandler } = require('../middleware/errorHandler');
const { REDIS_KEYS } = require('../config/constants');

/** GET /api/metrics — Dashboard polling endpoint */
router.get('/metrics', asyncHandler(async (req, res) => {
  const redis = getRedisClient();
  const counts = await getJobCounts(redis);
  res.json({ success: true, metrics: counts, timestamp: Date.now() });
}));

/** GET /api/dlq — List DLQ entries */
router.get('/dlq', asyncHandler(async (req, res) => {
  const redis = getRedisClient();
  const entries = await getDLQEntries(redis);
  res.json({ success: true, count: entries.length, entries });
}));

/** POST /api/flush — Clear all queue data (development only) */
router.post('/flush', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Flush disabled in production' });
  }

  const redis = getRedisClient();
  const keys = Object.values(REDIS_KEYS);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  res.json({ success: true, message: 'All queue data flushed' });
}));

module.exports = router;
