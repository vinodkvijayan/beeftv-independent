# AGENTS.md

This document is the working convention for AI, automation tools and collaborators in the BeefTV repository. The user's current tasks take precedence over this document; this document takes precedence over personal habits. All conclusions should be traceable back to code, configurations, tests, logs, or documentation, and historical impressions should not be used to replace the current situation.

## 1. Project boundaries

BeefTV (`glanderness/BeefTV`) is a workbench for AI film, television and short drama creation, and is still under rapid development. Public interfaces, data structures, and deployment configurations may be adjusted directly; no compatibility layers are added for old fields, old APIs, or old data unless explicitly required by the task.

The warehouse consists of several units with clear boundaries but that can operate independently:

| Unit | Technology Stack | Entrance | Responsibility |
| --- | --- | --- | --- |
| `web/` | Vite, React 19, TypeScript, React Router, Ant Design, Tailwind, Zustand, TanStack Query | `web/src/application.tsx`, `web/src/router.tsx` | Workspace UI, canvas interaction, browser caching, API calls and model protocol adaptation |
| `backend/` | Go 1.26, Gin, GORM, SQLite | `backend/cmd/desktop`, `backend/cmd/server` | Local workspace API, persistence tasks, resources and external model protocol adaptation |
| `docs/` | Next.js, Fumadocs, MDX | `docs/content/docs/` | Special documentation for users and developers; see `docs/source.config.ts` for build configuration |

The root script is responsible for Wails and local development verification. Mainline does not rely on PostgreSQL, Redis, logins, or multi-tenant deployments.

## 2. Before starting work

1. First read the entry, caller, configuration, lock file and adjacent tests involved in the task; first understand the current situation, and then decide whether to abstract or refactor.
2. Use `rg` / `rg --files` to search and read related files in parallel first. Do not change irrelevant modules, dependencies, formats or user-made changes for the sake of "unifying style".
3. First form the target boundary: what the page is responsible for, what the service is responsible for, how the handler/service/repository is layered, and how data and errors flow. New helpers must eliminate true duplication or isolate clear protocols, and cannot just transparently transmit parameters.
4. Check `git status --short`. Do not overwrite, roll back, or clean up changes not made this time; do not use `git reset --hard`, `git checkout --` or wide-range deletion.
5. Use `apply_patch` for manual editing; ASCII is used by default, except for business Chinese or existing Unicode files. Comments only explain non-intuitive algorithms, core entry points, security boundaries, and reasons for downgrades.

## 3. Directory responsibilities and dependency direction

### Front-end

- `web/src/pages/`: routing page and page private hook/component; page coordination process, without directly assembling the back-end protocol.
- `web/src/layouts/`: Route-level layout, global floating layer and page shell; do not repeatedly set the global body state on the page.
- `web/src/components/`: Real cross-page reusable UI or interactive capabilities; page private components remain in the page directory.
- `web/src/services/api/`: Business API, model channel protocol, resource API; no reliance on JSX, routing or AntD hints.
- `web/src/services/`: Cross-page side effects such as files, media, sync, cache and build tasks.
- `web/src/stores/`: Cross-page status and persistence configuration; the temporary status of the page remains on the page, and the media large object does not enter `localStorage`.
- `web/src/lib/`: Pure functions, canvas algorithms, protocol conversion, design tokens and basic capabilities that can be independently tested.
- `web/src/styles/globals.css`: Variables, resets, and necessary third-party overrides; page styles take precedence over existing tokens or page styles.

### Backend

