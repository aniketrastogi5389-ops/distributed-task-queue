/**
 * Structured Logger
 * ============================================================
 * WHY not just console.log?
 * 1. Structured logs (JSON) are parseable by log aggregators (Datadog, CloudWatch)
 * 2. Consistent format across all modules
 * 3. Log levels let you filter noise in production
 * 4. Timestamps are essential for debugging distributed systems
 *    (you need to correlate events across worker + server processes)
 * 
 * INTERVIEW INSIGHT:
 * "In distributed systems, structured logging is non-negotiable.
 *  When you have 10 workers processing jobs, you need to filter by
 *  jobId, workerId, and severity to debug issues."
 * 
 * PRODUCTION UPGRADE: Replace with Winston or Pino for file rotation,
 * log levels from env, and stream-based high-performance logging.
 * ============================================================
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

// Current log level — controlled by environment
const currentLevel = LOG_LEVELS[
  (process.env.LOG_LEVEL || 'DEBUG').toUpperCase()
] ?? LOG_LEVELS.DEBUG;

/**
 * Formats a log entry as a structured JSON string.
 * @param {'ERROR'|'WARN'|'INFO'|'DEBUG'} level 
 * @param {string} message 
 * @param {object} [meta] - Additional context (jobId, workerId, etc.)
 */
function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    pid: process.pid,
    ...meta,
  });
}

const logger = {
  error(message, meta) {
    if (currentLevel >= LOG_LEVELS.ERROR) {
      console.error(formatLog('ERROR', message, typeof meta === 'string' ? { detail: meta } : meta));
    }
  },

  warn(message, meta) {
    if (currentLevel >= LOG_LEVELS.WARN) {
      console.warn(formatLog('WARN', message, typeof meta === 'string' ? { detail: meta } : meta));
    }
  },

  info(message, meta) {
    if (currentLevel >= LOG_LEVELS.INFO) {
      console.log(formatLog('INFO', message, typeof meta === 'string' ? { detail: meta } : meta));
    }
  },

  debug(message, meta) {
    if (currentLevel >= LOG_LEVELS.DEBUG) {
      console.log(formatLog('DEBUG', message, typeof meta === 'string' ? { detail: meta } : meta));
    }
  },
};

module.exports = logger;
