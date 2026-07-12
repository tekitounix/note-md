---
slug: project-audit-2026-07
title: note-md 全体監査
type: audit
status: open
created: '2026-07-13T04:07:19+09:00'
updated: '2026-07-13T04:07:19+09:00'
retention_until: '2026-08-12'
schema_version: 1
---

# note-md 全体監査

この artifact は、設計・実装・構成・品質・性能・AI 利用・tazuna 運用の監査結果を、採用判断まで短期間集約する。

Audit slug: `project-audit-2026-07`
Created at: `2026-07-13T04:07:19+09:00`
Target: `tekitounix/note-md`
Target ref: `7582473` (`main`, dirty only by pre-existing `.vscode-test/` and this audit artifact)
Scope: `current main、origin/main、origin/dev、v0.1.1、source、test、docs、build、release、依存関係、最新 tazuna contract`
Exclusions: `実際の note 投稿、Marketplace publish、外部サービスへの実画像 upload、実装変更`
Runs: `runs/20260713T040719+0900-codex-gpt-5.md`
Findings: `17`
Triage: `Critical 2 / High 6 / Medium 7 / Low 2`
Promotion target: `trunk convergence plan → CLI/skill proposal → fidelity/test plan`
Linked plan: `n/a`（実装完了後に削除）
Audit review: `plans/audits/project-audit-2026-07/artifacts/review.md`
Retention until: `2026-08-12`
Secret check: `no secret values, customer data, or raw private logs included`

## Executive Summary

プロジェクトの思想は妥当である。note への自動投稿ではなく、人間が書く原稿をプレビュー・検証・コピーで強化し、公開判断を人間に残す境界は維持すべきである。Markdown source を互換性判断の正本にする方針、session-only upload cache、articleDir 外への symlink 越え防止も良い。

ただし、現在の `main` はリリース済み `v0.1.1` の祖先ではなく、`origin/dev` と分岐している。`v0.1.1` に入っていた sanitizer、Webview message capability、画像処理の fail-closed、upload timeout/CORS 検証、同意 versioning、Extension Host test、VSIX 内容検査、依存修正、release hardening が `main` から失われている。現在の最大リスクは個別バグではなく、公開版より古く危険なコードを `trunk` の正本にしていることである。

機能面では、最重要要件である validator がプレビューを開いた間しか動かず、パネルを閉じると Problems が消える。CLI と note 執筆 skill は存在しない。そのため「人間と AI の両方が、意識せず note 用環境を使える」という理想像には未到達である。

## 評価

| 観点 | 評価 | 根拠 |
|---|---|---|
| プロダクト思想 | 良好 | 自動公開をせず、preview/check/copy に限定している |
| note 風 preview | 基礎は良好、保証不足 | single panel、incremental update、TOC、数式、Mermaid はあるが visual regression がない |
| validator / Problems | 要件未達 | preview lifecycle に結合し、常時 lint ではない |
| copy / image workflow | `main` は危険、`v0.1.1` は改善済み | current main は部分失敗でも copy を有効化する |
| CLI / AI skill | 未実装 | `package.json` に `bin` なし、skill directory なし |
| security / privacy | 方針は良いが main が回帰 | `v0.1.1` hardening が trunk にない |
| tests | 純粋関数は良い、主要 journey は不足 | current main は 98 unit tests、Extension Host / rich clipboard / upload integration なし |
| performance | 通常記事では十分 | 1,000行 約15ms、10,000行 約120ms、50,000行 約408ms |
| repository 構成 | おおむね compact | flat `src/` は現規模に適切。分割より重複 parser の統合が先 |
| release / tazuna | 不健全 | divergent branches、version 逆行、harness drift、Marketplace 404 |

## Findings

### A01 — Critical — 正本ブランチと公開版が分岐し、hardening が trunk から失われている

Evidence:

- `git merge-base main origin/dev` は `61062b2`、`git rev-list --left-right --count main...origin/dev` は `2 12`。
- `v0.1.1` は `main` の祖先ではない。公開 VSIX は version `0.1.1` だが current `package.json` は `0.1.0`。
- `origin/dev` には sanitizer、Extension Host test、imageProcessor test、VSIX file-list gate、tag/version validation、pinned `@vscode/vsce` がある。current main にはない。
- kura registry と `origin/main` の最新 manifest は `branch_strategy = "trunk"`、default/integration branch は `main`。

Impact: security fix、release evidence、version、運用正本が一致しない。今 `main` を基準に新機能を追加すると、公開版修正を再度実装するか、将来統合時に衝突する。

