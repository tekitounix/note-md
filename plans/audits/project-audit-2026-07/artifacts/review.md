# 監査結果の再監査と実装判定

Target: `plans/audits/project-audit-2026-07/audit.md`
Reviewed at: `2026-07-13T06:25:00+09:00`
Reviewer: `Codex（同一文脈でのセルフレビュー）`
Axes: `事実性 / 再現性 / 重大度 / 範囲 / 優先順位 / tazuna lifecycle`

## 判定

主要結論は採用可能。17 件はソース、Git 参照、テスト、公開成果物、公式ヘルプ、現行 tazuna 監査のいずれかで再現でき、重大度を覆す反証はなかった。

## 修正した判断

1. `origin/dev` は単純統合せず、公開版 v0.1.1 の製品 hardening とテストだけを選択移植した。旧 ai-ops、旧開発フロー、cross-repository checkout は採用しなかった。
2. tazuna 同期は作業前提と最終 manifest の二段階に分けた。`setup agent-skills` は tazuna 本体専用で、adopter への正式経路は `setup agent-harness --project` の PR 生成であることを上流実装と文書で確認した。
3. 「全改善」から、実 note 投稿、実画像 upload、Marketplace publish、公開リポジトリへの push を分離した。ローカル実装は fail-closed にし、外部副作用は人手ゲートへ残した。
4. visual fidelity は DOM、CSP、Extension Host、生成 VSIX までを自動検証し、note 本番画面への実貼り付けは日付付き手動証跡を必須にした。

## 実装結果

| finding | disposition |
|---|---|
| A01-A04 | 公開版 hardening、ローカル資産、fail-closed copy、常時診断として実装 |
| A05 | `dist/cli.js` と `.agents/skills/note-writing/` として実装 |
| A06 | render、CLI、Extension Host、package journey の回帰試験を追加。実 note paste は人手ゲート |
| A07-A08 | 手動 release workflow、正しい公開導線、依存更新、0 件の production audit として実装 |
| A09-A11 | 共通画像 scanner、validator edge 修正、変換 cache、同時 upload dedup として実装 |
| A12-A13 | README/docs/harness/flake/運用表面を同期。agent-harness の公開 PR 生成は未実行 |
| A14 | 同意、timeout、CORS、memory-only cache、失敗時 copy 無効化を実装。画像送信自体は製品価値上維持 |
| A15-A17 | frontmatter 行番号、重複 slug、構成整理、ALT guidance として実装 |

## 残余リスク

- 同一文脈のセルフレビューであり、独立レビュアーではない。
- note への実貼り付けと第三者 upload service の実通信は、このローカル作業では行っていない。
- Marketplace 公開、GitHub Release、push、tazuna agent-harness PR は外部状態を変えるため、別途確認が必要である。

## 完成主張の再監査

前回の「改善完了」は棄却した。実装が index にあるだけで commit、main 統合、branch cleanup、最終配布試験が未実施だったためである。完成判定は、実装の正しさだけでなく、配布成果物と Git の収束を別々に検証する。

再監査で次を追加した。

- v0 系をベータとする README と Release workflow の扱いを一致させた。
- 分岐した旧 tag に依存する自動リリースノートをやめ、`docs/changelog.md` の対象版だけを抽出するようにした。
- 許可済みの互換範囲内で依存 lock を更新し、production audit 0 件を再確認した。
- 外部通信を模擬し、upload domain、CORS、Content-Type、fallback を検査する service tests を追加した。
- 対応画像の同一内容 dedup と、実 WASM による SVG→PNG 変換を pipeline test で確認した。
- 生成 VSIX を隔離した VS Code へ導入し、同梱 CLI の strict check を成果物単体で実行した。

## 再監査の機械証拠

| 対象 | 結果 |
|---|---|
| 正本ゲート | `./scripts/check.sh` 成功 |
| 単体試験 | 130 件成功 |
| Extension Host | 常時診断、Problems 維持、Quick Fix、preview wiring 成功 |
| 主要 unit coverage | render 98.76%、validator 97.68%、image scanner 96.23%、services 88.39%、image processor 78.41% |
| production dependency | `npm audit --omit=dev` 0 件 |
| tazuna | harness / structure / lifecycle / docs / language / security / CI / surface / nix / standard の必須失敗 0 件 |
| VSIX | 0.2.0（80 files、3.81 MB、SHA-256 `d46cb08479a92867b4361a34be8ed37460731b7ea5010c281f88e1e96f9eaa68`）を隔離導入し、manifest、CLI、同梱物を確認 |

Git の commit、main 統合、branch cleanup と公開同期は `plans/active/release-ready-completion/plan.md` の完了条件として扱い、機能ゲートの成功と混同しない。
