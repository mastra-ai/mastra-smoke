---
name: extend-smoke-coverage
description: Add smoke-test coverage for a new Mastra feature, API route, or Studio UI surface. Use when the user asks to "add coverage for X", "write a smoke test for the new Y endpoint", "test the new Z page", when a Mastra release notes mention features not currently exercised, or when investigating a regression that wasn't caught because there was no test for that path. This skill explains where tests live (`tests/` API vs `tests-ui/` UI), how to register fixtures in `src/mastra/`, how to update the COVERAGE.md tracking docs so the suite reflects reality, and the conventions to follow so new tests don't introduce flakes.
---

# extend-smoke-coverage

The smoke suite exists to catch regressions in published `@mastra/*`
alphas **before** they reach users. Coverage gaps are how regressions
slip through. When a new feature, endpoint, or Studio page lands, the
smoke suite needs to grow to match — otherwise the next alpha can break
it silently.

This skill is the playbook for adding that coverage cleanly.

## When to activate

Activate any time you need to add or update tests in response to:

- A new `/api/*` route, request shape, or response field landing upstream.
- A new Studio page, tab, or component.
- A new Mastra primitive (agent option, tool builder hook, workflow step
  kind, processor type, scorer kind, channel, schedule trigger, etc).
- A user asking "do we cover X?" — start here, answer from the COVERAGE
  docs, then add what's missing.
- A bug post-mortem revealing the smoke suite should have caught it.

## Mental model

There are exactly **three** files that change together for any coverage
addition. Skipping any one is a smell.

1. **The test file** — `tests/<area>/<feature>.test.ts` (Vitest, API) or
   `tests-ui/<area>/<feature>.spec.ts` (Playwright, UI).
2. **The fixture** (only if the feature needs server-side state) —
   register the agent/tool/workflow/etc in `src/mastra/<kind>/` and wire
   it into `src/mastra/index.ts`.
3. **The COVERAGE doc** — `tests/COVERAGE.md` for API, or
   `tests-ui/COVERAGE.md` for UI. Update the summary row count, add the
   feature to the right section, and bump the "last updated" date.

If you only touch (1), the suite grows but nobody can find what's
covered. If you only touch (3), the doc lies. If you only touch (2), the
fixture is dead code.

## Workflow

### 1. Find the right home

API tests live under `tests/` grouped by route prefix:

```
tests/agents/        →  /api/agents/*
tests/workflows/     →  /api/workflows/*
tests/memory/        →  /api/memory/*
tests/observability/ →  /api/observability/*
tests/stored/        →  /api/stored/*  (CRUD for stored entities)
tests/schedules/     →  /api/schedules/*
...
```

UI tests live under `tests-ui/` grouped by Studio route:

```
tests-ui/agents/        →  /agents/*
tests-ui/workflows/     →  /workflows/*
tests-ui/observability/ →  /observability/*
tests-ui/cms/           →  /cms/*
...
```

If the new feature doesn't fit an existing group, create a new
directory. Name it after the route prefix or Studio section, not the
ticket / PR.

### 2. Decide: API, UI, or both?

| Surface          | Test type | Why |
|------------------|-----------|-----|
| New REST endpoint | API only  | Status code, response shape, error paths |
| New Studio page  | UI only   | Heading, key controls, no console errors |
| Full feature (server + UI) | **Both** | API covers contract, UI covers wiring |

Default to **API-first**: API tests are fast, deterministic, easy to
debug. Add UI only when the feature is user-visible in Studio.

### 3. Check if the fixture already supports it

Before adding fixtures, grep what's already registered:

```bash
grep -r "name: '" src/mastra/agents src/mastra/tools src/mastra/workflows
cat src/mastra/index.ts | head -80   # see what's wired into Mastra
```

Reuse existing fixtures whenever possible (e.g. `test-agent`,
`calculator`, `helper-agent`). New fixtures cost server startup time and
DB rows on every run.

### 4. Add the fixture only if needed

If the new feature requires server-side state (a new tool kind, a new
workflow shape, a scorer that exercises a code path nothing else hits),
add it under `src/mastra/<kind>/` and export from
`src/mastra/<kind>/index.ts`. Then wire it into `src/mastra/index.ts`'s
`new Mastra({ ... })` call.

Keep fixtures **minimal**:
- Simplest possible schema that triggers the code path.
- No real LLM calls in fixtures (the `test-agent` reuses `gpt-4o-mini`
  via OpenAI; reuse it instead of adding a new model).
- No `setInterval`, no every-second cron, no background timers (see
  `KNOWN_ISSUES.md` — the scheduler race we already burned days on).