Recommendation: 全機能作業を止め、`origin/dev` / `v0.1.1` の hardening を基礎に、`main` の tazuna rename と trunk 宣言を意味的に再適用する convergence plan を最優先にする。tag は動かさず、次の公開版は `0.1.2` 以上にする。統合後に長期 `dev` を廃止する。

Disposition: `adopt immediately`。

### A02 — Critical — current main の Raw HTML / Webview / browser preview に code injection 境界違反がある

Evidence:

- `src/render.ts` は `MarkdownIt({ html: true })` で raw HTML を許可する。
- CSP は `cdn.jsdelivr.net` と `cdnjs.cloudflare.com` origin 全体を `script-src` に許可する。再現では Markdown 内の外部 `<script src="https://cdn.jsdelivr.net/...">` が出力に残った。
- Mermaid source を entity decode して HTML 本文へ挿入するため、再現では `</div><img ...>` が container 外へ出た。
- browser preview は nonce/CSP なしで raw `<script>` を含む一時 HTML を開く。
- current `previewPanel.ts` は Webview message token を検証しない。
- `origin/dev` / `v0.1.1` は `sanitize-html`、Mermaid escape、message token、localResourceRoots 縮小で対処済み。

Impact: untrusted Markdown が Webview 内の外部 code 実行や clipboard/message 操作へ進む余地がある。browser preview ではさらに CSP がない。

Recommendation: `v0.1.1` の hardening を trunk へ戻す。次段で CDN scripts を VSIX 内へ bundle し、CSP を nonce/local resource のみに狭める。「ブラウザで開く」は削除を第一候補とし、残す場合は sanitized content、CSP、mode 0600、stale temp cleanup を要求する。

Disposition: `adopt immediately`。

### A03 — High — current main は画像処理の部分失敗を成功扱いし、publish-ready でない本文をコピー可能にする

Evidence:

- `src/imageProcessor.ts:348-398` は missing / conversion failure を count して continue し、`:453-469` で partial `urlMap` を返す。
- `src/previewPanel.ts:272-286` は partial map を成功として `url-map-updated` を送り、copy button を有効化する。
- supported image の 20MB 制限は validator にはあるが upload pipeline 本体では current main が拒否しない。
- `origin/dev` は skipped/failed があれば throw し、20MB を upload 前に拒否する test を持つ。

Impact: UI が「コピー可能」と表示しても、本文に `vscode-webview` / local path が残り、note で画像が失敗する。最終成果物要件への直接違反。

Recommendation: `v0.1.1` の fail-closed を復元し、copy readiness を「全 local refs が有効な public URL を持つ」に一本化する。

Disposition: `adopt immediately`。

### A04 — High — validator が preview lifecycle に結合し、自動 lint 要件を満たさない

Evidence:

- `src/extension.ts:47` で preview open 時に初めて validation。
- change/save は `NotePreviewPanel.isActive` の場合だけ validation (`:89-102`)。
- panel dispose で `diagnostics.clear()` (`:28-31`)。
- `origin/dev` / `v0.1.1` でも同じ設計。

Impact: preview を開かない利用者、AI が編集した file、複数 document では Problems が自動 gate にならない。ユーザーが明示した重要要件に未達。

Recommendation: DiagnosticCollection を extension activation/document lifecycle に結び、preview から完全分離する。open/change/save/config change で対象 document を検査し、閉じた document だけ delete する。workspace 全走査は opt-in にする。

Disposition: `adopt immediately`。

### A05 — High — CLI と note 執筆 skill が存在せず、AI 利用の理想像に未到達

Evidence:

- `package.json` に `bin` / CLI script がない。
- `.agents/skills/`、`.claude/skills/`、`.github/skills/` に note 固有 skill がない。
- validator 自体は VS Code 非依存の API に近いが、CLI adapter と stable output contract がない。

Impact: AI は Problems を読めず、headless check も CI gate も実行できない。ユーザーが毎回書式を説明する必要がある。

Recommendation:

1. `note-md check <file...>` と `--stdin`、text/JSON/SARIF、stable rule ID、`--max-warnings`、exit code contract を追加する。
2. pure core と VS Code adapter / CLI adapter を分離する。自動修正は safe fixes だけ `--fix` とする。
3. `note-writing` skill を単一正本から各 agent surface へ materialize し、「note 記事の執筆・推敲・整形・公開準備」で自動選択される description にする。
4. skill は audience、original claim、evidence、構成、ALT、人間レビュー、`note-md check` を要求し、投稿・公開は行わない。

Disposition: `adopt after A01-A04`。

### A06 — High — 主価値である preview fidelity と rich-copy journey の回帰保証がない

