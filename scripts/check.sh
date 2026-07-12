#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

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
  "dist/cli.js"
  "dist/webview-vendor.js"
  "dist/webview-mermaid.js"
  "dist/highlight.css"
  "dist/katex.css"
  "dist/fonts/KaTeX_Main-Regular.woff2"
  "dist/resvg.wasm"
  "dist/webp_dec.wasm"
  "media/icon-marketplace.png"
  "docs/format-reference.md"
  "docs/changelog.md"
  "docs/third-party-notices.md"
)
for required in "${required_packaged_files[@]}"; do
  if ! grep -Fxq "$required" <<<"$vsce_listing"; then
    echo "ERROR: VSIX 同梱対象に必要なファイルがありません: $required" >&2
    exit 1
  fi
done

for forbidden in '^src/' '^test/' '^test-workspace/' '^scripts/' '^plans/' '^\.agents/' '^\.claude/' '^\.github/' '^\.tazuna/' '^AGENTS\.md$'; do
  if grep -Eq "$forbidden" <<<"$vsce_listing"; then
    echo "ERROR: VSIX に同梱すべきでないファイルが含まれています: $forbidden" >&2
    exit 1
  fi
done

package_version="$(node -p "require('./package.json').version")"
first_changelog_version="$(sed -nE 's/^## ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' docs/changelog.md | head -n 1)"
if [[ "$first_changelog_version" != "$package_version" ]]; then
  echo "ERROR: docs/changelog.md の先頭 version ($first_changelog_version) が package.json ($package_version) と一致しません" >&2
  exit 1
fi

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

echo "==> diff check"
git diff --check

echo "OK"
