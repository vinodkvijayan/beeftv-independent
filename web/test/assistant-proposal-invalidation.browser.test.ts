import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

let browser: Browser, server: ReturnType<typeof Bun.serve>;
let turns: Record<string, any>[], active: Record<string, any> | null;
let stream: ReadableStreamDefaultController<Uint8Array> | null;
let holdHistory = false, historyReads: Array<() => void>;
let chats = 0, supplements = 0, taskSubmissions = 0;
const turn = (id: string, invalidated = false) => ({ turnId: id, userText: `Request${id}`, selectedNodeIds: [], reply: `Plan${id}`, toolCalls: [], change: null,
    proposals: [{ proposalId: id, kind: "image", nodeIds: [id], model: "Picture model" }], proposalsInvalidated: invalidated, error: null, cancelled: false, createdAt: "2026-10-18" });
beforeEach(() => {
    // Both valid historical cards survive until the server says otherwise. Do not use last-turn heuristics.
    turns = [turn("old"), turn("current")]; active = null; stream = null;
    holdHistory = false; historyReads = []; chats = supplements = taskSubmissions = 0;
});
beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/assistant-proposal-invalidation-harness.tsx"], target: "browser", define: {
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
        const path = new URL(req.url).pathname;
        if (path === "/harness.js") return new Response(js, { headers: { "content-type": "application/javascript" } });
        if (path === "/harness.css") return new Response(css, { headers: { "content-type": "text/css" } });
        if (path.endsWith("/assistant/ui-session")) return ok({ token: "synthetic", expiresAt: new Date(Date.now() + 1800000).toISOString() });
        if (path.endsWith("/assistant/status")) return ok({ available: true });
        if (path.endsWith("/assistant/sessions")) return ok({ currentSessionId: "s1", sessions: [] });
        if (path.endsWith("/assistant/history")) {
            if (holdHistory) await new Promise<void>(resolve => { historyReads.push(resolve); });
            return ok({ sessionId: "s1", turns, active });
        }
        if (path.endsWith("/assistant/chat")) {
            chats++;
            turns = turns.map(item => ({ ...item, proposalsInvalidated: true }));
            return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { "content-type": "application/x-ndjson" } });
        }
        if (path.endsWith("/assistant/steer")) { supplements++; return ok({ accepted: true }); }
        if (path.includes("/tasks") && req.method === "POST") { taskSubmissions++; return new Response(null, { status: 500 }); }
        if (path.startsWith("/api/")) return ok({});
        return new Response('<html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script></html>', { headers: { "content-type": "text/html" } });
    } });
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

test("a new message disables generation until authoritative history expires old cards; the new card stays runnable", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
        const generate = page.getByRole("button", { name: "generate", exact: true });
        await generate.nth(1).waitFor();
        expect(await generate.nth(0).isEnabled()).toBe(true);
        expect(await generate.nth(1).isEnabled()).toBe(true);
        await page.getByRole("textbox", { name: "Message to Assistant" }).fill("Change to new plan");
        await page.getByRole("button", { name: "send", exact: true }).click();
        await page.getByRole("button", { name: "stop", exact: true }).waitFor();
        expect(await generate.nth(0).isDisabled()).toBe(true);
        expect(await page.getByRole("button", { name: "No need for now", exact: true }).nth(0).isEnabled()).toBe(true);
        for (let i = 0; i < 100 && !stream; i++) await new Promise(resolve => setTimeout(resolve, 10));
        expect(stream).not.toBeNull();
        holdHistory = true;
        const fresh = turn("fresh"); turns.push(fresh);
        stream.enqueue(new TextEncoder().encode(JSON.stringify({ type: "turn_end", ...fresh, sessionId: "s1" }) + "\n")); stream.close(); stream = null;
        await page.getByText("Solution fresh", { exact: true }).waitFor();
        expect(await generate.nth(0).isDisabled()).toBe(true);
        expect(await generate.nth(2).isDisabled()).toBe(true);
        // The history request is held after turn_end to exercise the validity readback gap.
        for (let i = 0; i < 100 && !historyReads.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
        expect(historyReads.length).toBe(1);
        // A manual refresh can supersede the final readback. Its pending result
        // must not briefly reopen stale cards when the first request finishes.
        await page.evaluate(() => { void (window as any).proposalFixture.refresh(); });
        for (let i = 0; i < 100 && historyReads.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
        expect(historyReads.length).toBe(2); historyReads.shift()!();
        await page.getByRole("button", { name: "stop", exact: true }).waitFor({ state: "hidden" });
        expect(await generate.nth(0).isDisabled()).toBe(true);
        holdHistory = false; historyReads.shift()!();
        await page.getByText("It has expired. Please ask the assistant to propose a new generation plan.", { exact: true }).nth(1).waitFor();
        expect(await generate.count()).toBe(1);
        expect(await generate.isEnabled()).toBe(true);
        expect(chats).toBe(1); expect(taskSubmissions).toBe(0);
        await page.reload();
        await page.getByText("It has expired. Please ask the assistant to propose a new generation plan.", { exact: true }).nth(1).waitFor();
        expect(await generate.count()).toBe(1); expect(await generate.isEnabled()).toBe(true);
    } finally { holdHistory = false; historyReads.forEach(resolve => resolve()); try { stream?.close(); } catch {} await page.close(); }
}, 20000);

test("a steer supplement keeps the server-valid proposal usable after the active turn settles", async () => {
    active = { turnId: "active", userText: "continue making", selectedNodeIds: [], status: "running", createdAt: "2026-10-18" };
    const page = await browser.newPage();
    try {
        await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
        await page.getByRole("button", { name: "stop", exact: true }).waitFor();
        await page.getByRole("textbox", { name: "Message to Assistant" }).fill("Supplement: Keep warm colors");
        await page.getByRole("button", { name: /^补\s*充$/ }).click();
        await page.getByText("The assistant has received the supplemental request.", { exact: true }).waitFor();
        active = null; turns.push({ ...turn("active"), userText: "continue making", proposals: [], supplements: ["Supplement: Keep warm colors"] });
        await page.evaluate(() => (window as any).proposalFixture.refresh());
        await page.getByRole("button", { name: "stop", exact: true }).waitFor({ state: "hidden" });
        const generate = page.getByRole("button", { name: "generate", exact: true });
        expect(await generate.count()).toBe(2);
        expect(await generate.nth(0).isEnabled()).toBe(true);
        expect(await generate.nth(1).isEnabled()).toBe(true);
        expect(await page.getByText("It has expired. Please ask the assistant to propose a new generation plan.", { exact: true }).count()).toBe(0);
        expect(supplements).toBe(1); expect(chats).toBe(0); expect(taskSubmissions).toBe(0);
    } finally { await page.close(); }
}, 20000);