Evidence:

- current main の tests は validator/render unit が中心で、`extension.ts`、`previewPanel.ts`、`imageProcessor.ts`、`codeActions.ts`、`consent.ts` が coverage report に現れない。
- loaded modules だけの line coverage は 83.51% だが、未 load の主要 adapter は 0% と同義。
- `v0.1.1` は Extension Host で command/Problems/1 QuickFix を検査するが、rich HTML clipboard、note paste、image upload readiness、visual fidelity は未検証。
- CSS/JS は `render.ts` に大きな template として存在し、desktop/mobile screenshot regression がない。

Impact: unit tests が green でも、コピー＆ペーストで公開可能という本質的価値は保証されない。

Recommendation: v0.1.1 tests を復元し、fixture article に対する HTML snapshot、security cases、frontmatter/scroll、image failure、copy-transform の DOM test を追加する。release manual gate では note staging/draft への paste、desktop/mobile screenshot、title/body/image の確認を必須 evidence にする。

Disposition: `adopt`。

### A07 — High — current release workflow と公開導線が release-ready ではない

Evidence:

- Marketplace item URL は 2026-07-13 時点で HTTP 404。README は Marketplace 検索で install できると断定する。
- current release workflow は unpinned `npx vsce`、tag/package version の不一致を検査しない、publish を常に後続実行、`continue-on-error: true`。
- tazuna CI audit は job timeout 不在、workflow-level write permission、checkout credential、workflow input の `run` 直展開を指摘。
- `v0.1.1` workflow は optional publish、version check、pinned vsce、timeouts を持つが、削除済み/非公開の旧 `tekitounix/ai-ops` checkout で失敗した。release asset 自体は別経路で存在し SHA-256 も GitHub digest と一致した。

Impact: release が失敗しても publish failure を隠し、source/tag/artifact/Marketplace の状態を一意に説明できない。

Recommendation: v0.1.1 hardening から旧 cross-repo checkout だけ除去して復元する。Marketplace 公開までは README の既定導線を Releases にする。publish は boolean input + environment + required secret + fail-closed とする。

Disposition: `adopt immediately with A01`。

### A08 — High — current main の production dependency に既知脆弱性が残る

Evidence:

- `npm audit --omit=dev`: 21 findings（high 1 / moderate 20）。根は主に `linkify-it` の quadratic complexity、`markdown-it`、Jimp 経由 `file-type`。
- renderer は `linkify: true` で user-authored Markdown を keystroke ごとに処理するため、`linkify-it` availability risk は到達可能。
- `npm outdated`: `markdown-it 14.1.1 → 14.3.0`、`jimp 1.6.0 → 1.6.1` 等。
- `origin/dev` lockfile を `npm audit --package-lock-only --omit=dev` した結果は 0 vulnerabilities。

Impact: crafted/accidental pathological input で Extension Host/Webview update が重くなる可能性がある。

Recommendation: trunk convergence で v0.1.1 lock/dependency hardening を復元し、その後 Renovate または定期 lock update を導入する。

Disposition: `adopt immediately`。

### A09 — Medium — image reference parser が複数実装され、Markdown の合法形を誤処理する

Evidence:

- image extraction、validator、render URL replacement が別々の regex を使う。
- 再現: `![x](<my image.png>)` と reference-style image は extraction 0 件、`![x](fig(a).png)` は `fig(a` と誤抽出。
- HTML `<img>`、frontmatter、Markdown inline で扱いが分岐する。
- `origin/dev` にも残る。

Impact: preview では見えても upload/cache/copy/diagnostic のどこかで欠落する。

Recommendation: markdown-it token を使う shared source scanner を 1 つ作り、source range、normalized ref、kind、local/global を返す。validator、imageProcessor、render が同じ結果を使う。

Disposition: `adopt`。

### A10 — Medium — validator のルール精度と「弾く」契約が不足

Evidence:

- pipe table は先頭 `|` 付きだけを検出し、`A | B` / `--- | ---` を逃す。
- fenced code の 0-3 space indentation と opening fence 以上の closing length を扱わない。
- current main の traversal は `includes('..')` で URL/filename を誤検出し得る。
- disabled rule ID は自由文字列で typo を知らせない。
- VS Code warning は公開を block しない。CLI exit policy もない。

Impact: false negative/positive が信頼を下げ、最終 check として使いにくい。

Recommendation: shared parser 導入後に CommonMark edge fixtures を追加する。VS Code は guidance、CLI は `--max-warnings=0` で publish gate にできる二層 contract とする。

