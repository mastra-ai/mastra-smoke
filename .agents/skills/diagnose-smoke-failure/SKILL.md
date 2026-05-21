---
name: diagnose-smoke-failure
description: Diagnose a failing Mastra smoke-test run when tagged on the failure thread in Slack (the channel running `mastra-ai/mastra-smoke`). Use this when you see a Slack message containing the literal token `SMOKE_FAILURE_CONTEXT` in a thread you've been mentioned in, when the user asks you to "debug this smoke run" / "look at the failure" / "diagnose this red build", or when a smoke-channel message links to a `github.com/mastra-ai/mastra-smoke/actions/runs/<id>` URL and asks for help. This skill teaches you how to parse the structured context block the smoke reporter posts, fetch the run artifacts via `gh run download`, triage the failure into one of three buckets (smoke-fixture bug / upstream `@mastra/*` regression / flake), decide the right action (open a smoke PR / open an upstream PR / file an upstream issue / reply that it's a flake), and post a single in-thread reply with the verdict.
---

# diagnose-smoke-failure

You've been tagged in a Slack thread on a failing run of the `mastra-ai/mastra-smoke` suite. Your job: figure out what broke, decide who should fix it, take the action that gets it fixed, and reply once in-thread with the verdict.

You have:
- Full Slack read/write (post replies in the failure thread).
- GitHub access to `mastra-ai/mastra-smoke` AND `mastra-ai/mastra`. You can open PRs, file issues, and comment.
- A working `gh` CLI.
- The `debug-mastra-framework` skill — **load it** when the trigger is an upstream framework bug.

You do **not** have a long-running shell on a hosted box, but you can clone repos and run commands inside the PR/CI environments you spawn.

## Step 1 — Parse the context block

The smoke reporter posts a thread reply on every failing run that looks like this:

```
SMOKE_FAILURE_CONTEXT
  repo: mastra-ai/mastra-smoke
  run_id: 26999999999
  run_url: https://github.com/mastra-ai/mastra-smoke/actions/runs/26999999999
  artifact_name: smoke-test-results-zod3
  npm_tag: alpha
  zod_version: 3.25.76
  packages_under_test: @mastra/core@1.36.1-alpha.0, @mastra/libsql@0.21.0, ...
  fetch_artifacts: |
    gh run download 26999999999 --repo mastra-ai/mastra-smoke --name smoke-test-results-zod3
  failures:
    - source: API
      file: tests/agents/agent-tools.test.ts
      title: "agent-tools should call calculator tool"
      error: "keyValidator._parse is not a function"
    - ...
  flakes:
    - source: UI
      file: tests-ui/stream-memory.spec.ts
      title: "..."
      retries: 1
END_SMOKE_FAILURE_CONTEXT
```

Scroll up the thread (or read the parent message) to find this block. If you can't find it after looking at the parent message + first ~10 replies, **stop and post in-thread**: "I can't find a `SMOKE_FAILURE_CONTEXT` block in this thread — was this an older run before the reporter added it? Link me to the run URL and I'll fetch artifacts manually."

## Step 2 — Pull artifacts

Run the `fetch_artifacts` command from the context block verbatim. It downloads:

- `reports/api-junit.xml` and/or `reports/ui-junit.xml` — full failure messages including stack traces.
- `reports/api-results.json` and/or `reports/ui-results.json` — same data, structured.
- `test-results/**/video.webm` (UI only) — playback of the failing browser session.
- `test-results/**/trace.zip` (UI only) — Playwright trace for time-travel debugging.

The error strings in the context block are truncated to ~240 chars. The full stack traces live in the JUnit files. **Always read the JUnit, not just the context block.**

## Step 3 — Triage into one of three buckets

For each failure, decide which bucket it belongs to. Failures in the same run can land in different buckets — diagnose each one independently.

### Bucket A: Smoke fixture bug

Symptom: the test is wrong, the fixture is wrong, an assertion is too tight, or a route changed upstream and the test wasn't updated.

Tell-tale signs:
- Stack trace stops inside `tests/` or `tests-ui/` — no `node_modules/@mastra/*` frames.
- Error is an `expect(...)` mismatch on a shape that recently changed upstream (check recent changesets in `mastra-ai/mastra/.changeset/*.md`).
- Test is asserting on a hardcoded port, version, or default that changed.

Action: open a PR in `mastra-ai/mastra-smoke` that fixes the test. Title format: `fix(smoke): <one-line summary>`. Always reference the run URL in the PR body.

### Bucket B: Upstream `@mastra/*` regression

Symptom: a framework bug shipped in the alpha under test. The smoke fixture is correct.

Tell-tale signs:
- Stack trace dives into `node_modules/@mastra/*` or `.mastra/output/*`.
- Error matches one of the known framework footguns (see `debug-mastra-framework` SKILL — `keyValidator._parse`, `SQLITE_ERROR mastra_*`, `"Background task started"` returned as a tool result, etc.).
- Failure only appears on one matrix leg (zod 3 vs zod 4) — strong tell for version-mixing bugs.
- Tests pass in isolation but fail under full-suite load.

Action: **load the `debug-mastra-framework` skill**. It tells you how to map the published alpha back to an upstream commit SHA, fetch the source, identify the root cause, and produce a fix.

Then:
- If the root cause is clear AND you can write the fix: open a PR against `mastra-ai/mastra`. Title: `fix(<package>): <one-line>`. Body: explain the regression, link the smoke run URL, paste the failing test names and the minimal repro. Add a `.changeset/*.md` entry.
- If the root cause is clear but the fix is uncertain or larger than a one-file change: file an **issue** in `mastra-ai/mastra` instead of a PR. Title: `<package>: <symptom>`. Body: same content as the PR body would have had, plus a "Proposed fix" section the maintainers can react to.
- If a matching upstream issue already exists (search before filing): comment on it with the new smoke run URL and the matrix leg that hit it. Do not file a duplicate.

