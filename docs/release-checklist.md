# リリースチェックリスト

最終更新日: 2026-07-13

## ビルドとテスト

- `./scripts/check.sh` が通る
- `git diff --check` が通る
- `actionlint .github/workflows/*.yml` が通る（`./scripts/check.sh` の必須検査）
- `shellcheck scripts/check.sh` が通る（`./scripts/check.sh` の必須検査）
- `npm audit --omit=dev` に既知の実行時脆弱性がない
- 現行 tazuna でハーネス、構造、ライフサイクル、文書、言語、安全性、継続的統合の監査を確認する

## 機能確認

- プレビューが Markdown 編集に追従する
- アクティブエディタ切り替えで同一パネルが追従する
- タイトルコピーと本文コピーが動く
- 文字数カウンターが代表原稿で note.com 実測と一致する
- 数式、ルビ、Mermaid、TOC が崩れない

## 画像確認

- JPG / PNG / SVG / WebP / BMP / TIFF が匿名名の PNG へ正規化される
- GIF / HEIC / AVIF と未知形式が外部へ送信されず、事前変換を案内する
- 同名別ディレクトリ画像で URL 置換が壊れない
- 同一画像を別パスで参照しても置換が壊れない
- 画像なし記事で本文コピーが即時有効になる
- 強制再アップロードが動く

## バリデータ確認

- Problems に主要ルールが出る
- プレビューを一度も開かなくても Problems に診断が出て、閉じても残る
- note-ignore-next-line が効く
- Quick Fix が主要ルールで動く
- `note-md check` の text / JSON / SARIF と終了コードが仕様どおり動く
- h1 欠落、AVIF、外部画像、画像 title の各診断が Problems と CLI で一致する

## ドキュメント確認

- README が現行機能と設定に一致する
- README は日本語の単一入口 (`README.md`) のままで、通常開発中に `README.ja.md` や `README.en.md` を復活させていない
- docs/format-reference.md が現行の本文コピー仕様に一致する
- docs/paste-workflow.md が現行運用の正本になっている
- docs/architecture.md と docs/validator.md が実装責務に一致する
- docs/image-specs.md への導線が残っている

## 外部依存確認

- アップロード同意文面が実装と README で矛盾しない
- README と同意文面が第三者サービスのログ可能性を明記している
- アップロードサービスが既定で無効で、Litterbox の明示 opt-in だけが許可される
- 各アップロードサービスの接続性が極端に悪化していない
- 削除済みサービスへの誤参照がコード・ドキュメントに残っていない
- LICENSE、`docs/third-party-notices.md`、生成済みの `docs/third-party-licenses.txt` が同梱されている
- プレビューが公開配信網へスクリプト、スタイル、書体を要求しない

## 公開前処理

- package.json の version を更新する
- Git tag (`vX.Y.Z`) と package.json の version が一致している
- package.json の publisher・表示名・説明・キーワードが公開方針と一致している
- 拡張機能アイコンが正式版アセットとして package に含まれている
- `docs/changelog.md` の先頭リリースが package.json と tag の version に一致する
- v0 系または末尾に先行版識別子を持つ版が GitHub Release でプレリリース扱いになる
- 不要な検証用ファイルが残っていない
- `NOTE_MD_VSIX_OUTPUT=note-md-<version>.vsix ./scripts/check.sh` で生成・検証した単一の `.vsix` に、必須ファイルだけが同梱されることを確認する
- 同じ `.vsix` をローカルにインストールし、主要操作を確認する
- git status がクリーンである
- 公開対象コミットが確定している
- 代表原稿を生成した VSIX で開き、タイトルと本文を note の下書きへ貼り付け、パソコンとスマートフォンのプレビューを日付付き証跡として残す

## 公開操作

- GitHub Release 用 workflow_dispatch の `tag` が公開対象タグと一致している
- Marketplace へ同時公開する場合だけ `publish_marketplace` を `true` にする
- 同時公開する場合は承認環境と `VSCE_PAT` の設定を確認する
- Marketplace へ公開しない場合は `publish_marketplace` を `false` にし、生成された `.vsix` と GitHub Release だけを成果物にする
