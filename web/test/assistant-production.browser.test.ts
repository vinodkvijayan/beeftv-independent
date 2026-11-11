import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

let browser: Browser, server: ReturnType<typeof Bun.serve>;
let currentSession = "s1", clearPlan = false, clearNextPlan = false;
let liveStream: ReadableStreamDefaultController<Uint8Array> | null = null;
let streamActive = false;
let liveText = "";
let liveLifecycle: Record<string, unknown> | undefined;
let historyToolCalls: unknown[] = [];
let chatStarted: Promise<void>, onChatStarted: () => void;
const chats: Array<{ message: string; selectedNodeIds: string[] }> = [];
const plan = { goal: "Two shots of the encounter on a rainy night", items: [
    { id: "s1", title: "Storyboards and first frame", status: "done" },
    { id: "s2", title: "Make video after checking first frame", status: "needs_user", note: "Check after the first frame is generated" },
], done: 1, total: 2, updatedAt: "2026-10-18" };
let livePlan = plan;
const turn = { turnId: "t1", userText: "Make two shots of meeting each other on a rainy night", selectedNodeIds: [], reply: "Storyboards and first frame plans are ready.", toolCalls: [], change: null,
    proposals: [{ proposalId: "p1", kind: "image", nodeIds: ["source"], model: "Picture model", modelKey: "test::image" }], error: null, cancelled: false, createdAt: "2026-10-18" };
beforeEach(() => {
    chats.length = 0; currentSession = "s1"; clearPlan = false; clearNextPlan = false; streamActive = false; liveText = ""; livePlan = plan; historyToolCalls = []; liveLifecycle = undefined;
    chatStarted = new Promise(resolve => { onChatStarted = resolve; });
});

beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/assistant-production-harness.tsx"], target: "browser", define: {
        "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"',
        "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"',
    }, plugins: [{ name: "test-source", setup(builder) {
        builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: "model-logo", namespace: "test-icons" }));
        builder.onLoad({ filter: /.*/, namespace: "test-icons" }, () => ({ contents: "export function ModelLogo() { return null; }", loader: "js" }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
    const css = await build.outputs.find(output => output.path.endsWith(".css"))?.text() || "";
    const ok = (data: unknown) => Response.json({ code: 0, data });
    server = Bun.serve({ port: 0, async fetch(req) {
        const pathname = new URL(req.url).pathname;
        if (pathname === "/harness.js") return new Response(js, { headers: { "content-type": "application/javascript" } });
        if (pathname === "/harness.css") return new Response(css, { headers: { "content-type": "text/css" } });
        if (pathname.endsWith("/assistant/ui-session")) return ok({ token: "synthetic-only", expiresAt: new Date(Date.now() + 1800000).toISOString() });
        if (pathname.endsWith("/assistant/status")) return ok({ available: true });
        if (pathname.endsWith("/assistant/sessions") && req.method === "POST") { currentSession = "new"; return ok({ sessionId: currentSession }); }
        if (pathname.endsWith("/assistant/sessions")) return ok({ currentSessionId: currentSession, sessions: [{ sessionId: "s1", title: "Rainy night creation" }, { sessionId: "s2", title: "another conversation" }] });
        if (pathname.endsWith("/assistant/sessions/activate")) { currentSession = (await req.json()).sessionId; return ok({ sessionId: currentSession }); }
        if (pathname.endsWith("/assistant/history")) return ok({ sessionId: currentSession, turns: currentSession === "s1" ? [{ ...turn, toolCalls: historyToolCalls }] : [],
            ...(streamActive ? { active: { turnId: "live-turn", requestId: "live-request", userText: "Start real-time production", selectedNodeIds: [], status: "running", streamed: liveText, lifecycle: liveLifecycle }, plan: livePlan } : currentSession === "s1" && !clearPlan ? { plan } : {}) });
        if (pathname.endsWith("/assistant/chat")) {
            const body = await req.json(); chats.push(body);
            if (body.message === "Start real-time production") {
                streamActive = true;
                return new Response(new ReadableStream<Uint8Array>({ start(controller) { liveStream = controller; onChatStarted(); } }), { headers: { "content-type": "application/x-ndjson" } });
            }
            return new Response(JSON.stringify({ type: "turn_end", ...turn, turnId: `t${chats.length + 1}`, reply: "First frame check completed", proposals: [], plan: clearNextPlan ? null : { ...plan, goal: "First frame checked", items: plan.items.map(item => ({ ...item, status: "done" })) } }) + "\n", { headers: { "content-type": "application/x-ndjson" } });
        }
        if (pathname.startsWith("/api/")) return ok({});
        return new Response('<html><meta name="viewport" content="width=device-width"><style>:root{--background:#fff;--foreground:#222;--muted:#f4f4f4;--muted-foreground:#666;--border:#ddd;--card:#fafafa;--fs-body:14px;--radius-lg:12px}*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script></html>', { headers: { "content-type": "text/html" } });
    } });
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((item): item is string => Boolean(item && existsSync(item)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);

test("The active observation stream displays the complete text and production plan in real time, and refreshes to restore from history without sending messages again.", async () => {
    currentSession = "s1"; clearPlan = false; clearNextPlan = false;
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    try {
        await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
        await page.getByText("Two shots of the encounter on a rainy night", { exact: true }).waitFor();
        await page.locator('.canvas-assistant-composer [contenteditable="true"]').fill("Start real-time production");
        await page.getByRole("button", { name: "send", exact: true }).click();
        await page.getByRole("button", { name: "stop", exact: true }).waitFor();
        await chatStarted;
        const before = chats.length;
        liveText = "The beginning, middle and end are complete.";
        livePlan = { ...plan, goal: "Plan currently being implemented" };
        const line = (payload: unknown) => new TextEncoder().encode(JSON.stringify(payload) + "\n");
        liveStream!.enqueue(line({ type: "text_snapshot", text: "beginning, middle" }));
        liveStream!.enqueue(line({ type: "plan", plan: livePlan }));
        liveStream!.enqueue(line({ type: "text_snapshot", text: liveText }));
        await page.getByText("Plan currently being implemented", { exact: true }).waitFor();
        await page.getByText(liveText, { exact: true }).waitFor();
        liveStream!.enqueue(line({ type: "lifecycle", phase: "tool", toolName: "canvas_node_configure" }));
        await page.getByText("Configuring build parameters.", { exact: true }).waitFor();
        liveStream!.enqueue(line({ type: "lifecycle", phase: "tool_end", toolName: "canvas_node_configure", success: true }));
        await page.getByText("The generation parameters have been configured and production is continuing.", { exact: true }).waitFor();
        liveStream!.enqueue(line({ type: "lifecycle", phase: "compaction" }));
        await page.getByText("The conversation is being organized for easy continuation.", { exact: true }).waitFor();
        liveStream!.enqueue(line({ type: "lifecycle", phase: "compaction_end", success: true }));
        await page.getByText("The conversation is being organized for easy continuation.", { exact: true }).waitFor({ state: "hidden" });
        liveLifecycle = { type: "lifecycle", phase: "business", stage: "exporting", toolName: "canvas_timeline_deliver" };
        liveStream!.enqueue(line(liveLifecycle));
        await page.getByText("The video is available and the editable project is being exported.", { exact: true }).waitFor();
        expect(chats.length).toBe(before);
        await page.reload();
        await page.getByText("Plan currently being implemented", { exact: true }).waitFor();
        await page.getByText(liveText, { exact: true }).waitFor();
        await page.getByText("The video is available and the editable project is being exported.", { exact: true }).waitFor();
        expect(chats.length).toBe(before);
    } finally {
        streamActive = false;
        try { liveStream?.close(); } catch { /* Browser detached on reload. */ }
        liveStream = null;
        await page.close();
    }
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

test("Media check facts are displayed via real history hook and retained after refresh, no model request is sent", async () => {
    const source = { resourceId: "final-video", version: "a".repeat(64), startMs: 5000, endMs: 12000 };
    historyToolCalls = [
        { tool: "media.inspect", isError: false, mediaFacts: { source, mode: "video", durationMs: 18000, hasAudio: true } },
        { tool: "media.check", isError: false, mediaFacts: { source: { ...source, startMs: 0, endMs: 18000 }, mode: "check", durationMs: 18000, hasAudio: true,
            silenceIntervals: [{ startMs: 0, endMs: 18000 }], meanDb: -91, peakDb: -91 } },
    ];
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    try {
        await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
        for (let attempt = 0; attempt < 2; attempt++) {
            const facts = page.getByLabel("Media censorship record");
            await facts.waitFor();
            expect(await facts.textContent()).toContain("Video clip read: 5–12 seconds · Total length 18 seconds");
            expect(await facts.textContent()).toContain("The entire detection interval is muted");
            expect(await facts.textContent()).not.toContain("Qualified");
            expect(await page.getByLabel("Current production schedule").textContent()).toContain("Step Progress · 1/2");
            await page.locator(".canvas-assistant-sidebar").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(chats).toHaveLength(0);
            if (!attempt) await page.reload();
        }
        if (process.env.BEEFTV_MEDIA_FACTS_SCREENSHOT) {
            await page.getByLabel("Media censorship record").scrollIntoViewIfNeeded();
            await page.screenshot({ path: process.env.BEEFTV_MEDIA_FACTS_SCREENSHOT, fullPage: true });
        }
        expect(errors).toEqual([]);
    } finally { await page.close(); }
}, 30000);

test("The real sidebar retains draft and product references, checks sent by the user, and updates/clears the current session plan", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
    await page.getByText("Two shots of the encounter on a rainy night", { exact: true }).waitFor();
    const check = page.getByRole("button", { name: "Check results", exact: true });
    expect(await check.isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).productionFixture.finish());
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Check results" && !button.disabled));
    expect(await page.getByText("After confirmation, billing will begin based on the selected channel.", { exact: false }).count()).toBe(0);
    const input = page.locator('.canvas-assistant-composer [contenteditable="true"]');
    await input.fill("Keep the ending I wrote");
    await check.click(); await check.click();
    expect(await input.innerText()).toContain("Keep the ending I wrote");
    expect((await input.innerText()).match(/检查这次生成/g)).toHaveLength(1);
    expect(chats).toHaveLength(0);
    expect(await page.getByText("2 nodes selected", { exact: true }).count()).toBe(1);
    const saved = await page.evaluate(() => (window as any).productionFixture.draft());
    expect(saved.resultSelection).toEqual({ sessionId: "s1", nodeIds: ["result"] });
    await page.evaluate(() => (window as any).productionFixture.show(false));
    await page.waitForFunction(() => !document.querySelector('.canvas-assistant-sidebar'));
    await page.evaluate(() => (window as any).productionFixture.show(true));
    await page.getByText("2 nodes selected", { exact: true }).waitFor();
    expect(await input.innerText()).toContain("Keep the ending I wrote");
    await page.reload();
    await page.getByText("2 nodes selected", { exact: true }).waitFor();
    expect(await input.innerText()).toContain("Check this build");
    await page.getByRole("button", { name: "historical dialogue", exact: true }).click();
    await page.getByText("another conversation", { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Current production plan"]'));
    expect(await page.getByText("2 nodes selected", { exact: true }).count()).toBe(0);
    expect(await page.getByText("1 node selected", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "historical dialogue", exact: true }).click();
    await page.getByText("Rainy night creation", { exact: true }).click();
    await page.getByText("2 nodes selected", { exact: true }).waitFor();
    expect(chats).toHaveLength(0);
    await page.getByRole("button", { name: "send", exact: true }).click();
    await page.getByText("First frame checked", { exact: true }).waitFor();
    expect(chats).toHaveLength(1);
    expect(chats[0].selectedNodeIds).toEqual(["original", "result"]);
    expect(chats[0].message).toContain("Keep the ending I wrote");
    await page.evaluate(() => (window as any).productionFixture.refresh());
    expect(await page.getByText("First frame checked", { exact: true }).count()).toBe(1);
    expect(await page.locator("body").evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    clearNextPlan = true;
    await input.fill("Start an independent task");
    await page.getByRole("button", { name: "send", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Current production plan"]'));
    await page.evaluate(() => (window as any).productionFixture.refresh());
    expect(await page.locator('[aria-label="Current production plan"]').count()).toBe(0);
    await page.getByRole("button", { name: "historical dialogue", exact: true }).click();
    await page.getByText("another conversation", { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Current production plan"]'));
    await page.getByRole("button", { name: "historical dialogue", exact: true }).click();
    await page.getByText("Rainy night creation", { exact: true }).click();
    await page.getByText("Two shots of the encounter on a rainy night", { exact: true }).waitFor();
    clearPlan = true;
    await page.evaluate(() => (window as any).productionFixture.refresh());
    await page.waitForFunction(() => !document.querySelector('[aria-label="Current production plan"]'));
    clearPlan = false;
    await page.evaluate(() => (window as any).productionFixture.refresh());
    await page.getByText("Two shots of the encounter on a rainy night", { exact: true }).waitFor();
    await page.getByRole("button", { name: "new conversation", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Current production plan"]'));
    expect(errors).toEqual([]);
    await page.close();
}, 60000);
