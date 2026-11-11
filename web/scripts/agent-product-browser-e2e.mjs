/**
 * 内置创作助手 — 真实浏览器验收（Playwright + 隔离后端）。
 *
 * 全部走真实用户路径，不用替身：
 * - 页面是真实 Vite DEV 下的 React 画布页，对话从真实输入框发出；
 * - 外部写入用真实 `beeftv` CLI（与 MCP 同一操作层）；
 * - 断言同时读后端文档与页面 DOM（节点、提示词编辑器、面板气泡）。
 *
 * 前置：隔离后端 127.0.0.1:18090 已启动，并已显式放行本脚本使用的 DEV Origin
 * （`BEEFTV_ALLOWED_ORIGINS` / `CANVAS_CORS_ORIGINS`，见 restart-isolated-server.sh）。
 * 发行形态是同源打包页面，不需要这条放行。
 *
 * 用法：bun scripts/agent-product-browser-e2e.mjs
 * 产物：结果 JSON 与截图写入 `.local/agent-product/`。
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

// 路径全部从本脚本位置推导，或用环境变量覆盖；默认产物落在 <workspace>/.local/agent-product。
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = resolve(process.env.BEEFTV_WORKSPACE || join(WEB_ROOT, ".."));
const AGENT_PRODUCT_DIR = resolve(process.env.BEEFTV_AGENT_PRODUCT_DIR || join(WORKSPACE_ROOT, ".local/agent-product"));
const API = process.env.AGENT_E2E_API || "http://127.0.0.1:18090/api";
const WEB_PORT = Number(process.env.AGENT_E2E_WEB_PORT || 18400);
const SHOTS = join(AGENT_PRODUCT_DIR, "screenshots");
const CLI = process.env.BEEFTV_CLI || join(AGENT_PRODUCT_DIR, "beeftv");
const OWNER = readFileSync(join(AGENT_PRODUCT_DIR, "data/agent_owner_token"), "utf8").trim();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const RESULT_PATH = process.env.AGENT_E2E_RESULT || join(AGENT_PRODUCT_DIR, "results-react-cross-entry.json");
// 每次运行的原始结果单独落一份（不覆盖），latest 指针只用于方便打开。
const RAW_RESULT_PATH = join(AGENT_PRODUCT_DIR, `results-react-cross-entry-${STAMP}.json`);
const TURN_TIMEOUT_MS = Number(process.env.AGENT_E2E_TURN_TIMEOUT_MS || 300_000);
// 助手输入框在有节点的画布上是富文本编辑器，空画布上是 textarea：用 aria-label 两种都命中。
const COMPOSER = '[aria-label="Message to Assistant"]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const steps = {};

/**
 * 失败与通过都追加保留：一次运行不能覆盖上一次的真实结果。
 *
 * 返回落盘结果而不是吞掉异常——证据链写入失败必须让本次验收显式失败，
 * 否则会出现「JSON 说通过、attempt 索引其实没写」的假证据。
 */
function appendAttempt(summary) {
    const line = JSON.stringify({
        stamp: summary.stamp,
        ok: summary.ok,
        passed: summary.checks.filter((item) => item.ok).length,
        total: summary.checks.length,
        failed: summary.checks.filter((item) => !item.ok).map((item) => item.name),
        rawResultPath: summary.rawResultPath,
    });
    try {
        appendFileSync(join(AGENT_PRODUCT_DIR, "results-react-cross-entry-attempts.jsonl"), `${line}\n`);
        return { written: true, error: null };
    } catch (error) {
        return { written: false, error: error instanceof Error ? error.message : String(error) };
    }
}


function check(name, ok, detail = "") {
    checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 600) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
    return Boolean(ok);
}