- `backend/internal/handler/`: HTTP input parameters, local workspace context, calling domain port and unified response; database query is not included.
- `backend/internal/bootstrap/` vs. `backend/internal/localapp/`: Native combined root and narrow ports; boot layer must not re-expose the giant `app.Service` method set.
- `backend/internal/task/`, `asset/`, `project/`, `generation/`: local domain contracts and implementations; new contracts may not reverse import `internal/app`.
- `backend/internal/app/`: Cross-domain orchestration and core implementation that has not yet been torn out. Provider, Protocol, custom channels and plug-ins are local extension capabilities that must be retained.
- `backend/internal/repository/`: GORM query and persistence; does not carry business policies.
- `backend/internal/model/`: Structures, enumerations, and simple model methods; no calls to external services.
- `backend/internal/provider/`: Model provider capabilities and protocol implementation.
- `backend/internal/database/`: Database connection, migration and connection pooling.
- `backend/cmd/`: Executable entry, migration and startup configuration; startup parameters must not bypass data directory constraints.

The call chain should remain as: `HTTP -> handler -> localapp/domain port -> app/domain implementation -> repository/model`; enter `generation` / `provider` / `protocol` / `outbound` when the model is required upstream.

### Plugins and documentation

- Before modifying `docs/`, confirm that the content belongs to the topic document instead of re-copying the long description to the root README. See `docs/index.md` for catalog index.

## 4. Front-end API and state contract

### Backend business JSON

The only call entry point for the business API is `http` exported by `web/src/services/api/request.ts`:

- The module writes `http.get/post/put/patch/delete`, and `http` unpacks `{ code, data, msg, reason }`. No more `request(apiClient.*)`, no more `axios.create`.
- Binary or non-envelope responses use `http.raw` (CSV, diagnostic package zip).
- `apiClient` is reserved only for interceptors and `http` internally; defaults to `VITE_CANVAS_BACKEND_URL || "/api"`.
- `request()` can still be used to test envelope unpacking and is not the calling surface of the business module.
- The backend's successful response is `{ code: 0, data: T, msg: string }`; HTTP 200 does not mean business success, `code !== 0` must throw an error. When it fails, use `ApiError.reason` / `ApiError.code` to determine the type, and do not parse `msg`. See error codes `web/src/services/api/error-codes.ts` and `docs/content/docs/backend/http-api.mdx`.
- OpenAPI 3.0 in `GET /api/openapi.yaml`. Do not generate a TypeScript client from the specification to replace the `http` module.
- The API module defines and exports the interface type; the page and React Query directly receive the unpacked `data` without repeatedly accessing `.data.data`.
- Query parameters use `compactApiParams` / `serializeApiParams`; cancellation requests pass `AbortSignal` and retain cancellation semantics.
- `FormData` Instead of manually setting `Content-Type`, let Axios generate the boundary. Failure to write the path must be thrown upward, not `catch { return defaultValue }`.

### Model Channels and Streaming Requests

- Custom channel URL/Header is still parsed by `channelRequest` of `custom-channel-relay.ts`; `createChannelTransport` of `channel-transport.ts` is actually sent. image / video / audio only group the protocol payload, and are no longer `axios + channelRequest` respectively.
- The custom channel is relayed by the local backend `/api/ai/custom`; clear `x-goog-api-key` and the old `X-Canvas-Upstream-Headers` when rebuilding headers, and do not put third-party keys into the browser URL.
- Provider-specific payload, response unpacking and state machine remain in corresponding `image.ts`, `video.ts`, `audio.ts`; do not plug into the general `request.ts`.
- Raw `fetch` only for media blob/data URLs, resources, workers or SSE; `response.ok` must be checked, passing the correct `credentials` and `signal`.
- The text task SSE is `GET /api/tasks/:id/text-events`, and the cursor is the increment event `id`; when disconnected, use `Last-Event-ID` or `?after=`, and the task ID cannot be used as a cursor.
- Agent turns off buffering/cache/gzip only for text tasks and explicit system model event flow paths; do not copy long timeouts and `proxy_buffering off` for all `/api/` requests.

### Data, cache and write paths

