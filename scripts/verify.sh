#!/usr/bin/env bash
# Push gate for the backend: every step must pass. See "Definition of done" in CLAUDE.md.
# Usage: npm run verify
set -uo pipefail
cd "$(dirname "$0")/.."

failed=()
step() {
  local name=$1; shift
  printf '\n▶ %s\n' "$name"
  if "$@"; then printf '✓ %s\n' "$name"; else printf '✗ %s\n' "$name"; failed+=("$name"); fi
}

contract_committed() {
  npm run -s openapi >/dev/null || return 1
  git diff --quiet -- openapi.json || {
    echo "openapi.json changed after regeneration — commit it with the code change"; return 1; }
}

step "typecheck" npx tsc --noEmit -p .
step "lint (no auto-fix)" npx eslint "src/**/*.ts"
step "formatting" npx prettier --check "src/**/*.ts"
step "tests" npx vitest run
step "OpenAPI contract up to date" contract_committed

if ((${#failed[@]})); then
  printf '\nVERIFY FAILED: %s\n' "${failed[*]}"; exit 1
fi
printf '\nVERIFY PASSED\n'
