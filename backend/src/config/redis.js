/**
 * Redis Connection Configuration
 * ============================================================
 * WHY ioredis over node-redis?
 * 1. Native support for Sorted Sets (ZADD, ZPOPMIN) — critical for priority queues
 * 2. Built-in reconnection with exponential backoff
 * 3. Pipeline/transaction support for atomic operations
 * 4. Better TypeScript support and maintenance
 * 
 * WHY a singleton pattern?
 * - Redis connections are expensive (TCP handshake + TLS + AUTH)
 * - One connection can handle ~10K ops/sec via multiplexing
 * - Multiple connections = resource waste + connection pool exhaustion
 * 
 * INTERVIEW INSIGHT:
 * "We use a single Redis connection per process because Redis is single-threaded.
 *  Multiple connections don't give us parallelism on the Redis side — they only
 *  add overhead. The bottleneck is Redis's event loop, not the connection count."
 * ============================================================
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;

/**
 * Creates and returns a singleton Redis connection.
 * Uses lazy initialization — connection is only created on first call.
 * 
 * WHY lazy initialization?
 * - Avoids connecting during module import (which can fail silently)
 * - Gives us a single point to handle connection errors
 * - Allows graceful startup: server can start even if Redis is temporarily down
 */
function getRedisClient() {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      'REDIS_URL is not set. Check your .env file.\n' +
      'Expected format: rediss://default:PASSWORD@ENDPOINT:PORT'
    );
  }

  redisClient = new Redis(redisUrl, {
    // Retry strategy: exponential backoff with jitter
    // WHY jitter? Without it, all workers reconnect simultaneously
    // after an outage (thundering herd problem)
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      const jitter = Math.random() * 200;
      logger.warn(`Redis reconnecting... attempt ${times}, delay ${delay + jitter}ms`);
      return delay + jitter;
    },

    // Maximum reconnection attempts before giving up
    maxRetriesPerRequest: 3,

    // Enable TLS for Upstash (rediss:// already implies this,
    // but being explicit is better for debugging)
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,

    // Connection metadata for debugging in Redis CLIENT LIST
    connectionName: `dtq-${process.env.NODE_ENV || 'dev'}-${process.pid}`,
  });

  // ---- Connection Event Handlers ----
  redisClient.on('connect', () => {
    logger.info('Redis connection established');
  });

  redisClient.on('ready', () => {
    logger.info('Redis ready to accept commands');
  });

  redisClient.on('error', (err) => {
    logger.error('Redis connection error:', err.message);
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisClient;
}

/**
 * Gracefully close the Redis connection.
 * Called during process shutdown to prevent connection leaks.
 * 
 * WHY graceful shutdown matters:
 * - Pending commands get flushed before disconnect
 * - Prevents "connection reset" errors in Redis logs
 * - Required for zero-downtime deployments (SIGTERM handling)
 */
async function closeRedisConnection() {
  if (redisClient) {
    logger.info('Closing Redis connection...');
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed gracefully');
  }
}

module.exports = { getRedisClient, closeRedisConnection };