- Canvas, projects, tasks, assets, and large JSON use `localforage` by workspace namespace; `localStorage` only saves small configurations, current namespace, or UI preferences. The namespace (`getActiveUserScope` / `scopedStorageKey`) is only used to distinguish local storage, and changes will prevent users from reading existing data.
- BeefTV regardless of account: each backend process only serves one local workspace and will not switch during operation. Account, login, wallet, balance and deduction belong to the server API; BeefTV only remembers the current server connection and refreshes the model capability directory when switching connections. Do not add protection or testing for "switching accounts during asynchronous operations"; asynchronous writeback only needs to check whether the canvas, project, and node are still the original targets.
- The local cache when the backend is unavailable is downgraded and does not mean that the server has saved it. The UI must distinguish between "local cache success" and "server-side persistence success".
- Operations related to generation, activation, approval, permissions, deletion, uploading, quotas, accounting, and keys belong to the strong verification writing path; do not use empty IDs, default users, default permissions, or default quotas.
- Material deletion must first check the project, canvas, task and other business references; if there are references, they will be retained and returned to the source. If there are no references, the physical objects will be cleaned up. Material records shall not be deleted if physical deletion fails.

## 5. Backend response, permissions and security

- The Gin interface uniformly returns `{ code, data, msg, reason }`; upon failure, HTTP status and business `code` should express the true failure and do not wrap all errors into 200. The machine-readable reason is placed in `reason`, see `docs/content/docs/backend/http-api.mdx`.
- All object reads, updates, and deletions are verified in the service to verify the current user and resource ownership; administrator permissions are verified in the service and do not rely on the front-end hidden button.
- By default, local loopback (`localhost` / `127.0.0.1` / `::1`) and LAN private network model upstream are enabled, and only link local (`169.254.0.0/16`, etc.), unspecified, and multicast addresses are intercepted; deployments that require strict public network isolation can explicitly set `CANVAS_ALLOW_PRIVATE_UPSTREAMS=false` and pass `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` for accurate release.
- The user API Key is saved locally in the browser and may be submitted to the self-deployment backend when the task is created; only use the real key under trusted deployment and HTTPS. Logs, error reports, URLs, localStorage, and persistent task bodies must not write sensitive URLs, cookies, or API Keys.
- Production must configure explicit `CANVAS_CORS_ORIGINS`, maintain HTTPS, restrict database, backup, data directory and `.settings-key` permissions; public registration is turned off by default.
- `docs/content/docs/backend/backend-database.mdx` is updated synchronously when database fields or tables change. You cannot just change the GORM model.

## 6. Canvas, UI and Design System

- Canvas components, states, and algorithms are placed in `web/src/components/canvas/`, `web/src/stores/canvas/`, and `web/src/lib/canvas/` respectively. The event ignore selector must cover modal, popover, dropdown and other floating layers.
- Canvas drag, connect, zoom, and shortcuts take pointer capture, wheel bubbles, focus, and `data-canvas-no-zoom` / `data-canvas-wheel-scroll` boundaries into account.
- Node and object names must have discoverable pencil entries and support single-click editing; double-click or right-click cannot be the only entry. Picture nodes maintain their original proportions, and panels cannot block the main canvas space for long periods of time.
- Ant Design common themes and control states are concentrated in `web/src/lib/app-theme.ts` / `AppProviders`. Use `AppModal flush` for the product pop-up window that comes with its own shell, and `AppDrawer` for the sidebar; do not copy the Modal styles of `padding: 0`. The content casing is still `.ant-modal-container`.
- Third-party coverage is limited to specific components, and no global `.ant-modal-*`, `.dark .ant-switch-*`, `.ant-checkbox-*` or Segmented status patches will be added. Before adding a new CSS, search for a selector with the same name and return to the unique source rule for modification.
- Follow `docs/ui-design-system.md` and the three-layer token of the project: Primitive → Semantic → Component. Inline style gives priority to quoting `var(--token-name)`, and does not scatter color, rounded corners, shadows and level literals.
- Main operation, normal selection, Checkbox/Radio, and Switch are roles of different colors; permanent switching uses `aria-pressed`, and `type="primary"` only represents the current main command. Respect `prefers-reduced-motion`, keyboard navigation remains in `:focus-visible`.

