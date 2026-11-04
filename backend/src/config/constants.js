/**
 * Constants — Single Source of Truth
 * ============================================================
 * WHY centralize constants?
 * 1. Prevents typo bugs (e.g., "hgih" instead of "high")
 * 2. Makes refactoring trivial (change once, applied everywhere)
 * 3. Self-documents the system's vocabulary
 * 
 * INTERVIEW INSIGHT:
 * "I use frozen enums to enforce valid states at the application layer,
 *  preventing invalid state transitions that could corrupt the queue."
 * ============================================================
 */

/**
 * Redis key prefixes — namespaced to avoid collisions
 * if multiple apps share the same Redis instance.
 * 
 * WHY namespacing? In production, a single Redis cluster often
 * serves multiple services. Without prefixes, key collisions = data loss.
 */
const REDIS_KEYS = Object.freeze({
  // Sorted Sets for priority queues (one per priority level)
  QUEUE_HIGH: 'dtq:queue:high',
  QUEUE_MEDIUM: 'dtq:queue:medium',
  QUEUE_LOW: 'dtq:queue:low',

  // Hash map storing full job data (jobId → serialized job)
  JOB_STORE: 'dtq:jobs',

  // Dead Letter Queue — jobs that exceeded max retries
  DLQ: 'dtq:dlq',

  // Set tracking currently processing jobs (for crash recovery)
  PROCESSING_SET: 'dtq:processing',

  // Counters for dashboard metrics
  METRICS_PROCESSED: 'dtq:metrics:processed',
  METRICS_FAILED: 'dtq:metrics:failed',
});

/**
 * Priority levels with their numeric scores.
 * LOWER score = HIGHER priority (dequeued first by ZPOPMIN).
 * 
 * WHY Sorted Sets for priority?
 * - Lists (LPUSH/RPOP) are FIFO only — no priority support
 * - Sorted Sets let us assign a score and pop the lowest score first
 * - O(log N) insert, O(log N) pop — efficient at scale
 * 
 * WHY lower score = higher priority?
 * - ZPOPMIN removes the member with the lowest score
 * - This is the natural ordering: priority 1 > priority 2 > priority 3
 */
const PRIORITIES = Object.freeze({
  high: { score: 1, queue: REDIS_KEYS.QUEUE_HIGH },
  medium: { score: 2, queue: REDIS_KEYS.QUEUE_MEDIUM },
  low: { score: 3, queue: REDIS_KEYS.QUEUE_LOW },
});

/**
 * Valid job states — this is a finite state machine.
 * 
 * State transitions:
 *   pending → processing → done
 *                ↓
 *              failed → (retry) → pending
 *                ↓
 *              dlq (after MAX_RETRIES exceeded)
 * 
 * INTERVIEW INSIGHT:
 * "Each job follows a deterministic state machine. This makes the system
 *  predictable and debuggable — you can always tell exactly where a job
 *  is in its lifecycle by querying its status."
 */
const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
  DLQ: 'dlq',
});

/**
 * Worker configuration defaults.
 * Separated from server config because workers and servers
 * scale independently in production.
 */
const WORKER_CONFIG = Object.freeze({
  POLL_INTERVAL_MS: parseInt(process.env.WORKER_POLL_INTERVAL_MS, 10) || 1000,
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES, 10) || 3,
  BASE_BACKOFF_MS: 2000, // 2^retries * base = 2s, 4s, 8s
});

module.exports = {
  REDIS_KEYS,
  PRIORITIES,
  JOB_STATUS,
  WORKER_CONFIG,
};
