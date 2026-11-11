# AGENTS.md

Working rules for AI tools and collaborators in this independent English edition of BeefTV. The current user task overrides this file. This file overrides personal habit. Conclusions must trace back to code, config, tests, logs, or docs.

The Chinese original is in [archive/zh/AGENTS.md](archive/zh/AGENTS.md).

## 1. Project boundary

BeefTV (`glanderness/BeefTV`) is a workspace for AI video and short-form production and is still moving quickly. Public interfaces, data shapes, and deploy config can change directly. Do not add compatibility layers for old fields, APIs, or data unless the task asks for that.

| Unit | Stack | Entry | Responsibility |
| --- | --- | --- | --- |
| `web/` | Vite, React 19, TypeScript, React Router, Ant Design, Tailwind, Zustand, TanStack Query | `web/src/application.tsx`, `web/src/router.tsx` | Workspace UI, canvas interaction, browser cache, API calls, model protocol adapters |
| `backend/` | Go 1.26, Gin, GORM, SQLite | `backend/cmd/desktop`, `backend/cmd/server` | Local workspace API, durable tasks, resources, external model protocols |
| `docs/` | Next.js, Fumadocs, MDX | `docs/content/docs/` | Topic docs for users and developers. Build config is `docs/source.config.ts` |

Root scripts cover Wails and local verification. The main line does not depend on PostgreSQL, Redis, login, or multi-tenant deploy.

## 2. Before changing code

1. Read the entry points, callers, config, lockfiles, and nearby tests for the task. Understand the current behavior before abstracting.
2. Search with `rg`. Do not restyle unrelated modules, dependencies, or the user's existing edits.
3. Decide the boundary first: what the page owns, what the service owns, how handler, service, and repository split, and how data and errors move. A new helper must remove real duplication or isolate a real protocol.
4. Check `git status --short`. Do not revert or delete changes you did not make. Do not use `git reset --hard`, `git checkout --`, or a wide delete.
5. Prefer ASCII in new text. Comments explain non-obvious algorithms, core entries, security boundaries, and why something degrades.

## 3. Directory ownership

### Frontend

- `web/src/pages/`: route pages and page-private hooks or components. Pages coordinate. They do not assemble backend protocol payloads.
- `web/src/layouts/`: route layouts, global overlays, and shells. Do not set global body state again inside a page.
- `web/src/components/`: UI reused across pages. Page-private components stay with the page.
- `web/src/services/api/`: business APIs, model-channel protocols, resource APIs. No JSX, router, or Ant Design toasts.
- `web/src/services/`: files, media, sync, cache, and generation tasks.
- `web/src/stores/`: cross-page state and persisted config. Page-local state stays in the page. Large media does not go into `localStorage`.
- `web/src/lib/`: pure functions, canvas algorithms, protocol conversion, design tokens.
- `web/src/styles/globals.css`: variables, reset, and required third-party overrides.

### Backend

- `backend/internal/handler/`: HTTP input, local workspace context, domain ports, and the shared response. No database queries.
- `backend/internal/bootstrap/` and `backend/internal/localapp/`: local composition root and narrow ports. Startup must not re-expose the giant `app.Service` method set.
- `backend/internal/task/`, `asset/`, `project/`, `generation/`: local domain contracts. New contracts must not import `internal/app`.
- `backend/internal/app/`: cross-domain orchestration and core code that has not been split out. Provider, protocol, custom channels, and plugins stay as local extension points.
- `backend/internal/repository/`: GORM queries and persistence. No business policy.
- `backend/internal/model/`: structs, enums, and simple methods. No outbound calls.
- `backend/internal/provider/`: model vendor capabilities and protocols.
- `backend/internal/database/`: connection, migrations, and pool.
- `backend/cmd/`: executables, migrations, and startup config. Flags must not bypass the data-directory constraint.

Call chain: `HTTP -> handler -> localapp/domain port -> app/domain implementation -> repository/model`. Model upstream goes through `generation`, `provider`, `protocol`, or `outbound`.

### Plugins and docs

- Confirm a `docs/` change belongs in a topic doc. Do not paste a long guide back into the root README. The index is `docs/index.md`.

## 4. Frontend API and state

Business JSON goes through `http` from `web/src/services/api/request.ts`.

- Modules call `http.get/post/put/patch/delete`. `http` unwraps `{ code, data, msg, reason }`. Do not call `request(apiClient.*)` or `axios.create` again.
- Binary or non-envelope responses use `http.raw`.
- `apiClient` is for the interceptor and `http` only. Default base is `VITE_CANVAS_BACKEND_URL || "/api"`.
- Success is `{ code: 0, data: T, msg: string }`. HTTP 200 is not business success. `code !== 0` must throw. Classify failures with `ApiError.reason` and `ApiError.code`, not by parsing `msg`.
- OpenAPI 3.0 is `GET /api/openapi.yaml`. Do not replace `http` with a generated TypeScript client.
- API modules export their types. Pages and React Query consume the unwrapped `data`.
- Query params use `compactApiParams` / `serializeApiParams`. Pass `AbortSignal` through and keep cancel behavior.
- Do not set `Content-Type` on `FormData`. A failed write must throw, not `catch { return defaultValue }`.