async function api(method, path, body) {
    const response = await fetch(API + path, {
        method,
        headers: { "Content-Type": "application/json", "X-Beeftv-Owner": OWNER },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: response.status, body: parsed, text: text.slice(0, 300) };
}

async function readCanvas(id) {
    const response = await api("GET", `/canvas-projects/${encodeURIComponent(id)}`);
    return response.body?.data?.project;
}

function runCli(args) {
    const result = spawnSync(CLI, args, {
        env: { ...process.env, BEEFTV_BASE_URL: API, BEEFTV_OWNER_TOKEN: OWNER },
        encoding: "utf8",
    });
    let parsed = null;
    try { parsed = JSON.parse(result.stdout.trim()); } catch { /* 非 JSON 输出 */ }
    return { exit: result.status, stdout: (result.stdout || "").trim().slice(0, 400), stderr: (result.stderr || "").trim().slice(0, 300), json: parsed };
}

async function panelMessages(page) {
    return page.evaluate(() => {
        const panel = document.querySelector(".canvas-assistant-panel");
        if (!panel) return { user: [], assistant: [], notices: [] };
        return {
            user: Array.from(panel.querySelectorAll(".canvas-assistant-user")).map((n) => n.textContent || ""),
            assistant: Array.from(panel.querySelectorAll(".canvas-assistant-reply")).map((n) => n.textContent || ""),
            notices: Array.from(panel.querySelectorAll(".canvas-assistant-card, .canvas-assistant-notice")).map((n) => n.textContent || ""),
        };
    });
}

async function waitForAssistantReply(page, expectedCount = 1, timeoutMs = TURN_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let last = { ready: false };
    while (Date.now() < deadline) {
        const messages = await panelMessages(page);
        last = { ready: messages.assistant.length >= expectedCount, ...messages };
        if (last.ready && !(await page.locator(".canvas-assistant-panel").getByRole("button", { name: "stop" }).count())) return last;
        await sleep(1500);
    }
    return last;
}

async function domNodeIds(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll("[data-node-id]")).map((n) => n.getAttribute("data-node-id")));
}

async function domNodeTitles(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="Drag node:"]')).map((n) => (n.getAttribute("aria-label") || "").replace("Drag node:", "")));
}

async function clickByLabel(page, label) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    if (await button.count()) { await button.click(); await sleep(1200); return true; }
    return false;
}

async function openCanvasMenu(page) {
    const trigger = page.locator("button", { hasText: /^画布 \d+$/ }).first();
    if (!(await trigger.count())) return false;
    await trigger.click();
    await sleep(900);
    return true;
}

async function switchCanvas(page, label) {
    if (!(await openCanvasMenu(page))) return false;
    const item = page.locator(".canvas-topbar-canvas-menu-select", { hasText: label }).first();
    if (!(await item.count())) return false;
    await item.click();
    await sleep(2500);
    return true;
}

/**
 * 切到菜单里另一个画布。
 *
 * 菜单标签是「画布 N」按排序序号生成的，新建画布后会重排，记录旧标签再回点并不可靠；
 * 打开菜单时自己一定是当前画布，因此点非当前行就是切到另一个画布。
 */
