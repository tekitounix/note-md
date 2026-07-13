# 変更履歴

このファイルには、note-md の利用者に影響する変更を記録します。

## 0.2.0 - 2026-07-13

### 追加

- frontmatter の `note-md` マーカーで note 記事を認識するオプトイン方式のバリデーションと Quick Fix。通常の Markdown には警告を出さない
- YAML 仕様に沿った frontmatter 解析と、重複キー・alias・壊れた YAML の診断
- `note-md` ヘッダーの `eyecatch`（プレビュー用アイキャッチ）と、開いている Markdown へマーカーを挿入する「note ヘッダーを追加」コマンド
- すべての Markdown を検査する `note-md.validator.treatAllMarkdownAsNote` 設定
- VS Code と同じルールを text、JSON、SARIF で実行できる `note-md` CLI
- note 向け記事の執筆、検査、プレビュー確認を案内する AI スキル
- 参照形式、HTML、frontmatter、空白や括弧を含むパスに対応した共通画像スキャナー
- VS Code 拡張機能ホストによる診断と Quick Fix の統合テスト

### 改善

- Webview の依存を VSIX 内に同梱し、外部 CDN 接続を廃止
- Mermaid を必要な記事でだけ読み込み、通常プレビューの初期転送量を削減
- 見出し ID、frontmatter の行番号、画像キャッシュ、並行アップロードの処理を安定化
- タイトルと目次の entity 二重 escape、画像参照の解釈差、WASM 再初期化を修正
- h1 必須、AVIF 非対応、未検証の外部画像を publish 前に検出する rules を追加
- 閉じていないコードフェンス、低解像度画像、安全に正規化できない GIF / HEIC / AVIF、frontmatter 画像も検出
- 実際に同梱する依存のライセンス・NOTICE 全文を生成して VSIX に収録
- 本文コピーを画像処理の失敗時に閉じる設計へ変更
- Node.js 24 LTS、NixOS 26.05、現行 GitHub Actions に開発・配布環境を更新

### セキュリティ

- Webview のコンテンツセキュリティポリシー、HTML 無害化、メッセージ権限を強化
- 外部画像 URL、redirect、配信 origin、応答サイズ、画像の寸法・件数・合計容量を fail-closed で制限
- 画像の path traversal と symlink による記事ディレクトリ外参照を拒否
- 外部送信を既定で無効にし、原画像をメタデータなし PNG と匿名ファイル名へ正規化してから送信
- アップロード結果をメモリ内だけに保持し、時間切れ、CORS、内容形式を検証
- 同意、ヘルスチェック、同時アップロードをワークスペースと有効サービス設定ごとに分離し、設定変更時の競合を遮断
- 同意撤回コマンドを追加し、Restricted Mode では拡張機能全体を無効化
- ワークスペース外ファイルの画像送信を拒否し、同意画面へ Catbox の規約 URL と商用利用条件を明記
- 画像形式を実データから判定し、拡張子偽装、寸法不明、合計容量超過をデコード前に拒否

### 配布

- tag と package version の一致を検証する手動 Release workflow を整備
- release tag が `origin/main` の祖先であることを検証し、固定 SHA の Actions だけで同一 commit を配布
- production build と VSIX 生成を一回へ統合し、生成アーカイブの必須・禁止ファイルを直接検証
- GitHub Release と Marketplace 公開を分離し、Marketplace 公開を明示選択制に変更
- 分岐していた v0.1.1 の公開履歴を、内容と既存タグを変えず次版の祖先へ統合
