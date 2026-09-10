# Smoke Tests

Post-release smoke tests that run against `alpha`-tagged Mastra packages. Tests exercise Mastra features end-to-end through the HTTP API and Studio UI.

> **Hitting a flaky test, suite hang, or wondering why a fixture is configured the way it is?** Read [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) first — it documents the scheduler/LibSQL race, the `backgroundTasks` tool-use regression, the local HTML-reporter hang, and other gotchas.

## Setup

```bash
cp .env.example .env   # fill in OPENAI_API_KEY (required), Slack vars (optional)
pnpm install --ignore-workspace
```

## Running

Build before running the API/UI suites or the built-server isolation check. Offline harness tests do not need a build:

```bash
pnpm build              # Builds the server and Studio assets for both suites
```

### API tests (Vitest)

```bash
pnpm build
pnpm test
```

### UI tests (Playwright)

```bash
pnpm build
pnpm test:ui
```

### Both

```bash
pnpm build
pnpm test:all
```

### Server ownership and diagnostics

Both runners use `scripts/smoke-server.ts` to launch the same built entrypoint. Each
invocation gets an allocated loopback port and a fresh directory:

```text
reports/runtime/<api-or-ui>-<unique-id>/
  run.json          # PID, entrypoint, effective paths, exit state, forced shutdown
  server.log        # complete stdout/stderr
  data/
    test.db
    mastra.duckdb
    test-workspace/
```

The fixture's `/smoke/health` response must identify that exact run before tests
start. Playwright never automatically reuses an existing server. Set `STUDIO_PORT`
only when a particular UI port is needed; an occupied port fails instead of attaching
to another process. Stop any manually running server on that port first.

Shutdown sends SIGTERM, allows 15 seconds for HTTP draining and storage teardown,
then escalates to SIGKILL if necessary. Teardown waits for process and log-stream
closure; a crash or forced shutdown fails the run. Data and logs are retained on
success and failure, not deleted during teardown. Remove an old run directory only
after verifying its process has stopped. CI uploads these files with `reports/` and
retains artifacts for 30 days. Abrupt SIGKILL of the runner cannot run cleanup hooks;
private paths still prevent a later invocation from deleting its data.

The top-level test reports and Playwright artifact directories keep their existing
names: concurrent servers are isolated, but do not run two report-producing instances
of the same suite into the same checkout's default report directories.

```bash
pnpm test:lifecycle    # Offline process lifecycle/failure tests; no build or LLM
pnpm test:isolation    # Two real built servers; verifies independent stores/workspaces, no LLM
```

### Slack report (after tests)

```bash
pnpm build && {
  export API_TEST_OUTCOME=success UI_TEST_OUTCOME=success
  CI=1 pnpm test || export API_TEST_OUTCOME=failure
  CI=1 pnpm test:ui || export UI_TEST_OUTCOME=failure
  pnpm report:slack
}
```

The report includes both API (Vitest) and UI (Playwright) results. The script loads `.env` automatically for local runs. Set `SLACK_CHANNEL_ID` to the channel you want results posted to (the bot must be a member).

## CI / GitHub Actions

The workflow at `.github/workflows/smoke.yml` runs on two triggers:

- **`schedule`** — twice-daily cron (`0 5,17 * * *`), 1h after the upstream alpha publish cron, against the `alpha` tag.
- **`workflow_dispatch`** — manual run with a `tag` input (defaults to `alpha`). Use this to smoke `latest`, retry a failed `alpha`, or test a custom dist-tag.

Each run:

1. Rewrites Mastra deps in `package.json` to the resolved tag, then `pnpm install --no-frozen-lockfile --ignore-workspace`
2. Runs offline reporting and process-lifecycle checks
3. Builds the project (`mastra build --studio`) and verifies two concurrent built servers have independent stores/workspaces
4. Runs API tests (Vitest) and UI tests (Playwright) on both Zod 3 and Zod 4
5. Posts combined results to a Slack channel (with failure videos and run links)
6. Uploads test artifacts, including per-run server diagnostics

All GitHub-managed config is prefixed `SMOKE_*` so it groups together in repo **Settings → Secrets and variables → Actions**.

### Required repository secrets

| Secret | Description |
|---|---|
| `SMOKE_OPENAI_API_KEY` | OpenAI API key used by all smoke agents (`gpt-4o-mini`). |
| `SMOKE_SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |

### Required repository variables

| Variable | Description |
|---|---|
| `SMOKE_SLACK_CHANNEL_ID` | Slack channel ID (`C...`) to post smoke results to. The bot must be invited to this channel. |

### Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `chat:write` — post messages
   - `files:write` — upload failure videos
   - `files:read` — read uploaded files
3. **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-...`)
4. **Invite the bot to the smoke channel** (`/invite @your-bot-name`). Without this, `chat.postMessage` returns `not_in_channel`.
5. Get the channel ID: in Slack, click the channel name → **About** → copy the **Channel ID** at the bottom.

## What's tested

### API tests (Vitest)

See [`tests/COVERAGE.md`](tests/COVERAGE.md) for the full test inventory. Coverage includes Workflows, Agents, Tools, Memory, MCP, Datasets, Scores, Processors, Workspaces, and Observability.

### UI tests (Playwright)

See [`tests-ui/COVERAGE.md`](tests-ui/COVERAGE.md) for the full test inventory.

## Project structure

```
mastra-smoke/
├── .env.example              # Required env vars
├── src/mastra/
│   ├── index.ts              # Mastra instance with agents, workflows, storage
│   ├── agents/               # Agent fixtures
│   └── workflows/            # Workflow fixtures
├── tests/                    # API tests (Vitest)
│   ├── setup.ts              # globalSetup: start server, teardown
│   ├── utils.ts              # fetchApi(), startWorkflow(), etc.
│   ├── COVERAGE.md           # Test inventory
│   └── agents/workflows/...  # Test files by feature
├── tests-ui/                 # UI tests (Playwright)
│   ├── server.ts             # Shared server lifecycle adapter
│   ├── global.setup.ts       # Pause autonomous schedule after server readiness
│   ├── helpers.ts            # Shared Playwright helpers
│   ├── COVERAGE.md           # Test inventory
│   └── agents/workflows/...  # Test spec files
├── reports/                  # Test reports + runtime diagnostics (gitignored)
└── scripts/
    ├── smoke-server.ts       # Shared run ownership and process lifecycle
    ├── smoke-server.test.ts  # Offline lifecycle regression tests
    ├── smoke-isolation.test.ts # Built-runtime isolation check
    └── slack-report.ts       # Slack channel/DM reporter (API + UI)
```

## Adding new tests

### API tests

1. Define workflows in `src/mastra/workflows/`
2. Register them in `src/mastra/index.ts`
3. Write tests in `tests/` using helpers from `tests/utils.ts`
4. Tests hit the API via raw `fetch` — no SDK dependency

### UI tests

1. Define fixtures (agents, workflows) in `src/mastra/`
2. Register them in `src/mastra/index.ts`
3. Write Playwright specs in `tests-ui/`
4. Update `tests-ui/COVERAGE.md`
