#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "==> npm ci"
npm ci

echo "==> lint"
npm run lint

echo "==> format check"
npm run format:check

echo "==> typecheck"
npm run typecheck

echo "==> test"
npm test

echo "==> package"
npm run package

echo "==> diff check"
git diff --check

echo "OK"
