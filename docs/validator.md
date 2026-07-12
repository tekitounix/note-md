# note-md バリデータ

最終更新日: 2026-07-13

バリデータは、note で無視・変形される可能性が高い Markdown と、コピー準備を妨げる画像問題を原文上で検出する。プレビューの開閉とは独立して動き、問題一覧、即時修正、コマンドラインが同じ `src/validator.ts` を使う。

## 実行

- 文書を開いたとき、編集から 300 ms 後、対象設定を変更したとき: 軽量な change rules
- 保存したとき: 編集時ルールに加え、画像の存在・サイズを非同期確認する保存時ルール
- CLI: 全 rules を実行する。`--strict` は warning も失敗にする

```sh
note-md check --strict article.md
note-md check --stdin --article-dir . --format json
note-md check article.md --format sarif
note-md rules
```

終了コードは 0 が合格、1 が診断による不合格、2 が引数・読込などの実行エラーである。

## 主なルール

| 分類 | rule ID |
|---|---|
| 非対応書式 | `note/no-table`、`note/no-italic`、`note/no-inline-code`、`note/no-h456`、`note/no-html5`、`note/no-footnote`、`note/no-image-title` |
| source 整合性 | `note/ruby-unmatched`、`note/ruby-nested`、`note/math-unmatched`、`note/math-display-unclosed` |
| 画像 | `note/image-path-traversal`、`note/image-missing`、`note/image-oversized`、`note/image-unsupported`、`note/image-alt-empty` |
| 構造・品質 | `note/multiple-h1`、`note/hr-variant`、`note/unclosed-html-tag`、`note/consecutive-blanks` |

`note/image-alt-empty` はアクセシビリティの hint である。装飾画像として空 ALT を意図する場合は、画像の直前に次を置く。

```html
<!-- note-ignore-next-line -->
```

## 抑制と Quick Fix

設定 `note-md.validator.disabledRules` には `note-md rules` が返す ID だけを指定できる。単発の例外は `note-ignore-next-line` を優先する。

即時修正は、見出しの深さ、区切り線、行内コードの記号、画像題名など、意味を推測せず安全に変えられる場合だけ提供する。本文の意味や画像の選択を AI や整形器が勝手に変えない。

## parser と安全性

フェンスコード、数式、前付け情報、明示的な除外対象は前処理で保護する。画像は `imageScanner.ts` が、空白や括弧を含む参照先、参照定義形式、HTML 画像、前付け情報のヘッダー画像を共通解析する。パスは `imageRefs.ts` が URL 復号と実体パス確認を適用し、シンボリックリンクを含め記事ディレクトリ外を拒否する。

この検査は観測済みの note 挙動を支援するもので、note の内部仕様や将来の表示を保証しない。公開前は preview と note 側の最終表示を人間が確認する。
