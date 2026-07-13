# External tool adapter contract

親ハーネスが provider CLI の引数を推測してはならない。候補集合、実行形式、完了判定は tazuna が所有する。以下は全ハーネス共通の必須手順。

```sh
tazuna orchestrate tools --json --strict
tazuna orchestrate certify --model-id <id> --capability <capability-id> --execute
tazuna orchestrate dispatch --tier <tier> --role {decision,design,execution,audit} --json
tazuna orchestrate call --tier <tier> --role {decision,design,execution,audit} \
  --plan-slug <slug> --profile <profile> --prompt-file <path> --execute
tazuna orchestrate job start --tier <tier> --role {decision,design,execution,audit} \
  --plan-slug <slug> --profile <profile> --prompt-file <path>
tazuna orchestrate job list --json
tazuna orchestrate job status <job-id> --json
tazuna feedback --draft-id <feedback-id>
tazuna orchestrate job recover <job-id> --confirm-observed --json
tazuna orchestrate job wait <job-id> --wait-seconds 60 --json
```

`Team Composition` の `Lead Tech` / `Worker` / `Reviewer` 等は CLI 値ではない。最終裁定=`decision`、設計=`design`、変更実行=`execution`、読み取り専用レビュー・監査・調査=`audit`へ、呼出しの実機能で写像する。

## Preflight

`tools --strict` は PATH 検出だけで成功してはならない。自動充当 lane ごとに次を確認し、stdout の credential / account 情報は表示しない。静的 probe は課金しない。証明が無いか期限切れなら `certify --execute` を明示的に実行する。

1. command が実行可能
2. `--version` が timeout 内に exit 0
3. subscription auth が有効
4. catalog API を持つ tool は roster の対象 model を列挙
5. lane 固有 credential directory を適用
6. model / capability / CLI version / canonical executable path+bytes / adapter / certification contract が一致する期限内 live certificate。capability は permission mode、response contract、context profile、response enforcement の固定組

`catalog_status=unverified` は provider CLI に非課金の model 列挙面がないという意味であり、model の確認済みを意味しない。全 roster を監査するときは `tools --strict-all` を使い、manual model を含む各 adapter が支える全 capability を検査する。

## Adapter matrix

| adapter | readiness | headless / prompt | 成功条件 |
|---|---|---|---|
| Claude Code | `claude auth status --json` | `-p`, stdin, JSON, session 非保存、設定源なし、safe-mode、prompt suggestion 無効、固定 name、Task無効、明示 model。read-only は`dontAsk + write/web deny`、repo-readのみRead/Glob/Grep allow | `terminal_reason=completed`、最終本文あり、`modelUsage` が指定 model だけ。formal review は `--json-schema` と `structured_output` 必須 |
| Codex CLI | `codex login status` | `codex exec --json --ephemeral --ignore-user-config --disable multi_agent`、leaf developer instruction、stdin、role 別 sandbox、明示 model | JSONL に agent message と `turn.completed`。formal review は `--output-schema` に適合する JSON 必須 |
| Grok Build | `grok models` | `--prompt-file /dev/stdin`, JSON, verbatim, memory/subagent 無効、明示 model。read-only role は `--no-plan --permission-mode dontAsk --sandbox read-only`。web は既定無効で、外部送信可能な research だけ `--allow-web` | JSON の `stopReason=EndTurn` と最終本文。`Cancelled` / `MaxTurns` / 欠落は拒否 |
| Cursor Agent | `cursor-agent status --format json` + `--list-models` | `--print`, stdin, JSON, sandbox、明示 model。read-only は `ask` (`plan` は exact response を壊すため使用禁止) | success result event と最終本文 |
| Ollama | `ollama list` | `ollama run <model>`, stdin | exit 0 と非空本文 |
| API lane | provider SDK 専用 | CLI adapter では起動しない | SDK 側の同等契約がない限り queue |

role から固定 capability を解決し、read-only capability は isolated / repo-read、execution は workspace とする。provider の plan mode を read-only の同義語にしない。prompt は argv に載せず、対話端末では `--prompt-file`、EOF のある非TTY pipe だけ `--prompt-stdin` を使う。secret、token、auth probe の stdout、思考列を artifact や chat に転記しない。

外部CLIのworker/reviewerは親Orchestratorが割り当てたleafであり、repositoryの編成規約を読んでも体制構成や面への委譲を再帰しない。Claudeはsafe-modeとTask deny、Codexは`features.multi_agent=false`とleaf developer instruction、Grokは`--no-subagents`、Cursorは読取専用ask modeとprovider descendant barrierで単一作業境界を強制する。協働thread状態の異常は`provider-collaboration-state`へ固定分類してlaneを隔離し、同じbindingで再試行しない。

`isolated` は project 内容を渡さない最小 Git context であり、全 provider 共通の host-filesystem confidentiality sandbox ではない。provider が制御面を持つ場合は repository read tool も無効化し、prompt に host の絶対 path を含めない。

