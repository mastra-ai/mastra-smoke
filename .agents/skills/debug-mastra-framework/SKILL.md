---
name: debug-mastra-framework
description: Debug bugs inside the @mastra/* packages from the smoke suite. Use when a smoke test fails with a stack trace pointing at node_modules/@mastra/* or .mastra/output/*, when you see framework-specific error strings (keyValidator._parse, SQLITE_ERROR mastra_*, "Background task started" instead of a tool result, "Tool not found" 500s, ZodObject._parse crashes), or when the user asks to investigate a regression in the published alpha. This skill teaches you how to map a published version back to upstream source, fetch and grep the original TypeScript, instrument the compiled dist for diagnostic logging, and (only when needed) clone the upstream repo locally to build a patched core.
---

# debug-mastra-framework

The smoke suite intentionally has **no source-code access** to
`mastra-ai/mastra`. When a published alpha regresses, you debug from the
outside in: stack trace → compiled dist → upstream TypeScript via GitHub
APIs → (optional) patched local build. This skill is the playbook.

Do **not** clone the upstream repo on the first pass. Most regressions
are diagnosable with just `view node_modules/.../dist/*.js` plus a
targeted `gh search code`. Cloning is a last resort.

## When to activate

Activate as soon as any of these appear:

- Stack trace mentions `@mastra/core`, `@mastra/server`, `@mastra/memory`,
  `@mastra/libsql`, `@mastra/duckdb`, `@mastra/mcp`, etc.
- Error text matches a known framework footgun:
  - `keyValidator._parse is not a function` → zod v3/v4 mixing
  - `SQLITE_ERROR: no such table: mastra_*` → init/migration race
  - `"Background task started. Task ID: …"` returned instead of a tool result → background-task injection
  - `"Tool not found"` 500s under load
  - `consumeStream error` against `mastra_workflow_snapshot`
- Tests pass in isolation but fail under full-suite load.
- A regression appears only on one matrix leg (zod 3 vs zod 4, Linux vs Mac).

## Workflow

### 1. Identify the failing package and version

```bash
cat package.json | grep '"@mastra/'   # repo declares "alpha" or "latest"
cat .mastra/output/package.json       # bundled resolution after build
ls .mastra/output/node_modules/@mastra/
cat .mastra/output/node_modules/@mastra/core/package.json | grep '"version"'
```

Pin down the exact version that crashed (e.g. `@mastra/core@1.36.0-alpha.10`).

### 2. Read the stack trace against the compiled dist

The smoke suite ships compiled `.js` chunks, not TypeScript. Stack frames
point at `.mastra/output/node_modules/@mastra/core/dist/chunk-XXXX.js`
or similar. Read them:

```bash
view .mastra/output/node_modules/@mastra/core/dist/chunk-6FFXBNBE.js  # offset/limit to the reported line
```

Search the dist for the failing function name to find every call site:

```bash
search_content 'validateToolInput' .mastra/output/node_modules/@mastra/core/dist
```

### 3. Map version → upstream sha

Run `scripts/resolve-sha.sh <package> <version>`:

```bash
.agents/skills/debug-mastra-framework/scripts/resolve-sha.sh @mastra/core 1.36.0-alpha.10
# prints commit sha that published this version, e.g. 9c8870195b
```

The script reads npm metadata (`gitHead`) and falls back to scanning
recent `mastra-ai/mastra` commits for the matching changeset.

### 4. Fetch original TypeScript by path

Once you have a sha, fetch the upstream source for any file:

```bash
.agents/skills/debug-mastra-framework/scripts/fetch-source.sh \
    9c8870195b packages/core/src/tools/tool-builder/builder.ts \
    > /tmp/builder.ts
view /tmp/builder.ts
```

This uses `raw.githubusercontent.com` — single HTTP fetch, no clone.

### 5. Search upstream code

Use `gh search code` to grep across `mastra-ai/mastra` without cloning:

```bash
gh search code 'keyValidator._parse' --repo mastra-ai/mastra --limit 20
gh search code 'backgroundOverrideZodSchema' --repo mastra-ai/mastra
```

Or browse a directory:

```bash
gh api repos/mastra-ai/mastra/contents/packages/core/src/tools/tool-builder?ref=<sha>
```

### 6. Instrument the dist for diagnostics

When the stack trace doesn't pinpoint the mutation site, patch the
compiled chunk **in place** with `console.error` logging. Always log to
a distinctive prefix (e.g. `[SMOKE_DBG]`) so you can grep server output.

See `references/dist-patching.md` for the recipe (find the line, edit
with `string_replace_lsp`, rebuild is **not** needed — `.mastra/output`
runs the patched code directly on next server start).

After patching:

```bash
pnpm test 2>&1 | tee /tmp/smoke-run.log
grep SMOKE_DBG /tmp/smoke-run.log | head -50
```

Always undo the patches before committing.

### 7. Reproduce in isolation if possible

If the bug looks self-contained:

```bash
mkdir /tmp/repro && cd /tmp/repro
pnpm init && pnpm add @mastra/core@<version> zod@<version>
# write a minimal script exercising the suspect API
node repro.mjs
```

If the bug only reproduces inside the full HTTP server + Playwright
suite (race condition, request ordering, schema mutation across
requests), document that explicitly — don't waste cycles chasing a
Node-only repro that can't exist.

### 8. Escalate to local clone (last resort)

Only clone when:
- You need to **modify** core source and rebuild to verify a fix.
- You need to run the upstream test suite.
- You need to bisect commits between alphas.

```bash
.agents/skills/debug-mastra-framework/scripts/clone-upstream.sh
# clones mastra-ai/mastra into ../mastra and prints the next steps
# (cd into it, install, pnpm --filter @mastra/core build:lib, pack, install into smoke)
```

The script does **not** assume any particular working tree layout — it
clones to a sibling directory of the smoke repo and leaves it untouched.

## Known matrix-specific footguns

See `references/zod-version-mixing.md` for the zod 3 ↔ zod 4 schema
mixing class of bugs (the most common framework regression we hit, since
the smoke suite tests against both major versions).

## What NOT to do

- Don't `pnpm install` an unrelated local checkout into the smoke
  fixture — it'll resolve workspace protocols and break the bundle.
- Don't commit dist patches. They're diagnostic-only.
- Don't file an upstream issue until you can either (a) point at a
  specific source line in `mastra-ai/mastra` or (b) attach a minimal
  reproduction. "Smoke fails on alpha.N" without diagnosis wastes
  framework-team time.
- Don't assume CI = local. Pnpm hoists differently on Linux; bare
  imports (notably `zod`) can resolve to different versions. If a bug
  is CI-only, the next thing to suspect is dependency resolution, not
  test code.
