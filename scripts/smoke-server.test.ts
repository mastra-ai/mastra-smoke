import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSmokeServer } from './smoke-server.ts';

async function fixture(mode = 'normal') {
  const root = await mkdtemp(join(tmpdir(), 'smoke lifecycle '));
  const entrypoint = join(root, 'server.mjs');
  await writeFile(entrypoint, `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    import { join, basename } from 'node:path';
    const mode = ${JSON.stringify(mode)};
    const root = process.env.SMOKE_RUN_DIR;
    console.log('fixture boot', root);
    if (mode === 'crash') process.exit(7);
    const server = createServer((req, res) => {
      if (mode === 'hang') return;
      if (req.url === '/crash') { res.end('crashing'); setTimeout(() => process.exit(9), 10); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ runId: basename(root), runDir: root }));
    });
    server.listen(Number(process.env.PORT), '127.0.0.1');
    process.on('SIGTERM', () => {
      if (mode === 'ignore-term') { console.log('ignored TERM'); return; }
      setTimeout(() => {
        writeFileSync(join(root, 'shutdown.txt'), 'closed');
        console.log('fixture stopped');
        server.closeAllConnections();
        server.close(() => process.exit(0));
      }, mode === 'slow-stop' ? 150 : 0);
    });
  `);
  return { root, entrypoint, runsDirectory: join(root, 'runs') };
}
const readManifest = async (runDir: string) => JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
async function cleanClosedFixture(f: Awaited<ReturnType<typeof fixture>>) {
  for (const dir of await readdir(f.runsDirectory)) {
    const manifest = await readManifest(join(f.runsDirectory, dir));
    assert.ok(['stopped', 'unexpected exit'].includes(manifest.state), `Retaining unclosed fixture: ${f.root}`);
  }
  await rm(f.root, { recursive: true, force: true });
}

// Only test-owned temporary roots are removed, after a confirmed child close.
test('two invocations own distinct roots; stopping one cannot affect the other', async t => {
  const f = await fixture();
  const servers: Awaited<ReturnType<typeof startSmokeServer>>[] = [];
  t.after(async () => {
    await Promise.all(servers.map(server => server.stop()));
    await rm(f.root, { recursive: true, force: true });
  });
  const first = await startSmokeServer({ ...f, suite: 'api' });
  servers.push(first);
  const second = await startSmokeServer({ ...f, suite: 'ui' });
  servers.push(second);
  assert.notEqual(first.runDir, second.runDir);
  assert.notEqual(first.baseUrl, second.baseUrl);
  assert.equal(await readFile(join(first.runDir, 'data', 'test-workspace', 'hello.txt'), 'utf8'), 'Hello from workspace!');
  assert.deepEqual(await readdir(join(second.runDir, 'data', 'test-workspace')), []);
  await first.stop();
  const health = await (await fetch(`${second.baseUrl}/smoke/health`)).json();
  assert.equal(health.runDir, second.runDir);
  assert.equal((await readManifest(first.runDir)).state, 'stopped');
  await second.stop();
  assert.match(await readFile(join(first.runDir, 'server.log'), 'utf8'), /fixture boot/);
  assert.equal((await readManifest(second.runDir)).state, 'stopped');
});

test('shutdown awaits delayed process exit and log closure, and is idempotent', async t => {
  const f = await fixture('slow-stop');
  const server = await startSmokeServer({ ...f, suite: 'ui' });
  t.after(async () => { await server.stop(); await rm(f.root, { recursive: true, force: true }); });
  const before = Date.now();
  await Promise.all([server.stop(), server.stop()]);
  assert.ok(Date.now() - before >= 140);
  assert.equal(await readFile(join(server.runDir, 'shutdown.txt'), 'utf8'), 'closed');
  assert.equal((await readManifest(server.runDir)).exitCode, 0);
  assert.match(await readFile(join(server.runDir, 'server.log'), 'utf8'), /fixture stopped/);
  await assert.rejects(fetch(`${server.baseUrl}/smoke/health`));
});

