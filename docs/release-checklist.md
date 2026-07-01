# リリースチェックリスト

最終更新日: 2026-07-02

## ビルドとテスト

- `./scripts/check.sh` が通る
- `git diff --check` が通る
- `actionlint .github/workflows/*.yml` が通る（`./scripts/check.sh` 内でも導入済み環境では実行）
- `shellcheck scripts/check.sh` が通る（`./scripts/check.sh` 内でも導入済み環境では実行）
- `python3 -m ai_ops audit ci --path . --json` の結果を確認する

## 機能確認

- プレビューが Markdown 編集に追従する
- アクティブエディタ切り替えで同一パネルが追従する
- タイトルコピーと本文コピーが動く
- 文字数カウンターが代表原稿で note.com 実測と一致する
- 数式、ルビ、Mermaid、TOC が崩れない

## 画像確認

- 対応形式 JPG / PNG / GIF / HEIC がそのまま扱える
- SVG / WebP / BMP / TIFF が PNG 変換される
- 同名別ディレクトリ画像で URL 置換が壊れない
- 同一画像を別パスで参照しても置換が壊れない
- 画像なし記事で本文コピーが即時有効になる
- 強制再アップロードが動く

## バリデータ確認

- Problems に主要ルールが出る
- note-ignore-next-line が効く
- Quick Fix が主要ルールで動く

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
- 既定で有効なアップロードサービスが公開方針に合っている
- 各アップロードサービスの接続性が極端に悪化していない
- 削除済みサービスへの誤参照がコード・ドキュメントに残っていない
- LICENSE と `docs/third-party-notices.md` の内容が同梱対象として確認済みである

## 公開前処理

- package.json の version を更新する
- Git tag (`vX.Y.Z`) と package.json の version が一致している
- package.json の publisher・表示名・説明・キーワードが公開方針と一致している
- 拡張機能アイコンが正式版アセットとして package に含まれている
- changelog 相当のリリースノートを用意する
- 不要な検証用ファイルが残っていない
- `npx --no-install vsce ls` で `.ai-ops/`、`.claude/`、`AGENTS.md`、`plans/`、未公開の検証用ファイルが同梱されないことを確認する
- `npx --no-install vsce package -o note-md-<version>.vsix` で生成した `.vsix` をローカルにインストールし、主要操作を確認する
- git status がクリーンである
- 公開対象コミットが確定している

## 公開操作

- GitHub Release 用 workflow_dispatch の `tag` が公開対象タグと一致している
- Marketplace へ同時公開する場合だけ `publish_marketplace` を `true` にする
- 同時公開する場合は承認環境と `VSCE_PAT` の設定を確認する
- Marketplace へ公開しない場合は `publish_marketplace` を `false` にし、生成された `.vsix` と GitHub Release だけを成果物にする
