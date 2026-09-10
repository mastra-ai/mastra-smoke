/**
 * Slack smoke-test reporter.
 *
 * Reads the Vitest JSON report (API tests) and Playwright JSON report (UI tests),
 * posts a combined summary to a channel (or DM), and uploads failure videos as
 * threaded replies.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN  – Bot User OAuth Token (xoxb-…)
 *   SLACK_CHANNEL_ID – Slack channel ID (e.g. C01ABCDEF). The bot must be
 *                      invited to this channel.
 *
 * Optional env vars:
 *   REPORT_PATH      – path to Playwright JSON report (default: reports/ui-results.json)
 *   API_REPORT_PATH  – path to Vitest JSON report (default: reports/api-results.json)
 *   VIDEO_DIR        – path to Playwright test-results dir (default: test-results)
 *   API_TEST_OUTCOME / UI_TEST_OUTCOME – runner step outcomes (success, failure,
 *     skipped, cancelled). Required to verify success, including local reporting.
 *     Missing outcomes are reported as unverified, never green.
 *   ZOD_VERSION      – resolved zod version (e.g. 3.25.76 or 4.3.6)
 *   MASTRA_VERSIONS  – comma-separated list of Mastra package versions
 *   WORKFLOW_RUN_URL – link to the GitHub Actions run
 *   PUBLISH_RUN_URL  – link to the upstream "Publish to npm" run (workflow_run trigger)
 *   SMOKE_TRIGGER    – "publish" or "manual"
 *   NPM_TAG          – npm dist-tag that was smoked (e.g. alpha, latest)
 *   GITHUB_REPOSITORY – e.g. "mastra-ai/mastra-smoke" (auto-set in Actions)
 *   GITHUB_RUN_ID    – numeric run id (auto-set in Actions); used by the
 *                      `SMOKE_FAILURE_CONTEXT` thread reply so an external
 *                      debugging agent (e.g. Devin) can `gh run download` the
 *                      artifacts when tagged in the failure thread.
 *   ARTIFACT_NAME    – name of the per-matrix-leg artifact (e.g.
 *                      "smoke-test-results-zod3"). When set, included in the
 *                      context block so the agent knows which artifact to pull.
 */

import { appendFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { classifySuite, formatSuiteStatus, suitePassed, validateStats } from './report-status.ts';
import type { SuiteStats } from './report-status.ts';

// Load .env if present (local dev); in CI, env vars come from secrets.
const envPath = join(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

// ── Types ──────────────────────────────────────────────────────────

// Playwright types
interface PlaywrightResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  attachments?: Array<{ name: string; path?: string; contentType: string }>;
  error?: { message?: string };
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests: Array<{
    title: string;
    results: PlaywrightResult[];
  }>;
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  errors?: Array<{ message?: string }>;
  config: { rootDir: string };
  suites: PlaywrightSuite[];
  stats: {
    startTime: string;
    duration: number;
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
  };
}

// Vitest JSON types (Jest-compatible format)
interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo';
  title: string;
  failureMessages?: string[];
}

interface VitestTestResult {
  name: string;
  status: 'passed' | 'failed';
  endTime: number;
  assertionResults: VitestAssertionResult[];
}

interface VitestReport {
  success: boolean;
  numFailedTestSuites: number;
  numRuntimeErrorTestSuites?: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  startTime: number;
  testResults: VitestTestResult[];
}

interface FailedTest {
  source: 'API' | 'UI';
  title: string;
  file: string;
  error: string;
  videoPath: string | null;
}

interface FlakyTest {
  source: 'UI';
  title: string;
  file: string;
  retries: number;
}

// ── Config ─────────────────────────────────────────────────────────

const SLACK_BOT_TOKEN = env('SLACK_BOT_TOKEN');
const SLACK_CHANNEL_ID = env('SLACK_CHANNEL_ID');
const REPORT_PATH = process.env.REPORT_PATH || 'reports/ui-results.json';
const API_REPORT_PATH = process.env.API_REPORT_PATH || 'reports/api-results.json';
const VIDEO_DIR = process.env.VIDEO_DIR || 'test-results';

// ── Helpers ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

