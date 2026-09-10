import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort from 'get-port';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ownedServers = new Map<() => Promise<void>, () => void>();
const emergencyStop = () => { for (const kill of ownedServers.values()) kill(); };
async function stopOnSignal(signal: 'SIGINT' | 'SIGTERM', exitCode: number) {
  const runnerHandlesSignal = process.listenerCount(signal) > 1;
  await Promise.allSettled([...ownedServers.keys()].map(stop => stop()));
  if (!runnerHandlesSignal) process.exit(exitCode);
}
const onInterrupt = () => { void stopOnSignal('SIGINT', 130); };
const onTerminate = () => { void stopOnSignal('SIGTERM', 143); };
function registerOwner(stop: () => Promise<void>, kill: () => void) {
  if (ownedServers.size === 0) {
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    process.on('exit', emergencyStop);
  }
  ownedServers.set(stop, kill);
}
function releaseOwner(stop: () => Promise<void>) {
  ownedServers.delete(stop);
  if (ownedServers.size === 0) {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    process.off('exit', emergencyStop);
  }
}

interface ServerOptions {
  suite: 'api' | 'ui';
  port?: number;
  entrypoint?: string;
  runsDirectory?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  killTimeoutMs?: number;
}

export async function startSmokeServer(options: ServerOptions) {
  const port = options.port ?? await getPort({ host: '127.0.0.1' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid smoke port: ${port}`);
  const runsDirectory = resolve(options.runsDirectory ?? join(projectDir, 'reports', 'runtime'));
  await mkdir(runsDirectory, { recursive: true });
  const runDir = await mkdtemp(join(runsDirectory, `${options.suite}-`));
  const runId = basename(runDir);
  const workspace = join(runDir, 'data', 'test-workspace');
  await mkdir(workspace, { recursive: true });
  if (options.suite === 'api') {
    const skillDir = join(workspace, 'skills', 'test-skill');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await writeFile(join(workspace, 'hello.txt'), 'Hello from workspace!');
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---', 'name: test-skill', 'description: A test skill for smoke tests', '---', '',
      '# Test Skill', '', 'This skill is used for smoke testing the workspace skills API.',
    ].join('\n'));
    await writeFile(join(skillDir, 'references', 'example.md'), '# Example Reference\n\nSome reference content.');
  }

  const entrypoint = resolve(options.entrypoint ?? join(projectDir, '.mastra', 'output', 'index.mjs'));
  const logPath = join(runDir, 'server.log');
  const manifestPath = join(runDir, 'run.json');
  const baseUrl = `http://127.0.0.1:${port}`;
  const manifest = {
    runId, runDir, entrypoint, cwd: projectDir, baseUrl, workspace,
    libsql: join(runDir, 'data', 'test.db'), duckdb: join(runDir, 'data', 'mastra.duckdb'),
    startedAt: new Date().toISOString(), pid: undefined as number | undefined,
    state: 'starting', forced: false, exitCode: null as number | null, signal: null as string | null,
    failure: undefined as string | undefined,
  };
  const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(logPath, `[smoke] ${JSON.stringify(manifest)}\n`);
  const envFile = join(projectDir, '.env');
  const child = spawn(process.execPath, [
    ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), entrypoint,
  ], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port), MASTRA_HOST: '127.0.0.1', NODE_ENV: 'production',
      MASTRA_DEV: 'false', MASTRA_AUTO_DETECT_URL: 'true',
      MASTRA_STUDIO_PATH: join(projectDir, '.mastra', 'output', 'studio'),
      SMOKE_RUN_DIR: runDir,
      // Retain the existing API workaround; changing rejection policy is separate.
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''}${options.suite === 'api' ? ' --unhandled-rejections=warn' : ''}`.trim(),
    },
    // The owner forwards cancellation once; terminal SIGINT must not also hit
    // the child directly and trigger Mastra's second-signal forced exit.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  manifest.pid = child.pid;
  saveManifest();
  child.stdout.on('data', chunk => appendFileSync(logPath, chunk));
  child.stderr.on('data', chunk => appendFileSync(logPath, chunk));
  let stopping = false;
  let closed = false;
  let spawnError: Error | undefined;
  child.once('error', error => {
    spawnError = error;
    appendFileSync(logPath, `[smoke] Spawn failed: ${error.message}\n`);
  });
  // 'close', unlike 'exit', also confirms that stdout/stderr have closed.
  const exited = new Promise<void>(done => child.once('close', (code, signal) => {
    closed = true;
    manifest.state = stopping ? 'stopped' : 'unexpected exit';
    manifest.exitCode = code;
    manifest.signal = signal;
    saveManifest();
    releaseOwner(stop);
    if (!stopping) console.error(`[smoke] Unexpected server exit (${code ?? signal}); logs: ${logPath}`);
    done();
  }));
  const exitError = () => new Error(`Smoke server exited unexpectedly (${spawnError?.message ?? manifest.exitCode ?? manifest.signal}); logs: ${logPath}`);
  const waitForExit = async (timeoutMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise<false>(done => { timer = setTimeout(() => done(false), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let stopPromise: Promise<void> | undefined;
  const stop = () => stopPromise ??= (async () => {
    const unexpected = closed || child.exitCode !== null || child.signalCode !== null;
    stopping = true;
    if (!closed) {
      child.kill('SIGTERM');
      if (!await waitForExit(options.shutdownTimeoutMs ?? 15_000)) {
        manifest.forced = true;
        saveManifest();
        child.kill('SIGKILL');
        if (!await waitForExit(options.killTimeoutMs ?? 5_000)) {
          throw new Error(`Could not confirm smoke server termination; retained ${runDir}`);
        }
      }
    }
    // Data and logs are retained even on success. A subsequent run always owns
    // a fresh directory, so teardown never unlinks a live or another run's DB.
    if (unexpected) throw exitError();
    if (manifest.forced || (manifest.exitCode !== 0 && manifest.signal !== 'SIGTERM')) {
      throw new Error(`Smoke server shutdown was unsuccessful; retained ${runDir}`);
    }
  })();
  registerOwner(stop, () => { if (!closed) child.kill('SIGKILL'); });

  try {
    const deadline = Date.now() + (options.startupTimeoutMs ?? 120_000);
    let lastError = 'No response';
    while (Date.now() < deadline) {
      if (closed) throw exitError();
      let identity: { runId?: string; runDir?: string } | undefined;
      try {
        const response = await fetch(`${baseUrl}/smoke/health`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))),
        });
        if (response.ok) identity = await response.json();
        else lastError = `Health status ${response.status}`;
      } catch (error) {
        lastError = String(error);
      }
      if (identity) {
        if (identity.runId !== runId || identity.runDir !== runDir) {
          throw new Error(`Smoke server identity mismatch at ${baseUrl}; refusing to reuse another server`);
        }
        if (closed) throw exitError();
        manifest.state = 'ready';
        saveManifest();
        console.log(`[smoke] ${options.suite} ready at ${baseUrl}; logs: ${logPath}`);
        return { baseUrl, runDir, pid: child.pid!, stop };
      }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`Smoke server readiness timed out: ${lastError}; logs: ${logPath}`);
  } catch (error) {
    manifest.failure = String(error);
    appendFileSync(logPath, `[smoke] Startup failed: ${manifest.failure}\n`);
    saveManifest();
    try { await stop(); } catch (shutdownError) {
      throw new AggregateError([error, shutdownError], `Smoke startup/shutdown failed; retained ${runDir}`);
    }
    throw error;
  }
}
