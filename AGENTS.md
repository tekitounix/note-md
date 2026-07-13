# AGENTS.md - note-md

このリポジトリは note 向けの Markdown プレビュー、検証、画像処理を提供する VS Code 拡張である。利用者に見える文言と README の主言語は日本語にする。コード識別子、機械トークン、コミットメッセージ、ブランチ名、LICENSE は英語を維持する。

[tekitounix/tazuna](https://github.com/tekitounix/tazuna) の横断ルールを継承する。破壊的操作、環境変更、ワークフロー、リリース、パッケージ公開に関わる変更、公開リポジトリへの push は提案、確認、実行の順で進める。読み取り専用コマンドとローカル確認は確認不要。

kura registry をプロジェクト台帳の正本とし、tazuna は運用規約、監査、ハーネスを担う。

## 作業場所

- 正本の場所: このリポジトリの Git ルート
- 技術構成: TypeScript、VS Code 拡張、Node.js 24 LTS、npm
- 生成物: `out/`、`dist/`、`*.vsix`

## 計画

- 非自明な実行作業は `plans/active/<slug>/plan.md` を使う。
- 短期の監査やレビュー証跡は `plans/audits/<slug>/` に置き、採用後は永続文書、実行計画、バックログへ昇格するか削除する。
- 実装、設計、修正、調査では `.agents/skills/orchestrate-task/SKILL.md` を入口にし、Tazuna の分類、充当、外部CLI、レビュー台帳の契約に従う。

## コマンド

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run package
./scripts/check.sh
```

`./scripts/check.sh` をローカル優先ゲートの正本にする。GitHub Actions は通常の PR や main への push で必須チェックにしない。リリースや外部証跡が必要なときだけ、手動ワークフローを明示して起動する。

## 構成

- `src/extension.ts`: コマンド登録と拡張の入口。
- `src/previewPanel.ts`: 単一の WebviewPanel の寿命管理。世代番号で古いメッセージを避ける。
- `src/render.ts`: `markdown-it` による note 風 HTML 描画。
- `src/cli.ts`: VS Code に依存しない `check` / `rules` CLI。
- `src/validator.ts`: note 非互換構文の診断。
- `src/imageScanner.ts`: Markdown、frontmatter、HTML の画像参照を共通解析する。
- `src/codeActions.ts`: 診断から QuickFix を作る。
- `src/imageProcessor.ts`: ローカル画像の抽出、PNG 変換、アップロード処理。
- `src/imageRefs.ts`: 画像参照の正規化と `articleDir` 境界の検査。
- `src/upload.ts`: セッション内だけのアップロードキャッシュ。ディスクへ保存しない。
- `src/services.ts`: 一時ホスティングサービスの抽象化。
- `src/consent.ts`: アップロード同意ダイアログ。
- `.agents/skills/note-writing/`: note 執筆依頼で暗黙に使う AI skill の正本。

## プロダクト規則

- note 互換性の判断は Markdown の原文を正とし、描画後の DOM だけで補正しない。
- アップロード結果はメモリ内だけに置く。secret、token、upload credential をリポジトリやログに残さない。
- symlink や path traversal で `articleDir` の外に出ないことを維持する。
- 利用者に見えるコマンド名と設定説明は日本語を既定にする。
- note 記事の執筆・推敲依頼では `note-writing` skill を使い、`note-md check --strict` を完了条件にする。

## 検証

完了報告前に少なくとも次を通す。

```sh
./scripts/check.sh
git diff --check
```

パッケージやリリースに触れた場合は、生成された `.vsix` の内容と動作、version、リリースワークフローの入力、Marketplace 公開用 secret の扱いを別途確認する。
