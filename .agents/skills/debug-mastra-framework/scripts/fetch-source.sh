#!/usr/bin/env bash
# Fetch a single source file from mastra-ai/mastra at a given sha.
#
# Usage:
#   fetch-source.sh <sha> <path/within/repo>
#   fetch-source.sh bf6c2a5 packages/core/src/tools/tool-builder/builder.ts
#
# Prints the file contents to stdout. Pipe into a file or pipe straight
# into the view tool's path argument.
set -euo pipefail

SHA="${1:?sha required (use resolve-sha.sh to get one)}"
SRC_PATH="${2:?repo-relative path required, e.g. packages/core/src/foo.ts}"

URL="https://raw.githubusercontent.com/mastra-ai/mastra/${SHA}/${SRC_PATH}"

if ! curl -fsSL "$URL"; then
  echo "" >&2
  echo "Failed to fetch $URL" >&2
  echo "Check the path exists at that sha: https://github.com/mastra-ai/mastra/tree/${SHA}/${SRC_PATH%/*}" >&2
  exit 1
fi
