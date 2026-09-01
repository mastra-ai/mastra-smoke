# Smoke Suite — Known Issues & Fixture Gotchas

Things to know before tweaking fixtures, bumping cadences, or debugging
a suite-level hang.

## 1. Scheduler cadence must stay ≥ 5s

**Symptom**

- Server logs flooded with `SQLITE_ERROR: no such table: mastra_schedules`
  or `mastra_workflow_snapshot` shortly after startup.
- `/api/schedules` intermittently 500s even though the table eventually exists.
- Under load (full UI suite, serial workers=1) the noise cascades: workflow
  snapshots fail to persist → agent-chat `toHaveURL` assertions time out →
  the suite hangs past 10–15 min and exits with code 128.
- In CI, tool-registry lookups can also starve: `agents/agent-tools`
  returns 500 "Tool not found", `agents/generate` reports "LLM did not
  invoke any tools", MCP returns `{ isError: true }` instead of
  `{ result: 42 }`.

**Cause**

`Mastra` boots the scheduler synchronously and `start()` fires `#runTick()`
immediately, before `setInterval` is armed (see
`packages/core/src/workflows/scheduler/scheduler.ts`). LibSQL may still
be running schema migrations at that moment. There is no
`tickStartDelayMs` config. Composite-store delegation (#16786) and
scheduler index/auto-suspend (#16805) reduced the surface area, but a
fast tick still piles `mastra_workflow_snapshot` writes onto the shared
LibSQL pool faster than tool-using tests can complete.

**Settings that work**

- `tickIntervalMs: 5_000` on the scheduler
- `scheduled-tick` cron: `*/5 * * * * *`
- `schedules.test.ts` still proves end-to-end firing in <5s

**If you bump cadence below 5s**, expect tool-call tests to return 500s
in CI before any scheduler errors appear. The starvation is silent on
the scheduler side.

## 2. `_background` injection corrupts zod v3 tool schemas (awaiting upstream fix)

**Symptom**

CI on `zod ^3.25.76` matrix (only — passes on `zod ^4`):

```
TypeError: keyValidator._parse is not a function
  at ZodObject._parse (zod/v3/types.js)
  at safeValidate
  at validateToolInput
  at Tool.execute
```

Cascade: direct tool `execute` returns 500, LLM-driven calls report
"did not invoke any tools", MCP returns `{ content, isError: true }`
instead of `{ result: 42 }`, tool-approval never produces a `tool-result`
event.

**Cause**

`CoreToolBuilder` injects a `_background` override field into every
background-eligible tool's input schema by calling
`originalSchema.extend({ _background: backgroundOverrideZodSchema })`.
`backgroundOverrideZodSchema` is built from `zod/v4`. When the user's
tool schema is a `zod/v3` `ZodObject`, extending it with a v4 child
produces a mixed shape; v3's `ZodObject._parse` then crashes calling
`_parse` on the v4 child (v4 doesn't expose `_parse`). The mutation is
also written back to `originalTool.inputSchema`, so the corruption
persists across requests.

CI-only because Mac pnpm hoists bare `zod` to v4.3.6's v3 compat shim,
while CI Linux hoists pure `zod@3.25.76`.

**Resolution**

Upstream PR #16915 reworks the injection to flow through the standard
JSON Schema interop path (`toStandardSchema → standardSchemaToJSONSchema`),
eliminating the v3/v4 mix and dropping the mutation. Once merged and
published, smoke should pass cleanly on the zod 3 matrix again.

**Workaround until merged**

None for CI. Locally, the bug only reproduces if you force
`.mastra/output/node_modules/zod` to point at `zod@3.25.76` (see the
debug-mastra-framework skill for the recipe).

## 3. Local UI run "hangs" with HTML reporter

**Symptom**

`pnpm test:ui` (no `CI=1`) appears to hang indefinitely after all tests
pass. Process exits 124 / times out at 15 min.

**Cause**

Default reporter is `html`, which serves the report on a local port and
blocks the process until you `Ctrl-C`. CI mode uses `list + json + junit`
reporters that exit cleanly.

**Workaround**

Run locally with `CI=1 pnpm test:ui` (or pass `--reporter=list`) when you
want the suite to exit on completion.

## 4. LLM tail-latency requires 45s `toHaveURL` assertions

**Symptom**

Sporadic failures in `agent-chat.spec.ts`, `agent-features.spec.ts`,
`memory/memory-threads.spec.ts` on
`expect(page).toHaveURL(/\/threads\/(?!new)/)`. The URL never transitions
because the model stream is still in flight.

**Cause**

Default Playwright `toHaveURL` timeout (5s) and an earlier 20s were both
too tight under full-suite load on `gpt-4o-mini` with working-memory tool
calls in the loop.

**Workaround**

URL/assistant-message waits in those three specs use a 45s timeout
(90s in `memory-threads.spec.ts`, whose working-memory turns route
through the nondeterministic `updateWorkingMemory` tool loop — observed
at 24s solo and >45s under full-suite load on `core@1.42.0-alpha.4`).
The two working-memory specs are also wrapped in
`test.describe.configure({ retries: 3 })` and tagged `@llm` so the Slack
reporter surfaces them when they recover after retry. Keep both
patterns in mind if you add new chat-flow specs.

## 5. Stale dev servers on port 4111 / 4555

Repeatedly observed: long-lived `node .mastra/output/index.mjs` processes
left behind by earlier interactive sessions hold port 4555 (or 4111) and
either cause Playwright's `reuseExistingServer: true` to attach to a stale
build, or block server startup entirely. Symptoms include test isolation
working but full-suite runs hanging.

Before debugging suite-level hangs, always:

```sh
ps aux | grep 'mastra/output' | grep -v grep
lsof -i :4555
# kill any lingering pids
```

## 6. Studio Schedules page CORS quirk (cosmetic)

Studio bundle served from `127.0.0.1:4111` issues SDK requests to
`localhost:4111` with `credentials: 'include'`. Browsers reject the
response because `Access-Control-Allow-Origin: *` is incompatible with
credentialed requests across the `localhost` ↔ `127.0.0.1` boundary, so
the page shows "Failed to load schedules / Failed to fetch" in
hand-driven sessions.

Playwright tests don't hit this because the test runner uses a single
host (`127.0.0.1:4555`) end-to-end. No action required for the smoke
suite, but worth knowing when probing UI with agent-browser.

## 7. Edit Dataset dialog never unmounted after dismissal (resolved)

On `mastra@1.13.0-alpha.4` Studio, the dataset detail "Edit Dataset"
dialog stayed rendered after Close, Cancel, or Escape. The smoke test
temporarily asserted its logical `data-closed` state instead of unmounting.

As of `@mastra/core@1.63.0-alpha.0`, dataset editing uses a dedicated
`/datasets/:id/edit` page instead of this dialog. The obsolete workaround
has been removed from `datasets.spec.ts`.

## 8. API working-memory tests intermittently time out (upstream)

**Symptom**

`tests/agents/stream-memory.test.ts › should recall context across turns`
and `tests/agents/generate.test.ts › multi-turn with memory › should
remember context across turns` intermittently hit their full test
timeout (120s / 60s) on the CI `zod3` leg. Reproduced locally on the
exact CI stack (`@mastra/core@1.42.0-alpha.4`, `zod@3.25.76`): three
back-to-back `stream-memory` runs measured 7.7s / 120s-timeout / 7.7s.

**Cause**

A single working-memory turn either converges in ~7s or spirals into a
runaway `updateWorkingMemory` tool-call loop that never finishes —
upstream `@mastra/core` behavior regression first seen on `1.38.x`,
still present in `1.42.0-alpha.4`. The `streamAgent` helper reads the
full response body (`res.text()`), so the loop blocks until the test
timeout fires. `zod4` happens to pass more often, so failures cluster
on the `zod3` leg, but it is not zod-specific.

**Workaround**

Both tests use `it(name, { timeout, retry: 2 }, fn)`. A passing turn is
~7s, so retries are cheap; the runaway path is rare enough that 2
retries clears it. Bumping the timeout alone does not help (the loop
never converges). Remove the retries once the upstream loop is fixed.

## 9. Workflow graph redesign (@mastra/core 1.44.x) + lost step-error detail

**Symptom**

- After bumping to `@mastra/core@1.44.0-alpha.2`, the entire
  `tests-ui/workflows/workflow-run.spec.ts` suite (10 tests) failed on both
  legs with `expect(locator('h2')).toHaveText(...)` (received "Recent runs")
  and `getByRole('button', { name: 'Handle-positive' / 'Always-fails' })`
  not found.

**Cause**

The workflow graph page was redesigned:
- The workflow name moved out of `<h1>/<h2>` into a header `<span>` (the only
  `<h2>` is now a "Recent runs" panel).
- Step nodes are `<div data-testid="workflow-default-node"
  data-workflow-step-key="<name>">`, no longer `role=button`. A parallel
  **timeline panel** renders `<div role="button"
  data-testid="workflow-timeline-row" data-workflow-step-key="<name>">` rows.
- Step output is shown in a CodeMirror JSON viewer revealed by clicking
  "Run output" (e.g. `{"result":{"result":"Positive: 10"}}`).
- "Recent runs" lists past runs as `<a href=".../graph/<runId>">` keyed by
  run id; the list only refreshes on (re)load.
- The resume button was renamed "Resume workflow" → "Resume"; the suspend
  payload text ("Please approve: ...") is no longer rendered.

The spec was rewritten to use the stable `data-workflow-step-key` /
`data-testid` hooks and status attributes instead of role/heading text.

**Upstream gap (unfixed)**

A **failed** workflow step no longer surfaces its error message anywhere in
the graph UI — the panel shows only a "Failed" badge + run id, with no
"Run output" section and no error text. The
`failure-workflow: step shows failed status and error detail` test therefore
asserts only the `failed` *status* (via `data-workflow-step-status`); the
error-text assertion (`Intentional failure for smoke test`) was dropped.
Restore it once the graph UI re-exposes failed-step error detail.

## 10. MCP disconnect crashes the server after the 15s keepalive

**Symptom**

Disconnecting a Streamable HTTP MCP client leaves its SSE keepalive alive. Its
next write runs after the outer response stream has been cancelled and crashes
the process with `ERR_INVALID_STATE: Controller is already closed`. Under the
full API suite, later tests fail with `terminated` or `ECONNREFUSED`.

**Cause**

The `fetch-to-node` response bridge does not propagate Web Stream cancellation
as a Node response `close` event, so the MCP transport never clears its
keepalive timer. See upstream issue
[mastra-ai/mastra#20332](https://github.com/mastra-ai/mastra/issues/20332) and
fix PR [#20642](https://github.com/mastra-ai/mastra/pull/20642).

**Temporary workaround**

`pnpm build` runs `scripts/patch-mcp-stream-cancellation.mjs` after
`mastra build`. The script patches the generated response adapter with
cancellation guards and emits `close` so the inner MCP stream clears its timer.
It refuses to modify an unrecognized vulnerable adapter and becomes a no-op
when the upstream fix is detected. Remove the script and build hook after
#20642 is included in the published alpha.

## 11. Standalone agent threads omit working-memory viewer/editor

**Symptom**

On `mastra@1.27.3-alpha.1`, `/agents/:agentId/threads/:threadId` has no
Memory launcher, working-memory content panel, or "Edit Working Memory"
action. The overview still shows memory *configuration*, but users cannot
inspect or edit a thread's current working memory.

**Cause**

The standalone-thread redesign in upstream PR #22675 renders `ThreadSidebar`
and `AgentChat` from `pages/agents/agent/thread.tsx`, but does not render the
existing `MemorySidebar` component. See upstream issue
[mastra-ai/mastra#22762](https://github.com/mastra-ai/mastra/issues/22762).

**Smoke handling**

The two working-memory UI tests remain in `memory-threads.spec.ts` as explicit
skips linked to #22762, and `tests-ui/COVERAGE.md` marks both surfaces blocked.
Re-enable them when Studio restores a per-thread working-memory viewer/editor.

## 12. Standalone agent thread sidebar has no delete action

The thread redesign maps each persisted thread directly to a
`MainSidebar.NavLink` with no action menu or delete callback. The prior
`delete thread` action and confirmation dialog are therefore unavailable.
See [mastra-ai/mastra#22763](https://github.com/mastra-ai/mastra/issues/22763).

The delete-thread UI test remains as an explicit skip linked to #22763. Restore
it when the standalone sidebar supports deleting a thread again.