### 5. Write the test

**API (Vitest):**

```ts
import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

describe('<feature> — <surface>', () => {
  it('GET /api/<route> returns <expected shape>', async () => {
    const { status, data } = await fetchJson<any>('/api/<route>');
    expect(status).toBe(200);
    expect(data).toMatchObject({ /* minimum invariants */ });
  });

  it('GET /api/<route>/:id returns a structured 404 for unknown id', async () => {
    const res = await fetchApi('/api/<route>/does-not-exist-smoke');
    expect(res.status).toBe(404);
  });
});
```

**UI (Playwright):**

```ts
import { test, expect } from '@playwright/test';

test.describe('<Feature>', () => {
  test('<page> renders without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/<route>');
    await expect(page.getByRole('heading', { name: /<feature>/i })).toBeVisible();

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
```

Conventions that have paid off:
- **`fetchApi` / `fetchJson`** from `tests/utils.ts` — never use raw `fetch`.
- **`page.on('pageerror')`** in every UI spec — catches the bugs that
  visible-element assertions miss.
- **Assert minimum invariants**, not full deep-equals. Upstream is free
  to add fields; the suite should not break on additive changes.
- **`/<route>` 404 on unknown id** — always include a negative case.
- **Use `helpers.ts` (UI)** — `fillAndSend`, `waitForAssistantMessage` —
  for any chat interaction. Don't reinvent input timing.
- **No `setTimeout` in tests**. Use Playwright/Vitest waiting primitives.
- **Tag LLM-touching tests with `@llm`** so the matrix-level retry budget
  applies (see `playwright.config.ts` / `vitest.config.ts`).

### 6. Run the test locally before committing

```bash
# API
pnpm build && pnpm test -- tests/<area>/<feature>.test.ts

# UI
pnpm build:studio && pnpm test:ui -- tests-ui/<area>/<feature>.spec.ts

# Both, full suite (don't skip — order-dependent bugs are real here)
pnpm build:studio && pnpm test:all
```

If your new test passes alone but the full suite fails, you've hit
either (a) a fixture collision (your fixture clashes with another) or
(b) an upstream framework bug exposed by the new code path. Check
`KNOWN_ISSUES.md` and the `debug-mastra-framework` skill.

### 7. Update COVERAGE.md

Open `tests/COVERAGE.md` and/or `tests-ui/COVERAGE.md` and:

1. **Bump the header**: `> N tests across M test files — last updated YYYY-MM-DD`.
2. **Find the right section row** in the Summary table; bump its count
   and update the Notes column if the addition is non-obvious (new
   endpoint, new gating, NEW marker for net-new sections).
3. **Bump the Total**.
4. **For API**: update the "Coverage by `/api/*` route group" cross-ref
   table if you added a new route prefix.
5. **For UI**: if you added a new Studio surface, note it in the section
   row.

If your addition uncovers something previously listed as 🔒 (blocked),
flip it to ✅ and remove the Notes blocker.

### 8. Sanity-check the diff

Before committing:

```bash
git diff --stat
# Expected: 1 test file (+), maybe 1-2 src/mastra files (+/M), 1-2 COVERAGE.md (M)
```

If you see changes to `playwright.config.ts`, `vitest.config.ts`,
`smoke.yml`, or `KNOWN_ISSUES.md`, stop and re-justify — those usually
shouldn't move when adding coverage. Carve them into a separate commit
with reasoning if they're truly needed.

## What NOT to do

- **Don't add tests for behavior that isn't published yet.** Smoke runs
  against `@mastra/*@alpha` — testing unreleased features makes the
  matrix fail until the alpha catches up.
- **Don't add fixtures "just in case".** Every fixture costs server
  startup time and migration rows. Reuse before adding.
- **Don't deep-equal whole response bodies.** Upstream adds fields all
  the time. Match the minimum shape.
- **Don't bump COVERAGE.md numbers without running `pnpm test`.** The
  count in the doc must match the actual test count.
- **Don't skip the negative test (404 / 4xx).** A regression that flips
  a 404 to a 500 is exactly what smoke is for.
- **Don't introduce real-time triggers** (`setInterval`, every-second
  cron, watch loops) — see `KNOWN_ISSUES.md` section 1. They poison the
  suite for everyone.
- **Don't add a UI test without `page.on('pageerror', ...)`.** Visible
  assertions miss silent client-side throws; the pageerror listener is
  the only reliable canary.
- **Don't skip the full-suite run.** Single-file passes don't catch
  order-dependent or schema-poisoning regressions.
