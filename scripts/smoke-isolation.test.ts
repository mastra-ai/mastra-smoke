import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { startSmokeServer } from './smoke-server.ts';

test('one built artifact supports independent concurrent databases and workspaces', { timeout: 120_000 }, async t => {
  const servers: Awaited<ReturnType<typeof startSmokeServer>>[] = [];
  t.after(async () => { await Promise.all(servers.map(server => server.stop())); });
  const runsDirectory = join(import.meta.dirname, '..', 'reports', 'runtime', 'isolation with spaces');
  const a = await startSmokeServer({ suite: 'api', runsDirectory });
  servers.push(a);
  const b = await startSmokeServer({ suite: 'ui', runsDirectory });
  servers.push(b);
  assert.notEqual(a.runDir, b.runDir);
  assert.notEqual(a.baseUrl, b.baseUrl);

  const created = await fetch(`${a.baseUrl}/api/datasets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'lifecycle-isolation-proof' }),
  });
  assert.equal(created.status, 200);
  const dataset = await created.json();
  assert.ok(dataset.id);
  assert.equal((await fetch(`${a.baseUrl}/api/datasets/${dataset.id}`)).status, 200);
  assert.equal((await fetch(`${b.baseUrl}/api/datasets/${dataset.id}`)).status, 404);

  const written = await fetch(`${a.baseUrl}/api/workspaces/test-workspace/fs/write`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'isolation-proof.txt', content: a.runDir }),
  });
  assert.equal(written.status, 200);
  assert.equal(await readFile(join(a.runDir, 'data', 'test-workspace', 'isolation-proof.txt'), 'utf8'), a.runDir);
  await assert.rejects(stat(join(b.runDir, 'data', 'test-workspace', 'isolation-proof.txt')), { code: 'ENOENT' });
  for (const server of servers) {
    for (const file of ['test.db', 'mastra.duckdb']) {
      assert.ok((await stat(join(server.runDir, 'data', file))).size > 0, `${file} must exist in ${server.runDir}`);
    }
  }

  const feedbackType = `isolation-${a.pid}`;
  const feedback = await fetch(`${a.baseUrl}/api/observability/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: { feedbackType, entityType: 'agent', entityId: 'test-agent', value: 1 } }),
  });
  assert.equal(feedback.status, 200);
  const feedbackA = await fetch(`${a.baseUrl}/api/observability/feedback?perPage=100`);
  assert.equal(feedbackA.status, 200);
  const dataA: { feedback: Array<{ feedbackType: string; value: number }> } = await feedbackA.json();
  assert.equal(dataA.feedback.find(row => row.feedbackType === feedbackType)?.value, 1);
  const feedbackB = await fetch(`${b.baseUrl}/api/observability/feedback?perPage=100`);
  assert.equal(feedbackB.status, 200);
  const dataB: { feedback: Array<{ feedbackType: string }> } = await feedbackB.json();
  assert.equal(dataB.feedback.some(row => row.feedbackType === feedbackType), false);

  await a.stop();
  const stillWritable = await fetch(`${b.baseUrl}/api/observability/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: { feedbackType: `isolation-${b.pid}`, entityType: 'agent', entityId: 'test-agent', value: 2 } }),
  });
  assert.equal(stillWritable.status, 200);
  assert.equal((await fetch(`${b.baseUrl}/api/workflows`)).status, 200);
  assert.equal((await fetch(`${b.baseUrl}/smoke/health`)).status, 200);
  const manifest = JSON.parse(await readFile(join(a.runDir, 'run.json'), 'utf8'));
  assert.equal(manifest.state, 'stopped');
  assert.equal(manifest.forced, false);
});
