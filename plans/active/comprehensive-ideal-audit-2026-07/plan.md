---
slug: comprehensive-ideal-audit-2026-07
title: note-md 理想状態への収束
type: plan
status: live
created: '2026-07-13T09:00:00+09:00'
updated: '2026-07-13T20:32:00+09:00'
tier: F
schema_version: 1
---

# note-md 理想状態への収束

この計画は作業中だけの正本である。完了時は、利用者に影響する結果を変更履歴と実装へ残し、本計画、短期監査、レビュー台帳を削除する。

## 契約

- Branch: `feature/release-readiness`
- Worktree: repository root、書込みは Codex root の一人だけ
- Execution Profile: `P-F`
- Scope: note-md の安全性、検証器、プレビュー、配布、計画契約
- 正本ゲート: `./scripts/check.sh`、`git diff --check`、`tazuna check --stage pre-report`
- 自律範囲: ローカル実装、試験、監査、単一VSIX生成、ローカル統合
- 人間関門: 公開 push、release、Marketplace 公開、第三者サービスの商用許可取得
- 上流 Tazuna/Cursor lane: 改善は並行してよいが、note-md 完了の hard dependency にしない
Force Boundaries: 秘密、未信頼領域、外部送信、配布物、規約、試験は強制関門。公開操作は人間関門
Determinism Source: 固定した依存関係、実コード、ローカル検査、監査台帳
Resource Snapshot: 2026-07-13。AGENTS.md記載の技術構成と認定済み異系列監査経路を使用
Local Heavy: 全量検査と配布物生成は候補差分に一回。失敗時だけ無効になった検査を再実行
Autonomy Scope: ローカル修正、検査、監査、統合。公開送信、公開、外部契約は除外
Orchestration Pattern: P-F
Orchestration Rule: 統括一人が書込み、専門家は読取り、異系列Xは最終候補へ一回
Lead Tech: Codex root
Worker Ownership: 計画、安全性、画面・配布を分離し、統合判断は統括が行う

## Progress

- [x] 3専門監査を統合し、P-F・3波へ計画を圧縮する
- [x] 安全性、検証器、プレビュー、構築、VSIXの残差を修正する
- [x] 209件の試験、Extension Host、単一VSIX正本gateを通す
- [x] Tazuna pre-reportと異系列Xを最終候補で通す（`job-3e7cf2e397ab22cf`、ADOPT）
- [x] 第2ラウンドの署名、ローカル統合、完了記録を確定する。本記録を履歴へ固定した次のコミットで計画を削除する

## 目的

note 向けプレビュー、検証、CLI、本文コピー、画像処理を、既定で外部送信せず、入力境界で fail-closed になり、同じ配布物を一回の正本ゲートで検証できる状態へ収束させる。計画は残差閉鎖、凍結snapshot検証、署名と清掃の3波だけにする。

## Tier Allocation

基準日: 2026-07-13

| 役割 | 具体的な実体 | 作業量 | 独立性 | fallback |
|---|---|---|---|---|
| 統括・単一書込み | OpenAI Codex root | 全工程 | 統括・実装 | 人間関門 |
| 計画監査 T1 | Codex別context | 1監査 | Leadと別context | 統括直轄、独立性なしと明記 |
| 安全性監査 T1 | Codex別context | 1監査 | Leadと別context | 同上 |
| 画面・配布監査 T1 | Codex別context | 1監査 | Leadと別context | 同上 |
| 異系列 X | Anthropic Claude Opus | 最終1監査 | OpenAIと異系列 | 代替せず未完とする |
| 機械確認 T2 | ローカルtoolchain | 正本gate1回 | 決定論的 | T1へ昇格 |

- 推定内部作業量: 60–120k tokens、最終review 20–40k tokens
- 直接従量費: subscription lane のため $0 見込み。外部課金が発生する経路は使わない
- heavy gate: 最終候補に1回。修正が入った場合だけ影響試験と無効化された最終gateを再実行
- 降格条件: 3ドメイン未満かつ差分1000行未満へ縮小した場合だけ再判定。本件は該当しない

## 監査結論

旧計画は NO-GO だった。原因は P-E の過小分類、実装と台帳の乖離、存在しないstep参照、Tazuna/Cursorの不要な直列依存、同一snapshot署名の欠落、重複buildである。以下の3波へ置換し、旧step番号を参照しない。

アプリ内ブラウザに利用可能な実体がなく、実描画は自動実行できなかった。代替として描画契約試験と VS Code 拡張機能ホストを必須にし、note.com下書きへの実貼付けと端末別目視は公開前の人間関門として明記する。

## 3-wave roadmap

