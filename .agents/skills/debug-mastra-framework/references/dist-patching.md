# Patching the compiled dist for diagnostics

When a stack trace pinpoints a line in the compiled output but doesn't
tell you *what* the data looks like, patch the `.js` file in place with
`console.error` calls. The smoke server reads `.mastra/output/...`
directly — no rebuild needed for the patch to take effect, just restart
the server (which Playwright does between specs anyway).

## Where to patch

Two places matter, depending on what the bug is doing:

1. `.mastra/output/node_modules/@mastra/core/dist/chunk-*.js`
   — the framework code paths invoked at runtime.

2. `.mastra/output/node_modules/zod/...` (specifically `v3/types.js` or
   `v4/`)
   — when a zod internal throws and you need to see which key/validator
   is bad. zod has its own native code there; logging is fine.

You may also need to patch the corresponding files under
`./node_modules/@mastra/core/...` if the same code runs during tests
outside the bundled server (rare).

## How to patch

Pick a prefix you'll grep for — `[SMOKE_DBG]` is a good default since it
won't collide with anything else.

1. `view` the file at the reported line.
2. `string_replace_lsp` to insert one or more `console.error('[SMOKE_DBG] ...', ...)`
   calls before the offending statement.
3. Run the failing test (or whole suite) with output piped to a log:
   ```bash
   pnpm test 2>&1 | tee /tmp/smoke.log
   ```
4. `grep '\[SMOKE_DBG\]' /tmp/smoke.log | head -50`.

## What to log

The most useful things in a framework debug session:

- **Schema state** — `console.error('[SMOKE_DBG]', { vendor: schema?.['~standard']?.vendor, keys: Object.keys(schema?.shape ?? schema?._def?.shape?.() ?? {}), hasParse: typeof schema?._parse })`
- **Shape entries** when iterating — log each key and the validator
  type/version before calling into it.
- **Whether mutation has happened** — capture a marker before the
  suspect mutation (`schema._smoke_seen = true`) and check for the
  marker on the next request to confirm the same instance is reused.

## Don't

- Don't change behavior. Only `console.error`. Anything else, and you're
  no longer debugging the bug — you're debugging your patch.
- Don't commit the patch. Always revert before staging.
- Don't `pnpm install` after patching — pnpm hardlinks back to the
  global store and will silently undo your changes the next time
  dependencies are touched.
