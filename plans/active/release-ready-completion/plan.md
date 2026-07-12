---
slug: release-ready-completion
title: note-md を clean main のリリース直前状態へ収束する
type: plan
status: live
created: '2026-07-13T05:10:00+09:00'
updated: '2026-07-13T06:25:00+09:00'
tier: C
schema_version: 1
---

# note-md を clean main のリリース直前状態へ収束する

Branch: `feat/note-md-ideal-state`
Worktree: `/Users/tekitou/kura/github.com/tekitounix/note-md`
Worktree Lease: `single active worktree`
Execution Profile: `implementation-heavy`
Resource Snapshot: `Codex セッションを利用。残量は観測不能。代替 agent への切替なし`
Local Heavy: `heavy-approved — user の完成指示に基づき ./scripts/check.sh を単一並列で実行し、失敗時に停止`
Gate Contract: `.tazuna/harness.toml` と `./scripts/check.sh`
Force Boundaries: `実投稿、実画像送信、Marketplace publish、release dispatch は行わない。public push と remote branch deletion は直前確認後のみ実行する`
Determinism Source: `./scripts/check.sh、tazuna audit、git ref 検査、隔離 VSIX 導入試験`
KB Search: `該当なし — repository と最新 tazuna 正本を直接監査`
Autonomy Scope: `ローカルの監査、修正、commit、main 統合、不要な local branch 整理、隔離 VSIX 検証`
Orchestration Pattern: `hybrid:P-F-sequential-single-agent`
Orchestration Rule: `Lead Tech が全採否を担当し、developer 制約により worker を起動しない。独立性不足は機械検査とセルフレビューで明示する`
Lead Tech: `Codex`
Primary Agent: `Codex`
Independent Reviewer: `none（実行環境の制約により同一文脈セルフレビュー）`
Worker Ownership: `current worktree の全変更を Codex が所有`
文書昇格: `検証結果を audit artifact へ反映し、完了 plan は削除する`

## Purpose / Big Picture

実装済みの改善を再監査し、リリース成果物として不足する証跡や文書を補う。検証済み commit を local main へ統合し、不要な local branch と worktree を残さず、origin へ反映する直前または確認後の反映済み状態へ収束する。

## Progress

- [x] 2026-07-13: 現在の branch、worktree、remote、tag、staged diff を再監査した。
- [x] release readiness と配布成果物を再検証する。
- [x] 必要な追加修正を実装し、正本ゲートを再実行する。
- [ ] task commit を作成し、local main へ統合する。
- [ ] 不要な local branch を削除し、単一 worktree と clean main を確認する。
- [ ] public sync の確認境界を処理し、最終状態を記録する。

## Surprises & Discoveries

- 前回完了報告時点では変更が task branch の index にあるだけで、commit、main 統合、branch cleanup は未実施だった。
- local `dev` と削除済み remote を追跡する二つの `chore/*` branch が残っている。
- origin には trunk 方針と重複する `dev` branch が残っている。
- v0.x を beta とする README に対し、Release workflow が 0.2.0 を正式版扱いする不整合があった。
- `v0.1.1` tag は main と分岐しており、自動生成リリースノートの比較元として不安定だった。
- 外部 service 層と画像処理成功経路の unit coverage が低く、安全境界の模擬試験を追加する必要があった。

## Decision Log

- `main` は origin/main と一致するため、検証済み task commit を fast-forward 統合する。
- `dev` は current product hardening と tazuna 設定に置換済みかを tree diff で確認してから local/remote cleanup 対象とする。
- 公開操作は ref とコマンドを明示した確認を経る。
- 0.2.0 の変更履歴を `docs/changelog.md` に固定し、v0 系はプレリリースとして公開する。
- tazuna の汎用 agent-harness は段階導入中の任意警告であり、製品固有でない約40ファイルを増やすため採用しない。
- 外部通信は実行せず、通信模擬でアップロード先、CORS、内容形式、予備経路を固定し、実際の WASM で SVG 変換を検査する。

## Improvement Candidates

### 今回の候補なし

- 観察: n/a
- 根拠: n/a
- 推奨反映先: rejected
- 確認要否: no
- 検証: n/a
- 状態: rejected — 候補なし。
- tazuna_origin: n/a
- upstream_ref: n/a
- misclassification_reason: n/a

## Tier Allocation

2026-07-13（developer 制約により単独実行）

| 役割 | tier | 実体 (lane) | 実行 tool | fallback |
|---|---|---|---|---|
| Lead Tech / worker / reviewer | T0 | OpenAI Codex / GPT-5 | Codex | 機械検査とセルフレビューを明示し、独立レビューを偽らない |

## Domain Coverage

| 範囲 | 観点 | 担当 | 検証 |
|---|---|---|---|
| source / CLI / Webview | 機能・安全性・効率 | Codex | unit / Extension Host |
| package / workflow | 配布・version・artifact | Codex | VSIX isolated install / listing |
| Git / tazuna | branch・worktree・運用契約 | Codex | Git refs / tazuna audits |
| docs / skill | 利用者・AI の完了導線 | Codex | docs audit / skill validator |

## Validation and Acceptance

- `./scripts/check.sh` と `git diff --check` が成功する。
- production dependency audit が 0 件である。
- 生成 VSIX を隔離した拡張ディレクトリへ導入でき、manifest、CLI、同梱物が一致する。
- tazuna の必須監査が FAIL 0 になる。
- ローカル作業ツリーは一つ、ローカルブランチは main だけ、main は clean で task commit を含む。
- 公開同期後は origin/main とローカル main が一致し、廃止対象のリモートブランチが残らない。

## Outcomes & Retrospective

完了時に監査 artifact へ結果を昇格し、この active plan を削除する。
