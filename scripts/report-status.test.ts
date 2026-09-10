import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as status from './report-status.ts';

const passed = { passed: 1, failed: 0, skipped: 0, flaky: 0, total: 1 };

test('success requires both a successful runner and a valid report', () => {
  assert.equal(status.classifySuite('success', passed).status, 'passed');
  assert.equal(status.suitePassed(status.classifySuite('failure', passed)), false);
  assert.equal(status.classifySuite(undefined, passed).status, 'unverified');
  assert.equal(status.classifySuite('unexpected', passed).status, 'unverified');
  assert.equal(status.classifySuite('success', undefined).status, 'infrastructure failure');
});

test('skipped and cancelled steps cannot reuse a passing report', () => {
  assert.equal(status.classifySuite('skipped', passed).status, 'not run');
  assert.equal(status.classifySuite('cancelled', passed).status, 'interrupted');
});

test('runner errors fail even with passing test counts', () => {
  assert.deepEqual(status.classifySuite('success', passed, undefined, 'setup failed'), {
    status: 'infrastructure failure', reason: 'setup failed',
  });
});

test('test failures, retries, partial skips, and all-skipped suites remain distinct', () => {
  assert.equal(status.classifySuite('failure', { ...passed, passed: 0, failed: 1 }).status, 'failed');
  const flaky = { ...passed, passed: 0, flaky: 1 };
  assert.equal(status.classifySuite('success', flaky).status, 'flaky');
  assert.equal(status.formatSuiteStatus('UI', status.classifySuite('success', flaky), flaky),
    'UI: 1/1 passed, 1 passed on retry');
  const partial = { ...passed, skipped: 1, total: 2 };
  assert.equal(status.formatSuiteStatus('UI', status.classifySuite('success', partial), partial),
    'UI: 1/2 passed, 1 skipped');
  assert.equal(status.classifySuite('success', { ...passed, passed: 0, skipped: 1 }).status, 'skipped');
  assert.equal(status.classifySuite('success', { ...passed, passed: 0, total: 0 }).status, 'infrastructure failure');
});

test('invalid and inconsistent report counts are rejected', () => {
  for (const invalid of [NaN, undefined, -1, 0.5, '1']) {
    assert.throws(() => status.validateStats({ ...passed, passed: invalid as number }), /invalid test counts/);
  }
  assert.throws(() => status.validateStats({ ...passed, total: 2 }), /do not add up/);
  status.validateStats(passed);
});

const startTime = Date.UTC(2026, 8, 10);
function apiReport() {
  return {
    success: true, numFailedTestSuites: 0, numTotalTests: 1, numPassedTests: 1,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, startTime,
    testResults: [{ name: 'example.test.ts', status: 'passed', endTime: startTime + 100,
      assertionResults: [{ status: 'passed', fullName: 'API example', title: 'example', ancestorTitles: [] }] }],
  };
}
function uiReport() {
  return {
    errors: [] as Array<{ message: string }>,
    stats: { startTime: new Date(startTime).toISOString(), duration: 100, expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ title: 'UI', file: 'example.spec.ts', specs: [{ title: 'UI example', ok: true,
      tests: [{ title: 'example', results: [{ status: 'passed', duration: 100 }] }] }] }],
  };
}