| wave | 内容 | 完了条件 | 状態 |
|---|---|---|---|
| 1. 契約同期と残差閉鎖 | A/NM台帳同期、入力形式・総量・同意scope、frontmatter、TOC、clipboard、atomic build、VSIX単一化を修正 | 変更面の対象試験が緑、Critical/Major残件0 | 完了 |
| 2. 凍結snapshotの単一検証 | tree hash固定、`./scripts/check.sh` で保持VSIXを1個生成、Extension Host、Tazuna pre-report、cross-vendor X、reviewer synthesis | 同一snapshotの全gate成功、Critical/Major 0、Minor全件disposition | 完了 |
| 3. 署名・統合・清掃 | orchestration signoff、検証treeの一回統合、一時計画・監査・生成物清掃 | tree hash一致、clean worktree。公開pushは別関門 | 完了。本記録の次のコミットで計画を削除 |

## closure matrix

| finding | disposition | 証拠 / 残作業 |
|---|---|---|
| A01 | fixed | 計画をP-F・3-waveへ置換。A/NMを本表へ統合 |
| A02 / NM-02 | fixed | ImgBB削除、既定送信先なし、Catbox規約URLと商用条件を同意画面へ明記 |
| A03 | fixed | remote script/style/font依存を廃止しVSIXへ同梱 |
| A04 / NM-03 | fixed | trust、workspaceState、provider別key、撤回、競合防止、workspace外送信拒否 |
| A05 / NM-04 | fixed and verified | magic判定、寸法fail-closed、100MB即時停止、bounded response/read、redirect/CORS/path境界。209件と正本gateで確認 |
| A06 / NM-07 | fixed and verified | 変換済みcloneをoffscreen描画してHTML/plain textを同時生成。描画契約試験で確認 |
| A07 | fixed and verified | stable TOC shell、mobile CSS、Extension Host成功。実端末目視は公開前関門 |
| A08 / NM-14 | fixed and verified | release ancestry、固定Actions、単一fresh VSIX実体検査成功 |
| NM-01 | fixed | 全許可形式を匿名PNGへ再encode。EXIF/GPS fixtureあり |
| NM-05 | fixed | AbortSignalを変換、batch delay、実fetchへ伝播する試験あり |
| NM-06 | fixed / signature rejected | exact tag、version、origin/main ancestry、固定SHAを必須化。署名基盤が未契約のためsigned tagは要件化しない |
| NM-08 | fixed | renderer共有allowlist。安全なHTTPSはwarning、HTTP等はerror |
| NM-09 | fixed | 未正規化形式は原本送信せず拒否 |
| NM-10 | fixed | 未閉鎖code fenceとdisplay mathを原文で診断 |
| NM-11 | fixed | SARIF URIを相対化 |
| NM-12 | fixed and verified | 未使用 marketplace SVG をVSIXから除外しarchive禁止検査に成功 |
| NM-13 | fixed and verified | production distを一時dirへ構築しrename、失敗時は旧distを復元。production build成功 |

renderer/validatorの大規模分割、OS matrix拡張、signed tag基盤は今回のrelease blockerではないため別backlog候補とし、本計画へ混ぜない。service healthは観測証拠であり、外部障害時は送信先を無効のまま保つ。

## 検証順序

1. 実装中は変更面の対象試験だけを実行する。
2. wave 1終了時に候補tree hashを記録し、以後の不要な編集を止める。
3. `NOTE_MD_VSIX_OUTPUT=<一時パス> ./scripts/check.sh` を一回実行する。これは test、production build、fresh VSIX、archive内容、license、lintを一つに束ねる。
4. 同じ候補で VS Code 拡張機能ホストと Tazuna の完了前検査を確認する。
5. 同じtreeへ cross-vendor X を一回だけ実行し、3専門reviewと統合する。
6. 指摘修正が入った場合だけ、影響試験と無効化されたstep 3–5を再実行する。

## 最終受入

- `./scripts/check.sh` と `git diff --check` が成功
- 保持した単一VSIXのversion、必須/禁止file、zip整合性が成功
- Extension Hostで診断、Quick Fix、単一WebviewPanelが成功
- Critical/Major未解決0。Minorは fix / defer / reject と根拠を記録
- cross-vendor X と2名以上のreviewer synthesisが同じtreeを承認
- review証跡に候補・artifact hash、`orchestration.json` に独立roundとsignoffを記録
- ローカル統合後のtree hashが検証済みtreeと一致し、worktreeがclean
- 公開pushとnote.com実貼付けは、明示確認後のpublish gateとして分離

## 回復

