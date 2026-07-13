#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tmp_root="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT
license_before="$tmp_root/third-party-licenses.before.txt"
cp docs/third-party-licenses.txt "$license_before"

echo "==> npm ci"
npm ci

echo "==> runtime dependency audit"
npm audit --omit=dev

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

required_packaged_files=(
  "package.json"
  "readme.md"
  "LICENSE.txt"
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
  "docs/third-party-licenses.txt"
)
package_version="$(node -p "require('./package.json').version")"
first_changelog_version="$(sed -nE 's/^## ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' docs/changelog.md | head -n 1)"
if [[ "$first_changelog_version" != "$package_version" ]]; then
  echo "ERROR: docs/changelog.md の先頭 version ($first_changelog_version) が package.json ($package_version) と一致しません" >&2
  exit 1
fi

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "ERROR: shellcheck が必要です" >&2
  exit 1
fi
echo "==> shellcheck"
shellcheck scripts/check.sh

if ! command -v actionlint >/dev/null 2>&1; then
  echo "ERROR: actionlint が必要です" >&2
  exit 1
fi
echo "==> actionlint"
actionlint .github/workflows/*.yml

echo "==> production build + VSIX archive"
vsix_path="${NOTE_MD_VSIX_OUTPUT:-$tmp_root/note-md-$package_version.vsix}"
mkdir -p "$(dirname "$vsix_path")"
npx --no-install vsce package -o "$vsix_path"

if ! cmp -s "$license_before" docs/third-party-licenses.txt; then
  echo "ERROR: docs/third-party-licenses.txt が現在の bundle と一致しません" >&2
  exit 1
fi

unzip -t "$vsix_path" >/dev/null
archive_listing="$(unzip -Z1 "$vsix_path" | sed -n 's#^extension/##p' | grep -v '/$')"
printf '%s\n' "$archive_listing"

for required in "${required_packaged_files[@]}"; do
  if ! grep -Fxq "$required" <<<"$archive_listing"; then
    echo "ERROR: VSIX に必要なファイルがありません: $required" >&2
    exit 1
  fi
done

for forbidden in '^src/' '^test/' '^test-workspace/' '^scripts/' '^plans/' '^\.agents/' '^\.claude/' '^\.direnv/' '^\.github/' '^\.tazuna/' '^AGENTS\.md$' '^media/icon-marketplace\.svg$'; do
  if grep -Eq "$forbidden" <<<"$archive_listing"; then
    echo "ERROR: VSIX に同梱すべきでないファイルが含まれています: $forbidden" >&2
    exit 1
  fi
done

archive_version="$(unzip -p "$vsix_path" extension/package.json | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => process.stdout.write(String(JSON.parse(input).version)));
')"
if [[ "$archive_version" != "$package_version" ]]; then
  echo "ERROR: VSIX version ($archive_version) が package.json ($package_version) と一致しません" >&2
  exit 1
fi

echo "検証済み VSIX: $vsix_path"

echo "==> diff check"
git diff --check

echo "OK"