// Exercise the actual CLI entrypoint. IO is replaced before evaluation: no real
// filesystem reads, credentials, network requests, or Slack uploads are possible.
const source = readFileSync(new URL('./slack-report.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.dirname', JSON.stringify('/virtual/scripts'))
  .replace('main().catch(err => {', 'globalThis.completion = main().catch(err => {');
const reporterCode = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function report(
  api: unknown = apiReport(), ui: unknown = uiReport(),
  outcomes: Record<string, string> = { API_TEST_OUTCOME: 'success', UI_TEST_OUTCOME: 'success' },
  slackSucceeds = true,
) {
  const files = new Map<string, string>();
  if (api !== null) files.set('reports/api-results.json', typeof api === 'string' ? api : JSON.stringify(api));
  if (ui !== null) files.set('reports/ui-results.json', typeof ui === 'string' ? ui : JSON.stringify(ui));
  const posts: Array<{ text: string; blocks?: unknown[] }> = [];
  let executionOutput = '';
  const context = vm.createContext({
    exports: {}, completion: Promise.resolve(),
    require: (name: string) => {
      if (name === './report-status.ts') return status;
      if (name === 'node:path') return path;
      if (name === 'node:fs') return {
        existsSync: (file: string) => files.has(file),
        appendFileSync: (file: string, text: string) => {
          assert.equal(file, '/virtual/output');
          executionOutput += text;
        },
        readFileSync: (file: string) => {
          assert.ok(files.has(file), `Unexpected read: ${file}`);
          return files.get(file);
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: { SLACK_BOT_TOKEN: 'fake', SLACK_CHANNEL_ID: 'fake', GITHUB_OUTPUT: '/virtual/output', ...outcomes },
      exit: (code: number) => { throw new Error(`Reporter exited: ${code}`); } },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url: string, options: { body: string }) => {
      assert.equal(url, 'https://slack.com/api/chat.postMessage');
      assert.match(executionOutput, /^test_status=(success|failure)\n$/);
      if (!slackSucceeds) assert.equal(executionOutput, 'test_status=success\n');
      posts.push(JSON.parse(options.body));
      return { json: async () => ({ ok: slackSucceeds, ts: 'fake', error: 'delivery rejected' }) };
    },
  });
  vm.runInContext(reporterCode, context);
  await context.completion;
  assert.ok(posts.length > 0, 'Expected a summary');
  return Object.assign(posts, { executionOutput });
}

test('CLI reports all green only for two completed passing suites', async () => {
  const posts = await report();
  assert.match(posts[0].text, /all green/);
  assert.match(posts[0].text, /API: 1\/1 passed.*UI: 1\/1 passed/);
  assert.equal(posts.length, 1);
  assert.equal(posts.executionOutput, 'test_status=success\n');
});

test('notification failure does not overwrite the verified test outcome', async () => {
  await assert.rejects(report(apiReport(), uiReport(), undefined, false), /Reporter exited: 1/);
});

for (const [name, api, ui] of [
  ['API missing', null, uiReport()],
  ['UI missing', apiReport(), null],
  ['both missing', null, null],
  ['invalid JSON', '{bad', uiReport()],
  ['invalid shape', apiReport(), {}],
  ['invalid counts', { ...apiReport(), numPassedTests: -1 }, uiReport()],
  ['incomplete API inventory', { ...apiReport(), testResults: [] }, uiReport()],
  ['incomplete UI inventory', apiReport(), { ...uiReport(), suites: [] }],
  ['invalid date', apiReport(), { ...uiReport(), stats: { ...uiReport().stats, startTime: 'bad' } }],
] as const) {
  test(`CLI reports execution failure and diagnostic context: ${name}`, async () => {
    const posts = await report(api, ui);
    assert.doesNotMatch(posts[0].text, /all green/);
    assert.match(posts[0].text, /infrastructure failure/);
    assert.equal(posts.executionOutput, 'test_status=failure\n');
    assert.match(posts[1].text, /SMOKE_FAILURE_CONTEXT/);
    assert.match(posts[1].text, /execution: infrastructure failure/);
  });
}

test('CLI ignores stale results for skipped and cancelled steps', async () => {
  const posts = await report(apiReport(), uiReport(), { API_TEST_OUTCOME: 'skipped', UI_TEST_OUTCOME: 'cancelled' });
  assert.match(posts[0].text, /API: not run/);
  assert.match(posts[0].text, /UI: interrupted/);
  assert.doesNotMatch(posts[0].text, /1\/1 passed|all green/);
});

test('CLI requires supplied outcomes even if both reports passed', async () => {
  const posts = await report(apiReport(), uiReport(), {});
  assert.match(posts[0].text, /API: unverified.*UI: unverified/);
  assert.doesNotMatch(posts[0].text, /all green/);
});

test('CLI detects failure exit with a passing report', async () => {
  const posts = await report(apiReport(), uiReport(), { API_TEST_OUTCOME: 'failure', UI_TEST_OUTCOME: 'success' });
  assert.match(posts[0].text, /Runner failed without recorded test failures/);
  assert.match(posts[0].text, /UI: 1\/1 passed/);
});

test('CLI detects runner-level errors, including setup failures with zero failed tests', async () => {
  const api = apiReport();
  api.success = false;
  api.numFailedTestSuites = 1;
  const ui = uiReport();
  ui.errors.push({ message: 'webServer failed to start' });
  const posts = await report(api, ui);
  assert.match(posts[0].text, /Vitest reports unsuccessful execution/);
  assert.match(posts[0].text, /webServer failed to start/);
});

test('CLI never trusts passing counters over recorded failures', async () => {
  const api = apiReport();
  api.testResults[0].assertionResults[0].status = 'failed';
  const ui = uiReport();
  ui.suites[0].specs[0].ok = false;
  ui.suites[0].specs[0].tests[0].results[0].status = 'failed';
  const posts = await report(api, ui);
  assert.doesNotMatch(posts[0].text, /all green/);
  assert.equal(posts.executionOutput, 'test_status=failure\n');
  assert.match(posts[0].text, /Playwright results conflict/);
});

test('CLI detects interrupted attempts even when counters look successful', async () => {
  const ui = uiReport();
  ui.suites[0].specs[0].tests[0].results[0].status = 'interrupted';
  const posts = await report(apiReport(), ui);
  assert.match(posts[0].text, /Playwright reports interrupted tests/);
});

test('CLI does not call empty or entirely skipped suites green', async () => {
  const empty = apiReport();
  empty.numTotalTests = 0;
  empty.numPassedTests = 0;
  empty.testResults = [];
  const emptyPosts = await report(empty);
  assert.match(emptyPosts[0].text, /Report contains no tests/);
  const skipped = apiReport();
  skipped.numPassedTests = 0;
  skipped.numPendingTests = 1;
  skipped.testResults[0].assertionResults[0].status = 'skipped';
  const skippedPosts = await report(skipped);
  assert.match(skippedPosts[0].text, /API: skipped — No tests executed/);
  assert.doesNotMatch(skippedPosts[0].text, /all green/);
});

test('CLI includes diagnostic context when failed counts have no assertion details', async () => {
  const api = apiReport();
  api.numFailedTests = 1;
  api.numPassedTests = 0;
  const posts = await report(api);
  assert.match(posts[0].text, /1 tests failed/);
  assert.match(posts[1].text, /without individual failure details/);
});

test('CLI preserves assertion failure details and separates retry passes', async () => {
  const api = apiReport();
  api.success = false;
  api.numFailedTests = 1;
  api.numPassedTests = 0;
  api.testResults[0].assertionResults[0].status = 'failed';
  const failedPosts = await report(api);
  assert.match(failedPosts[0].text, /1 tests failed/);
  assert.match(failedPosts[1].text, /API example/);
  const ui = uiReport();
  ui.stats.expected = 0;
  ui.stats.flaky = 1;
  ui.suites[0].specs[0].tests[0].results.unshift({ status: 'failed', duration: 20 });
  const flakyPosts = await report(apiReport(), ui);
  assert.match(flakyPosts[0].text, /passed with retries/);
  assert.match(flakyPosts[0].text, /UI: 1\/1 passed, 1 passed on retry/);
  assert.doesNotMatch(flakyPosts[0].text, /all green/);
});
