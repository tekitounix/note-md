#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_ai_ops() {
  if python3 -c 'import ai_ops' >/dev/null 2>&1; then
    python3 -m ai_ops "$@"
    return
  fi

  local sibling_ai_ops="$repo_root/../ai-ops"
  if [[ -d "$sibling_ai_ops/ai_ops" ]]; then
    PYTHONPATH="$sibling_ai_ops${PYTHONPATH:+:$PYTHONPATH}" python3 -m ai_ops "$@"
    return
  fi

  echo "ERROR: ai-ops が見つかりません。PATH へ導入するか、note-md の sibling に ai-ops checkout を置いてください。" >&2
  return 1
}

echo "==> npm ci"
npm ci

echo "==> lint"
npm run lint

echo "==> format check"
npm run format:check

echo "==> typecheck"
npm run typecheck

echo "==> test"
if [[ "$(uname -s)" == "Linux" ]] && command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a npm test
else
  npm test
fi

echo "==> package"
npm run package

echo "==> packaged file list"
vsce_listing="$(npx --no-install vsce ls)"
printf '%s\n' "$vsce_listing"

required_packaged_files=(
  "package.json"
  "README.md"
  "LICENSE"
  "dist/extension.js"
  "dist/resvg.wasm"
  "dist/webp_dec.wasm"
  "media/icon-marketplace.png"
  "docs/format-reference.md"
  "docs/third-party-notices.md"
)
for required in "${required_packaged_files[@]}"; do
  if ! grep -Fxq "$required" <<<"$vsce_listing"; then
    echo "ERROR: VSIX 同梱対象に必要なファイルがありません: $required" >&2
    exit 1
  fi
done

for forbidden in '^src/' '^test/' '^test-workspace/' '^scripts/' '^plans/' '^\.ai-ops/' '^\.claude/' '^AGENTS\.md$'; do
  if grep -Eq "$forbidden" <<<"$vsce_listing"; then
    echo "ERROR: VSIX に同梱すべきでないファイルが含まれています: $forbidden" >&2
    exit 1
  fi
done

if command -v shellcheck >/dev/null 2>&1; then
  echo "==> shellcheck"
  shellcheck scripts/check.sh
else
  echo "==> shellcheck (skip: command not found)"
fi

if command -v actionlint >/dev/null 2>&1; then
  echo "==> actionlint"
  actionlint .github/workflows/*.yml
else
  echo "==> actionlint (skip: command not found)"
fi

echo "==> ai-ops harness audit"
run_ai_ops audit harness --path "$repo_root" --strict

echo "==> ai-ops structure audit"
run_ai_ops audit structure --path "$repo_root"

echo "==> ai-ops lifecycle audit"
run_ai_ops audit lifecycle --path "$repo_root" --project-type external

echo "==> ai-ops docs audit"
run_ai_ops audit docs --path "$repo_root" --json

echo "==> ai-ops language audit"
run_ai_ops audit language --path "$repo_root" --strict-ja --changed-only

echo "==> ai-ops security audit"
run_ai_ops audit security --path "$repo_root" --scope changed

echo "==> ai-ops ci audit"
run_ai_ops audit ci --path "$repo_root" --json

echo "==> diff check"
git diff --check

echo "OK"
