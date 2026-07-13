---
name: orchestrate-task
description: Use for implementation/design/fix/build/refactor, and for research/investigation tasks (調べて/調査/研究/research/investigate/survey). Scope → P-A..P-F or research branch → team/cost → confirm (new work) or expert agreement (plan step) → execute per decisions §12.
---

# orchestrate-task

運用核 §11 の入口。実装系依頼では範囲分類 → profile → 体制 → 承認/合意 → 着手。調査系依頼 (調べて / 調査 / 研究) も対象で、手順 1 の調査分岐へ進む。

## 起動条件

implement / fix / build / migrate、実装して / 直して / 作って / 移植して 等が含まれるとき、変更前に適用。読み取り専用の軽い参照 (説明・単発 grep/Read) は省略可。ただし調査依頼 (調べて / 調査 / 研究 / research / investigate / survey 等) は読み取り専用でも対象で、省略せず手順 1 の調査分岐 (4 軸見積もりの代わり) を通す。

**外部leaf**: 親から割り当てられた役割だけを実行し、統括・再委譲・子worker起動をしない。

## 手順

### 1. Scope 推定

着手前に 4 軸を見積もる。観測不能は `unknown`。推測で「小さい」と決めつけない。

調査系タスク (調べて / 調査 / 研究) は 4 軸見積もりの代わりに次を通す: **情報源選定** (project の `.tazuna/harness.toml::[kb]` 地図 + 同 skill の `references/research-routing.md`(tazuna 本体では `docs/design/research-routing.md` が正本) の判断表から `required` を導出) → **面への委譲** → **終了時の網羅宣言** (`references/research-coverage-declaration.md` 様式で `required` / `searched` / `unavailable` / `skipped+理由` + 出典)。**P-C 相当の目安** (開始時宣言の要否。機械判定は `tazuna orchestrate classify` が `research route` として返す): 単純な事実確認 (`simple`) = 単独・数回のツール呼び出し / 比較調査 (`comparative`) = 小規模並列 / **横断調査 (複数面 × 役割分割) または機密度の高い調査 (`cross`) = P-C 相当 (開始時宣言が必要)**。それ未満は終了時の網羅宣言のみで足りる。調査タスクの編成根拠は LOC 規模でなく research route。判断表・面の定義の詳細は `references/research-routing.md` が正本 (配布先でも同 skill 配下から到達可能)。

- **推定行数**: 新規+変更+テストの概算
- **影響モジュール数**
- **設計確度**: 高 / 中 / 低
- **可逆性**: 可逆 / 困難 / 不可逆

### 1.5. ドメイン洗い出し

対象が属するドメインを列挙。出典: `.tazuna/harness.toml::[orchestration.domains]` (無ければファイル所有権)。複数ドメイン同居は担当をドメイン境界で分割。複数ドメイン → マルチドメイン → P-C 以上。

### 1.6. ローカル負荷分類

重量級候補 (nix / release build / workspace 全体 test 等) は着手前に分類。`[local_execution]` 宣言を優先。必要時はコマンド・目的・代替不可理由・並列上限・停止条件を提示し確認。許可後は低負荷既定 (`nix --max-jobs 1`、`CARGO_BUILD_JOBS=1` 等)。`tazuna run-heavy --dry-run` → `--confirm` で実行。

### 1.7. 作業形状の確定 (tier 帯の上流)

規模 (profile) と並べて作業形状を分類し、各役割の tier / cost_class / local|frontier 帯を先に固定する (`docs/design/orchestration.md §11`)。優先順: 機密/ローカル限定か (拒否権 → local 限定) → context が local 実効窓を超えるか (→ local 除外) → 実装詳細が閉じているか (未確定判断や広い context が残るなら T1/T0 が直接実装、閉じた機械作業だけ T2 裁量) → 判断は単独か非相関要か (非相関 → T0+X)。**T2 は低知能/economy の同義語ではなく、コストだけを理由にモデル知能を落とさない**。無人ロングランは §11.4 の checkpoint / canary / サンプリング監査を課す。

### 2. Profile 選択

複数条件は最上位 profile。

| scope | profile | team | 明示確認 |
|---|---|---|---|
| LOC<100・単一・確立・可逆 | **P-A** | 単独 + self-review | 省略可 |
| LOC 100-300・単一・軽微新規・可逆 | **P-B** | Lead + 専門家 + self-review | 必要 |
| LOC 300-800・2-3 モジュール or 中確度 | **P-C** | Lead + 専門家 2-3 + 批判的 + self-review | 必要 |
| 低確度 or 仕様レビュー | **P-D** | P-C の team + 設計修正ループ | 必要 |
| 不可逆・本番・security/data | **P-E** | P-D の team + 独立モデル critique | 必要 |
| 横断・LOC>1000・cross-cutting | **P-F** | full pipeline + cross-vendor + Lead 専任 | 必要 |

P-A 省略可: (1) LOC<100 単一 (2) 確立 pattern (3) 可逆 (4) secret/破壊/環境変更なし (5) 重量級なし (6) Kernel §2-§5 非該当。いずれか外れれば P-A でも確認。