## 7. Local development, deployment and data directories

### Skill list shows hard constraints

- Only skill names are displayed in the list name areas of Skill Market, My Skills and My Contributions. Description, author, version, number of files and script files, compatibility instructions, conditions of use and other details are placed in the corresponding details view. It is prohibited to restore subtitles, abstracts or "contains scripts" and other descriptive text in the list.
-On the right side, only the short gray source identification approved by the user and the necessary operations, activation status and submission progress are retained. The source identification uses short copy such as "official", "my", "market" and "plug-in". The specific source and permission description are placed in the prompt or details and are not allowed to be expanded into a second line of description.
- When adding skill information, first access the details view. Before delivery, check the list of three sub-pages to confirm that there are no additional instructions in the name area and that the details entry can read the complete information.

- Read `.env.example` and the corresponding Compose file first. Host back-end development must use `.local/project-workbench-debug`, which is ignored by Git, and explicitly specified through `CANVAS_BACKEND_DATA_DIR`; do not use `backend/data` as a development account database.
- Place `.local/cache` in the local cache; do not submit databases, upload files, `.env`, real keys, build products, or editor configurations.
- Host development: `backend/` runs `CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug go run ./cmd/server`, `web/` uses Bun and Vite; do not use pnpm/npm to cover the same set of `node_modules`, and do not submit `pnpm-lock.yaml` or `package-lock.json`. Docker hot updates use `docker-compose.dev.yml`; local build runs use `docker-compose.local.yml`.
- Standalone Compose uses `docker-compose.yml` (SQLite data volume, backend, web), and source code construction can be superimposed on `docker-compose.build.yml`. The public network only exposes the `3000` of the web, and the backend `8080` remains in the Compose network.
- The dev server is not started by default; it will only be started if the user explicitly requests browser preview or joint debugging, and the port, data directory and existing processes must be confirmed first.
- The only official application path for macOS is `/Applications/BeefTV.app`. Only run `./scripts/update-local-beeftv-app.sh` when native applications need to be updated; do not retain `build/bin/BeefTV.app` as a usable version, and do not copy, rename, or archive additional copies of `.app`.
- Health checks can only prove that the portal is available and cannot replace login, SSE, task generation and resource access verification.

## 8. Verify discipline

Projects currently do not automatically run syntax checks, type checks, tests, or builds by default. When the user explicitly requires verification, or the risk of change requires verification, select the minimum sufficient command according to the scope, and record it truthfully in the delivery:

- Front end: `cd web && bun run build`; `bun test ...` for special testing. The UI exit rule uses `bun run lint` (only antd Empty and static `Modal.confirm` are prohibited, not style checking).
- Backend: `cd backend && go test ./...`; when resources, tasks or permissions are involved, the corresponding integration/smoke path will be supplemented.
- The old built-in Agent has been retired from the product running surface: `/agent/*` route is no longer registered, general task creation, task retry and task Worker reject `cloud_agent`, `cloud_agent_step`, `agent_memory_compact`, old rounds and memory compression scheduling remain disabled, and historical data is retained. The replacement kernel of the current branch uses the official pi SDK selected in `agent-host/`. Go manages the runtime, business rounds and operation authorization; React uses `/api/assistant/*`. The host only has a Durable execution runtime: the old JSONL session has a read-only history. Sending a new message in the old session will open a new Durable session with handover instructions, and the create/prompt/replace/abort execution path of the old SDK will not be restored. Check the official API and the actual access path, and you cannot restore the old entrance or create a new model session loop; zero model host verification, real business operations, paid model acceptance and official release are recorded separately as evidence.
- Documentation station: `cd docs && bun run types:check` or `bun run build`.
- When UI changes can be verified by the browser, key routing, light and dark themes, scrolling, pop-up windows, empty states and core interactions are checked; if verification cannot be performed, alternative basis is provided, and static reading or `git diff` is not written as running verification.