session 非保存フラグを持つ provider では強制する。Grok / Cursor の現行 CLI には同等フラグがないため resume / continue を使わず、certificate の `session_policy=provider-unverified-not-resumed` で限界を明示する。これを session 非保存の証明と表現しない。

manual model も raw CLI で直接呼ばない。`call --model-id <roster id>` を使うと、tier / role / plan / certificate / lease / completion の全関門を保ち、自動 fallback だけを無効にできる。監査の formal verdict は native review capability が current の Claude/Codex に限る。Grok/Cursor は明示 `--response-contract text-v1` の独立 findings として使い、formal verdict に格上げしない。

## 親セッション補助経路

`prefer-external`で`Agent|Task`を起動する前に、通常の宣言markerへ次を追加する。`in_session_role`、起動時の`tool_input.description`と同じ`in_session_task`、`external_route_considered=true`、`external_route_outcome`（`user-requested|capability-gap|unavailable|coordination-benefit`）、`external_route`、12文字以上の`external_route_result`と`in_session_reason`を記録する。さらに`tool_name`と`tool_input`を`ensure_ascii=false`、key順、空白なしJSONへ正規化し、そのSHA-256を`tool_input_sha256`へ入れる。markerは一致する一回の起動で消費される。自由文の妥当性は充当reviewで確認する。`deny`はmarkerにかかわらず拒否し、TOML破損時も厳密な`deny`代入行を保守的に優先する。

## Failure handling

次のいずれかは成功として数えない。

- command / auth / model catalog probe の失敗
- child の非ゼロ終了
- provider の失敗終了、または観測と診断を経て明示停止された job。観測期限の到達だけは失敗ではない
- JSON parse 失敗
- final answer / completion marker の欠落
- Claude の `modelUsage` に roster 外の補助 model が出現
- 役割別 response contract の不成立
- dispatch-cap lease の child PID 再結合失敗 (child process group を停止して拒否)

失敗した reviewer を「レビュー済み」と記録しない。観測期限に達した job を失敗扱いせず、job id を保持して `status` / `inspect` で heartbeat、最終進捗、supervisor/provider 生存を確認する。進行中なら停止せず別作業を続け、完全な terminal response を `wait` で回収する。`stalled` だけでは停止せず、明示した停止条件に一致し途中成果を保全した場合だけ `job cancel --confirm-observed --reason <code>` を使う。

失敗終端では固定 `failure_cause` / action / remediation を読み、生の私有出力を会話やレビュー成果物に転記しない。容量・認証は人間対応、提供元契約不成立は対象能力の再認定、Tazuna 実行基盤は改善票へ分ける。同期 `orchestrate call` が観測する完全な読取専用失敗だけが認定済み候補へ最大 2 回代替できる。分離ジョブ、実行役、`--model-id` 明示時は再実行しない。`feedback_draft_id` があれば `tazuna feedback --draft-id ...` で確認する。自動 Issue はプロジェクト harness の明示許可だけで、`ambiguous` は固定送信先を確認後の `--confirm-ambiguous` 以外で再試行しない。

容量は account 全体と model 単体を分離する。モデル別残量を機械可読に返さない提供元で停滞した場合、停滞時刻だけで原因を決めない。利用者または提供元状態面でモデル単体枯渇を確認した後だけ、`job cancel --confirm-observed --reason provider-model-capacity-exhausted --confirmed-failure model-capacity` を使う。この確認は provider 非依存の `lane × model` 障壁となり、同じ account の他モデルを退避しない。

構造化完了または response contract の失敗は、同一 lane / model / capability が runtime quarantine される。解除は隔離 canary の `certify --execute` 成功だけで行い、通常 call の成功や時間経過で戻さない。read-only の再計測は明示的に行えるが、execution の spawn 後の不明終端だけは project / plan 単位の `needs-reconciliation` であり、状態再観測前に retry / account switch / lane fallback しない。作業木と外部副作用を確認した後だけ、`job inspect` で確認した `attempt_id` と `authorization_digest` を渡して `orchestrate reconcile --plan-slug <slug> --attempt-id <id> --authorization-digest <digest> --confirm-observed` で明示解除する。

Grok Build の失敗後に Cursor 上の Grok を手作業で起動する行為は、roster に別 lane/model として宣言され、catalog とデータ境界が検証済みの場合だけ許される。名称が同じでも別 tool 経路を同一 lane とみなさない。

## Adapter maintenance

provider CLI 更新時は help、auth、catalog、prompt pipe/EOF、role 権限、JSON schema、終了 marker、heartbeat / progress 観測、明示停止を実測し、argv と parser の fixture を同時更新する。adapter parser、共有 invocation engine、schema、certification 判定ロジックの digest 変更で既存 certificate は自動失効するため、全対象 capability を再認証する。PATH 検出だけ、自然言語の「完了しました」だけ、親ハーネスの UI 表示だけを認定根拠にしない。
