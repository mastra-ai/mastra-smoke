import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, '..');

/**
 * Pre-server cleanup. MUST run before the Mastra server boots (it is invoked
 * as part of the Playwright webServer command), NOT in globalSetup:
 * Playwright launches the webServer before globalSetup runs, so deleting the
 * database there unlinks it out from under the live server. On @mastra/core
 * >= 1.40 the libsql client re-opens connections during interactive write
 * transactions; a re-opened connection recreates the unlinked path as a
 * fresh empty database, producing intermittent
 * "SQLITE_ERROR: no such table: mastra_*" failures mid-run.
 */

// Delete stale database files (LibSQL + DuckDB) so every run starts fresh.
async function cleanDatabase() {
  const dirs = [projectDir, join(projectDir, '.mastra', 'output')];
  for (const dir of dirs) {
    for (const suffix of ['', '-journal', '-shm', '-wal']) {
      await rm(join(dir, `test.db${suffix}`), { force: true }).catch(() => {});
    }
    for (const suffix of ['', '.wal']) {
      await rm(join(dir, `mastra.duckdb${suffix}`), { force: true }).catch(() => {});
    }
  }
}

/**
 * Wipe the workspace directory so tests start with a clean slate.
 *
 * Must match the basePath in src/mastra/index.ts:
 *   new LocalFilesystem({ basePath: './test-workspace' })
 *
 * LocalFilesystem resolves relative paths against process.cwd(),
 * which is projectDir when the Playwright webServer starts.
 */
async function cleanWorkspace() {
  const wsDir = join(projectDir, 'test-workspace');
  await rm(wsDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(wsDir, { recursive: true });
}

await cleanDatabase();
await cleanWorkspace();
