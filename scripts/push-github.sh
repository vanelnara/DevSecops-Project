#!/usr/bin/env bash
# Fix CRLF and push to GitHub — run: bash scripts/push-github.sh
set -euo pipefail
cd "$(dirname "$0")/.."
find scripts -name "*.sh" -exec sed -i 's/\r$//' {} +
export GITHUB_TOKEN="${GITHUB_TOKEN:?Set GITHUB_TOKEN first}"
bash scripts/push-to-github.sh