Model channels and streams:

- Custom channel URL and headers are resolved by `channelRequest` in `custom-channel-relay.ts`. The send path is `createChannelTransport` in `channel-transport.ts`.
- Custom channels are relayed by the local backend at `/api/ai/custom`. When rebuilding headers, drop `x-goog-api-key` and the old `X-Canvas-Upstream-Headers`. Do not put a third-party key in a browser URL.
- Provider payload, response unpacking, and state machines stay in `image.ts`, `video.ts`, and `audio.ts`.
- Raw `fetch` is only for media blobs, data URLs, resources, workers, or SSE. Check `response.ok` and pass `credentials` and `signal`.
- Text-task SSE is `GET /api/tasks/:id/text-events`. The cursor is the increasing event `id`. Reconnect with `Last-Event-ID` or `?after=`. The task id is not the cursor.

Data and writes:

- Canvas, projects, tasks, media, and large JSON use workspace-scoped `localforage`. `localStorage` is for small config and UI preferences. Changing the namespace (`getActiveUserScope` / `scopedStorageKey`) hides existing data.
- One backend process serves one local workspace. Account, login, wallet, balance, and billing belong to the server API. Do not add protection for "the account changed during an async write". An async write only checks that the canvas, project, and node are still the original target.
- A local cache used while the backend is down is a fallback. The UI must distinguish "saved locally" from "persisted on the server".
- Generation, activation, approval, permission, delete, upload, quota, billing, and keys are strict writes. Do not fill in an empty id, a default user, a default permission, or a default quota.
- Deleting media checks project, canvas, task, and other references first. If something still references it, keep it and return the source. Delete the database row only after the physical object is gone.

## 5. Backend responses, permission, and security

- Gin returns `{ code, data, msg, reason }`. On failure, both the HTTP status and the business `code` must say it failed. Do not wrap every error as 200. Machine-readable cause goes in `reason`.
- Reads, updates, and deletes check the current user and resource ownership in the service. Admin permission is checked in the service, not by hiding a button.
- Loopback and private LAN model upstreams are allowed by default. Link-local (`169.254.0.0/16`), unspecified, and multicast addresses are blocked. Set `CANVAS_ALLOW_PRIVATE_UPSTREAMS=false` and allow hosts with `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` when a deploy must stay on the public internet.
- User API keys live in the browser and may be sent to a self-hosted backend when a task is created. Use real keys only on a trusted deploy over HTTPS. Logs, error reports, URLs, `localStorage`, and persisted task bodies must not contain secret URLs, cookies, or API keys.
- Production needs an explicit `CANVAS_CORS_ORIGINS`, HTTPS, and tight permissions on the database, backups, data directory, and `.settings-key`. Public registration stays off.
- A database field or table change updates `docs/content/docs/backend/backend-database.mdx` in the same change.

## 6. Canvas, UI, and design system

- Canvas components, state, and algorithms live in `web/src/components/canvas/`, `web/src/stores/canvas/`, and `web/src/lib/canvas/`. Ignore-selectors must cover modals, popovers, and dropdowns.
- Drag, connect, zoom, and shortcuts must account for pointer capture, wheel bubbling, focus, and `data-canvas-no-zoom` / `data-canvas-wheel-scroll`.
- Names need a visible pencil and single-click edit. Double-click or the context menu cannot be the only entry. Image nodes keep their aspect ratio.
- Shared Ant Design theme lives in `web/src/lib/app-theme.ts` and `AppProviders`. Product dialogs with their own shell use `AppModal flush`. Side panels use `AppDrawer`.
- Third-party overrides stay on the specific component. Do not add new global `.ant-modal-*`, `.dark .ant-switch-*`, `.ant-checkbox-*`, or Segmented patches.
- Follow `docs/ui-design-system.md` and the three token layers: Primitive, Semantic, Component. Inline style should use `var(--token-name)`.
- Primary action, selection, checkbox, radio, and switch are different color roles. Persistent toggles use `aria-pressed`. `type="primary"` is only the current main command. Honor `prefers-reduced-motion` and keep `:focus-visible`.

## 7. Local development and data directory

Skill lists:

- Market, My skills, and My submissions show only the skill name in the name area. Description, author, version, file counts, compatibility, and conditions belong in the detail view.
- The right side keeps a short gray source label plus the actions the user already accepted. Source labels stay short: Official, Mine, Market, Plugin. Do not grow a second line of explanation.
- New skill information goes into the detail view first.