### 3. Team / cost 提示

CLI の `--role` は担当名でなく機能語彙。裁定=`decision`、設計=`design`、変更=`execution`、読取専用レビュー/調査=`audit`。詳細は`references/tool-adapters.md`。

- **profile** + 判定理由
- **外部ツール解決** — 内蔵補助エージェント一覧を正本にせず、外部CLIを既定のworker/reviewer経路とする。`tazuna orchestrate tools --json --strict`で実行ファイル・版・認証・モデルを検証する。起動・観測・停止・失敗処理は`references/tool-adapters.md`に従い、生のCLIや無断代替を使わない。
- **親セッション経路** — 利用者指定、外部CLIの能力差・不能、同一親内の調整適合時だけ補助利用する。外部観測と理由を一回消費markerへ記録する（`references/tool-adapters.md`）。同一親はX・独立reviewへ数えず、repositoryの`deny`を優先する。
- **充当宣言** (`§27` 追補) — 役割、知能帯、レーン/モデル、実行ツール、推論量、代替を**チャットで表にする**。降格 3 条件 (タスクカード / 機械化完了判定 / エスカレーション)、統括型|相談役型、X 予約を添える。推論量は名簿から選び、既定外を理由付けする。P-C+ は `## Tier Allocation` へ転記。外部実行は `--prompt-file`、非TTY EOF pipe だけ `--prompt-stdin` とし、`tazuna orchestrate call --execute` に集約する。宣言markerの作成は`references/tool-adapters.md`に従う。
- **ドメイン割当** (マルチドメイン時必須)
- **cost** (token + USD、fan-out 時は内訳)
- **ローカル負荷** + 制限
- **実行順序** (unit / review pipeline)
- **承認要否**: 新規作業 — P-A 軽微のみ自動着手、他は明示承認待ち。計画内 step — 専門家合意で自律 (`§12` Plan-Scoped Autonomy)。**宣言と確認は別物**: 充当宣言は毎回・無条件、人間確認は新規作業の Go 関門 1 回に集約する (`[orchestration].confirm_granularity = "per-wave"` を人間が宣言した repo のみ波ごと確認)

### 4. 承認 / 合意

**新規作業** (active plan なし、または Implementation Order 外): P-A 軽微以外は profile/team/cost を提示しユーザー確認 1 回。確認前に code 変更・PR・外部 API 禁止。

**計画内手順** (`plans/active/<slug>/plan.md` の実装順序): 統括役と専門家合意（判断記録 / 統合）で自律。**完走**: 「最後まで」指示時はレビュー→修正→統合（squash）→ 計画内実行（事前確認済みの横断書き込みを含む）までを既定とする。**中〜大規模**では完走範囲に独立レビュー（同一セッションの自己監査は独立に数えない）→ 統合 → 作業台帳 `orchestration.json` の署名を含める。署名欠落のまま完了宣言しない。事前確認が緑の計画内環境操作は統括役の採択で実行してよい。計画承認後に計画内手順を人間の再確認待ちに落とすのは既定禁止。

**人間 escalation のみ**: (1) plan / Autonomy Scope / session の明示停止 (2) E1–E9 (`templates/escalation-contract.md`) (3) secret 露出等 不可逆かつ計画外 (4) 契約欠陥 (`§38`)。AI 独自 Safety 発明で止めない。`status=blocked` 時は Decision Log に `Human Gate Reason:` または `人間必須:`。

### 5. 着手

**新規**: ユーザー確認後に提示順で実行。**計画内**: 専門家合意後に着手 (人間再 Confirm 不要)。scope 大幅変化で profile 再適用 (例: 200 行→600 行で P-B→P-C)。

## 関連 skill

- **self-review**: 完了報告 / PR 前。team の最終 step
- **review-synthesis**: P-C+ で reviewer 2 人以上
- **monomi**: fetch 不能な一次情報

## CLI

`classify` / `tools` / `dispatch` / `call` / 非同期jobの検証済み構文と完了契約は`references/tool-adapters.md`。最終判断はエージェント (新規時はユーザー)。

## Override / 違反

閾値 override は `.tazuna/harness.toml::[orchestration]`。`audit lifecycle orchestration-contract` は入口配線のみ検査。`declaration_gate`はmarkerなしの起動を拒否する。`prefer-external`は外部経路の評価と理由を持つ一回消費markerを要求し、`deny`は常に拒否する。

## See Also

- `AGENTS.md §11` / `docs/decisions.md §12` — Plan-Scoped Autonomy / Finish-through / Human-Defined Safety
- `docs/operation.md::Execution Profile` / `templates/plan.md`
- `references/research-routing.md` / `references/research-coverage-declaration.md`(同 skill 配下の配布用複製。tazuna 本体の正本は `docs/design/research-routing.md` / `templates/research-coverage-declaration.md`) — 調査タスクの判断表・網羅宣言様式
- `references/tool-adapters.md` — 外部 CLI の検証済み起動・完了・失敗契約