破壊的resetは使わない。atomic build失敗時は旧`dist/`を復元する。外部CLIの終端不明時は再送せずjob/receiptを照合する。外部providerが使えない場合は独立性を偽装せず、認定済みAnthropic経路だけをXとして使う。

2026-07-13 の製品候補 `28c3ce227514a2ec53dbe6539b2c6403183d488f851a04155a3d19c292164971` は、正本検査、209件の試験、拡張機能ホスト、実配布物検査、完了前検査、差分検査に成功した。配布物の SHA-256 は `a5648215334653a3753d854013ff476ea890d3290407feab309aea4025036967`。その後に同期したのは Tazuna のハーネス、スキル、レビュー記録だけで、製品コードは変更していない。

異系列監査 `job-3e7cf2e397ab22cf` は同じ製品候補を含む現作業ツリーを監査し、次の受領条件をすべて満たした。

- `receipt_recorded=true`
- `completion_validated=true`
- `selected_model_attested=true`

判定は採用、重大指摘は0件だった。第2ラウンドと署名は `orchestration.json`、詳細は `reviews/final-opus-adopt-20260713.md` に記録した。

## Domain Coverage

| 対象 | 領域 | 主担当 | 副担当 | 最終監査 |
|---|---|---|---|---|
| 画像処理、同意、送信 | 安全性 | Lead | security reviewer | X |
| frontmatter、validator、CLI | 原文検証 | Lead | roadmap reviewer | X |
| renderer、Webview、clipboard | GUI | Lead | GUI reviewer | X |
| build、workflow、VSIX | 配布 | Lead | release reviewer | X |

## Improvement Candidates

### note-md 固有の将来候補

- rendererとvalidatorの大規模分割は、行数だけを理由に今回へ混ぜず、保守性の実障害が出た時点で別計画にする。
- OS matrixと署名tagは、公開方針と署名基盤のownerが確定した場合だけ再開する。
- 観察: 今回の公開可否を左右さない保守性・署名基盤の候補である。
- 根拠: 現行の製品検査と異系列監査で重大残件は0件。
- 推奨反映先: 将来、実障害または公開方針が確定した時点の別計画。
- 確認要否: yes。公開方針に関わる場合だけ人間確認。
- 検証: 本計画の対象外として独立監査が採用。
- 状態: deferred — 現リリースへ混ぜない。
- tazuna_origin: `not-tazuna`
- upstream_ref: `n/a`
- misclassification_reason: `note-md固有の保守性と公開方針であり、Tazuna生成物の欠陥ではない`

### Tazuna 外部モデル受領経路

- 観察: 旧受領経路はプロバイダー終了後の終端 receipt 再生と leaf 起動契約で失敗した。
- 根拠: 旧 job 2件の同一障害に対し、Tazuna PR #417 の統合後は `job-3e7cf2e397ab22cf` が一回で受領・検証・モデル証明まで完了した。
- 推奨反映先: Tazuna の実装、テスト、運用契約。note-md は統合済み SHA を参照する。
- 確認要否: no。上流で統合済み。
- 検証: `.tazuna/harness.toml` の `tazuna_sha=9a6d69469d0366a417f214ccffd3f122dfb36183` と最終監査証跡。
- 状態: adopted — 上流修正を同期し、実 job で再発しないことを確認。
- tazuna_origin: `tazuna-caused`
- upstream_ref: `https://github.com/tekitounix/tazuna/pull/417`
- misclassification_reason: `n/a`

## Outcomes & Retrospective

- 既定の外部送信を廃止し、画像、同意、入力、表示、配布の各境界を閉鎖側へ統一した。
- 209件の試験、拡張機能ホスト、単一の実配布物検査、完了前検査、差分検査を同じ製品候補で通した。
- 異系列最終監査は採用、重大指摘0件。台帳の第2ラウンドと署名へ記録した。
- 重複していた外部モデル失敗は Tazuna PR #417 で原因別に修正され、note-md からの実行で受領完了を確認した。
- 公開 push、リリース、Marketplace 公開、第三者サービスの商用許可、note.com 実貼付け、端末別目視は人間関門として分離した。ローカル完成を妨げる未完作業ではない。
- KB Ingest: 対象なし。再利用可能な受領契約の知見は Tazuna の実装・テスト・運用正本へ既に昇格済み。

## 調査網羅宣言

- 必須面: ローカル計画、Git差分、コード、試験、VSIX、Tazuna、異系列review
- 探索済み: 旧plan/audit/orchestration、37 tracked差分とuntracked成果、security/GUI/releaseの実装とテスト
- 到達不能: in-app Browser実体、note.com下書きへの実貼付け、公開release
- 意図的除外: SNS、一般Web検索。ローカル実装収束には不要
