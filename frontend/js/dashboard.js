/**
 * Dashboard — Real-time polling + UI controller
 * Polls /api/metrics and /api/jobs every 2 seconds.
 */

const API_BASE = window.location.origin;
const POLL_INTERVAL = 2000;

// ===== DOM Refs =====
const $ = (sel) => document.querySelector(sel);
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const pendingCount = $('#pendingCount');
const processingCount = $('#processingCount');
const completedCount = $('#completedCount');
const failedCount = $('#failedCount');
const highCount = $('#highCount');
const mediumCount = $('#mediumCount');
const lowCount = $('#lowCount');
const barHigh = $('#barHigh');
const barMedium = $('#barMedium');
const barLow = $('#barLow');
const jobsTableBody = $('#jobsTableBody');
const totalJobsBadge = $('#totalJobsBadge');
const dlqList = $('#dlqList');
const dlqBadge = $('#dlqBadge');
const createJobForm = $('#createJobForm');
const createResult = $('#createResult');
const batchBtn = $('#batchBtn');
const flushBtn = $('#flushBtn');

let previousMetrics = {};

// ===== API Helpers =====
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// ===== Metric Update with animation =====
function updateMetric(el, newValue) {
  const current = el.textContent;
  const next = String(newValue);
  if (current !== next) {
    el.textContent = next;
    el.classList.add('updated');
    setTimeout(() => el.classList.remove('updated'), 400);
  }
}

// ===== Polling =====
async function pollMetrics() {
  try {
    const data = await apiFetch('/api/metrics');
    if (!data.success) throw new Error('Metrics fetch failed');

    const m = data.metrics;
    updateMetric(pendingCount, m.pending);
    updateMetric(processingCount, m.processing);
    updateMetric(completedCount, m.completed);
    updateMetric(failedCount, `${m.failed} / ${m.dlq}`);

    // Priority bar
    const total = m.byPriority.high + m.byPriority.medium + m.byPriority.low || 1;
    barHigh.style.flex = m.byPriority.high / total;
    barMedium.style.flex = m.byPriority.medium / total;
    barLow.style.flex = m.byPriority.low / total;
    highCount.textContent = m.byPriority.high;
    mediumCount.textContent = m.byPriority.medium;
    lowCount.textContent = m.byPriority.low;

    // Connection status
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Live';

    previousMetrics = m;
  } catch (err) {
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Disconnected';
  }
}

async function pollJobs() {
  try {
    const data = await apiFetch('/api/jobs?limit=30');
    if (!data.success) return;

    totalJobsBadge.textContent = data.count;

    if (data.jobs.length === 0) {
      jobsTableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No jobs yet — create one above!</td></tr>';
      return;
    }

    jobsTableBody.innerHTML = data.jobs.map(job => `
      <tr>
        <td class="job-id">${job.id.slice(0, 8)}…</td>
        <td>${escapeHtml(job.type)}</td>
        <td><span class="priority-badge ${job.priority}">${job.priority}</span></td>
        <td><span class="status-badge ${job.status}">${job.status}</span></td>
        <td>${job.retries || 0} / ${job.maxRetries || 3}</td>
        <td>${timeAgo(job.createdAt)}</td>
      </tr>
    `).join('');
  } catch (err) {
    // Silently ignore — metrics poll handles connection status
  }
}

async function pollDLQ() {
  try {
    const data = await apiFetch('/api/dlq');
    if (!data.success) return;

    dlqBadge.textContent = data.count;

    if (data.entries.length === 0) {
      dlqList.innerHTML = '<p class="empty-state">No dead-lettered jobs</p>';
      return;
    }

    dlqList.innerHTML = data.entries.map(e => `
      <div class="dlq-entry">
        <div class="dlq-entry__id">ID: ${e.jobId.slice(0, 12)}… | Type: ${escapeHtml(e.type || 'unknown')}</div>
        <div class="dlq-entry__error">❌ ${escapeHtml(e.lastError)}</div>
        <div class="dlq-entry__meta">Retries: ${e.retries} | Priority: ${e.priority || '—'} | ${timeAgo(e.movedAt)}</div>
      </div>
    `).join('');
  } catch (err) {
    // ignore
  }
}

// ===== Create Job =====
createJobForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = $('#submitJobBtn');
  submitBtn.classList.add('loading');

  try {
    let payload = {};
    const payloadStr = $('#jobPayload').value.trim();
    if (payloadStr) {
      try { payload = JSON.parse(payloadStr); }
      catch { throw new Error('Invalid JSON in payload field'); }
    }

    const data = await apiFetch('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: $('#jobType').value.trim(),
        priority: $('#jobPriority').value,
        payload,
      }),
    });

    if (data.success) {
      showResult(`✅ Job ${data.job.id.slice(0, 8)}… enqueued (${data.job.priority})`, 'success');
    } else {
      showResult(`❌ ${data.error}`, 'error');
    }
  } catch (err) {
    showResult(`❌ ${err.message}`, 'error');
  } finally {
    submitBtn.classList.remove('loading');
  }
});

// ===== Batch Create =====
batchBtn.addEventListener('click', async () => {
  batchBtn.disabled = true;
  batchBtn.textContent = 'Creating...';
  const types = ['email', 'resize-image', 'generate-report', 'send-notification', 'data-sync'];
  const priorities = ['high', 'medium', 'low'];

  try {
    for (let i = 0; i < 5; i++) {
      await apiFetch('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          type: types[Math.floor(Math.random() * types.length)],
          priority: priorities[Math.floor(Math.random() * priorities.length)],
          payload: { batch: true, index: i },
        }),
      });
    }
    showResult('✅ 5 random jobs enqueued!', 'success');
  } catch (err) {
    showResult(`❌ ${err.message}`, 'error');
  } finally {
    batchBtn.disabled = false;
    batchBtn.textContent = 'Enqueue 5 Random Jobs';
  }
});

// ===== Flush =====
flushBtn.addEventListener('click', async () => {
  if (!confirm('Clear ALL queue data? This cannot be undone.')) return;
  try {
    const data = await apiFetch('/api/flush', { method: 'POST' });
    showResult(data.success ? '🗑️ All data flushed' : `❌ ${data.error}`, data.success ? 'success' : 'error');
  } catch (err) {
    showResult(`❌ ${err.message}`, 'error');
  }
});

// ===== Utils =====
function showResult(msg, type) {
  createResult.textContent = msg;
  createResult.className = `form__result ${type}`;
  setTimeout(() => { createResult.className = 'form__result'; }, 4000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

// ===== Start Polling =====
async function poll() {
  await Promise.all([pollMetrics(), pollJobs(), pollDLQ()]);
}

poll(); // Initial fetch
setInterval(poll, POLL_INTERVAL);
