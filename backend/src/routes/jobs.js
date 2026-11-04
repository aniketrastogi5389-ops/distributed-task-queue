/**
 * Job Routes — Producer API
 * ============================================================
 * POST /api/jobs     → Enqueue a new job
 * GET  /api/jobs     → List recent jobs
 * GET  /api/jobs/:id → Get single job by ID
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { getRedisClient } = require('../config/redis');
const { enqueueJob } = require('../queue/producer');
const { getJob, getAllJobs } = require('../queue/jobStore');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /api/jobs
 * Body: { type: string, payload: object, priority: 'high'|'medium'|'low' }
 */
router.post('/jobs', asyncHandler(async (req, res) => {
  const { type, payload, priority } = req.body;

  if (!type || typeof type !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Field "type" is required and must be a string',
    });
  }

  const redis = getRedisClient();
  const job = await enqueueJob(redis, { type, payload, priority });

  res.status(201).json({ success: true, job });
}));

/** GET /api/jobs — List recent jobs (last 100) */
router.get('/jobs', asyncHandler(async (req, res) => {
  const redis = getRedisClient();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const jobs = await getAllJobs(redis, limit);
  res.json({ success: true, count: jobs.length, jobs });
}));

/** GET /api/jobs/:id — Get a specific job */
router.get('/jobs/:id', asyncHandler(async (req, res) => {
  const redis = getRedisClient();
  const job = await getJob(redis, req.params.id);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  res.json({ success: true, job });
}));

module.exports = router;
