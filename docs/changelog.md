# 変更履歴

このファイルには、note-md の利用者に影響する変更を記録します。

## 0.2.0 - 2026-07-13

### 追加

- プレビューを開かなくても Markdown 文書を検査する常時バリデーションと Quick Fix
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
- 実際に同梱する依存のライセンス・NOTICE 全文を生成して VSIX に収録
- 本文コピーを画像処理の失敗時に閉じる設計へ変更
- Node.js 24 LTS、NixOS 26.05、現行 GitHub Actions に開発・配布環境を更新

### セキュリティ

- Webview のコンテンツセキュリティポリシー、HTML 無害化、メッセージ権限を強化
- 画像の path traversal と symlink による記事ディレクトリ外参照を拒否
- アップロード結果をメモリ内だけに保持し、時間切れ、CORS、内容形式を検証
- 同意、ヘルスチェック、同時アップロードを有効サービス設定ごとに分離し、設定変更時の競合を遮断

### 配布

- tag と package version の一致を検証する手動 Release workflow を整備
- GitHub Release と Marketplace 公開を分離し、Marketplace 公開を明示選択制に変更
- 分岐していた v0.1.1 の公開履歴を、内容と既存タグを変えず次版の祖先へ統合
