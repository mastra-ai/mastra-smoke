---
name: extend-smoke-coverage
description: Add smoke-test coverage for a new Mastra feature, API route, or Studio UI surface. Use when the user asks to "add coverage for X", "write a smoke test for the new Y endpoint", "test the new Z page", when a Mastra release notes mention features not currently exercised, when investigating a regression that wasn't caught because there was no test for that path, or any time you are about to write or modify a `.test.ts` / `.spec.ts` file under `tests/` or `tests-ui/`. This skill explains where tests live (`tests/` API vs `tests-ui/` UI), how to register fixtures in `src/mastra/`, how to update the COVERAGE.md tracking docs so the suite reflects reality, the assertion patterns that are banned because they pass against garbage data, and the self-audit pass to run before committing.
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
- A user asking "what's new since the last alpha?" or "what should we
  add coverage for?" — jump to the **Discovering what's missing**
  section below before touching any files.
- A bug post-mortem revealing the smoke suite should have caught it.

## Discovering what's missing

When the user asks "what should we cover?" or "is anything new since
the last alpha?", don't guess from memory — diff the live truth.

### A. Diff the live API surface against existing tests

The smoke fixture exposes `GET /api/system/api-schema`, which returns
the full route catalog the running server actually serves. Compare it
against the routes already exercised:

```bash
# All routes the running server exposes (requires a built + running fixture)
pnpm build && pnpm dev &   # or however the fixture is up
curl -s http://localhost:4111/api/system/api-schema \
  | jq -r '.routes[] | "\(.method) \(.path)"' | sort -u > /tmp/server-routes.txt

# All routes referenced by current tests
grep -rhoE "'/api/[a-zA-Z0-9/_:{}-]+" tests | sort -u > /tmp/tested-routes.txt

# Routes the server has but tests never touch
comm -23 /tmp/server-routes.txt /tmp/tested-routes.txt | head -40
```

The leftover list is the candidate set. Skim it, group by route prefix,
match against `tests/COVERAGE.md`'s section table to decide if it's a
genuine gap or already covered indirectly (e.g. a `/:id` variant
covered by the list test).

### B. Diff Studio routes against existing UI specs

Studio's route table lives in `packages/playground/src/App.tsx` upstream.
Fetch it via the `debug-mastra-framework` recipe (single curl, no
clone):

```bash
SHA=$(gh api repos/mastra-ai/mastra/commits/main --jq '.sha')
curl -fsSL "https://raw.githubusercontent.com/mastra-ai/mastra/$SHA/packages/playground/src/App.tsx" \
  | grep -E "path:|<Route" > /tmp/studio-routes.txt

# Routes the UI specs visit
grep -rhoE "page\.goto\('/[a-zA-Z0-9/_-]+" tests-ui | sort -u > /tmp/tested-ui-routes.txt
```

Cross-reference — anything in Studio that no spec visits is a candidate.

### C. Scan recent upstream changesets

Changesets describe what's about to ship in the next alpha, named per
intent. They're the highest-signal source for "new feature landed":

```bash
gh api 'repos/mastra-ai/mastra/contents/.changeset?ref=main' \
  --jq '.[] | select(.name | endswith(".md")) | select(.name != "README.md") | .name' \
  | head -20

# Read any that look feature-shaped
gh api 'repos/mastra-ai/mastra/contents/.changeset/<file>.md?ref=main' \
  --jq '.content' | base64 -d
```

Filter for `feat(...)` / `fix(...)` lines that mention new endpoints,
new pages, new agent options, new processor kinds, etc. `chore` and
internal refactors usually don't need new smoke coverage.

### D. Scan recent commits since the last tested alpha

For a more exhaustive sweep:

```bash
# Find the sha of the alpha currently under test (see debug-mastra-framework SKILL step 3)
LAST_SHA="<resolved sha for the last green alpha>"

gh api "repos/mastra-ai/mastra/compare/$LAST_SHA...main" \
  --jq '.commits[] | "\(.sha[0:10]) \(.commit.message | split("\n")[0])"' \
  | grep -iE '^(.{10}) (feat|fix)\(' \
  | head -40
```

This shows every user-facing change between the last alpha we tested
and `main`. Inspect commit diffs (`gh api repos/mastra-ai/mastra/commits/<sha>`)
for any that add routes, components, or primitives.

### E. Triage what you find

Not everything new needs smoke coverage. Use this rubric:

| Kind of change                          | Add smoke coverage? |
|-----------------------------------------|---------------------|
| New `/api/*` route                      | Yes — API test |
| New Studio page or tab                  | Yes — UI spec |
| New required request/response field     | Yes — extend nearest existing test |
| New agent / tool / workflow primitive   | Yes — fixture + API test |
| New optional config flag (defaults safe)| Usually no — unless it changes a default code path |
| Internal refactor (no public surface)   | No |
| Doc / README change                     | No |
| Dependency bump                         | No (matrix covers it) |

