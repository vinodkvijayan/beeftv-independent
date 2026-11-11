# BeefTV built-in creative assistant evaluation platform (`agent-host/eval/`)

This catalog provides a built-in creative assistant evaluation bench (Evaluation Harness). Through the memory version of Go business authoritative simulator (`sim-go.mjs`) and 11 fixed creation scenarios (`scenarios.mjs`), the real `agent-host/server.mjs` (Durable SQLite session, operation bridge, canvas CAS and skill loading) is driven to perform regression evaluation. The `fake` mode uses local model stubs called by written tools, with zero external deductions; by only proving that the host and simulated business links can run, it cannot prove the creation quality of the real model or the acceptance of the actual Go backend and desktop interaction.

The actual Go return is run by `backend/internal/handler/timeline_delivery_integration_test.go`: official Durable, SQLite, FFmpeg, node binding and project export with materials; it will also kill the Node when Go has accepted rendering but the host has not received a receipt, and then restore it with the original session, asserting that there is only one rendering task. Models are locally scripted and no media is purchased.

真实制作的阶段报告可用 `python3 agent-host/eval/report-production.py --profile <隔离桌面数据目录> --run <证据目录>` 生成；已有素材改稿加 `--existing-media`。证据目录须有 `full-lifecycle.json` 或 `receipt.json`，提供 `startedAt/canvasId/sessionId`。脚本只读实际数据库，输出 `performance.json`，区分主模型、压缩等辅助响应、素材等待、渲染、文件可用和最后说明；并发区间取并集。视频传输的开始/结束沿用任务日志记录，旧记录和内联媒体无法细拆的阶段保持未知。费用只读已核账回执的 `actualCNY`，不采用 SDK 的默认零单价；它不替代账单核对。

---

## 1. Directory structure

- `sim-go.mjs`: Memory version of Go business authoritative simulator (`createSimGo`). Load real `operation-descriptors.fixture.json`, support `/api/ops`, `/api/ops/:id`, `/api/canvas`, `/api/canvas/operations`, `/api/assistant/runtime/turns/:id`, `/api/assistant/turns`, `/api/assistant/skills`, `/api/assistant/skills/active`, `/api/assistant/runtime/canvases/:id/skill-context` and `/api/generation-tasks`. The entrance only assembles the external interface, and the implementation is placed in `sim-go/` according to responsibilities. Each module explicitly receives the same shared state (`state.mjs`): canvas reading and writing `canvas-store.mjs` and `canvas-ops.mjs`, storyboard `storyboard.mjs`, generating proposals and submissions `generation.mjs`, task life cycle and time consumption `tasks.mjs`, media and materials `media.mjs`, skills `skills.mjs`, round authorization and revocation `turns.mjs`, operation distribution `operations.mjs`, HTTP routing `http.mjs`.
- `scenarios.mjs` (and `scenarios/index.mjs`): 11 fixed evaluation scenario definitions, deterministic checks (`checks`) and native Fake OpenAI Chat Completions SSE model stub (`createFakeModelServer`). The scene definitions and check items of S8–S11 are in `scenarios/real-failures.mjs`, the alternative scenes R1/R3/R6/R7/L1 are in `scenarios/parity.mjs`, and the shared pure functions are in `scenarios/shared.mjs`.
- `run-eval.mjs`: CLI review runner, budget gate and cost meter (`createCostMeter`), key desensitizer (`redactSecrets`) and JSON/Markdown report generator.
- `run-external-eval.mjs`: External Agent comparison driver, see "External Agent comparison" below.
- `sim-go.test.mjs`: Single test and end-to-end suite for `sim-go`, CAS conflicts, storyboard output connection binding, generation proposal and cancellation, budget circuit breaker and desensitization.

---

## 2. Run quickly