async function switchToOtherCanvas(page) {
    if (!(await openCanvasMenu(page))) return "";
    const row = page.locator(".canvas-topbar-canvas-menu-row:not(.is-current) .canvas-topbar-canvas-menu-select").first();
    if (!(await row.count())) return "";
    const label = (await row.innerText()).trim();
    await row.click();
    await sleep(2500);
    const match = page.url().match(/\/canvas\/([^/?#]+)/);
    return label && match ? match[1] : "";
}

async function createCanvasFromUi(page) {
    if (!(await openCanvasMenu(page))) return null;
    const add = page.getByRole("button", { name: "New canvas" }).first();
    if (!(await add.count())) return null;
    await add.click();
    await sleep(3500);
    const match = page.url().match(/\/canvas\/([^/?#]+)/);
    return match ? match[1] : null;
}

/** 选中节点：点击节点标题区，节点配置面板随之出现。 */
async function selectNode(page, nodeId) {
    const box = await page.evaluate((id) => {
        const node = document.querySelector(`[data-node-id="${id}"]`);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: rect.x + Math.min(60, rect.width / 2), y: rect.y + Math.min(18, rect.height / 2) };
    }, nodeId);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await sleep(2000);
    return true;
}

/**
 * 从 UI 读回**选中节点**的提示词。
 *
 * 节点只渲染 metadata.content；提示词显示在选中节点的 composer 面板里。为了证明读到的是
 * 目标节点：面板取「composer 向上最近一个含拖拽手柄的容器」，要求它恰好只有一个手柄、
 * 且页面上只有一个 composer；标题不在面板内，因此调用方还会换选另一个节点做交叉验证。
 */
async function readPromptInUi(page, nodeId, expected, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    let evidence = { value: "", dragHandles: 0, composerCount: 0 };
    while (Date.now() < deadline) {
        if (await selectNode(page, nodeId)) {
            evidence = await page.evaluate(() => {
                const composers = Array.from(document.querySelectorAll("textarea"))
                    .filter((node) => !node.closest(".canvas-assistant-panel"));
                const composer = composers[0];
                if (!composer) return { value: "", dragHandles: 0, composerCount: 0 };
                let panel = composer;
                for (let depth = 0; depth < 12 && panel.parentElement; depth += 1) {
                    if (panel.querySelector("[data-canvas-node-drag-handle]")) break;
                    panel = panel.parentElement;
                }
                return {
                    value: composer.value || "",
                    dragHandles: panel.querySelectorAll("[data-canvas-node-drag-handle]").length,
                    composerCount: composers.length,
                };
            }, "Use natural language to describe creation requirements...");
            if (!expected || evidence.value.includes(expected)) return evidence;
        }
        await sleep(2000);
    }
    return evidence;
}

const consoleErrors = [];
const failedRequests = [];
const cancelledRequests = [];
/** 每个对话请求的原始 NDJSON 事件摘要：用来区分「模型只做了一步」与「前端截断」。 */
const chatResponses = [];
const stopClicks = { count: 0 };

async function main() {
    mkdirSync(SHOTS, { recursive: true });

    const status = await api("GET", "/assistant/status");
    if (!status.body?.data?.available) {
        check("Built-in helper hosts are available", false, JSON.stringify(status.body?.data || status.text));
        return;
    }
    check("Built-in helper hosts are available", true, JSON.stringify(status.body.data.health).slice(0, 200));

    const stamp = Date.now();
    const canvasA = `ui-A-${stamp}`;
    // 画布外壳由后端预置（本用例考察对话与刷新，不是新建画布流程）；
    // 刻意不写 chatSessions，与外部写入产生的文档形状一致。
    const created = await api("PUT", `/canvas-projects/${canvasA}`, {
        project: {
            id: canvasA, revision: 0, title: "Acceptance Canvas A", workspaceProjectId: `ws-${stamp}`,
            nodes: [{ id: "side1", type: "text", title: "Side branch-immovable", position: { x: 60, y: 660 }, width: 320, height: 180, metadata: { prompt: "Side branch prompt word", content: "Side content" } }],
            connections: [],
        },
    });
    if (created.status !== 200) { check("Preset canvas A", false, created.text); return; }

    const vite = spawn("bunx", ["vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
        cwd: WEB_ROOT,
        env: { ...process.env, VITE_API_PROXY_TARGET: "http://127.0.0.1:18090" },
        stdio: "pipe",
    });
    const stopVite = () => { try { vite.kill("SIGTERM"); } catch { /* 已退出 */ } };
    let webReady = false;
    for (let i = 0; i < 90; i += 1) {
        try { const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`); if (response.ok) { webReady = true; break; } } catch { /* 还没起来 */ }
        await sleep(500);
    }
    check("Vite DEV ready", webReady, `http://127.0.0.1:${WEB_PORT}`);
    if (!webReady) { stopVite(); return; }

    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((path) => path && existsSync(path));
    const browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const chatBodies = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400)); });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`.slice(0, 400)));
    // 画布 SSE 在路由切换/画布切换时会被主动关闭，net::ERR_ABORTED 是预期行为，不是失败。
    page.on("requestfailed", (request) => {
        const aborted = request.failure()?.errorText === "net::ERR_ABORTED";
        // 画布 SSE 在路由/画布切换时被主动关闭，对话流在用户点「停止」时被主动取消：
        // 两者都是预期取消，单独记录；其余网络失败一律算失败。
        if (aborted && request.url().includes("/events")) { cancelledRequests.push(`events ${request.url().slice(-40)}`); return; }
        if (aborted && request.url().includes("/api/assistant/chat")) { cancelledRequests.push("assistant/chat stop"); return; }
        if (!aborted) failedRequests.push(`${request.method()} ${request.url().slice(0, 120)} ${request.failure()?.errorText || ""}`);
    });
    page.on("response", async (response) => {
        if (!response.url().includes("/api/assistant/chat")) return;
        try {
            const text = await response.text();
            const events = text.split("\n").map((line) => line.trim()).filter(Boolean)
                .map((line) => { try { return JSON.parse(line); } catch { return null; } })
                .filter(Boolean);
            const turns = events.filter((event) => event.type === "turn_end");
            chatResponses.push({
                status: response.status(),
                textDeltas: events.filter((event) => event.type === "text_delta").length,
                turnEnds: turns.length,
                reply: (turns[turns.length - 1]?.reply || "").slice(0, 400),
                tools: (turns[turns.length - 1]?.toolCalls || []).map((call) => call.tool),
                error: turns[turns.length - 1]?.error || null,
            });
        } catch { /* 流被取消，无完整响应体 */ }
    });
    page.on("request", (request) => { if (request.url().includes("/api/assistant/chat")) chatBodies.push(request.postData() || ""); });

    try {
        await page.goto(`http://127.0.0.1:${WEB_PORT}/canvas/${canvasA}`, { waitUntil: "domcontentloaded" });
        await page.locator(COMPOSER).waitFor({ timeout: 60_000 });
        await sleep(4000);
        check("Canvas page and assistant panel loading", await page.locator(".canvas-assistant-panel").count() > 0, await page.title());

        // ---- 1. UI 对话建三镜头并连成链 ----
        await page.locator(COMPOSER).fill("Create three image nodes on the current canvas: shot 1 - opening, shot 2 - conflict, shot 3 - ending, and connect them into a chain; do not change the existing side nodes.");
        await page.locator("aside").getByRole("button", { name: "send" }).click();
        const reply = await waitForAssistantReply(page, 1);
        const afterTurn = await readCanvas(canvasA);
        const titles = (afterTurn?.nodes || []).map((node) => node.title);
        check("The assistant gives a reply after the UI conversation", reply.ready, (reply.assistant?.[0] || reply.reason || "").slice(0, 160));
        check("Dialogue creates three shots", ["Shot 1-Opening", "Shot 2 - Conflict", "Shot 3 - Closing"].every((title) => titles.includes(title)), titles.join(","));
        check("Three lenses connected into a chain", (afterTurn?.connections || []).length === 2, String((afterTurn?.connections || []).length));
        await clickByLabel(page, "Fit to screen");
        await sleep(1500);
        const domTitles = await domNodeTitles(page);
        check("New lens appears in real canvas DOM", ["Shot 1-Opening", "Shot 2 - Conflict", "Shot 3 - Closing"].every((title) => domTitles.includes(title)), domTitles.join(","));
        await page.screenshot({ path: join(SHOTS, `01-ui-dialogue-created-shots-${STAMP}.png`) });

        const target = (afterTurn?.nodes || []).find((node) => node.title === "Shot 2 - Conflict");
        const revisionAfterTurn = afterTurn.revision;

        // ---- 2. CLI 改目标镜头 prompt → UI 看到新值 ----
        // --content 是描述符对生成类节点声明的可编辑提示词路径（metadata.composerContent），
        // 也就是画布编辑器读的那个字段；--prompt 写的是已提交提示词，编辑器不显示它。
        const cliUpdate = runCli(["canvas", "node", "update", "--canvas", canvasA, "--node", target.id, "--expected-revision", String(revisionAfterTurn), "--content", "Night scene: Confrontation at the alley on a rainy night", "--op-id", `e2e-cli-${stamp}`, "--json"]);
        steps.cliUpdate = cliUpdate;
        check("CLI successfully changed the target lens", cliUpdate.exit === 0, `exit=${cliUpdate.exit} ${cliUpdate.stdout.slice(0, 160)}`);

        const promptInUi = await readPromptInUi(page, target.id, "Night scene: Confrontation at the alley on a rainy night");
        const afterCli = await readCanvas(canvasA);
        const targetAfterCli = (afterCli?.nodes || []).find((node) => node.id === target.id);
        steps.cliChangeVisible = {
            promptInUi: promptInUi.value.slice(0, 200),
            promptReadEvidence: { dragHandles: promptInUi.dragHandles, composerCount: promptInUi.composerCount },
            backendComposerContent: targetAfterCli?.metadata?.composerContent,
            backendPrompt: targetAfterCli?.metadata?.prompt,
            backendContent: targetAfterCli?.metadata?.content,
            revision: afterCli?.revision,
        };
        check(
            "UI prompt word editor shows new value written by CLI",
            promptInUi.value.includes("Night scene: Confrontation at the alley on a rainy night") && promptInUi.dragHandles === 1 && promptInUi.composerCount === 1,
            `ui=${promptInUi.value.slice(0, 80)} dragHandles=${promptInUi.dragHandles} composers=${promptInUi.composerCount} backend=${targetAfterCli?.metadata?.composerContent}`,
        );
        // 交叉验证：换选另一个镜头，composer 必须跟随选择（不再显示目标节点的值）；
        // 若那个镜头本身有草稿，还要求读到它自己的值。这证明上一条读到的确实是目标节点的字段。
        const crossNode = (afterCli?.nodes || []).find((node) => node.id !== target.id && node.type === "image");
        const crossExpected = String(crossNode?.metadata?.composerContent || "");
        const crossRead = crossNode ? await readPromptInUi(page, crossNode.id, crossExpected, 20_000) : { value: "" };
        steps.promptCrossCheck = { nodeId: crossNode?.id, expected: crossExpected, read: crossRead.value.slice(0, 80) };
        check(
            "composer follows the selected node (the value of the target node will no longer be displayed after changing the selection)",
            Boolean(crossNode) && !crossRead.value.includes("Confrontation in the alley on a rainy night") && (!crossExpected || crossRead.value.includes(crossExpected)),
            JSON.stringify(steps.promptCrossCheck),
        );
        check("CLI write does not overwrite the media result slot of the generated node", targetAfterCli?.metadata?.content === "", `content=${String(targetAfterCli?.metadata?.content).slice(0, 60)}`);
        await page.screenshot({ path: join(SHOTS, `02-ui-sees-cli-change-${STAMP}.png`) });

        // ---- 3. 陈旧 revision 提交被拒且不覆盖用户值 ----
        const stale = runCli(["canvas", "node", "update", "--canvas", canvasA, "--node", target.id, "--expected-revision", String(revisionAfterTurn), "--content", "Stale value that should not be written", "--op-id", `e2e-stale-${stamp}`, "--json"]);
        const afterStale = await readCanvas(canvasA);
        const stalePrompt = (afterStale?.nodes || []).find((node) => node.id === target.id)?.metadata?.composerContent;
        steps.staleWrite = { exit: stale.exit, reason: stale.json?.reason, stdout: stale.stdout };
        check("Stale revision submission was rejected by the server", stale.exit !== 0 && stale.json?.reason === "stale_revision", `exit=${stale.exit} reason=${stale.json?.reason}`);
        check("Stale commits did not overwrite current values", stalePrompt === "Night scene: Confrontation at the alley on a rainy night", String(stalePrompt));
        const staleInUi = await readPromptInUi(page, target.id, "Night scene: Confrontation at the alley on a rainy night", 20_000);
        check("After stale submission, the editor is still the user's current value.", staleInUi.value.includes("Night scene: Confrontation at the alley on a rainy night") && staleInUi.dragHandles === 1, `ui=${staleInUi.value.slice(0, 80)}`);

        // ---- 4. 旁支节点完好 + 手工新增/撤销路径保留 ----
        const sideNode = (afterStale?.nodes || []).find((node) => node.id === "side1");
        check("The content of the side branch node has not been changed", sideNode?.metadata?.prompt === "Side branch prompt word", `prompt=${sideNode?.metadata?.prompt}`);

        await page.keyboard.press("Escape");
        const beforeAdd = (await domNodeIds(page)).length;
        let afterAdd = beforeAdd;
        if (await clickByLabel(page, "Add node")) {
            const textItem = page.getByRole("button", { name: "text", exact: true }).first();
            if (await textItem.count()) { await textItem.click(); await sleep(2500); afterAdd = (await domNodeIds(page)).length; }
        }
        await page.keyboard.press("Escape");
        await sleep(500);
        await page.keyboard.press("Meta+z");
        await sleep(2500);
        const afterUndo = (await domNodeIds(page)).length;
        // 撤销只能回退这次手工新增：外部刚写入的目标字段、旁支内容与连线都不能被旧快照倒退。
        const afterUndoDoc = await readCanvas(canvasA);
        const afterUndoNodes = afterUndoDoc?.nodes || [];
        const afterUndoTarget = afterUndoNodes.find((node) => node.id === target.id);
        const afterUndoSide = afterUndoNodes.find((node) => node.id === "side1");
        const afterUndoTitles = await domNodeTitles(page);
        steps.manualPath = {
            beforeAdd,
            afterAdd,
            afterUndo,
            targetComposerContent: afterUndoTarget?.metadata?.composerContent,
            sideContent: afterUndoSide?.metadata?.content,
            connections: (afterUndoDoc?.connections || []).length,
            domTitles: afterUndoTitles,
        };
        check("Manually adding nodes is still available", afterAdd === beforeAdd + 1, JSON.stringify({ beforeAdd, afterAdd }));
        check("Manual undo is still available", afterUndo === beforeAdd, JSON.stringify({ beforeAdd, afterUndo }));
        check("Undo does not rewind the target field just written by the CLI", afterUndoTarget?.metadata?.composerContent === "Night scene: Confrontation at the alley on a rainy night", `composerContent=${String(afterUndoTarget?.metadata?.composerContent).slice(0, 60)}`);
        check("Undoing does not change the branch node", afterUndoSide?.metadata?.content === "Side content" && afterUndoTitles.includes("Side branch-immovable"), `content=${String(afterUndoSide?.metadata?.content).slice(0, 40)} titles=${afterUndoTitles.join(",")}`);
        check("Undoing does not change the three-lens chain", (afterUndoDoc?.connections || []).length === 2, String((afterUndoDoc?.connections || []).length));

        // ---- 5. 收起面板再打开：会话不中断、历史正确 ----
        const beforeCollapse = await panelMessages(page);
        await page.locator('button[aria-label="Close Assistant"]').click();
        await sleep(1300);
        const collapsed = await page.locator(".canvas-assistant-panel").count() === 0;
        await page.locator('button[aria-label="Assistant"]').first().click();
        await sleep(1500);
        const afterExpand = await panelMessages(page);
        steps.collapse = { collapsed, before: beforeCollapse.assistant.length, after: afterExpand.assistant.length };
        check("Assistant panel disappears after closing", collapsed, String(collapsed));
        check("History will be kept intact after reopening", JSON.stringify(beforeCollapse) === JSON.stringify(afterExpand), JSON.stringify(steps.collapse));
        await page.screenshot({ path: join(SHOTS, `03-collapse-reopen-history-${STAMP}.png`) });

        // ---- 6. 发送时冻结 selectedNodeIds ----
        const ids = (await domNodeIds(page)).filter((id) => id !== "side1");
        const first = ids[0];
        const second = ids[1];
        const selectedAtSend = [];
        if (first && await selectNode(page, first)) selectedAtSend.push(first);
        chatBodies.length = 0;
        await page.locator(COMPOSER).fill("Please only reply: Received.");
        await page.locator("aside").getByRole("button", { name: "send" }).click();
        await sleep(900);
        if (second) await selectNode(page, second);
        const freezeReply = await waitForAssistantReply(page, 2);
        const body = chatBodies[0] ? JSON.parse(chatBodies[0]) : null;
        const sentIds = (body?.selectedNodeIds || []).slice().sort();
        steps.selectedSnapshot = { selectedAtSend, sentSelectedNodeIds: body?.selectedNodeIds };
        check("Freezes the selected object when sending, and subsequent selections do not change the request.", Boolean(body) && JSON.stringify(sentIds) === JSON.stringify(selectedAtSend.slice().sort()), JSON.stringify(body?.selectedNodeIds));
        check("The turn of the frozen use case ends normally", freezeReply.ready, (freezeReply.assistant?.[1] || "").slice(0, 120));
        await page.screenshot({ path: join(SHOTS, `04-selected-snapshot-${STAMP}.png`) });

        // ---- 7. A 请求进行中切到 B ----
        const assistantBefore = (await panelMessages(page)).assistant.length;
        await page.locator(COMPOSER).fill("In one sentence, describe the three shots you have planned for this short play, without changing the canvas.");
        await page.locator("aside").getByRole("button", { name: "send" }).click();
        await sleep(2000);
        const aStopVisible = await page.locator("aside").getByRole("button", { name: "stop" }).count() > 0;
        const canvasB = await createCanvasFromUi(page);
        check("Switch to B while A request is in progress", Boolean(canvasB) && page.url().includes(canvasB), `${canvasB} ${page.url()}`);
        await sleep(2500);
        const bPanel = await panelMessages(page);
        check("B canvas panel is independent (no dialogue of A)", bPanel.user.length === 0 && bPanel.assistant.length === 0, JSON.stringify(bPanel.user).slice(0, 160));

        await page.locator(COMPOSER).fill("Please only reply: B Canvas is ready.");
        await page.locator("aside").getByRole("button", { name: "send" }).click();
        await sleep(2500);
        const stopB = page.locator("aside").getByRole("button", { name: "stop" }).first();
        const hasStopB = await stopB.count() > 0;
        if (hasStopB) { stopClicks.count += 1; await stopB.click(); await sleep(2000); }
        const bAfterStop = await panelMessages(page);
        steps.abIsolation = { aStopVisible, hasStopB, bNotices: bAfterStop.notices };
        check("B can initiate and stop conversations independently", hasStopB, JSON.stringify(steps.abIsolation));

        const switchedBackTo = await switchToOtherCanvas(page);
        const backToA = Boolean(switchedBackTo) && switchedBackTo === canvasA;
        const aReply = await waitForAssistantReply(page, assistantBefore + 1, 150_000);
        const aMessages = await panelMessages(page);
        const aCancelled = aMessages.notices.some((text) => /取消|停止|已中断/.test(text));
        steps.abIsolation.aAssistant = aMessages.assistant.map((text) => text.slice(0, 120));
        steps.abIsolation.aNotices = aMessages.notices;
        check("After switching back to A, A's new assistant's reply is fully visible.", backToA && aMessages.user.some((text) => text.includes("three shots")) && aMessages.assistant.length === assistantBefore + 1, JSON.stringify(aMessages.assistant.map((text) => text.slice(0, 60))));
        check("Stopping B only affects B's run", aReply.ready && !aCancelled, `cancelled=${aCancelled} notices=${JSON.stringify(aMessages.notices).slice(0, 160)}`);
        await page.screenshot({ path: join(SHOTS, `05-ab-isolation-back-to-A-${STAMP}.png`) });

        // ---- 8. 脏草稿保护（真实页面编辑未被服务端确认期间，外部写入不能静默覆盖本地） ----
        await page.keyboard.press("Escape");
        const canvasBeforeDirty = await readCanvas(canvasA);
        const revisionBeforeDirty = canvasBeforeDirty.revision;
        const nodesBeforeDirty = (await domNodeIds(page)).length;

        // 把画布 PUT 挂起：本地编辑照常进 store，但服务端拿不到，形成真实的「未确认编辑」窗口。
        let heldPut = null;
        await page.route("**/api/canvas-projects/*", async (route) => {
            const request = route.request();
            if (request.method() === "PUT" && !request.url().includes("/generated-assets")) {
                heldPut = route;
                return;    // 故意不 continue：保持未确认
            }
            await route.continue();
        });

        if (await clickByLabel(page, "Add node")) {
            const textItem = page.getByRole("button", { name: "text", exact: true }).first();
            if (await textItem.count()) { await textItem.click(); await sleep(2500); }
        }
        await page.keyboard.press("Escape");
        const localOnlyNodes = (await domNodeIds(page)).length;
        const serverWhileLocalDirty = await readCanvas(canvasA);

        // 外部（CLI，另一条入口）在同一画布上写目标字段。
        const externalWhileLocalDirty = runCli(["canvas", "node", "update", "--canvas", canvasA, "--node", target.id, "--expected-revision", String(serverWhileLocalDirty.revision), "--content", "External writes during local unacknowledged", "--op-id", `e2e-dirty-${stamp}`, "--json"]);
        // 等应用自己发现外部写入（轮询/SSE），看它是否保留本地编辑并给出冲突出口。
        let dirtyNoticeSeen = false;
        let acceptButtonSeen = false;
        const dirtyDeadline = Date.now() + 30_000;
        while (Date.now() < dirtyDeadline) {
            dirtyNoticeSeen = await page.evaluate(() => (document.querySelector("aside")?.innerText || "").includes("The canvas has been updated in other portals"));
            acceptButtonSeen = await page.getByRole("button", { name: "Use the latest version" }).count() > 0;
            if (dirtyNoticeSeen && acceptButtonSeen) break;
            await sleep(1500);
        }
        const nodesAfterExternal = (await domNodeIds(page)).length;
        const uiTargetAfterExternal = await readPromptInUi(page, target.id, "Night scene: Confrontation at the alley on a rainy night", 20_000);

        steps.dirtyDraft = {
            revisionBeforeDirty,
            nodesBeforeDirty,
            localOnlyNodes,
            serverRevisionWhileHeld: serverWhileLocalDirty.revision,
            externalExit: externalWhileLocalDirty.exit,
            externalReason: externalWhileLocalDirty.json?.reason,
            dirtyNoticeSeen,
            acceptButtonSeen,
            nodesAfterExternal,
            uiTargetValue: uiTargetAfterExternal.value.slice(0, 120),
            uiTargetPanelScoped: uiTargetAfterExternal.dragHandles === 1,
        };
        check("During local unconfirmed editing, the server did not get the edit.", serverWhileLocalDirty.revision === revisionBeforeDirty && (serverWhileLocalDirty.nodes || []).length === nodesBeforeDirty - 0, `serverRevision=${serverWhileLocalDirty.revision} localNodes=${localOnlyNodes}`);
        check("External writes successfully enter the server", externalWhileLocalDirty.exit === 0, `exit=${externalWhileLocalDirty.exit} ${externalWhileLocalDirty.stdout.slice(0, 120)}`);
        check("Local draft is not overwritten by external writes (node count maintained)", nodesAfterExternal === localOnlyNodes, `${localOnlyNodes} -> ${nodesAfterExternal}`);
        check("The interface gives a conflict prompt and the \"Use the latest version\" exit", dirtyNoticeSeen && acceptButtonSeen, JSON.stringify({ dirtyNoticeSeen, acceptButtonSeen }));
        check("The editor still shows the locally retained target value", uiTargetAfterExternal.value.includes("Night scene: Confrontation at the alley on a rainy night") && uiTargetAfterExternal.dragHandles === 1, uiTargetAfterExternal.value.slice(0, 80));
        await page.screenshot({ path: join(SHOTS, `06-dirty-draft-conflict-${STAMP}.png`) });

        // 放开被挂起的提交：服务端会按 revision 拒绝这次陈旧提交，本地内容必须仍在。
        if (heldPut) { try { await heldPut.continue(); } catch { /* 路由已失效 */ } }
        heldPut = null;
        await sleep(4000);
        const nodesAfterRelease = (await domNodeIds(page)).length;
        const uiAfterRelease = await readPromptInUi(page, target.id, "Night scene: Confrontation at the alley on a rainy night", 20_000);
        steps.dirtyDraft.afterRelease = { nodes: nodesAfterRelease, targetValue: uiAfterRelease.value.slice(0, 120) };
        check("Local content remains after rejection of stale submissions", nodesAfterRelease >= localOnlyNodes && uiAfterRelease.value.includes("Night scene: Confrontation at the alley on a rainy night"), JSON.stringify(steps.dirtyDraft.afterRelease));
        await page.unroute("**/api/canvas-projects/*");

        steps.consoleErrors = consoleErrors;
        steps.failedRequests = failedRequests;
        // 脏草稿场景故意挂起画布 PUT：客户端 4s 超时并记录一条持久化失败是这段测试造成的预期噪声，
        // 单独归类保留，不算产品的非预期运行时报错。
        const expectedDuringDirtyHold = consoleErrors.filter((text) => /画布后端持久化失败/.test(text));
        steps.expectedDuringDirtyHold = expectedDuringDirtyHold;
        const unexpected = consoleErrors.filter((text) => !/antd:|deprecated/i.test(text) && !/画布后端持久化失败/.test(text));
        check("The page does not run as expected and an error occurs", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
        check("No failed network requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));
    } finally {
        steps.canvasA = canvasA;
        await browser.close().catch(() => {});
        stopVite();
    }
}

await main();

const summary = {
    ok: checks.every((item) => item.ok),
    stamp: STAMP,
    api: API,
    webPort: WEB_PORT,
    workspaceRoot: WORKSPACE_ROOT,
    gitHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: WORKSPACE_ROOT, encoding: "utf8" }).stdout?.trim() || null,
    evidence: { chatResponses, cancelledRequests, consoleErrors, failedRequests, stopClicks: stopClicks.count, expectedDuringDirtyHold: steps.expectedDuringDirtyHold || [] },
    checks,
    steps,
};
summary.rawResultPath = RAW_RESULT_PATH;
const attemptLog = appendAttempt(summary);
summary.attemptLog = attemptLog;
if (!attemptLog.written) {
    // 证据链写入失败必须显式失败：不能让「通过」建立在没落盘的记录上。
    checks.push({ name: "Try to record the placement", ok: false, detail: attemptLog.error });
    summary.ok = false;
}
const serialized = JSON.stringify(summary, null, 2);
writeFileSync(RAW_RESULT_PATH, serialized);
writeFileSync(RESULT_PATH, serialized);
console.log(`This original result${RAW_RESULT_PATH}`);
console.log(`The result has been written${RESULT_PATH}`);
console.log(`try to record${attemptLog.written ? "Added" : `Write failed:${attemptLog.error}`}`);
console.log(`total${checks.filter((item) => item.ok).length}/${checks.length} Pass`);
process.exit(summary.ok ? 0 : 1);
