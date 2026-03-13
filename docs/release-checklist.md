# リリースチェックリスト

最終更新日: 2026-03-14

## ビルドとテスト

- npm run compile が通る
- npm test が通る
- production build が通る

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
- プレビュー注釈が更新に追従する
- note-ignore-next-line が効く
- Quick Fix が主要ルールで動く

## ドキュメント確認

- README が現行機能と設定に一致する
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
- LICENSE と THIRD_PARTY_NOTICES が同梱されている

## 公開前処理

- package.json の version を更新する
- package.json の publisher・表示名・説明・キーワードが公開方針と一致している
- 拡張機能アイコンが正式版アセットとして package に含まれている
- changelog 相当のリリースノートを用意する
- 不要な検証用ファイルが残っていない
- git status がクリーンである
- 公開対象コミットが確定している
