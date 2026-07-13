# note-md

非公式の note 向け Markdown プレビュー、常時バリデーション、CLI、画像処理、本文コピーを提供する執筆支援環境。

> **本プロジェクトは note 株式会社および note.com とは無関係の個人プロジェクトです。**
>
> **現在ベータ版（v0.x）です。** 仕様や API が変更される場合があります。

## 機能

### プレビュー

- note の表示に近いスタイルでリアルタイムプレビュー
- アクティブな Markdown エディタに自動追従
- ゴシック / 明朝の書体切り替え
- 目次（サイドバー TOC）と文字数カウンター（実サイトとは計算方法が異なる場合があります）
- 数式（KaTeX）、Mermaid ダイアグラム、シンタックスハイライト対応
- 表示用 JavaScript、CSS、font は VSIX 内に同梱し、公開 CDN へ接続しない

### 本文コピー

- note のエディタに直接ペーストできる HTML をクリップボードにコピー
- h1 を自動除去し、タイトルは別ボタンでコピー
- 数式を note の `$${...}$$` 記法に自動変換
- Mermaid を note 認識のフェンス記法に変換
- ルビ（`｜漢字《かんじ》`）を保持
- 連続画像の消失を防ぐスペーサーを自動挿入

### 画像処理

- JPG / PNG / SVG / WebP / BMP / TIFF をメタデータなしの PNG に正規化
- Retina 2x（1240px 幅）で出力
- 外部送信は既定で無効。送信先の明示設定とワークスペース単位の同意後だけ一時ホスティングへアップロード
- GIF / HEIC / AVIF と未知形式は、安全に正規化できないため外部送信しない
- SHA-256 ハッシュで同一画像の重複アップロードをスキップ

### バリデーション