Environment:

- Read `.env.example` and the matching Compose file. Host backend development uses the gitignored `.local/project-workbench-debug` via `CANVAS_BACKEND_DATA_DIR`. Do not treat `backend/data` as the dev database.
- Local cache is `.local/cache`. Do not commit databases, uploads, `.env`, real keys, build output, or editor config.
- Host dev: from `backend/`, `CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug go run ./cmd/server`. `web/` uses Bun and Vite. Do not mix pnpm and npm on the same `node_modules`. Docker hot reload is `docker-compose.dev.yml`. Local build run is `docker-compose.local.yml`.
- Single-machine Compose is `docker-compose.yml` (SQLite volume, backend, web), plus `docker-compose.build.yml` for a source build. Only the web port `3000` is public. Backend `8080` stays on the Compose network.
- Do not start a dev server unless the user asked for a browser preview. Check the port, data directory, and existing processes first.
- On a Mac the only supported installed app path is `/Applications/BeefTV.app`. Update it only with `./scripts/update-local-beeftv-app.sh`.
- A health check does not prove login, SSE, generation, or resource access.

## 8. Verification

This repo does not run typecheck, tests, or builds unless the user asks or the change is risky. Pick the smallest command and report what actually ran.

- Frontend: `cd web && bun run build`. Focused tests: `bun test ...`. `bun run lint` only bans antd `Empty` and static `Modal.confirm`.
- Backend: `cd backend && go test ./...`, plus the integration path when resources, tasks, or permissions change.
- The old built-in agent is gone from the product surface. `/agent/*` is not registered. Task create, retry, and the worker reject `cloud_agent`, `cloud_agent_step`, and `agent_memory_compact`. The replacement is `agent-host/` with the pinned official pi SDK. Go owns runtime, business turns, and operation authorization. React uses `/api/assistant/*`. There is one Durable execution runtime. Old JSONL sessions are read-only history. A new message in an old session opens a new Durable session. Do not restore the old create, prompt, replace, or abort path.
- Docs site: `cd docs && bun run types:check` or `bun run build`.
- For a UI change you can open, check the route, both themes, scroll, dialogs, empty states, and the core interaction. If you cannot, say what you used instead. Do not call `git diff` a run.

Stop after the same failure three times. Record what you saw, what you ruled out, and the next hypothesis.

## 9. Docs and delivery

- Root `README.md` keeps the product position, a short capability overview, quick start, deploy, security, and links. Topic detail goes in `docs/content/docs/`.
- Feature and code maps live in `docs/content/docs/overview/features.mdx` and `docs/content/docs/backend/code-map.mdx`. Unconfirmed behavior stays in the task or pull request.
- API, tables, SSE, storage, deploy, or security-boundary changes update the matching topic doc.
- This edition's user-facing docs are English. Do not publish passwords, tokens, cookies, real accounts, machine-sensitive paths, session ids, budget amounts, live log ids, or customer names. Commands, ports, and environment variables must match the current scripts and Compose files.
- Commit subjects: `<type>(<scope>): <summary>` with `type` one of `feat|fix|refactor|perf|docs|test|build|ci|chore|revert`.

Before handing work over, check focus, callers, types, errors, permission, ownership, docs, an honest verification note, and that no key or local data was added. Re-read section 10 and run `node scripts/structure-budget.mjs`.

## 10. Keep the structure from rotting

- Compute each conclusion in one place. Whether a task can be retried or fetched is the backend `task.outcome`. The frontend does not infer it. Model capability, protocol, billing, and error class come from the server API.
- The client does not preflight reference media (size, aspect, pixels, format, duration). Upstream error redaction and "which reference failed" belong on the server. BeefTV displays and forwards that result.
- Do not add a rule keyed by model name. Built-in channel differences belong in the server API. A third-party channel with its own key is a protocol plugin under `plugin-packages/`.
- New code does not go into `backend/internal/app`. New packages must not import `internal/app`.
- Do not edit a published database migration. Append a new version.
- Tests assert behavior. They do not assert on source text.
- Before fixing a bug, find every place the rule is written. If there are several, collapse them first.
- A file over about 800 lines that is changed often should be split by responsibility in the same change. Do not split for its own sake.
- `node scripts/structure-budget.mjs` records structure numbers: `internal/app` lines, files over 1000 lines, hardcoded model and vendor names, handlers that depend on `*app.Service`, and tests that read source text. CI only lets those numbers shrink. A necessary increase needs a reason in the PR, then `--update`. Also run `node scripts/deadcode-budget.mjs`. Dead code may only shrink.
- Use `node scripts/structure-budget.mjs --hotspots 7` to see files that collected the most fixes in seven days.