test('readiness timeout is bounded and stops its child before returning', async t => {
  const f = await fixture('hang');
  t.after(() => cleanClosedFixture(f));
  const before = Date.now();
  await assert.rejects(startSmokeServer({ ...f, suite: 'ui', startupTimeoutMs: 250, shutdownTimeoutMs: 2000 }), /readiness timed out/);
  assert.ok(Date.now() - before < 4000);
  const [dir] = await readdir(f.runsDirectory);
  const manifest = await readManifest(join(f.runsDirectory, dir));
  assert.equal(manifest.state, 'stopped');
  assert.throws(() => process.kill(manifest.pid, 0), { code: 'ESRCH' });
});

test('startup crash preserves logs and records confirmed exit', async t => {
  const f = await fixture('crash');
  t.after(() => cleanClosedFixture(f));
  await assert.rejects(startSmokeServer({ ...f, suite: 'ui' }), /startup\/shutdown failed/);
  const [dir] = await readdir(f.runsDirectory);
  const runDir = join(f.runsDirectory, dir);
  assert.equal((await readManifest(runDir)).exitCode, 7);
  assert.match(await readFile(join(runDir, 'server.log'), 'utf8'), /fixture boot/);
});

test('unexpected exit after readiness fails teardown instead of disappearing silently', async t => {
  const f = await fixture();
  const server = await startSmokeServer({ ...f, suite: 'ui' });
  t.after(() => cleanClosedFixture(f));
  await fetch(`${server.baseUrl}/crash`);
  const deadline = Date.now() + 2000;
  while ((await readManifest(server.runDir)).state !== 'unexpected exit' && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 20));
  }
  await assert.rejects(server.stop(), /exited unexpectedly/);
  assert.equal((await readManifest(server.runDir)).exitCode, 9);
});

test('SIGTERM-resistant child is killed and forced shutdown is reported as failure', async t => {
  const f = await fixture('ignore-term');
  const server = await startSmokeServer({ ...f, suite: 'ui', shutdownTimeoutMs: 100 });
  t.after(() => cleanClosedFixture(f));
  await assert.rejects(server.stop(), /shutdown was unsuccessful/);
  const manifest = await readManifest(server.runDir);
  assert.equal(manifest.forced, true);
  assert.equal(manifest.signal, 'SIGKILL');
  assert.equal(manifest.state, 'stopped');
  assert.throws(() => process.kill(server.pid, 0), { code: 'ESRCH' });
});

test('occupied port never reuses or kills the existing server', async t => {
  const f = await fixture();
  const first = await startSmokeServer({ ...f, suite: 'ui' });
  t.after(async () => { await first.stop(); await rm(f.root, { recursive: true, force: true }); });
  await assert.rejects(startSmokeServer({ ...f, suite: 'ui', port: Number(new URL(first.baseUrl).port) }));
  const health = await (await fetch(`${first.baseUrl}/smoke/health`)).json();
  assert.equal(health.runDir, first.runDir);
  assert.equal((await readManifest(first.runDir)).state, 'ready');
});

test('owner SIGTERM awaits its server shutdown', async t => {
  const f = await fixture('slow-stop');
  const parentPath = join(f.root, 'owner.mjs');
  const moduleUrl = new URL('./smoke-server.ts', import.meta.url).href;
  await writeFile(parentPath, `
    import { startSmokeServer } from ${JSON.stringify(moduleUrl)};
    const server = await startSmokeServer(${JSON.stringify({ ...f, suite: 'ui' })});
    console.log('OWNED:' + JSON.stringify({ runDir: server.runDir, pid: server.pid }));
  `);
  const owner = spawn(process.execPath, ['--experimental-strip-types', parentPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<number | null>(done => owner.once('close', done));
  t.after(async () => { owner.kill('SIGTERM'); await closed; await cleanClosedFixture(f); });
  const owned = await new Promise<{ runDir: string; pid: number }>((done, reject) => {
    let output = '';
    owner.once('error', reject);
    owner.stdout.on('data', chunk => {
      output += chunk.toString();
      const line = output.split('\n').find(line => line.startsWith('OWNED:'));
      if (line) done(JSON.parse(line.slice(6)));
    });
  });
  owner.kill('SIGTERM');
  assert.equal(await closed, 143);
  assert.equal((await readManifest(owned.runDir)).state, 'stopped');
  assert.equal(await readFile(join(owned.runDir, 'shutdown.txt'), 'utf8'), 'closed');
  assert.throws(() => process.kill(owned.pid, 0), { code: 'ESRCH' });
});