- note 非対応書式（テーブル、インラインコード、イタリックなど）を警告
- タイトル用 h1 の欠落、変換できない AVIF、未検証の外部画像を公開前に検出
- VS Code の Problems パネルに表示
- frontmatter に `note-md` マーカーを持つ記事だけを検査（通常の Markdown は対象外。[note-md ヘッダー](#note-md-ヘッダー)参照）
- 画像パスの安全性チェック（パストラバーサル検出）
- 空の画像代替テキストにアクセシビリティのヒントを表示
- QuickFix 対応（h1 分割、画像 title 除去など）
- `<!-- note-ignore-next-line -->` で個別の警告を抑制可能
- 同じルールを headless CLI から text / JSON / SARIF で利用可能

## インストール

[Releases](https://github.com/tekitounix/note-md/releases) から `.vsix` をダウンロードし、拡張機能ビュー → `…` → **VSIX からインストール…**、または次を実行します。

```sh
code --install-extension note-md-*.vsix
```

Marketplace は公開準備中です。公開を確認できるまでは Releases を正規の導線とします。

## クイックスタート

1. 拡張機能をインストール
2. Markdown ファイルを開く
3. Problems に出た error / warning を修正
4. エディタ右上のプレビューアイコン、またはコマンドパレットから **「note プレビューを開く」** を実行
5. ツールバーの **「タイトル」** → note のタイトル欄にペースト
6. 画像準備が完了して **「本文コピー」** が有効になったら、note のエディタ本文にペースト

ローカル画像を本文コピーへ含める場合は、設定で送信先を明示してから「note 向けに画像を処理してアップロード」またはプレビューの再送ボタンを実行します。初回だけワークスペース単位の確認ダイアログが表示され、同意後は変更画像を自動処理します。
一件でも画像が未解決、変換失敗、アップロード失敗の場合は本文コピーを有効にしません。
外部 URL の画像はアップロードと配信確認の対象外なので、Problems の warning に従って note 側の表示を確認してください。

## CLI

CLI は VS Code を起動せず同じ rules を実行するため、AI、pre-commit、任意の editor から利用できます。現在は repository checkout で提供します。

```sh
npm ci
npm run compile
npm link

note-md check --strict article.md
note-md check --stdin --article-dir . --format json
note-md check article.md --format sarif
note-md rules
```

終了コードは 0 が合格、1 が診断による不合格、2 が実行エラーです。warning を許容する通常検査では `--strict` を外し、上限を指定するときは `--max-warnings 0` のように設定します。

## AI スキル

`.agents/skills/note-writing/` を正本として、Claude と GitHub 系の探索位置にも薄い入口を配置しています。「note の記事を書きたい」「この原稿を note 用に推敲して」のような依頼で使い、執筆後に CLI の strict check とプレビュー確認を行います。skill は note への自動投稿や、同意のない画像アップロードを行いません。

この自動探索は AI が本 repository 内で作業する場合に利用できます。VSIX 単体を任意 workspace に導入しても、OS の `PATH` への CLI 登録や AI skill の全体インストールは行いません。repository 外では、checkout した `dist/cli.js` を明示的に実行してください。

## 対応書式

### 使える書式

| 書式 | 備考 |
|------|------|
| 見出し（h2, h3） | |
| 太字 | |
| 取り消し線 | |
| リンク | |
| 箇条書き / 番号付きリスト | 入れ子対応 |
| 引用 | |
| コードブロック | シンタックスハイライト対応 |
| 区切り線 | |
| 画像 | |
| ルビ | `｜漢字《かんじ》` 記法 |
| インライン数式 / ディスプレイ数式 | KaTeX、中央寄せ対応 |
| Mermaid ダイアグラム | |
| テキスト配置 | 中央寄せ / 右寄せ |

### 使えない書式（note の制約）

| 書式 | 理由 |
|------|------|
| テーブル | note がペースト時に無視する |
| インラインコード | note が非対応。本文コピー時にバッククォートを除去 |
| イタリック | `<em>` / `<i>` 全て note が無視する |
| 画像キャプション | ペースト経由で設定不可（60 パターン以上で検証済み） |
| 連続画像 | 画像が連続すると最後以外が消失するため、間に空行を自動挿入（note 側の制約） |

詳細は [docs/format-reference.md](docs/format-reference.md) を参照してください。

## note-md ヘッダー

バリデーションは、frontmatter に `note-md` マーカーを持つファイルだけを対象にします。通常の Markdown（README や技術メモなど）に note 非対応構文の警告が出るのを防ぐためのオプトイン方式です。マーカーが無いファイルでもプレビュー（「note プレビューを開く」）はいつでも使えます。

最小形（これだけで note 記事として認識されます）:

```yaml
---
note-md:
---
```

任意フィールドを付ける場合（フロー記法なら 3 行に収まります）:

```yaml
---
note-md: { eyecatch: figures/cover.png }
---
```

| フィールド | 意味 | 既定 |
|------|------|------|
| （マーカー自体） | 必須。存在するだけで note 記事として検証対象になる。`note-md: false` で明示的に対象外 | — |
| `eyecatch` | プレビューに表示するアイキャッチ画像パス（プレビュー専用。実際の note 記事のアイキャッチは note 側で設定します） | なし |
| `version` | ヘッダー形式のバージョン。通常は書きません（将来の互換性のために拡張が読みます） | 最新 |

本文フォント（ゴシック体／明朝体）はヘッダーではなく、プレビュー上のボタンで切り替えます。既存の `header:` トップレベルキーは `eyecatch` の後方互換として引き続き読み込まれます。コマンド「note ヘッダーを追加」で、開いている Markdown にマーカーを挿入できます。

## 設定

| 設定 | 説明 | デフォルト |
|------|------|------------|
| `note-md.uploadExpiry` | 画像アップロードの有効期限 | `72h` |
| `note-md.enabledUploadServices` | 利用する画像送信先。規約確認後に明示設定 | `[]` |
| `note-md.validator.disabledRules` | 無効化するバリデーションルール ID | `[]` |
| `note-md.validator.treatAllMarkdownAsNote` | すべての Markdown を note 記事として検証する（マーカー不要の旧挙動） | `false` |

## データの取り扱い

> **重要**: 外部画像送信は既定で無効です。送信先を設定し、明示操作したワークスペースで同意した場合だけ外部サービスを利用します。

### アップロードされるデータ

- Markdown 記事中に参照されているローカル画像を、メタデータを引き継がない PNG に再エンコードして送信します
- 送信ファイル名は画像内容の SHA-256 から作る匿名名で、元の basename は送りません
- 記事本文、frontmatter、原画像の EXIF、その他ファイルは送信しません
- GIF / HEIC / AVIF と未知形式は原本を送らず、PNG または JPEG への事前変換を案内します

### 送信先サービス

note のエディタはペースト時にブラウザ上で画像 URL を fetch するため、配信ドメインが `access-control-allow-origin: *` を返す（CORS 対応の）サービスのみ使用できます。

| 優先度 | サービス | 運営 | 保持期間 | CORS | 備考 |
|--------|----------|------|----------|------|------|
| 1 | [litterbox.catbox.moe](https://litterbox.catbox.moe/) | Catbox LLC (米国) | 1h–72h (設定可能) | `*` | 一時ホスティング専用。Catbox 利用規約に商用利用の事前承認条項あり |

既定の送信先はありません。Litterbox を選ぶ場合は利用規約を確認してください。特に組織または収益を伴うプロジェクトでの利用には Catbox 経営者の書面による明示的な事前許可が必要です。非公式 endpoint に依存していた ImgBB 経路は削除済みです。

### アクセス可能性

- アップロードすると公開 URL が発行され、URL を知っている人は保存期間中その画像にアクセスできます
- パスワード保護や認証はありません
- 機密画像や限定公開前提の画像はアップロードしないでください
- サービス提供者側で IP アドレス、匿名化後のファイル名、容量、アップロード時刻等が記録される場合があります
- 拡張機能はアップロード後の URL が所定の配信元、CORS、画像 Content-Type を満たすか検証し、redirect や別 origin を拒否します
- コマンド「note 画像送信の同意を撤回」で今後の送信を停止できます。既に発行済みの公開 URL や外部ファイルは削除されません

### 目的と仕組み

- note の記事エディタに本文コピーをペーストすると、note がブラウザ経由で画像を取得し自社 CDN にコピーします（このため CORS 対応が必須）
- 一時的なホスティングで十分であり、画像 URL は長期間有効である必要はありません
- アップロード結果は VS Code のセッション内メモリにのみキャッシュされます
- **ディスクへの永続化は行いません** — VS Code の再起動でキャッシュはクリアされます
- 同一セッション内で同じ画像を再処理する場合は、SHA-256 ハッシュで重複を検知しスキップします

### 各サービスの利用規約

利用にあたっては、各サービスの利用規約もご確認ください:

- Catbox LLC (litterbox): [利用規約](https://catbox.moe/legal.php)

### 法務上の注意

- この拡張機能は法的助言を提供しません
- 第三者サービスの利用規約、保存期間、ログ方針、商用利用可否は利用者自身で確認してください
- 組織利用や収益を伴うプロジェクトでは、Catbox から書面による明示的な事前許可を得ない限り Litterbox を有効にしないでください

## 開発

- 実行環境: Node.js 24 LTS、npm
- ビルド: `npm run compile`
- 回帰テスト: `npm test`（単体テスト + VS Code Extension Host 統合テスト）
- パッケージ: `npm run package`
- デバッグ: VS Code の `Run Extension` を起動すると `test-workspace/sample.md` が開きます

## ドキュメント

- [docs/changelog.md](docs/changelog.md): リリースごとの利用者向け変更履歴
- [docs/format-reference.md](docs/format-reference.md): 対応書式と制約
- [docs/paste-workflow.md](docs/paste-workflow.md): note へ貼り付ける実運用手順
- [docs/image-specs.md](docs/image-specs.md): note の画像仕様メモ
- [docs/third-party-notices.md](docs/third-party-notices.md): 同梱依存と第三者サービスの注意事項
- [docs/architecture.md](docs/architecture.md): 実装アーキテクチャ
- [docs/validator.md](docs/validator.md): バリデータの設計と運用
- [docs/release-checklist.md](docs/release-checklist.md): リリース前の確認項目

## ライセンス

MIT
