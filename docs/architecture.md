# note-md アーキテクチャ

最終更新日: 2026-03-14

この文書は、現在の note-md 実装の責務分担とデータフローを説明する正本です。

## 概要

note-md は、VS Code Extension Host 側で Markdown の解析・画像処理・バリデーションを行い、Webview 側で note.com 風プレビューとコピー UI を提供します。

設計上の原則は次の3つです。

1. 変換ロジックは Extension Host に寄せる
2. Webview は表示とユーザー操作に専念する
3. note 依存の仕様は Markdown ソース基準で扱う

## モジュール構成

### Extension Host

- src/extension.ts
コマンド登録、イベント購読、バリデーション配線、プレビュー追従の入口。

- src/previewPanel.ts
WebviewPanel の単一インスタンス管理。フルレンダリング、差分更新、画像アップロードの起動、generation による stale message 排除を担当。

- src/render.ts
Markdown から note 風 HTML を生成。TOC 生成、ruby / Mermaid / 数式の変換、文字数カウント、Webview 用 CSS/JS テンプレートを持つ。

- src/imageProcessor.ts
Markdown からローカル画像参照を抽出し、必要なら PNG 変換し、アップロードして URL マップを返す。

- src/imageRefs.ts
画像参照の正規化、article 配下制約、symlink 越え防止、URL マップ解決の共通ユーティリティ。

- src/upload.ts
セッション内アップロードキャッシュ。SHA-256 をキーに URL を再利用し、source ref ごとの URL マップを構築する。

- src/services.ts
一時ホスティングサービス抽象化。ヘルスチェックと優先順位付きフォールバックを提供する。

- src/validator.ts
note 非対応記法や危険なパターンの診断本体。

- src/codeActions.ts
Quick Fix を VS Code の CodeAction として公開する。

- src/consent.ts
アップロード同意の確認ダイアログ管理。

### Webview

render.ts に埋め込まれた JS が以下を担当する。

- プレビュー DOM 更新
- コピー操作
- フォント切り替え
- TOC スクロール
- KaTeX / Mermaid / highlight.js の再実行
- Extension Host から届く urlMap / charCount の反映

## 主要フロー

### プレビュー更新

1. extension.ts が Markdown の変更を検知する
2. previewPanel.ts が現在の追従対象ドキュメントなら incrementalUpdate を呼ぶ
3. render.ts の renderBody() が本文 HTML、TOC、charCount を生成する
4. previewPanel.ts が update メッセージを Webview に送る
5. Webview が DOM を更新し、KaTeX / Mermaid / highlight.js を再適用する

### 初回表示または文書切り替え

1. NotePreviewPanel.createOrShow() で単一パネルを作る
2. fullRender() が generation を更新して HTML 全体を生成する
3. checkAndUpload() が画像状態を評価する
4. 必要なら自動アップロードへ進み、不要なら既存 urlMap を返す

### 画像処理

1. imageProcessor.ts が Markdown からローカル画像参照を抽出する
2. imageRefs.ts が articleDir 配下かつ symlink 越えしていない実ファイルだけを通す
3. 非対応形式は jimp / resvg-wasm で PNG に変換する
4. upload.ts が SHA-256 ベースでキャッシュ再利用する
5. services.ts が利用可能なアップロード先へフォールバックしながら送信する
6. previewPanel.ts と render.ts が source ref ベースの urlMap で画像 URL を差し替える

### 文字数カウント

文字数は DOM からではなく Markdown ソースから計算する。

- h1 は除外する
- 画像と区切り線は空ブロックとして扱う
- ruby は親文字だけ数える
- 数式は note 記法ベースで数える
- ブロック連結は改行1文字で表現する

この計算は render.ts の countNoteChars() に集約される。

## 状態管理

### generation

previewPanel.ts はフルレンダリングごとに generation を進める。Webview 側は受信したメッセージの gen が現在値と一致する場合だけ適用し、文書切り替え中の古い非同期結果を破棄する。

### 画像キャッシュ

upload.ts のキャッシュは articleDir 単位の sessionCache で保持する。

- 永続化はしない
- expiresAt を超えた URL は再利用しない
- 同一バイナリでも複数の source ref を保持する
- source ref → URL への展開は loadUrlMap() で行う

## 既知の設計判断

1. Webview は単一パネルでアクティブエディタへ追従する
2. 画像アップロードはプレビュー表示と分離し、必要時だけ行う
3. note 互換ロジックは DOM 後処理ではなく Markdown ソース基準で寄せる
4. validator は分割よりも単一ファイルの一貫性を優先している

## リリース前に見るべき関連文書

- docs/format-reference.md
- docs/paste-workflow.md
- docs/image-specs.md
- docs/validator.md
- docs/release-checklist.md