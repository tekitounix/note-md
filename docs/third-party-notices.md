# 第三者通知

note-md は MIT ライセンスで公開され、VSIX には次の実行時依存と推移依存を実行資産として同梱する。各構成要素には上流のライセンスが適用される。同梱した版の著作権表示、許諾文、NOTICE は [`third-party-licenses.txt`](third-party-licenses.txt) に生成・収録する。依存関係全体の版は `package-lock.json` を正とする。

| 構成要素 | 主な用途 | ライセンス | 上流 |
|---|---|---|---|
| markdown-it と推移依存 | Markdown parse | MIT、BSD-2-Clause、Python-2.0 など | <https://github.com/markdown-it/markdown-it> |
| sanitize-html と推移依存 | HTML allowlist | MIT など | <https://github.com/apostrophecms/sanitize-html> |
| Jimp、@jsquash/webp | raster 画像変換 | MIT、Apache-2.0 など | <https://github.com/jimp-dev/jimp>、<https://github.com/jamsinclair/jSquash> |
| @resvg/resvg-wasm | SVG rasterize | MPL-2.0 | <https://github.com/nicolo-ribaudo/resvg-js> |
| Highlight.js | code highlight | BSD-3-Clause | <https://github.com/highlightjs/highlight.js> |
| KaTeX | 数式表示と font | MIT | <https://github.com/KaTeX/KaTeX> |
| Mermaid | diagram 表示 | MIT と推移依存の各 license | <https://github.com/mermaid-js/mermaid> |
| yaml | frontmatter parse | ISC | <https://github.com/eemeli/yaml> |

コード表示、数式表示、図表示の三つのライブラリは公開配信網から取得せず、`dist/` に同梱した版だけをプレビューで読み込む。Font Awesome は使用しない。

## 外部画像送信サービス

外部送信は既定で無効である。利用者が Litterbox を明示設定し、対象ワークスペースで同意した場合だけ、ローカル画像をメタデータなしの PNG と匿名名へ変換して `litterbox.catbox.moe` へ送信する。このサービスは本プロジェクトが運営するものではなく、利用条件、個人情報の扱い、保存期間、記録、不正利用対応は提供者の規約に従う。記事本文、前付け情報、原画像の EXIF、認証情報、Cookie は送信しない。
