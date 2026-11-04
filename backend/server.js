/**
 * Server Entry Point
 * ============================================================
 * Starts the Express server AND an inline worker for local dev.
 * In production, the worker runs as a separate process.
 * ============================================================
 */

require('dotenv').config();
const app = require('./src/app');
const { closeRedisConnection } = require('./src/config/redis');
const { startWorker, stopWorker } = require('./src/workers/worker');
const logger = require('./src/utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    pid: process.pid,
  });
  logger.info(`Dashboard: http://localhost:${PORT}`);
  logger.info(`API: http://localhost:${PORT}/api/jobs`);

  // Start inline worker (same process for easy local dev)
  logger.info('Starting inline worker...');
  startWorker();
});

// ---- Graceful Shutdown ----
async function shutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  stopWorker();

  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await closeRedisConnection();
      logger.info('Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', { error: err.message });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', { error: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
  process.exit(1);
});
