#!/usr/bin/env bash
# Last-resort: clone mastra-ai/mastra next to the smoke repo for local
# source-level debugging / building a patched core.
#
# Use this only when steps 1-7 of SKILL.md aren't enough — i.e. you need
# to modify framework source and produce a tarball to install into the
# smoke fixture.
#
# Usage:
#   clone-upstream.sh           # clones to ../mastra (default)
#   clone-upstream.sh /path/to  # clones to /path/to/mastra
set -euo pipefail

SMOKE_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEST_PARENT="${1:-$(dirname "$SMOKE_ROOT")}"
DEST="$DEST_PARENT/mastra"

if [[ -d "$DEST" ]]; then
  echo "Upstream clone already exists at: $DEST" >&2
  echo "  cd $DEST && git fetch origin && git checkout main && git pull" >&2
  exit 0
fi

echo "Cloning mastra-ai/mastra to $DEST ..." >&2
git clone --depth 200 https://github.com/mastra-ai/mastra.git "$DEST"

cat <<EOF >&2

Done. Next steps for building a patched @mastra/core:

  cd "$DEST"
  pnpm install
  # ... edit packages/core/src/... ...
  pnpm --filter @mastra/core build:lib
  cd packages/core && pnpm pack

  # Then in the smoke fixture (a different directory):
  cd "$SMOKE_ROOT"
  cp "$DEST/packages/core/mastra-core-*.tgz" /tmp/
  # Overlay onto the bundled output (the smoke flow uses .mastra/output):
  cp -r "$DEST/packages/core/dist/"* \
        ./.mastra/output/node_modules/@mastra/core/dist/
  # Re-run tests:
  pnpm test

Do NOT \`pnpm install\` the tarball into the smoke fixture's package.json
— it pulls workspace: deps that don't exist outside the upstream monorepo.
Overlay the built dist/ directly instead, as shown above.
EOF
