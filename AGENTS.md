# AGENTS.md - note-md

この repository は note 向け Markdown preview / validation / image processing を提供する VS Code extension である。ユーザー向け UI と README の主言語は日本語。source code identifier、machine token、commit message、branch name、LICENSE は英語を維持する。

ai-ops の cross-project rules を継承する。破壊的操作、環境変更、workflow / release / package publish に関わる変更、public repo への push は Propose -> Confirm -> Execute を通す。read-only command と local check は確認不要。

## Workspace

- Canonical path: `~/ghq/github.com/tekitounix/note-md/`
- Stack: TypeScript / VS Code extension / Node.js 20 / npm
- Generated and build outputs: `out/`, `dist/`, `*.vsix`

## Commands

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run package
./scripts/check.sh
```

`./scripts/check.sh` を local-first gate の正本にする。remote GitHub Actions は通常 PR / main push の必須 check にしない。release / external evidence が必要なときだけ manual workflow を明示 dispatch する。

## Architecture

- `src/extension.ts`: command registration、extension entrypoint。
- `src/previewPanel.ts`: single WebviewPanel lifecycle。generation counter で stale message を避ける。
- `src/render.ts`: markdown-it based note-style HTML rendering。
- `src/validator.ts`: note-incompatible syntax diagnostics。
- `src/codeActions.ts`: validator diagnostics から QuickFix CodeActions を作る。
- `src/imageProcessor.ts`: local image extraction、PNG conversion、upload flow。
- `src/imageRefs.ts`: image reference normalization と articleDir boundary。
- `src/upload.ts`: session-only upload cache。disk persistence はしない。
- `src/services.ts`: temporary hosting service abstraction。
- `src/consent.ts`: upload consent dialog。

## Product Rules

- note 互換性の判断は Markdown source を正とし、rendered DOM だけで補正しない。
- upload result は memory-only。secret / token / upload credential を repository や log に残さない。
- symlink / path traversal で articleDir の外に出ないことを維持する。
- user-facing command title / configuration description は日本語を既定にする。

## Verification

完了報告前に少なくとも次を通す。

```sh
./scripts/check.sh
git diff --check
```

package / release に触れた場合は、生成された `.vsix` の動作確認、version、release workflow の入力、Marketplace publish secret の扱いを別途確認する。