Disposition: `adopt after A05/A09`。

### A11 — Medium — converted image cache と並列 dedup の設計が一致しない

Evidence:

- unsupported source の shortcut は source bytes の hash を引くが、実 cache entry は converted PNG bytes の hash で保存される。
- 同一 hash の2参照を同じ parallel batch で処理すると、両方が cache miss を観測して重複 upload し得る。
- `origin/dev` にも残る。

Impact: コメントに反して conversion/upload skip が効かない場合があり、外部送信回数と待ち時間が増える。

Recommendation: cache key を `{sourceHash, transformVersion}` にするか、prepared stage で source/content hash ごとに dedupe する。in-flight Promise map で concurrent duplicate を1本化し、sourceRefs をまとめる。

Disposition: `adopt`。

### A12 — Medium — docs が実装・公開状態・最新 note 仕様とずれている

Evidence:

- `docs/validator.md` は preview annotation と image low-res hint を記載するが、実装は Problems only、low-res rule は comment だけ。
- frontmatter `header` は source にあるが README/format reference にない。
- README の Marketplace install は 404。
- note 公式の「登録画像の推奨サイズ一覧」は 2026-07-10 更新で profile icon 330×330 を明記するが、`docs/image-specs.md` は「明確な推奨サイズなし」。
- 「60 パターン以上で検証」の再現 artifact が repository にない。

Impact: 人間と AI が誤った正本を参照する。

Recommendation: product docs と research evidence を分ける。`format-reference.md` は article body/heading の current verified subset に絞り、日付と公式 URL を付ける。実験 claim は audit artifact/fixture へ置く。不要な profile/membership 節は削る。

Disposition: `adopt`。

### A13 — Medium — latest tazuna contract と同期していない

Evidence:

- current manifest は tazuna SHA `52e1640`、local upstream HEAD は `73b7bb4`。harness/standard audits が drift を検出。
- local HEAD は `origin/main` より1 commit behind。その commit は `branch_strategy = "trunk"`。
- missing/old contract: `[workspace_visibility]`、`[local_execution]`、`[remote_sync]`、publication/language detail。canonical path は旧 `~/ghq`。
- structure/docs audit は root `THIRD_PARTY_NOTICES.md`、surface audit は `.vscode/settings.json` の generated/cache hide 不足を FAIL。
- `.vscode-test/` が gitignore されず 2,163 untracked-not-ignored files として見える。full gitleaks の89 findings はこの test cache を scan した結果で、tracked HEAD archive の redacted scan は no leaks。
- latest lifecycle は plan schema、remote sync、local heavy、orchestration skill を警告する。

Impact: audit noise が実問題を隠し、AI が古い path/branch/command を使う。

Recommendation: A01 の canonical branch を確定後、`tazuna migrate --update-harness` を Propose → Confirm → Execute で行う。既存 `origin/dev` の新しい visibility/local execution 設定を参照しつつ、旧 `ai-ops` token/wrapper を最新 `tazuna` に直す。

Disposition: `adopt with A01`。

### A14 — Medium — preview 表示と外部 upload の副作用が密結合

Evidence:

- current main は Markdown activation 直後に service health checks を開始し、consent 前に外部接続する。`origin/dev` は削除済み。
- preview ready 後に local image があれば自動 upload prompt/処理へ進む。
- upload consent は current main では単一 boolean で、service list 変更時も再確認しない。`origin/dev` は version + service set key で修正済み。

Impact: 見るだけの preview が network side effect と結びつき、privacy expectation と performance を悪化させる。

Recommendation: v0.1.1 consent/timeout/CORS hardening を復元する。さらに local preview は常に local-only、外部 upload は「本文コピーを準備」または明示 command の時だけにする。

Disposition: `adopt`。

### A15 — Medium — frontmatter と source mapping に edge bug がある

Evidence:

- `parseFrontmatter()` は exact first line ではなく `startsWith('---')` のため、`----` から始まる本文を frontmatter と誤認した。
- render は frontmatter を strip した後の token line をそのまま `data-source-line` に使い、editor line offset を加えない。再現では実 line 5 の h2 が `data-source-line="2"`。
- duplicate heading は同じ `id="same"` を生成する。
- `origin/dev` にも残る。

Impact: preview scroll sync、TOC navigation、hidden header feature の予測可能性が落ちる。

Recommendation: exact delimiter、line offset、unique slug suffix を test-first で直す。frontmatter を残すなら README/format reference で正式 contract 化する。

Disposition: `adopt`。

### A16 — Low — repository は概ね compact だが、最小化の方向を誤ると品質を落とす

Evidence:

