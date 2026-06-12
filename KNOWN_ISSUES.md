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
`expect(page).toHaveURL(/\/chat\/(?!new)/)`. The URL never transitions
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

## 7. Edit Dataset dialog never unmounts after dismissal (awaiting upstream fix)

**Symptom**

On `mastra@1.13.0-alpha.4` Studio, the dataset detail "Edit Dataset"
dialog stays fully rendered on screen after Close, Cancel, or Escape.
Base UI marks it `data-closed` + `data-ending-style`, the
`dialog-content-out` animation runs to completion, but the element is
never removed — opacity returns to 1 and the dialog visually persists.
Confirmed both in Playwright and in a hand-driven agent-browser session
(screenshot 3s after Cancel still shows the dialog). Saving works: the
PATCH lands and the dataset updates; only the dismissal is broken.

**Workaround**

`datasets.spec.ts › edit dataset name and description` asserts
`toHaveAttribute('data-closed', '')` (logical close) instead of
`not.toBeVisible()` (unmount) until the upstream fix lands. Revert to
the unmount assertion once fixed.
