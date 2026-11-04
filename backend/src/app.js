/**
 * Express Application Setup
 * ============================================================
 * Serves both the API and the frontend dashboard from one process.
 * In production, these would be split (Railway API + Vercel frontend).
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// ---- Core Middleware ----
app.use(express.json({ limit: '1mb' }));

app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(s => s.trim())
    : '*',
  methods: ['GET', 'POST'],
}));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.originalUrl.includes('/api/metrics')) { // Don't log poll spam
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });
  next();
});

// ---- Serve Frontend (static files) ----
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// ---- Health Check ----
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ---- API Routes ----
const jobRoutes = require('./routes/jobs');
const statusRoutes = require('./routes/status');
app.use('/api', jobRoutes);
app.use('/api', statusRoutes);

// ---- 404 Handler ----
app.use((req, res) => {
  // Don't 404 on frontend routes — serve index.html
  if (!req.originalUrl.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'index.html'));
  }
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.originalUrl} not found` });
});

// ---- Global Error Handler ----
app.use(errorHandler);

module.exports = app;
