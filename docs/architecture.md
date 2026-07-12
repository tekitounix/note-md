# note-md アーキテクチャ

最終更新日: 2026-07-13

note-md は、同じ Markdown 原文と互換性ルールを、エディタのプレビュー、問題一覧、コマンドライン、AI スキルから利用する。

## 境界

```text
Markdown source
  ├─ validator.ts + imageScanner.ts ─ Problems / CLI / QuickFix
  ├─ render.ts ─ previewPanel.ts ─ Webview / rich copy
  └─ imageProcessor.ts ─ upload.ts ─ services.ts ─ temporary hosting
```

- `src/extension.ts`: VS Code adapter。コマンド、常時診断、設定変更、エディタ追従を扱う。
- `src/cli.ts`: headless adapter。`check` と `rules` を提供する。
- `src/validator.ts`: note 非互換ルールと診断の正本。VS Code 型には依存しない。
- `src/imageScanner.ts`: frontmatter、Markdown、参照形式、HTML の画像参照を一度だけ解釈する。
- `src/imageRefs.ts`: URL decode、正規化、realpath を含む `articleDir` 境界を扱う。
- `src/render.ts`: Markdown を許可リストで sanitize し、note 風 HTML とコピー用 DOM を作る。
- `src/previewPanel.ts`: 単一 WebviewPanel、世代番号、message token、画像準備状態を管理する。
- `src/webviewVendor.ts`: コードと数式をローカル表示するライブラリの入口。
- `src/webviewMermaid.ts`: Mermaid を使う記事だけで読み込む図表ライブラリの入口。
- `src/imageProcessor.ts`: 画像をメモリ内で検査・変換し、全件成功した場合だけ URL map を返す。
- `src/upload.ts`: SHA-256 単位の memory-only cache と同時 upload の重複排除を行う。
- `src/services.ts`: 明示的に有効化された一時ホスティングの timeout、URL、CORS、Content-Type を検証する。
- `src/consent.ts`: versioned consent を管理する。

## 重要な不変条件

1. note 互換性の判断は rendered DOM ではなく Markdown source を正とする。
2. プレビューは遠隔のスクリプト、スタイル、書体を読み込まない。実行資産は `dist/` に同梱し、一時値と `webview.cspSource` だけをコンテンツセキュリティ方針で許可する。
3. HTML はプレビュー表示前に許可リストで無害化する。表示側からの操作は現在の世代番号と一時トークンが一致した場合だけ受け付ける。
4. 画像は symlink、absolute path、`..` を含め realpath で `articleDir` 外へ出さない。
5. アップロード先 URL、ハッシュ、原文の参照先は、エディタの実行中メモリだけに置き、ディスクへ保存しない。
6. ローカル画像が一件でも未解決、変換失敗、upload 失敗なら本文コピーを有効にしない。
7. note 投稿は自動化しない。最終操作は人間が preview からコピーし、note 上で確認する。

## build artifact

`esbuild.mjs` は次を生成する。

- `dist/extension.js`: VS Code extension bundle
- `dist/cli.js`: Node.js CLI bundle
- `dist/webview-vendor.js`: browser-only vendor bundle
- `dist/webview-mermaid.js`: Mermaid を使う場合だけ読み込む bundle
- `dist/highlight.css`、`dist/katex.css`、`dist/fonts/`: ローカル表示資産
- `dist/resvg.wasm`、`dist/webp_dec.wasm`: 画像変換資産

## ローカルゲート

`./scripts/check.sh` が依存導入、静的検査、整形確認、型検査、単体・拡張ホスト試験、梱包内容、シェルとワークフローの構文、差分確認の正本である。外部公開、実画像の送信、note への実貼り付けは [リリースチェックリスト](release-checklist.md) の人手ゲートで確認する。