### Run the simulator and evaluate the core single test```bash
cd agent-host
bun test eval/sim-go.test.mjs
```

### Run full 11-scenario deterministic evaluation (default `--model fake`, zero-pay call)```bash
cd agent-host
bun eval/run-eval.mjs --model fake
```

### Specify single scene and custom output directory```bash
cd agent-host
bun eval/run-eval.mjs --scenario S1,S2 --model fake --runs 1 --out /tmp/beeftv-eval-report
```

### Run real model evaluation (need to explicitly configure non-zero unit price and budget upper limit)```bash
cd agent-host
BEEFTV_AGENT_BASE_URL="https://your-provider.example.com/v1" \
BEEFTV_AGENT_API_KEY="sk-..." \
BEEFTV_AGENT_MODEL="your-model-id" \
BEEFTV_EVAL_PRICE_IN="2.0" \
BEEFTV_EVAL_PRICE_OUT="8.0" \
bun eval/run-eval.mjs --model real --scenario all --runs 3 --max-requests 25 --budget-cny 25 --out /tmp/beeftv-real-eval
```

---

## 3. CLI parameters and environment variables

### CLI parameters
| Parameters | Default value | Description |
| :--- | :--- | :--- |
| `--scenario <id\|all>` | `all` | Scene identifier (supports names such as `S1`..`S11` or `shortdrama-2shot`, supports comma separation) |
| `--model <fake\|real>` | `fake` | `fake` uses the local deterministic SSE model service; `real` connects to the real model and enables the local metering agent |
| `--runs <N>` | `1` | Number of repeated runs of each scene (`1..50`) |
| `--max-requests <N>` | `25` | Maximum model request limit for a single round injected into `BEEFTV_AGENT_MAX_REQUESTS_PER_TURN` |
| `--budget-cny <number>` | `25` | Accumulate fees according to the returned usage. After reaching the threshold, stop subsequent requests and mark `aborted_budget`; the current request may cause the fee to exceed the threshold |
| `--out <dir>` | Temporary directory | Output directory path of `report.json`, `report.md`, `ledger.jsonl` and `requests/` |

`requests/` saves the original text of each model request in the order in which it is issued (from `0001.json` onwards, the key is desensitized and only the length of the inline image is left), corresponding to `seq` of the ledger. The ledger is assigned to the scene and round when the request is issued, and the session key (`prompt_cache_key` or `metadata.user_id`) in the request is used to return the late request from the previous scene to the original scene, marked `late`. Before the end of each scene, the host will wait for no ongoing rounds and in-flight requests (up to 10 seconds for fake models, up to 120 seconds for real models), and the results will be recorded as `settle` in the report.

### Environment variables (`--model real` required)
- `BEEFTV_EVAL_PRICE_IN`: Enter price (RMB/million tokens, must be `> 0`)
- `BEEFTV_EVAL_PRICE_OUT`: Output price (RMB/million tokens, must be `> 0`)
- `BEEFTV_AGENT_BASE_URL`: Model service Base URL
- `BEEFTV_AGENT_API_KEY`: Model API Key (automatically desensitized to `[REDACTED]` before writing reports and ledgers)
- `BEEFTV_AGENT_MODEL`: Model ID
- `BEEFTV_AGENT_API`: protocol type (default `openai-completions`)

---

## 4. List of fixed evaluation scenes (S1–S11)

Scoring for S8–S11 uses only structured data: canvas nodes, generation scenarios, `opLog` action records, and round records. The original reply text is only written into `detail` for diagnostic information and does not participate in keyword determination.

| Number | Scenario ID | Core Validation Objectives | Baseline Expectations |
| :--- | :--- | :--- | :--- |
| **S1** | `shortdrama-2shot` | Empty canvas to create a 2-shot skit opening: storyboard script nodes, 2 lines of complete storyboards, 2 first frame graph nodes, 2 video nodes, `image->video` connections, zero dangling media nodes | `PASS` |
| **S2** | `storyboard-8shot` | Full 8-shot storyboard, only create the first frame graph node for the first 2 shots and backfill `imageNodeId`, the 3rd-8th shot will not cross the boundary to create nodes | `PASS` |
| **S3** | `local-edit` | Preset 4-mirror canvas, only change the description of the 3rd mirror and the prompt word of the 3rd first frame, and assert that the 1/2/4 mirrors and other nodes and connections are 100% untouched | `PASS` |
| **S4** | `mid-turn-steer` | During the first round of model request, the redirection was injected through `/steer` (Ancient Martial Arts 4 mirrors -> Cyberpunk Neon Night Market 2 mirrors), and the same round of convergence was completed | `PASS` |
| **S5** | `post-generation-review` | After submitting the generation proposal, the simulator delivers a picture with a six-finger defect to test the automatic wake-up review capability (`wake-on-generation`) | `PASS` |
| **S6** | `skill-across-turns` | Only the first round of activation of the "short drama storyboarding to the first frame" skill; subsequent natural additions and confirmations, check that each request still has active skills, first frame naming and frame, valid `imageNodeId` backfill and proposed access control; no compression is triggered | `PASS` |
| **S7** | `user-requested-generation-review` | After the first round of proposals is confirmed and delivered by the user, the user actively initiates a second round of review, and the assistant checks the product, corrects the prompt word at the original node, and resubmits; the resubmission is still waiting for confirmation | `PASS` |
| **S8** | `single-image-against-skill` | The "Short drama storyboarding to the first frame" skill has been selected, but the user only needs a 9:16 vertical screen first frame: only 1 image node is built, no other nodes; when the plan is submitted, the node must be 9:16, count=1, and the node will not be written in this round after submission | `PASS` |
| **S9** | `skill-batch-limit` | After selecting the "Asset Batch Production" skill, name the protagonists Lin Xi, Chen Ye, Jiang Mo, and Su Wei, props old pocket watches, energy bracelets, scene rooftops, laboratories, and playgrounds: determine the final node based on the named entities and the targets when submitting the plan must be characters; the total number of each plan based on the target and count when submitted shall not exceed 4 pieces | `PASS` |
| **S10** | `proposal-follows-node-settings` | The user requested to resubmit the plan after changing the draft image size from 16:9 to 1:1 in the interface: Except for read-only operations and plan generation in this round, any successful operation that references the node ID will fail; the node snapshot (including the media field) must be consistent with the setup, and the plan parameters must be consistent with the current value of the node | `PASS` |
| **S11** | `recover-from-tool-error` | There is a generated picture on the canvas; for the first time in this round, the recoverable `stale_media_version` is returned for `media.inspect` of the picture, and the correct current version is required to be reviewed successfully later (the read-only overview is not considered completed); the same set of normalized error parameters is not repeated, and the round is completed without errors | `PASS` |

---

## Alternative scenarios (R1/R3/R6/R7/L1)

`scenarios/parity.mjs` defines 6 scenarios to go through "replacing the built-in assistant in DSH". They use the same set of `setup / turns / evaluate` as S1–S11, but **not enter `all`**: `all` still only runs S1–S11, with alternative scenes selected individually using `parity` or scene codes.

```bash
cd agent-host
# 外部 Agent（Claude Code / Codex / DSH）直接用场景码
bun eval/run-external-eval.mjs --scenario R1a,R3 --out /tmp/beeftv-parity-ext
# 内置宿主 + 真实模型（需要模型与预算配置）
bun eval/run-eval.mjs --model real --scenario parity --runs 1 --out /tmp/beeftv-parity
```

The built-in deterministic fake model does not have a script branch for the R scene. `--model fake --scenario parity` will run but fail; please use an external agent or real model before accessing the script. The scoring of the ruler itself can be covered by the sim-go self-test in `bun test eval/scenarios.test.mjs` (correct execution should pass all tests, and there should be at least one counterexample for each scenario).

| Number | Scenario ID | Core Verification Goal |
| :--- | :--- | :--- |
| **R1a** | `submit-wait-image` | The external Agent said "Generate the first frame of mirror 1", the picture task takes about 20 seconds: the first frame is completed and bound when the user no longer sends messages, the same node does not pay for repeated submissions, and the reply explains the result. The built-in assistant must wait for user confirmation on the interface before submitting, and is only run by external agents |
| **R1b** | `submit-wait-video` | The external Agent requires the first frame and video in one sentence. The video task takes about 135 seconds: the pictures and videos are finally completed and bound, and there is no repeated payment submission. The built-in assistant path is marked as not applicable in the same way |
| **R3** | `restart-resume` | The external agent only submitted two first frames in the first round (about 30 seconds, the user said there was no need to wait); in the second round (the new process continued the chat), it asked "Are those two frames ready?": In the second round, no new paid submissions will be added, and both frames are tied to their respective nodes. Built-in helper paths are marked as not applicable |
| **R6** | `long-film-10shot` | Divide into 5 rounds according to the built-in rhythm: In the first round, write 10 storyboards and start the first batch of first frames, and in up to 3 rounds of "continue" to complete the first frame, finally synthesize and render the timeline. The 10 lines correspond to the 10 first frame nodes one-to-one and are all bound; there is a successful rendering after the last timeline update |
| **R7** | `same-turn-multi-edit` | Change the titles and text of 4 text nodes in the same round: all 4 are correct and no changes are lost; the number of `stale_revision` is only recorded in the inspection details and is not used as a failure condition |
| **L1** | `large-canvas-locate` | Find "Remark 137" by title on the canvas with about 300 nodes and correct the text: only change this one; the number of times the canvas is read and the number of bytes returned are recorded in the inspection details |

The scoring only looks at the results: canvas nodes and binding fields, `simGo.snapshot().tasks`, `opLog` and round records; branches are not based on tool names or model names, and there is no need to change the ruler when new waiting/submitting tools are added in the future.

### Task time consumption

模拟器新增 `simGo.setTaskTiming(canvasId, { imageMs, videoMs, audioMs, defaultMs })`，按画布配置生成任务耗时。配置过的画布上，`propose → 确认` 或外部 `canvas.generation.submit` 会立即返回 `running`，任务到点后异步完成；没配置的画布保持原来的「确认后 5 毫秒完成」行为，外部提交也一样会完成，不会停在 `running`。

### Two submission paths

- Built-in host: `canvas.generation.propose`, then confirmed by the panel (`confirmProposals`), and automatically written back to the node after the task is completed. The built-in host requires that the proposal has been confirmed when calling `canvas.generation.submit`, otherwise it will be rejected according to the real backend; only the original task will be read back when the confirmed proposal is resubmitted.
- External Agent (owner token / registered client, `approvalMode=caller`): First `canvas.generation.propose` gets the canvas version and model configuration version, and then calls `canvas.generation.submit` with stable `operationId`. Successful submission is deemed to have completed the approval: the proposal will be marked as confirmed and the task will be recorded, and the runner will not confirm it again for the user. The task only delivers products, and the node still needs to use `canvas.task.bind` to write back, which is consistent with the real backend. External Agent cannot be regenerated on a node that has been successfully generated; please create a new node when you need to make another copy. This is consistent with the real backend and is the difference between external paths and built-in host confirmation paths.
- Both paths can call the read-only `task.wait` (the maximum waiting time is 25 seconds, the timeout returns `pending` and the original `taskId`, and no error is returned). The descriptor is not exposed by default, and appears in `/api/ops` after the alternative scenario setup is called `simGo.enableTaskWait()`; when it is not enabled, direct HTTP calls are also rejected as unknown operations, so the capability boundaries and tool definition volumes of S1–S11 remain unchanged.

### The runner needs to wait for cooperation

Scenario rounds can be defined with `waitForTasksBeforeTurnMs` (e.g. R3 round 2): the runner should wait for the unfinished tasks on the canvas to end before starting this round. The scene can also bring `waitForTasksBeforeEvaluateMs`, but only the built-in runner uses it to wait for tasks before scoring; the external runner does not use this field to wait for the external agent, otherwise it will cover up the problem of not waiting for the result.

A scenario can declare `runners: ['external']` (e.g. R1a/R1b/R3). When the built-in runner encounters such a scenario, it will record `not_applicable` and indicate the reason, and it will not be counted as a failure; the external runner will run as usual, and will skip the built-in scenario in the same way.


---

## 5. Core guard indicator description

1. **Structural integrity rate (`structuralCompletenessRate`)**: The number of structured assertions passed in the scene/the total number of assertions.
2. **Generate access control compliance (`unconfirmedGenerationCount` / `duplicateNodeCount` / `duplicateProposalCount`)**:
   - The number of tasks that directly trigger paid generation without user confirmation must be `0`.
   - The number of repeatedly created nodes with the same name on the same canvas, and the number of repeated proposals for the same non-failed node.
3. **Efficiency and Cost (`efficiency`)**: Number of rounds, number of model requests, number of read and write operations, input/output Token, RMB cost and time-consuming.
4. **CAS conflict recovery rate (`conflictRecoveryRate`)**: The proportion of successful recovery by rereading the latest canvas after encountering `revision_conflict`.
5. **Multi-round skill retention rate (`skillRetentionRate`)**: The retention rate of active skill request context and product constraints after only 4 rounds of dialogue in the first round of selecting skills in S6; not the retention rate after compression.

---

## 6. Known limitations and expansion methods

- **Fee threshold is not a payment hard limit**: Fees are calculated after the request returns usage, and the maximum cost for the current request is not reserved. Before the real model is accepted, the budget still needs to be authorized, and expenditures must be controlled based on the number of requests and the upper limit of model output. `--budget-cny` cannot be regarded as a deduction limit that will never be exceeded.
- **S5 automatic wake-up review (`wake-on-generation`)**: After the simulator completes the task, deliver the `task_completed` notification to `/events` and observe the host's automatic wake-up review, modify the original node prompt word, and re-register the generation order (`expectedBaselinePass: true`). If the scenario where the baseline is expected to pass falls back to `baseline_gap`, the overall report will be judged to be `failed` and exit with a non-0 status code. The maximum observation window is 120 seconds. It ends when the review of this canvas is seen and the host stops. After the real model is awakened, it takes several requests to complete the review. Waiting for 1 second will misjudge a late review as a capability gap. Within the observation window, it is proven that the host's automatic wake-up link is working properly, and the actual delivery of the production task completion event still needs to be coordinated with the backend for continued testing and acceptance.
- **S7 is a user-initiated review**: The user sends another message to initiate a review, which is scored separately from the automatic wake-up of S5. S7 cannot be used to claim that automatic renewal has been implemented. The corrected prompt word can be either `canvas.node.configure`'s `patch.prompt` (standard practice for media nodes) or `canvas.node.update`'s `prompt`/`content`; just changing other parameters does not count. Pictures and defect descriptions are provided by the simulator; the real model mode also uses simulated products and defect descriptions, which are not a measurement of the accuracy of visual judgment of real pictures.
- **Controlled error in S11**: The model tool parameter schema will first reject `media.inspect` that lacks `expectedVersion` (the error text is `Validation failed ... missing`) and will not reach the simulator; when the operation layer is directly called, the simulator rejects it according to the `media_version_required` of the real backend. The scene also uses `armNextMediaInspectError` to return the recoverable `stale_media_version` for `media.inspect` of the target image for the first time in this round, and prompts to re-read the overview to obtain the current version; `asset-s11-seed` and `res-s11-seed` declared by the node have been registered, and reading by nodeId or assetId will enter the same controlled error process. The review will only be completed if the subsequent correct version of `media.inspect` is successful. The evaluation simultaneously counts the same parameters on the model side and the simulator side and retries; replying to the original text is only for diagnosis and does not participate in scoring.
- **S6 does not test compression**: Scene has been renamed from `skill-after-compaction` to `skill-across-turns`. Tests that actually invoke Durable compression, intentionally use lossy digests, and verify skill re-injection are on `../durable-skills-cases.mjs`, run by `bun test durable-skills.test.mjs`; this review does not inherit its conclusions.
- **New scene**: Add scene definitions including `id`, `code`, `setup`, `turns` and `evaluate` to the `SCENARIOS` array of `scenarios.mjs` to automatically include it in `--scenario all`; replace the scene into `PARITY_SCENARIOS` of `scenarios/parity.mjs`, only `--scenario parity` Or scene code selection, do not change `all`.

---

## External Agent control (Claude Code / Codex / DSH)

`eval/run-external-eval.mjs` uses the same simulator and the same set of scenarios for scoring, and replaces it with an external Agent to answer: start `claude -p`, `codex exec` or `dsh --profile headless --json` once per user round (the second round will continue from the previous round of sessions), read and write the simulator through `beeftv mcp serve`, and install the canvas skills in `plugins/beeftv-skills`. The configuration directory of the external Agent is a temporary directory and does not read or write the actual `~/.claude`, `~/.codex` or `~/.dsh` of the local machine. It will be deleted upon normal termination and abnormal exit.

```bash
cd backend && go build -o /tmp/beeftv ./cmd/beeftv && cd ../agent-host
# Claude Code（Anthropic 兼容网关）
BEEFTV_EVAL_AGENT=claude ANTHROPIC_BASE_URL=https://<网关> ANTHROPIC_API_KEY=... BEEFTV_EVAL_AGENT_MODEL=<模型> \
BEEFTV_EVAL_PRICE_IN=0.2 BEEFTV_EVAL_PRICE_OUT=0.8 BEEFTV_CLI=/tmp/beeftv \
bun eval/run-external-eval.mjs --scenario S1,S2,S3,S6,S7,S8,S9,S10,S11 --runs 2 --out /tmp/ext-eval
# Codex（OpenAI Responses 兼容网关）
BEEFTV_EVAL_AGENT=codex BEEFTV_EVAL_CODEX_BASE_URL=https://<网关>/v1 BEEFTV_EVAL_CODEX_API_KEY=... BEEFTV_EVAL_AGENT_MODEL=<模型> ...
# DSH headless（模型服务商沿用本机 headless profile 的配置）
BEEFTV_EVAL_AGENT=dsh BEEFTV_EVAL_DSH_BIN="$(command -v dsh)" \
BEEFTV_CLI=/tmp/beeftv BEEFTV_EVAL_AGENT_MODEL=<服务商>/<模型> \
BEEFTV_EVAL_PRICE_IN=0.2 BEEFTV_EVAL_PRICE_CACHE=0.004 BEEFTV_EVAL_PRICE_OUT=0.8 \
bun eval/run-external-eval.mjs --scenario S1 --runs 1 --budget-cny <元> --out /tmp/dsh-eval
```

- 模拟器前有一层转发，把当前回合写进 `x-beeftv-agent-turn`，按回合判分的检查照常可用；`/business/tools` 回空列表。
- S4（中途插话）、S5（生成后自动唤醒）只有内置宿主支持，记为不适用；S6 的「每次请求都带着活动技能」只能从宿主请求体取证，不计入。技能 pin 改成在消息里告诉它技能版本，相当于用户说「我选了这个技能」。
- `--with-digest`：每轮把内置助手同款的制作摘要放在消息前面，用来量摘要对外部 Agent 的作用。
- 用量统一成三个数：未缓存输入、缓存读、输出。Claude 的 `input_tokens` 不含缓存，缓存创建并进未缓存输入；Codex 的 `input_tokens` 已含缓存，会减掉；DSH 的 `inputTokens` 就是未缓存输入。每轮另记工具调用数和耗时，summary 给出每轮平均工具调用、耗时中位数与 p90、按场景的完成数。Codex 不报模型请求次数，按「工具调用数 + 1」估。
- 用量不完整：CLI 没返回 usage、返回空对象、DSH 事件流缺 `step_end` 用量（输入和输出缺任一项也算缺）、一轮没有任何 `step_end`（包括崩溃、超时或只输出 error）或会话日志补不全时，该轮在报告里计入 `usageIncompleteTurns`，不会当成 0 元。设了 `--budget-cny` 时遇到这种轮次立即停止本场景剩余回合和后续场景，状态写 `aborted_usage_incomplete`；没设预算时只计数并继续。
- 费用：`BEEFTV_EVAL_PRICE_IN` 算未缓存输入，`BEEFTV_EVAL_PRICE_CACHE` 算缓存读，`BEEFTV_EVAL_PRICE_OUT` 算输出（元/百万 token）。没给 `PRICE_CACHE` 时按 `PRICE_IN` 算缓存读，报告 `meta.cachePriceSource` 会写成 `price_in`。
- 预算：`--budget-cny <元>` 在每轮开始前按已累计费用检查，达到上限就停，剩下的场景记 `aborted_budget`；不预留当前轮。设了预算但 `PRICE_IN`/`PRICE_OUT` 缺失或为 0 时直接报错退出，不按 0 算。
- 模拟器没有 `generation.estimate` 和 `media.review`，外部 Agent 调到时会报不支持；这是模拟器的缺口，正式后端有这两个操作。

### DSH headless driver

- `BEEFTV_EVAL_DSH_BIN`: The `dsh` executable file is found from `PATH` by default; when it is not `PATH`, the result of `command -v dsh` or the actual path in the installation package (such as `<dsh-path>`) is used.
- Isolation: A new temporary `DSH_HOME` is created for each evaluation, and the profile is initialized by dsh itself; `DSH_AGENTS_HOME` and `HOME` also point to the temporary directory and are deleted after completion. If any step in the preparation phase fails, the temporary directory will be deleted and the local `~/.dsh` will not be written.
- Model service provider configuration: read-only copy `profiles/headless/cordis.patch.yml` from source `DSH_HOME` (`BEEFTV_EVAL_DSH_SOURCE_HOME`, default current `$DSH_HOME` or `~/.dsh`) at runtime. This only contains configuration and key environment variable names, not keys.
- Credentials: Prioritize only the startup environment variable, and the variable name is taken from the key variable (`apiKeyEnv`) declared in the source configuration. When the declared variable is missing, the source `.credentials.yaml` will be copied into a copy of the temporary `0600` with permissions under `DSH_HOME`. The temporary directory will be deleted when the evaluation is completed; no soft links, no changes to the user's real credential files, and no writing to the warehouse, reports or logs.
- MCP: Use `--patch` to hang `@deepseek-ai/dsh-mcp-client`, `serverName` to `beeftv`, stdio to start `beeftv mcp serve`, env to have `BEEFTV_BASE_URL` and `BEEFTV_OWNER_TOKEN`, `toolCallTimeoutMs` to 120000. The "N tools" reported by `beeftv mcp serve` are written into the report meta.
- Tool surface: overlay closes the command line, file reading and writing, web pages, sub-agents, tasks, to-do and other built-in tools one by one, leaving only skill reading and BeefTV MCP. headless does not have a finer category switch, so it is disabled by plugin id; the actual number of tools is read back from stderr and is not inferred from the configuration. The permissions are preset with `danger-full-access` and `--approval-policy never` to avoid waiting for approval when no one is on duty.
- Skill: `plugins/beeftv-skills/skills/beeftv-canvas/SKILL.md` copied to temporary `$DSH_HOME/skills/beeftv-canvas/`.
- Chat continuation: Use `--session-id` in the second round to continue the same session; the session does not have an agent preset, and the working directory is fixed to the same temporary directory, which meets the headless chat continuation restrictions.
- Analysis: Get the final reply, `final.reason`, exit code and `tool_call` number from the `--json` event stream; in the usage of each step `status(step_end)`, `inputTokens` is uncached input, `cacheReadTokens` is cached read, and `outputTokens` is output. At least one step must have valid input and output at the same time; when there is a retry step without usage, or with only cached reading/only output, the `assistant/message`/`assistant/attempt` usage of the session log under the temporary DSH_HOME is supplemented; if there is no `zstd` command or cannot be supplemented, it will be marked as "Incomplete Usage", and it will pass silently without pressing 0.
- `BEEFTV_EVAL_AGENT_MODEL`: Optional, in the form of `provider/model` (the model id itself can have a slash); if not filled in, use the current DSH configuration, and write the actual provider, model, and inference gear into the report meta. `BEEFTV_EVAL_DSH_REASONING` can cover the inference gear, and the default configuration or `high` is used.

---

## Real backend efficiency measurement (without simulator)

`eval/real-go-driver.mjs` plus `backend/internal/handler/assistant_real_baseline_test.go`: The real backend (real canvas, permissions, scheme registration) is isolated from the Go test, and then the real `agent-host`. The model request is forwarded by the metering agent, and the input/output token, cache hit, time consumption and tool call (including the first 400 words of parameters) are recorded per request, and summarized into `summary.md` and `raw.json` by round. Paid generation will only register the plan and will not submit it.

```bash
cd backend
# 默认：脚本化假模型，只验证测量工具本身
go test ./internal/handler -run TestAssistantEfficiencyBaselineOnRealBackend -count=1
# 真实模型（费用自理；密钥只通过环境变量传入，不写文件）
BEEFTV_REAL_BASELINE_URL=https://<网关>/v1 BEEFTV_REAL_BASELINE_KEY=... BEEFTV_REAL_BASELINE_MODEL=<model-id> \
BEEFTV_REAL_BASELINE_OUT=/tmp/baseline go test ./internal/handler -run TestAssistantEfficiencyBaselineOnRealBackend -count=1 -timeout 25m
```

The model directory is provided by the local configuration written by the test; the test fails directly when the directory is empty to avoid obtaining a distorted baseline.

---

## Really generate end-to-end (will actually produce pictures and videos)

`eval/real-gen-driver.mjs` plus `backend/internal/handler/assistant_real_gen_test.go`: real host + real Go backend + real media task, follow three rounds to complete "Storyboard → First Frame → Check → Video → Cut into Film", and download the pictures, videos and finished films to the output directory.

```bash
cd backend
# 默认：本地假 OpenAI 图片/视频上游（合法 PNG 与 5 秒 MP4），零付费，验证整条流程
BEEFTV_REAL_GEN=1 BEEFTV_REAL_GEN_OUT=/tmp/real-gen go test ./internal/handler -run TestAssistantRealGenerationEndToEnd -count=1 -v -timeout 15m
# 真实网关（费用自理；密钥只从环境变量进入进程，不写文件）
BEEFTV_REAL_GEN_URL=https://<网关>/v1 BEEFTV_REAL_GEN_KEY=... \
BEEFTV_REAL_GEN_OUT=/tmp/real-gen go test ./internal/handler -run TestAssistantRealGenerationEndToEnd -count=1 -v -timeout 60m
```

- `BEEFTV_REAL_GEN=1`: Explicitly enable false mode local verification; the test will be skipped by default when it is not set and `BEEFTV_REAL_GEN_URL` is not provided.
- `BEEFTV_REAL_GEN_URL` / `BEEFTV_REAL_GEN_KEY`: Generate an OpenAI compatible gateway shared with the text model; automatically enter the real mode after setting the URL.
- `BEEFTV_REAL_GEN_MODEL`: Assistant text model, which defaults to the built-in assistant default model.
- `BEEFTV_REAL_GEN_MAX_TASKS`: The upper limit of the total number of picture/video tasks, the default is `6`; after exceeding the limit, the new plan will not be confirmed, and the reason will be reported and recorded.
- `BEEFTV_REAL_GEN_MAX_VIDEO_SECONDS`: The upper limit of seconds for a single-lens video, the default is `5`; video solutions that are extremely long or have unknown seconds are not confirmed.
- `BEEFTV_REAL_GEN_OUT`: output directory; default temporary directory. The report is `report.json` / `report.md`, the product is `artifacts/`, and `canvas.json`.
- Timeout: The default is 5 minutes for picture tasks, 15 minutes for video tasks, and 10 minutes for a single round. It can be adjusted by `BEEFTV_REAL_GEN_IMAGE_TIMEOUT_MS`, `BEEFTV_REAL_GEN_VIDEO_TIMEOUT_MS`, and `BEEFTV_REAL_GEN_TURN_TIMEOUT_MS`.
- Confirm the real `ApproveGenerationOrder` (the service method of "Confirm Plan" on the interface); the test side `/__confirm` only provides entrance and hard upper limit. Quota check, reservation and confirmation are executed serially in the same lock, and are counted according to the complete `Targets` plan. Audio and other types outside the scope of this test are directly rejected. The film review model is configured according to `ResolveMediaReviewProvider`, and `/__media-review` will report whether the parsing is successful.
- The absolute media address returned by the upstream and pointing to the upstream base address (scheme+host of `BEEFTV_REAL_GEN_URL`) will be rewritten to point to the local test proxy, and the real key will be re-injected by the proxy during download; other domain names such as CDN will remain intact. The proxy only retains `Authorization` when the scheme, hostname, and port of the redirection target are completely consistent with the upstream base address; cross-domain or subdomain redirection will first delete the authentication and then continue to follow, and the CDN signature address can still be downloaded normally.
- Any round of chat failure, task waiting timeout or task failure will immediately stop subsequent confirmation and subsequent rounds. Normal exit shares the same set of endings with `SIGINT`/`SIGTERM`: first call `/__shutdown` to stop new confirmations and share the gate lock with the confirmations, then wait for the ongoing confirmations in this process to end, then query all tasks, cancel the cancellations, query again, write reports and exit; the total ending time has a hard upper limit of 10 seconds, shorter than the 20 seconds of `WaitDelay` on the Go side, and repeated signals will not re-enter. If the within-budget confirmation has not yet been completed, the report is marked `confirmationOutcomeUnknown: true` and the related plan ID, and the test is judged to have failed. Tasks that cannot be canceled list the task ID, upstream task number, and "may still be running" in the report.
- Regardless of fake mode or real mode, the report must prove that 2 first frames, 2 videos, and 1 finished movie are successfully saved and downloaded, otherwise the test fails and points out which item is missing.
- All written text (original request text, report, `canvas.json`) are uniformly desensitized, covering the upstream key, `Bearer` header and `sk-` form key.
- `canvas.timeline.render` in round 3 is a local ffmpeg rendering task (`timeline_render ffmpeg` is shown in the report), no paid upstream is called, and `BEEFTV_REAL_GEN_MAX_TASKS` is not counted. When finishing, stop the host first and wait for the host process to exit, then query, cancel, and query again to avoid continuing to create tasks after the host is closed.
- Known limitations: `media.overview`/`media.inspect` is the main model image check, and `media.review` only accepts MP4/WAV for the review model; if the real gateway returns the image URL, it must be ensured that the URL can be downloaded by the local backend or rewritten to the proxy. The driver does not write the key to configuration or reporting.