Stop the blind trial when similar failures occur three times in a row, record the phenomena, excluded items, and new hypotheses, and then switch paths or ask the user to make a decision.

## 9. Documentation and Delivery

- 根 `README.md` 只保留项目定位、能力概览、快速开始、部署、安全和文档入口；详细专题写入 `docs/content/docs/`。
- `README.md` 是根 README 的中文准稿；每次修改 `README.md` 时，同步更新 `README.en.md`，并在两个文件顶部保留语言切换链接。
- 功能与代码地图分别维护在 `docs/content/docs/overview/features.mdx`、`docs/content/docs/backend/code-map.mdx`。尚未确认的实现状态保留在任务或拉取请求中，不写入公开产品文档。
- API、数据表、SSE、资源存储、部署或安全边界变化时同步对应专题文档；不要只改代码和根 README。
- 文档默认中文，不写过期日期，不公开密码、Token、Cookie、真实账号、机器敏感路径、会话编号、飞书表编号、内部授权记录、预算金额、线上日志编号或客户与内部人名；提交说明和 PR 描述里也不写这些内容。命令、端口、环境变量必须以当前脚本和 Compose 为准。
- Git 提交说明使用 `<type>(<scope>): <业务模块> - <变更摘要>`，`type` 为 `feat|fix|refactor|perf|docs|test|build|ci|chore|revert`。
- 团队协作流程（交叉 review、付费授权、预算与合并/发版审批）另见团队私有工作约定，不在公开仓库维护。AI 代理默认不直接合并 PR 或发版。

Before delivery, at least check: whether the changes are focused, whether the caller and type are synchronized, whether errors/permissions/data ownership are complete, whether necessary documents are synchronized, whether the verification is truthful, whether keys or local data are left, and **actively review Section 10 "Preventing Shit Mountains" item by item and run `node scripts/structure-budget.mjs`** (without user reminder).

## 10. Prevent shit mountains

The reconstructed structure is maintained by the following points, which are also applicable when fixing bugs and adding functions; each change must be actively self-checked before submission or delivery, without waiting for users to ask:

- 同一个结论只在一处计算。任务能否重试、能否取回只读后端 `task.outcome`，前端不另行推断或补写；模型能力、协议、扣费结论和错误归类归服务端 API。
- 客户端不加参考素材（尺寸、比例、像素、大小、格式、时长等）预检门禁；上游报错脱敏、真实原因透传与具体素材定位（如「第 N 张参考图 `@图片N`」）统一在服务端 API 完成，BeefTV 只展示与透传。
- 不新增按模型名写的规则。内置渠道的差异交给服务端 API；自带 Key 的第三方渠道写成协议插件（`plugin-packages/`）。
- 新代码不放进 `backend/internal/app`，放到对应领域包；新包不得 import `internal/app`。
- 已发布的数据库迁移版本不改，只追加新版本。
- 测试测行为，不读源码文字做断言。
- 修 bug 前先查这条规则写在几处；有多处就先合成一处再修。
- 文件超过约 800 行且最近常改、常修时，在本次改动里按职责拆开；不为拆而拆。
- `node scripts/structure-budget.mjs` 记录几项结构数字：`internal/app` 行数、超过 1000 行的文件（含 CSS）、源码里写死的模型和厂商名、直接依赖 `*app.Service` 的 handler、读源码文字的测试。CI 只允许它们变小；确需变大时在 PR 说明里写清理由，再运行 `--update`。同一轮也运行 `node scripts/deadcode-budget.mjs`，死代码只许减少，确需增加时在 PR 说明理由，不能直接更新基线。
- 每周花半小时铲屎：运行 `node scripts/structure-budget.mjs --hotspots 7` 看近 7 天修 bug 最集中的文件，挑一处拆开或合并规则，再运行 `--update` 收紧基线；发版前关掉已经过时的 PR。
