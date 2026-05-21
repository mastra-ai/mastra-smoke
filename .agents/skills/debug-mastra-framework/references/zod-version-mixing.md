# Zod v3 ↔ v4 schema mixing in @mastra/core

The smoke suite tests against both `zod ^3.25.x` and `zod ^4.x`. Mastra
supports both, but the framework internals routinely import from
`zod/v4` for things like processor schemas and the `_background`
override. When a user-supplied schema is built with `zod/v3` and the
framework `.extend()`s or `.merge()`s a `zod/v4` child into it (or vice
versa), the resulting object's `_parse` chain crashes:

```
TypeError: keyValidator._parse is not a function
  at ZodObject._parse (.../zod/v3/types.js:1961)
  at safeValidate (.../@mastra/core/dist/chunk-XXXX.js)
  at validateToolInput (...)
```

(`_parse` is a zod v3 internal; zod v4 renamed/moved internals to
`_zod`/`.def`/`.parse()`. Any cross-version splice fails.)

## CI-only? Usually.

These bugs are often invisible on macOS but lethal on CI Linux. Reason:
pnpm hoists differently. On Mac, `bare-zod` may resolve to the
`zod@4.x` package whose v3 entrypoint is a compat shim that exposes
both old and new internals. On Linux, the resolver may hoist a pure
`zod@3.x` install that has no v4 compat layer.

If a test passes locally but fails in CI on the zod-3 matrix leg only,
suspect this class of bug first.

## Reproducing locally

```bash
# in the smoke fixture
cd e2e-tests/smoke   # or repo root if mastra-smoke standalone
sed -i.bak 's/"zod": "[^"]*"/"zod": "3.25.76"/' package.json
rm -rf node_modules pnpm-lock.yaml .mastra/output
pnpm install --ignore-workspace --no-frozen-lockfile
pnpm build:studio

# Force bare `zod` inside the bundled output to point at the pure v3.
# This mimics the CI Linux hoist.
cd .mastra/output/node_modules
rm zod
ln -s .pnpm/zod@3.25.76/node_modules/zod zod
cd -

pnpm test
```

Restore with `mv package.json.bak package.json && rm -rf node_modules pnpm-lock.yaml && pnpm install` when done.

## Where the framework usually splices versions

Known sites (from past investigations):

- **`packages/core/src/tools/tool-builder/builder.ts`** — `CoreToolBuilder`
  injects `_background` and `_resume` overrides via `originalSchema.extend(...)`.
  Both override schemas were built with `zod/v4`. Fixed in
  `mastra-ai/mastra#16915` by routing through JSON-Schema instead.
- **`packages/core/src/processors/processors/structured-output.ts`** —
  internal structuring agent's schema flow.
- **Any `applyCompatLayer` consumer** that returns AI-SDK `Schema`s
  rather than zod objects.

## Diagnostic recipe

1. Confirm matrix-specificity: does the bug only hit `zod 3` matrix in CI?
2. Reproduce locally with the recipe above.
3. Patch `zod@3.x/v3/types.js` `ZodObject._parse` at the `keyValidator._parse`
   call site to log the offending key and the validator's vendor/structure
   (see `dist-patching.md`).
4. Run the failing test, grep `[SMOKE_DBG]` — you'll see the key that's
   wrong (e.g. `_background`) and that its validator has `_zod` but no
   `_parse`, identifying it as a zod v4 object embedded in a v3 shape.
5. Search upstream for where that key is injected:
   ```bash
   gh search code "'<key_name>':" --repo mastra-ai/mastra
   ```
6. Identify the file + line that does `.extend(...)` with a v4 schema,
   propose a fix that routes through JSON Schema (the codebase's
   canonical schema-interop layer).