function env(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function slackApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; error?: string; channel?: { id: string }; ts?: string };
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error}`);
  }
  return data;
}

async function uploadFile(channelId: string, threadTs: string, filePath: string, title: string) {
  const fileBuffer = readFileSync(filePath);
  const fileName = basename(filePath);
  const fileSize = statSync(filePath).size;

  // Step 1: Get upload URL
  const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      filename: fileName,
      length: String(fileSize),
    }),
  });
  const urlData = (await urlRes.json()) as { ok: boolean; upload_url: string; file_id: string; error?: string };
  if (!urlData.ok) {
    throw new Error(`files.getUploadURLExternal failed: ${urlData.error}`);
  }

  // Step 2: Upload file content
  await fetch(urlData.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  });

  // Step 3: Complete upload and share to channel/thread
  const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: [{ id: urlData.file_id, title }],
      channel_id: channelId,
      thread_ts: threadTs,
    }),
  });
  const completeData = (await completeRes.json()) as { ok: boolean; error?: string };
  if (!completeData.ok) {
    throw new Error(`files.completeUploadExternal failed: ${completeData.error}`);
  }
}

// ── Parse Playwright report ─────────────────────────────────────────

function collectPlaywrightFailures(suites: PlaywrightSuite[], parentFile = ''): FailedTest[] {
  const failures: FailedTest[] = [];

  for (const suite of suites) {
    const file = suite.file || parentFile;

    for (const spec of suite.specs) {
      if (spec.ok) continue;

      const allResults = spec.tests.flatMap(t => t.results);
      const failedResult = allResults.find(
        r => r.status === 'failed' || r.status === 'timedOut',
      );
      if (!failedResult) continue;

      let videoPath: string | null = null;
      const videoAttachment = failedResult.attachments?.find(a => a.contentType === 'video/webm');
      if (videoAttachment?.path && existsSync(videoAttachment.path)) {
        videoPath = videoAttachment.path;
      }

      if (!videoPath) {
        videoPath = findVideo(spec.title, spec.title);
      }

      failures.push({
        source: 'UI',
        title: spec.title,
        file,
        error: extractFailureSummary(failedResult.error?.message || 'Unknown error'),
        videoPath,
      });
    }

    if (suite.suites) {
      failures.push(...collectPlaywrightFailures(suite.suites, file));
    }
  }

  return failures;
}

function collectPlaywrightFlakes(suites: PlaywrightSuite[], parentFile = ''): FlakyTest[] {
  const flakes: FlakyTest[] = [];

  for (const suite of suites) {
    const file = suite.file || parentFile;

    for (const spec of suite.specs) {
      // A spec is flaky when ok=true overall but some attempt(s) failed before
      // a retry passed. Playwright records each attempt in tests[].results.
      if (!spec.ok) continue;

      const allResults = spec.tests.flatMap(t => t.results);
      const failedAttempts = allResults.filter(
        r => r.status === 'failed' || r.status === 'timedOut',
      ).length;
      const passedAttempts = allResults.filter(r => r.status === 'passed').length;

      if (failedAttempts > 0 && passedAttempts > 0) {
        flakes.push({
          source: 'UI',
          title: spec.title,
          file,
          retries: failedAttempts,
        });
      }
    }

    if (suite.suites) {
      flakes.push(...collectPlaywrightFlakes(suite.suites, file));
    }
  }

  return flakes;
}

function extractFailureSummary(message: string): string {
  // Strip ANSI color codes
  const stripped = message.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = stripped.split('\n');

  const kept: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;

    // Skip stack frames, code snippet lines, and file path pointers
    if (/^at\s/.test(t)) continue;
    if (/^\s*\d+\s*\|/.test(raw)) continue;
    if (/^[\^~]+$/.test(t)) continue;
    if (/^❯\s/.test(t)) continue;

    const isInformative =
      i === 0 ||
      /^(Error:|AssertionError|Locator:|Expected|Received|Timeout|Call log|TimeoutError|expect\()/i.test(t);

    if (!isInformative) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    kept.push(t);
    if (kept.length >= 5) break;
  }

  const summary = kept.join(' · ');
  return summary || stripped.split('\n')[0] || 'Unknown error';
}

function findVideo(_specTitle: string, testTitle: string): string | null {
  if (!existsSync(VIDEO_DIR)) return null;

  const dirs = readdirSync(VIDEO_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const slug = dir.name.toLowerCase();
    const titleSlug = testTitle.toLowerCase().replace(/\s+/g, '-');
    if (slug.includes(titleSlug)) {
      const videoFile = join(VIDEO_DIR, dir.name, 'video.webm');
      if (existsSync(videoFile)) return videoFile;
    }
  }

  return null;
}

// ── Parse Vitest report ─────────────────────────────────────────────

function collectVitestFailures(report: VitestReport): FailedTest[] {
  const failures: FailedTest[] = [];

  for (const testResult of report.testResults) {
    for (const assertion of testResult.assertionResults) {
      if (assertion.status !== 'failed') continue;

      const errorMsg = assertion.failureMessages?.[0] || 'Unknown error';

      failures.push({
        source: 'API',
        title: assertion.fullName,
        file: testResult.name,
        error: extractFailureSummary(errorMsg),
        videoPath: null,
      });
    }
  }

  return failures;
}

// ── Main ───────────────────────────────────────────────────────────

function readReport<T>(path: string, outcome: string | undefined, parse: (value: unknown) => T): { report?: T; error?: string } {
  // A skipped/cancelled step may leave an old report during local replay.
  if (outcome === 'skipped' || outcome === 'cancelled') return {};
  if (!existsSync(path)) return { error: `Report missing: ${path}` };
  try {
    return { report: parse(JSON.parse(readFileSync(path, 'utf8'))) };
  } catch (error) {
    return { error: `Invalid report ${path}: ${extractFailureSummary(error instanceof Error ? error.message : String(error)).slice(0, 400)}` };
  }
}

function countPlaywrightTests(suites: PlaywrightSuite[]): number {
  return suites.reduce((total, suite) => total +
    suite.specs.reduce((count, spec) => count + spec.tests.length, 0) +
    countPlaywrightTests(suite.suites ?? []), 0);
}

function hasInterruptedTests(suites: PlaywrightSuite[]): boolean {
  return suites.some(suite =>
    suite.specs.some(spec => spec.tests.some(test => test.results.some(result => result.status === 'interrupted'))) ||
    hasInterruptedTests(suite.suites ?? []),
  );
}

async function main() {
  const api = readReport(API_REPORT_PATH, process.env.API_TEST_OUTCOME, value => {
    const report = value as VitestReport;
    const stats: SuiteStats = {
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      skipped: report.numPendingTests + report.numTodoTests,
      flaky: 0,
      total: report.numTotalTests,
    };
    validateStats(stats);
    if (typeof report.success !== 'boolean' || !Number.isFinite(report.startTime) ||
      !Number.isInteger(report.numFailedTestSuites) || report.numFailedTestSuites < 0) {
      throw new Error('Missing or invalid execution metadata');
    }
    const failures = collectVitestFailures(report);
    if (report.testResults.reduce((count, test) => count + test.assertionResults.length, 0) !== stats.total) {
      throw new Error('Report test inventory does not match its total');
    }
    const endTime = Math.max(report.startTime, ...report.testResults.map(test => test.endTime));
    const runnerError = !report.success || report.numFailedTestSuites > 0 || (report.numRuntimeErrorTestSuites ?? 0) > 0 ||
      failures.length > 0 || report.testResults.some(test => test.status === 'failed')
      ? 'Vitest reports unsuccessful execution or suite errors'
      : undefined;
    return { stats, failures, startTime: report.startTime,
      duration: Number.isFinite(endTime) ? endTime - report.startTime : undefined, runnerError };
  });
  const ui = readReport(REPORT_PATH, process.env.UI_TEST_OUTCOME, value => {
    const report = value as PlaywrightReport;
    const stats: SuiteStats = {
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      skipped: report.stats.skipped,
      flaky: report.stats.flaky,
      total: report.stats.expected + report.stats.unexpected + report.stats.flaky + report.stats.skipped,
    };
    validateStats(stats);
    if (!Number.isFinite(Date.parse(report.stats.startTime)) || !Number.isFinite(report.stats.duration)) {
      throw new Error('Missing execution metadata');
    }
    const failures = collectPlaywrightFailures(report.suites);
    if (countPlaywrightTests(report.suites) !== stats.total) {
      throw new Error('Report test inventory does not match its total');
    }
    const flakes = collectPlaywrightFlakes(report.suites);
    const runnerError = report.errors?.length
      ? `Playwright runner error: ${extractFailureSummary(report.errors[0].message || 'Unknown error').slice(0, 400)}`
      : hasInterruptedTests(report.suites) ? 'Playwright reports interrupted tests'
      : failures.length > stats.failed || flakes.length > stats.flaky ? 'Playwright results conflict with summary counts'
      : undefined;
    return { stats, failures, flakes, startTime: report.stats.startTime, duration: report.stats.duration, runnerError };
  });
  const apiStatus = classifySuite(process.env.API_TEST_OUTCOME, api.report?.stats, api.error, api.report?.runnerError);
  const uiStatus = classifySuite(process.env.UI_TEST_OUTCOME, ui.report?.stats, ui.error, ui.report?.runnerError);
  const emptyStats: SuiteStats = { passed: 0, failed: 0, skipped: 0, flaky: 0, total: 0 };
  const apiStats = api.report?.stats ?? emptyStats;
  const uiStats = ui.report?.stats ?? emptyStats;
  const apiFailures = api.report?.failures ?? [];
  const uiFailures = ui.report?.failures ?? [];
  const uiFlakes = ui.report?.flakes ?? [];
  const apiStartTime = api.report?.startTime;
  const uiStartTime = ui.report?.startTime;
  const apiDurationMs = api.report?.duration;
  const uiDurationMs = ui.report?.duration;

  const channelId = SLACK_CHANNEL_ID;

  // Build summary
  const executionFailures: FailedTest[] = [];
  for (const [source, status, path, failures] of [
    ['API', apiStatus, API_REPORT_PATH, apiFailures],
    ['UI', uiStatus, REPORT_PATH, uiFailures],
  ] as const) {
    if (!suitePassed(status) && (status.status !== 'failed' || failures.length === 0)) {
      executionFailures.push({
        source,
        title: `${source} execution: ${status.status}`,
        file: path,
        error: status.reason || 'Report records failed tests without individual failure details',
        videoPath: null,
      });
    }
  }
  const allFailures = [...executionFailures, ...apiFailures, ...uiFailures];
  const totalFailed = apiStats.failed + uiStats.failed;
  const isGreen = suitePassed(apiStatus) && suitePassed(uiStatus);
  // Publish execution status before notification delivery; Slack failure must
  // not change the recorded test outcome.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `test_status=${isGreen ? 'success' : 'failure'}\n`);
  }
  const hasFlakes = uiStats.flaky > 0;
  const emoji = isGreen ? (hasFlakes ? '⚠️' : '✅') : '🔴';

  // Use the earliest available start time for the timestamp
  const startMs = apiStartTime ?? (uiStartTime ? new Date(uiStartTime).getTime() : Date.now());
  const runTs = Math.floor(startMs / 1000);
  const timeStr = `<!date^${runTs}^{date_short_pretty} at {time}|${new Date(startMs).toISOString()}>`;

  // Per-suite status lines
  const apiDuration = apiDurationMs != null ? ` in ${formatDuration(apiDurationMs)}` : '';
  const apiLine = formatSuiteStatus('API', apiStatus, api.report?.stats) + apiDuration;
  const uiDuration = uiDurationMs != null ? ` in ${formatDuration(uiDurationMs)}` : '';
  const uiLine = formatSuiteStatus('UI', uiStatus, ui.report?.stats) + uiDuration;

  const zodVersion = process.env.ZOD_VERSION;
  const npmTag = process.env.NPM_TAG;
  const tagZodLabel = [npmTag && `tag: ${npmTag}`, zodVersion && `zod: ${zodVersion}`]
    .filter(Boolean)
    .join(' • ');
  const labelSuffix = tagZodLabel ? ` (${tagZodLabel})` : '';

  const headline = isGreen
    ? `${emoji} *Smoke Tests${labelSuffix}* — ${hasFlakes ? 'passed with retries' : 'all green'}`
    : `${emoji} *Smoke Tests${labelSuffix}* — ${totalFailed > 0 ? `${totalFailed} tests failed` : 'execution incomplete or unsuccessful'}${executionFailures.length && totalFailed > 0 ? '; execution issues' : ''}`;

  const statusLines = [apiLine, uiLine].filter(Boolean).join('  ·  ');

  // Context line: timestamp, run links, trigger, skipped/flaky counts
  const contextParts = [timeStr];
  if (process.env.WORKFLOW_RUN_URL) contextParts.push(`<${process.env.WORKFLOW_RUN_URL}|smoke run>`);
  if (process.env.PUBLISH_RUN_URL) contextParts.push(`<${process.env.PUBLISH_RUN_URL}|publish run>`);
  if (process.env.SMOKE_TRIGGER) contextParts.push(`trigger: ${process.env.SMOKE_TRIGGER}`);
  const totalSkipped = apiStats.skipped + uiStats.skipped;
  if (totalSkipped > 0) contextParts.push(`${totalSkipped} skipped`);
  if (uiStats.flaky > 0) contextParts.push(`⚠️ ${uiStats.flaky} flaky`);
  // Count distinct reported tests, including passed-on-retry and skipped tests.
  const apiTotal = apiStats.total;
  const uiTotal = uiStats.total;
  if (apiTotal + uiTotal > 0) {
    contextParts.push(`coverage: ${apiTotal} API · ${uiTotal} UI`);
  }

  const blocks: Record<string, unknown>[] = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextParts.join('  ·  ') }],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${headline}\n${statusLines}` },
    },
  ];

  // Mastra package versions block
  const mastraVersions = process.env.MASTRA_VERSIONS;
  if (mastraVersions) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `📦 ${mastraVersions}` }],
    });
  }

  if (!isGreen && allFailures.length > 0) {
    blocks.push({ type: 'divider' });

    // Slack section blocks have a 3000-char text limit.
    // Build the list incrementally and stop when we'd exceed the budget.
    const header = '*Failures:*\n\n';
    const maxLen = 2900; // leave room for header + truncation notice
    let failureList = '';
    let shown = 0;

    for (const f of allFailures) {
      const error = f.error.length > 280 ? f.error.slice(0, 280) + '…' : f.error;
      // Escape chars that break Slack mrkdwn inside the error string
      const safeError = error.replace(/[*_~`<>]/g, c => `\\${c}`);
      const entry = `• [${f.source}] \`${f.file}\`\n   ${f.title}\n   _${safeError}_`;
      const candidate = failureList ? failureList + '\n\n' + entry : entry;
      if (header.length + candidate.length > maxLen) break;
      failureList = candidate;
      shown++;
    }

    const remaining = allFailures.length - shown;
    if (remaining > 0) {
      failureList += `\n\n_…and ${remaining} more_`;
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${header}${failureList}`,
      },
    });

    if (allFailures.some(f => f.videoPath)) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: '🎬 _Failure videos attached in thread_' },
        ],
      });
    }
  }

  // Flaky section — surfaces specs that passed only after retrying. We keep
  // these in the green count but list them so we can track LLM tail-latency
  // trends across alpha bumps. Skipped when all-green AND no flakes.
  if (uiFlakes.length > 0) {
    blocks.push({ type: 'divider' });

    const header = '*Flaky (passed on retry):*\n\n';
    const flakyLines = uiFlakes
      .map(f => `• \`${f.file}\` — ${f.title} _(${f.retries} ${f.retries === 1 ? 'retry' : 'retries'})_`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${header}${flakyLines}`,
      },
    });
  }

  const fallbackText = `${headline} — ${statusLines}`;

  // Post summary
  const msgRes = await slackApi('chat.postMessage', {
    channel: channelId,
    text: fallbackText, // fallback for notifications
    blocks,
  });

  const threadTs = msgRes.ts!;
  console.log(`Posted summary (ts: ${threadTs}, channel: ${channelId})`);

  // Upload failure videos as thread replies
  for (const failure of allFailures) {
    if (!failure.videoPath) continue;
    console.log(`Uploading video for: ${failure.title}`);
    try {
      await uploadFile(channelId, threadTs, failure.videoPath, failure.title);
    } catch (err) {
      console.error(`Failed to upload video for ${failure.title}:`, err);
    }
  }

  // Post a machine-readable context block in the failure thread so an
  // external debugging agent (e.g. Devin) tagged on the failure has
  // everything it needs to fetch artifacts, locate upstream source, and
  // open a PR/issue. See .agents/skills/diagnose-smoke-failure/SKILL.md
  // for the consumer-side workflow.
  if (!isGreen && allFailures.length > 0) {
    await postAgentContext(channelId, threadTs, allFailures, uiFlakes);
  }

  console.log('Done.');
}

async function postAgentContext(
  channelId: string,
  threadTs: string,
  failures: FailedTest[],
  flakes: FlakyTest[],
) {
  const lines: string[] = ['SMOKE_FAILURE_CONTEXT'];

  const repo = process.env.GITHUB_REPOSITORY || '';
  const runId = process.env.GITHUB_RUN_ID || '';
  const runUrl = process.env.WORKFLOW_RUN_URL || '';
  const artifactName = process.env.ARTIFACT_NAME || '';
  const zodVersion = process.env.ZOD_VERSION || '';
  const npmTag = process.env.NPM_TAG || '';
  const mastraVersions = process.env.MASTRA_VERSIONS || '';

  if (repo) lines.push(`  repo: ${repo}`);
  if (runId) lines.push(`  run_id: ${runId}`);
  if (runUrl) lines.push(`  run_url: ${runUrl}`);
  if (artifactName) lines.push(`  artifact_name: ${artifactName}`);
  if (npmTag) lines.push(`  npm_tag: ${npmTag}`);
  if (zodVersion) lines.push(`  zod_version: ${zodVersion}`);
  if (mastraVersions) lines.push(`  packages_under_test: ${mastraVersions}`);

  lines.push('  fetch_artifacts: |');
  if (repo && runId && artifactName) {
    lines.push(`    gh run download ${runId} --repo ${repo} --name ${artifactName}`);
  } else {
    lines.push('    (run_id / artifact_name not available — see run_url for artifacts)');
  }

  lines.push('  failures:');
  for (const f of failures) {
    lines.push(`    - source: ${f.source}`);
    lines.push(`      file: ${f.file}`);
    lines.push(`      title: ${JSON.stringify(f.title)}`);
    // Truncate aggressively — Devin can pull the full message from
    // reports/*-junit.xml in the artifact bundle.
    const err = f.error.length > 240 ? f.error.slice(0, 240) + '…' : f.error;
    lines.push(`      error: ${JSON.stringify(err)}`);
  }

  if (flakes.length > 0) {
    lines.push('  flakes:');
    for (const f of flakes) {
      lines.push(`    - source: ${f.source}`);
      lines.push(`      file: ${f.file}`);
      lines.push(`      title: ${JSON.stringify(f.title)}`);
      lines.push(`      retries: ${f.retries}`);
    }
  }

  lines.push('END_SMOKE_FAILURE_CONTEXT');

  // Wrapped in a triple-backtick code block so Slack renders it as
  // monospace and the agent can copy/parse it verbatim. Slack's section
  // text limit is 3000 chars; truncate the body (keeping the END marker)
  // if we get close.
  const body = lines.join('\n');
  const maxBody = 2900;
  const truncated = body.length > maxBody
    ? body.slice(0, maxBody - 60) + '\n  … (truncated — see artifact)\nEND_SMOKE_FAILURE_CONTEXT'
    : body;

  const text = '```\n' + truncated + '\n```';

  await slackApi('chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text,
    // Use blocks so Slack doesn't auto-unfurl URLs in the YAML-ish body.
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🤖 _Tag `@Devin` in this thread to auto-diagnose. Devin loads `.agents/skills/diagnose-smoke-failure/SKILL.md` to handle the rest._',
          },
        ],
      },
    ],
  });

  console.log('Posted SMOKE_FAILURE_CONTEXT thread reply');
}

main().catch(err => {
  console.error('Slack report failed:', err);
  process.exit(1);
});