### Bucket C: Flake

Symptom: LLM tail-latency, transient network failure, or a known-flaky UI spec.

Tell-tale signs:
- Test is tagged `@llm` (search the test file for the tag).
- Error is a timeout, a Playwright `expect.poll` retry exhaustion, or an OpenAI 5xx.
- Run-only failure — re-running the same test on the same alpha passes.
- The test also appears in the `flakes:` section of the context block (Playwright retry-then-pass).

Action: do **not** open a PR. Reply in-thread: "Looks like a flake — `<test name>` is tagged `@llm` and the error is a tail-latency timeout. No action needed unless this becomes recurring (≥3 runs in a week)."

If you suspect it's a *new* class of flake (not LLM tail-latency, not a known footgun), say so and suggest the user re-run the workflow once before declaring it green.

### Tie-breaker

If you can't decide between A and B, **re-read the stack trace**. The deepest non-test frame tells you who owns the bug:
- Deepest frame in `node_modules/@mastra/*` → Bucket B.
- Deepest frame in `tests/` or `tests-ui/` → Bucket A.
- Both? Look at *which side made the broken assumption*: a smoke test calling an endpoint that no longer exists is A; an endpoint that exists but returns wrong data is B.

## Step 4 — Take the action

Open exactly one PR/issue per failing surface (one PR can cover multiple related failures). Do **not** spam the upstream repo with one PR per failing test.

PR/issue body MUST include:

1. A one-paragraph summary of the failure mode.
2. The smoke run URL.
3. The exact failing test name(s) and file path(s).
4. The relevant excerpt from the stack trace (not the full thing — the deepest 5-10 frames).
5. The matrix leg (zod version, npm tag, package versions under test) — copy this verbatim from the context block.
6. For PRs: a "Verification" section explaining how the smoke suite proves the fix.

If you opened an upstream PR or issue, also add a comment on it that says `tracked-by: <smoke run URL>` so the maintainers can find the original red run.

## Step 5 — Reply once in-thread

Post **one** reply in the Slack thread you were tagged in. Keep it short. Template:

```
Triaged this run:

• <failure 1 short name> → <bucket> · <link to PR / issue / "flake — no action">
• <failure 2 short name> → ...

<one-paragraph summary of what's going on, if non-obvious>
```

Do not post intermediate progress updates. Do not post your shell commands. The thread is for humans — they want one verdict, not a play-by-play.

If you need to ask the humans something (e.g. "I think this is bucket B but I want to confirm before opening an upstream PR — should I?"), ask it in-thread as a question, not as a statement. One question per reply.

## Anti-patterns

- **Don't open a PR before reading the JUnit file.** The context block is a summary; the truth is in the artifact.
- **Don't open both a PR and an issue for the same failure.** Pick one.
- **Don't ignore the `flakes:` section.** A flake mentioned in the context block is sometimes the root cause of a "downstream" failure in the same run (test ordering, server contention).
- **Don't re-run the suite to "see if it's flaky" without saying so.** If you trigger a re-run, post in-thread first: "Re-running to confirm it's not a flake — will report back when it finishes."
- **Don't load `debug-mastra-framework` for bucket A or C failures.** It's only for bucket B.
- **Don't open speculative fixes.** If you don't know what's wrong, file an issue. A "maybe this works" PR wastes a maintainer's review cycle.

## Worked example

You're tagged on a thread. Parent message says "🔴 Smoke Tests (tag: alpha • zod: 3.25.76) — 10 failed". The context block lists 10 failures, all with the same error `keyValidator._parse is not a function`, all in tests that execute tools.

1. Parse: zod=3.25.76, `@mastra/core@1.36.1-alpha.0`, 10 failures in agent-tools/generate/stream/tool-approval tests.
2. Fetch: `gh run download <id> --repo mastra-ai/mastra-smoke --name smoke-test-results-zod3`.
3. Read `reports/api-junit.xml`: every stack trace goes `ZodObject._parse` → `safeValidate` → `validateToolInput` → `Tool.execute`. All frames after the test code are in `node_modules/@mastra/core/dist/`.
4. Triage: Bucket B — same error string, all matrix-leg-specific (zod 3 only), stack ends in `@mastra/core`. Known footgun pattern from `debug-mastra-framework`.
5. Load `debug-mastra-framework`, follow it to identify the `CoreToolBuilder` `_background` injection mixing zod v3/v4 schemas (commit `<sha>` in `packages/core/src/tools/tool-builder/builder.ts`).
6. Open PR against `mastra-ai/mastra` titled `fix(core): inject _background override via JSON Schema, not Zod v4 .extend()`. PR body: summary, run URL, all 10 failing tests, deepest-frame excerpt, matrix leg, verification (`pnpm test` passes with the patch). Add `.changeset/grumpy-planes-count.md`.
7. Reply in-thread:
   ```
   Triaged this run:

   • All 10 tool-execution failures → upstream regression · mastra-ai/mastra#16915

   `CoreToolBuilder` injects `_background` using zod v4 `.extend()`, which corrupts user tool schemas built with zod v3. CI Linux hoists bare `zod` to 3.25.76 (vs Mac to 4.3.6), so the bug only fires on the zod-3 matrix leg. Fix submitted.
   ```

That's the loop. One thread reply per tag; one action per failure mode; never speculate.