When in doubt: if a regression here would silently break a published
alpha for users, add coverage. If a regression would surface as a
TypeScript build error before publish, skip it.

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

### 5a. Probe before you assert

Before writing any assertion, **run the endpoint once and capture the
real response.** Don't write assertions from memory or from what the
docs imply — assert against the actual bytes the server emits today.

Cheap, disposable workflow:

```ts
// tests/_probe.test.ts — write, run, delete. Do NOT commit.
import { describe, it } from 'vitest';
import { fetchJson } from './utils.js';

describe('probe', () => {
  it('embedders', async () => {
    const r = await fetchJson('/api/embedders');
    console.log('EMBEDDERS', r.status, JSON.stringify(r.data).slice(0, 800));
  });
});
```

```bash
pnpm test -- tests/_probe.test.ts 2>&1 | grep EMBEDDERS
rm tests/_probe.test.ts   # delete before committing
```

Then write the real test against the response shape you actually saw —
deterministic ids, exact error strings, full field-by-field structure.

### 5b. Banned assertion patterns

The whole point of smoke is to catch regressions. Weak assertions
defeat that — they pass against any reasonably-shaped garbage. Reviewers
(human and agentic) reject these patterns. If you find yourself writing
one, stop and ask "what does this actually prove?"

| ❌ Banned                                                              | ✅ Replace with |
|------------------------------------------------------------------------|----------------|
| `expect(typeof x).toBe('string')` as the only check                    | `expect(x).toBe('exact')` or `expect(x).toMatch(/substring/)` |
| `expect([200, 404, 500]).toContain(res.status)`                        | Pick the one correct status. If it's genuinely unstable, file a framework bug. |
| `expect(arr.length).toBeGreaterThan(0)` alone                          | Also assert one item's shape, and a deterministic id/value if available. |
| `expect(data).toBeDefined()` without drilling in                       | Walk the structure with explicit field assertions. |
| `expect(...).not.toThrow()` as the only assertion                      | Assert what the call returns or its observable side effect. |
| `try { ... } catch { /* swallow */ }` inside test bodies               | Let unexpected errors fail the test. Use `await expect(...).rejects.toThrow(/msg/)` for expected throws. |
| `fetchJson<any>(...)` in new code                                      | Type the response — missing fields fail at compile time. |
| Error-body asserted only as `typeof error === 'string'`                | Assert the message contains the unknown id, missing field, or operation that failed. |
| 400 body asserted without checking `issues[].field`                    | Validation responses carry structured `issues` — assert the offending field is named. |

Concrete examples from real smoke fixes:

```ts
// ❌ Was passing against literally any 4xx-or-5xx
expect([404, 500]).toContain(res.status);

// ✅ Exact status + the id appears in the message
expect(res.status).toBe(404);
expect(data.error).toMatch(/does-not-exist-smoke/);
```

```ts
// ❌ Passed even if `output` was empty or `usage` was missing fields
expect(typeof data.id).toBe('string');
expect(data.usage).toBeDefined();

// ✅ Proves the LLM actually produced text and the token math is internally consistent
const msg = data.output.find(o => o.type === 'message');
const text = msg.content.find(c => c.type === 'output_text');
expect(typeof text.text).toBe('string');
expect(text.text.length).toBeGreaterThan(0);
expect(data.usage.total_tokens).toBe(data.usage.input_tokens + data.usage.output_tokens);
```

### 5c. Self-audit before committing

After writing tests but **before** running the full suite, run a focused
self-audit. The cheapest way is a sub-agent pass with this exact prompt:

> Read these new test files: `<list of files>`. For each assertion, ask:
> "Would this still pass if the server returned empty, wrong, or
> structurally-similar-but-garbage data?" Flag every assertion that
> would pass against bad data. Check specifically for:
>
> - Bare `expect(typeof x).toBe(...)` as the only check on a field
> - `[a, b].toContain(status)` accepting multiple statuses
> - `length > 0` / `toBeDefined()` without follow-up shape assertions
> - `fetchJson<any>(...)` instead of a typed response
> - Error bodies asserted only as "is a string"
> - 400 responses without `issues[].field` checks
> - `try/catch` swallowing errors inside test bodies
>
> For each finding, name the file, line range, and a concrete tightened
> assertion.

Apply every flagged fix, then re-run the focused tests, then the full
suite. Commit only after the audit comes back clean.

This pass should also be run by reviewers on any smoke-coverage PR.

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
- **Don't ship weak assertions.** See section 5b. `typeof x === 'string'`,
  `[200, 500].toContain(status)`, `length > 0` alone, `toBeDefined()`
  without drill-down, and `fetchJson<any>` all pass against broken
  servers and are rejected in review.
- **Don't skip the self-audit** in section 5c. New test files get one
  pass over them before commit — that's the cheapest way to catch the
  assertion you wrote at 2am that proves nothing.
