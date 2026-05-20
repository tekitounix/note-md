# AGENTS.md - note-md

このリポジトリは note 向けの Markdown プレビュー、検証、画像処理を提供する VS Code 拡張である。ユーザー向け UI と README の主言語は日本語。コード識別子、機械トークン、コミットメッセージ、ブランチ名、LICENSE は英語を維持する。

`github.com/tekitounix/ai-ops` の横断ルールを継承する。破壊的操作、環境変更、ワークフロー、リリース、パッケージ公開に関わる変更、公開リポジトリへの push は提案、確認、実行の順で進める。読み取り専用コマンドとローカル確認は確認不要。

プロジェクト台帳は ai-org 側の登録簿を正本とする。ai-ops はこのリポジトリの運用規約、監査、ハーネスだけを担う。

運用文書と作業指示は日本語を正本にする。英語は公開入口、識別子、機械トークン、外部サービス名、API 名に限って使う。

## Workspace

- Canonical path: `~/ghq/github.com/tekitounix/note-md/`
- Stack: TypeScript / VS Code extension / Node.js 20 / npm
- Generated and build outputs: `out/`, `dist/`, `*.vsix`

## Plans

- 非自明な実行作業は `plans/active/<slug>/plan.md` を使う。
- 短期 audit / review artifact は `plans/audits/<slug>/` に置き、採用後は durable docs / plan / backlog へ昇格するか削除する。

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