- 11-12 source files の flat layout は現規模で navigation cost が低い。
- `validator.ts` の rule 分割は file 数だけ増やし、shared preprocessing の一貫性を落とす可能性がある。
- 一方 `render.ts` は renderer、CSS、browser JS、copy transform、security policy を1,311行に混在する。
- `release-hardening.test.js` の ruby count test は `render.test.js` と重複する。

Recommendation: rule-per-file 分割はしない。CLI core を作る時だけ adapter/core 境界を導入する。Webview assets の分離は local bundle/CSP/testability とセットの場合だけ行う。重複 test file は統合し、`docs/image-specs.md` は記事用途に縮める。

Disposition: `adopt selectively`。

### A17 — Low — note の最新 accessibility guidance を validator/skill が利用していない

Evidence:

- note 公式 editor help は画像 ALT を1-2文程度の端的な説明にすることを推奨する。
- Markdown image alt は render されるが、empty/generic alt を guidance する rule/skill がない。

Recommendation: `note/image-alt-empty` を warning/hint として追加し、decorative image の suppression 方法を用意する。semantic quality は opaque auto-score にせず skill checklist と人間 review に置く。

Disposition: `defer until CLI/skill`。

## 公式仕様の再確認

- [note editor help](https://www.help-note.com/hc/ja/articles/360012426133-%E3%82%A8%E3%83%87%E3%82%A3%E3%82%BF-%E8%A8%98%E4%BA%8B%E7%B7%A8%E9%9B%86%E7%94%BB%E9%9D%A2-%E3%81%A7%E3%81%A7%E3%81%8D%E3%82%8B%E3%81%93%E3%81%A8): h2/h3、引用、list、code、中央/右寄せ、画像形式、ALT guidance。
- [Markdown shortcuts](https://www.help-note.com/hc/ja/articles/4410617032217-Markdown%E3%82%B7%E3%83%A7%E3%83%BC%E3%83%88%E3%82%AB%E3%83%83%E3%83%88): h2/h3、hr、quote、fenced code、lists、bold、strike。
- [image size](https://www.help-note.com/hc/ja/articles/360010421653-%E7%94%BB%E5%83%8F%E3%82%B5%E3%82%A4%E3%82%BA%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6): text article 20MB、620px display、long edge 4,000px。
- [registered image sizes](https://www.help-note.com/hc/ja/articles/360000231642-%E7%99%BB%E9%8C%B2%E7%94%BB%E5%83%8F%E3%81%AE%E6%8E%A8%E5%A5%A8%E3%82%B5%E3%82%A4%E3%82%BA%E4%B8%80%E8%A6%A7): heading 1280×670、profile 330×330、2026-07-10 update。

公式の投稿 API が見つからないことを自動投稿の黙示許可とは解釈しない。本 project は copy/paste と人間による最終公開を境界として維持し、private/internal endpoint や browser session automation を追加しない。

## 推奨実行順

1. **Trunk convergence**: `origin/dev` / `v0.1.1` hardening を main に統合し、version と release contract を復旧する。
2. **Security / publish readiness**: A02/A03/A07/A08/A14 を closed にし、v0.1.1 VSIX と同等以上を確認する。
3. **Always-on diagnostics**: validator を preview lifecycle から分離する。
4. **Headless core + CLI**: shared scanner、`note-md check`、JSON/SARIF、exit policy。
5. **AI skill**: no-autopublish、人間主導、CLI gate、editorial/accessibility checklist を materialize する。
6. **Fidelity and journey tests**: rich-copy、paste、image readiness、desktop/mobile visual regression。
7. **tazuna convergence**: latest harness、canonical path、visibility、local execution、remote sync、agent skill contract を同期する。
8. **Docs slimming**: 公開状態と最新公式仕様に合わせ、重複/無関係な説明を削る。

## Triage

| Finding | Disposition | Promotion target | Reason |
|---|---|---|---|
| A01-A04, A07-A08, A13-A14 | adopt | `plans/active/trunk-convergence/` | 現状回復と安全境界が前提 |
| A05, A09-A11, A17 | adopt/defer | `plans/proposals/note-cli-skill/` | AI 利用の理想像を実現する次段 |
| A06, A15 | adopt | `plans/active/preview-fidelity/` | 本質価値の回帰保証 |
| A12, A16 | adopt selectively | 上記 plan と durable docs | 実装と同時に正本を減らす |

## Retention

この audit は 2026-07-13 に再監査され、採用した改善は同日の作業ブランチへ実装した。履歴上の根拠と外部確認が必要な残余項目は `review.md` を正とする。
