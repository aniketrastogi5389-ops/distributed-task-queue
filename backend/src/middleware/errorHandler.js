/**
 * Global Error Handler Middleware
 * ============================================================
 * WHY a centralized error handler?
 * 1. DRY — every route doesn't need its own try/catch response logic
 * 2. Consistent error response format for the frontend
 * 3. Prevents stack traces from leaking to clients in production
 * 4. Single place to add error monitoring (Sentry, PagerDuty)
 * 
 * INTERVIEW INSIGHT:
 * "Express error middleware must have exactly 4 parameters (err, req, res, next).
 *  If you forget one, Express won't recognize it as error middleware — a common
 *  interview gotcha."
 * ============================================================
 */

const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log the full error internally (with stack trace)
  logger.error(`${req.method} ${req.originalUrl} → ${statusCode}`, {
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    requestId: req.headers['x-request-id'] || 'none',
  });

  // Send sanitized error to client
  res.status(statusCode).json({
    success: false,
    error: message,
    // Only include stack in development — NEVER in production
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Wraps async route handlers to catch errors automatically.
 * Without this, unhandled promise rejections crash the process.
 * 
 * Usage: router.post('/jobs', asyncHandler(createJob));
 * 
 * WHY?
 * Express 4.x doesn't catch async errors automatically.
 * Express 5.x fixes this, but we're on 4.x for stability.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, asyncHandler };
