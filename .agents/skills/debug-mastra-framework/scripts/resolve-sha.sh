#!/usr/bin/env bash
# Resolve a published @mastra/* version to the upstream commit sha that
# produced it. Uses GitHub's commit search to find the "Version Packages"
# commit that bumped this package to this version.
#
# Usage:
#   resolve-sha.sh @mastra/core 1.36.0-alpha.10
#
# Requires: gh, jq, curl
set -euo pipefail

PKG="${1:?package name required, e.g. @mastra/core}"
VERSION="${2:?version required, e.g. 1.36.0-alpha.10}"

# Map @mastra/foo → packages/foo (the convention for almost everything;
# adjust the table here for outliers).
PKG_DIR=""
case "$PKG" in
  @mastra/core)            PKG_DIR="packages/core" ;;
  @mastra/server)          PKG_DIR="packages/server" ;;
  @mastra/memory)          PKG_DIR="packages/memory" ;;
  @mastra/mcp)             PKG_DIR="packages/mcp" ;;
  @mastra/libsql)          PKG_DIR="stores/libsql" ;;
  @mastra/duckdb)          PKG_DIR="stores/duckdb" ;;
  @mastra/loggers)         PKG_DIR="loggers" ;;
  @mastra/schema-compat)   PKG_DIR="packages/schema-compat" ;;
  @mastra/observability)   PKG_DIR="packages/observability" ;;
  @mastra/client-js)       PKG_DIR="client-sdks/client-js" ;;
  mastra)                  PKG_DIR="packages/cli" ;;
  *)                       PKG_DIR="" ;;
esac

if [[ -z "$PKG_DIR" ]]; then
  echo "Unknown package mapping for $PKG — extend the case in resolve-sha.sh." >&2
  echo "Hint: search the repo with: gh search code '\"name\": \"$PKG\"' --repo mastra-ai/mastra" >&2
  exit 2
fi

echo "# Searching mastra-ai/mastra for the commit that published $PKG@$VERSION" >&2
echo "# (looking at $PKG_DIR/package.json on recent 'version packages' commits)" >&2

# Pull the 50 most recent version-packages commits and check each one's
# package.json at the relevant directory until we find the bump.
SHAS=$(
  gh search commits 'version packages' \
    --repo mastra-ai/mastra \
    --limit 50 \
    --json sha,commit \
    --jq '.[] | .sha'
)

for sha in $SHAS; do
  pkg_json=$(curl -fsSL \
    "https://raw.githubusercontent.com/mastra-ai/mastra/$sha/$PKG_DIR/package.json" \
    2>/dev/null || true)
  [[ -z "$pkg_json" ]] && continue
  this_version=$(echo "$pkg_json" | jq -r '.version // ""')
  if [[ "$this_version" == "$VERSION" ]]; then
    echo "$sha"
    exit 0
  fi
done

echo "No version-packages commit found for $PKG@$VERSION in the last 50 release commits." >&2
echo "Try widening the search or fall back to: gh search commits '\"$VERSION\"' --repo mastra-ai/mastra" >&2
exit 1
