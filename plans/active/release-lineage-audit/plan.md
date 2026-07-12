---
slug: release-lineage-audit
title: v0.1.1 分岐後の全変更を監査し正しいリリース系譜へ統合する
type: plan
status: live
created: '2026-07-13T06:50:00+09:00'
updated: '2026-07-13T09:30:00+09:00'
tier: C
schema_version: 1
---

# v0.1.1 分岐後の全変更を監査し正しいリリース系譜へ統合する

Branch: `main`
Worktree: `/Users/tekitou/kura/github.com/tekitounix/note-md`
Worktree Lease: `single active worktree`
Session Carryover: `n/a`
Execution Profile: `audit-first-cross-cutting`
Resource Snapshot: `Codex 同一基盤の3 reviewerを並列利用。残量は観測不能。追加 lane なし`
Local Heavy: `監査中は read-only。採用後の正本ゲートは user の完成指示に基づき単一並列で実行し、失敗時停止`
Gate Contract: `.tazuna/harness.toml`、`./scripts/check.sh`、Git ancestry/tree checks
Force Boundaries: `既存 tag を移動・削除しない。release dispatch と package publish は行わない。public push は Propose -> Confirm -> Execute`
Determinism Source: `git merge-base/rev-list/diff/range-diff、両系列 source/test、正本ゲート、tree hash`
KB Search: `該当なし — repository の全履歴と現行 tazuna contract を直接監査`
Autonomy Scope: `read-only 監査、ローカル修正、検証、commit。停止は公開 push、release、tag 操作、計画外変更のみ`
Orchestration Pattern: `P-D`
Orchestration Rule: `3 reviewer は Git、security、product/release の非重複軸を担当し、Lead Tech が反証と採否を統合する。reviewer は実装しない`
Lead Tech: `Codex root`
Primary Agent: `Codex root`
Independent Reviewer: `three parallel Codex reviewers with disjoint axes`
Worker Ownership: `reviewers are read-only; root alone owns any adopted edits`
文書昇格: `永続的な release lineage 判断だけを docs/changelog または commit message に残し、完了 plan は削除する`

## Purpose / Big Picture

`v0.1.1` と `main` が共通祖先 `61062b2` から分岐した後の全変更を照合し、現行 main が誤った基点により修正を欠落・回帰させていないか判断する。問題があれば先に修正し、問題がなければ現行 tree を保持した ancestry reconciliation で 0.1.1 を次版の正式な祖先にする。

## Progress

- [x] 両系列のコミット・変更・公開成果物を台帳化する。
- [x] 3専門軸の独立監査を完了し、矛盾と反証を統合する。
- [ ] 採用した問題を修正し、tree/ancestry/全ゲートを検証する。
- [ ] clean main、単一 branch/worktree、remote sync の確認境界まで収束する。

## Surprises & Discoveries

- `v0.1.1` は `main` の祖先ではなく、共通祖先から main 側5、0.1.1側10コミットに分岐している。
- `v0.1.1` 固有の hardening は現行 tree にすべて包含または上位化されており、機能欠落はない。
- 通常 merge の試行は28 path、97 conflict hunk に達し、旧 `.ai-ops` と workflow を再混入させる危険がある。
- 現行実装には分岐由来ではない公開阻害要因があり、見出しの実体参照、画像解析、同意・サービス競合、WASM の寿命管理、第三者許諾文を修正する必要がある。

## Decision Log

- 監査結果が揃うまで `-s ours` merge を正当化しない。
- patch-id 一致だけでなく、安全不変条件と試験の意味的包含を確認する。
- 公開阻害要因の修正後に木の識別値を記録し、内容を変えず履歴上の祖先関係だけを統合する。
- 既存の `v0.1.1` tag は移動・再作成しない。

## Outcomes & Retrospective

TBD。

## Improvement Candidates

### 公開阻害要因の修正

- 観察: プレビュー、検証器、アップロードの寿命管理、許諾証跡に再現可能な不整合があった。
- 根拠: 3名の独立報告と統括担当による再現試験。
- 推奨反映先: この実行計画
- 確認要否: 不要 — ユーザーの完成指示の範囲内。
- 検証: 単体試験、拡張機能ホスト、梱包、隔離した VSIX、履歴・木の照合。
- 状態: adopted — 実装中。
- tazuna_origin: not-tazuna
- upstream_ref: v0.1.1..main semantic inventory
- misclassification_reason: n/a

## Team Composition

| 役割 | agent / owner | scope | trigger | artifact |
|---|---|---|---|---|
| Lead Tech | Codex root | 全 finding の反証、採否、実装 | 全レビュー受領後 | synthesis / final diff |
| Git reviewer | specialist A | ancestry、commit inventory、merge strategy | start | read-only report |
| Security reviewer | specialist B | v0.1.1 hardening の包含と回帰 | start | read-only report |
| Product reviewer | specialist C | 設計、テスト、release、tazuna | start | read-only report |

## Tier Allocation

2026-07-13（同一基盤の並列 reviewer 編成）

| 役割 | tier | 実体 (lane) | 実行 tool | fallback |
|---|---|---|---|---|
| Lead Tech | T0 | Codex root | local git / shell | reviewer 間の不一致を直接再現する |
| specialist A-C | T1 | Codex sub-agents | read-only local tools | root が再監査する |

## Domain Coverage

| 触る範囲 | 該当ドメイン | 主担当 | 副担当 | meta-review |
|---|---|---|---|---|
| Git refs / tags / commits | release lineage | Git reviewer | Product reviewer | Lead Tech |
| src / security tests | security / runtime | Security reviewer | Lead Tech | Lead Tech |
| docs / workflows / harness / tests | product / operations | Product reviewer | Git reviewer | Lead Tech |

## Validation and Acceptance

- `v0.1.1` 固有変更の各項目に current main の包含・置換・欠落判定がある。
- 安全性強化、コピー準備、アップロード、診断、公開契約に未説明の回帰がない。
- reconciliation 採用時は merge 前後の tree hash が同一で、`v0.1.1` が main の祖先になる。
- `./scripts/check.sh`、`git diff --check`、tazuna pre-report が成功する。
- 最終ローカル状態は clean main、単一 branch/worktree である。

## Idempotence and Recovery

監査は read-only で再実行可能。系譜統合は既存 tag を変更せず、通常の merge commit として review/revert 可能にする。
