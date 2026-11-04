// Quick script to create 10 batch jobs for testing
const http = require('http');

const types = ['email', 'resize-image', 'generate-report', 'data-sync', 'send-notification'];
const priorities = ['high', 'medium', 'low'];
let completed = 0;

for (let i = 0; i < 10; i++) {
  const body = JSON.stringify({
    type: types[i % types.length],
    priority: priorities[i % priorities.length],
    payload: { batchIndex: i, test: true },
  });

  const req = http.request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/jobs',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        completed++;
        const parsed = JSON.parse(data);
        console.log(`[${completed}/10] ${parsed.job.priority.toUpperCase()} | ${parsed.job.type} | ${parsed.job.id.slice(0, 8)}...`);
        if (completed === 10) {
          console.log('\nAll 10 jobs created! Watch the worker process them...');
        }
      });
    }
  );

  req.write(body);
  req.end();
}
