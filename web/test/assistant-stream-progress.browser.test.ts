import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

/**
 * 助手回复和思考都必须在终态之前分多段出现在面板里。
 *
 * 慢速替身按固定间隔分片：正文用例分四次发 text_snapshot，中间夹一次工具进度；
 * 思考用例先等界面展开并观察首段，再发后续思考、工具和正文，最后才发 turn_end。
 * 只要有任何一层把内容攒到最后，面板在终态前就只会看到一段或零段。
 */

let browser: Browser, server: ReturnType<typeof Bun.serve>;
let chatRequests = 0;
let continueThinking: (() => void) | undefined;

const CHUNKS = ["First paragraph content.", "Second paragraph content.", "The content of the third paragraph.", "The fourth paragraph."];
const CHUNK_GAP_MS = 750;
const THINKING_GAP_MS = 600;

type Line = (payload: unknown) => void;

function ndjsonStream(script: (line: Line) => Promise<void>): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const line: Line = (payload) => controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
            line({ type: "session", sessionId: "stream-session" });
            await script(line);
            controller.close();
        },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}

async function slowTextTurn(line: Line) {
    let text = "";
    for (const [index, chunk] of CHUNKS.entries()) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_GAP_MS));
        text += chunk;
        line({ type: "text_snapshot", text });
        // 工具进度夹在正文中间：工具前后的正文都要留着，且不重复。
        if (index === 1) line({ type: "lifecycle", phase: "tool", toolName: "canvas_get" });
    }
    await new Promise((resolve) => setTimeout(resolve, CHUNK_GAP_MS));
    line({ type: "turn_end", reply: text, toolCalls: [], error: null, cancelled: false });
}

/** 终态里的三段思考；进行中的快照用同一批文本，只是最后一段还是 streaming。 */
const THINKING_DONE = [
    { id: "entry:0", text: "Start by reading the two nodes on the canvas and confirm that they are the opening and the conflict.", status: "done" as const },
    { id: "entry:1", text: "Look at the timeline again.", status: "done" as const },
    { id: "entry:2", text: "Now write down the conclusion.", status: "done" as const },
];

async function slowThinkingTurn(line: Line) {
    const gap = () => new Promise((resolve) => setTimeout(resolve, THINKING_GAP_MS));
    const firstObserved = new Promise<void>((resolve) => { continueThinking = resolve; });
    await gap();
    line({ type: "reasoning_snapshot", segments: [{ id: "live-1:0", text: "First read the two nodes on the canvas.", status: "streaming" }] });
    // 默认折叠时正文不在 DOM 中；等测试实际展开并观察首段后再发下一段。
    // 否则点击耗时超过 600ms 就会漏采首段，误判为产品把增量攒到最后。
    await firstObserved;
    line({ type: "reasoning_snapshot", segments: [THINKING_DONE[0], { id: "live-2:1", text: "Look at the timeline again.", status: "streaming" }] });
    await gap();
    // 工具夹在两段思考之间：工具进度仍是单独一行，不并入思考。
    line({ type: "lifecycle", phase: "tool", toolName: "canvas_get" });
    line({ type: "reasoning_snapshot", segments: [THINKING_DONE[0], THINKING_DONE[1], { id: "live-3:2", text: "Now write down the conclusion.", status: "streaming" }] });
    await gap();
    line({ type: "text_snapshot", text: "The first text paragraph." });
    await gap();
    line({ type: "text_snapshot", text: "The first text paragraph. Second paragraph of text." });
    await gap();
    line({ type: "turn_end", reply: "The first text paragraph. Second paragraph of text.", toolCalls: [{ toolCallId: "t1", tool: "canvas_get" }], reasoning: THINKING_DONE, error: null, cancelled: false });
}

/** 宿主在生成中把思考清空（块被替换成空或 redacted）：整段替换为空数组。 */
async function clearedThinkingTurn(line: Line) {
    const gap = () => new Promise((resolve) => setTimeout(resolve, THINKING_GAP_MS));
    await gap();
    line({ type: "reasoning_snapshot", segments: [{ id: "live-1:0", text: "This section will be cleared later.", status: "streaming" }] });
    await gap();
    line({ type: "reasoning_snapshot", segments: [] });
    await gap();
    line({ type: "text_snapshot", text: "Have revisited the canvas." });
    await gap();
    line({ type: "turn_end", reply: "Have revisited the canvas.", toolCalls: [], reasoning: [], error: null, cancelled: false });
}

/** 终态说这一轮没有可读思考：流里显示过的那段不能在结算后留下。 */
async function settledEmptyThinkingTurn(line: Line) {
    const gap = () => new Promise((resolve) => setTimeout(resolve, THINKING_GAP_MS));
    await gap();
    line({ type: "reasoning_snapshot", segments: [{ id: "live-1:0", text: "This final state will be cleared.", status: "streaming" }] });
    await gap();
    line({ type: "text_snapshot", text: "Have revisited the canvas." });
    await gap();
    line({ type: "turn_end", reply: "Have revisited the canvas.", toolCalls: [], reasoning: [], error: null, cancelled: false });
}

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/assistant-stream-harness.tsx"],
        target: "browser",
        define: {
            "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"',
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"',
        },
        plugins: [{
            name: "test-source",
            setup(builder) { builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) })); },
        }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
    const ok = (data: unknown) => Response.json({ code: 0, data });
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const pathname = new URL(req.url).pathname;
            if (pathname === "/test/continue-thinking" && req.method === "POST") {
                continueThinking?.();
                continueThinking = undefined;
                return ok({});
            }
            if (pathname === "/harness.js") return new Response(js, { headers: { "content-type": "application/javascript" } });
            if (pathname.endsWith("/assistant/ui-session")) return ok({ token: "synthetic-only", expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
            if (pathname.endsWith("/assistant/status")) return ok({ available: true });
            if (pathname.endsWith("/assistant/sessions")) return ok({ currentSessionId: "stream-session", sessions: [] });
            if (pathname.endsWith("/assistant/history")) return ok({ sessionId: "stream-session", turns: [], active: null });
            if (pathname.endsWith("/assistant/chat")) {
                chatRequests++;
                // 面板按钮决定脚本：思考用例走带思考分片的慢速替身。
                const body = await req.json().catch(() => null) as { message?: string } | null;
                const message = String(body?.message || "");
                if (message.includes("Clear")) return ndjsonStream(clearedThinkingTurn);
                if (message.includes("final state")) return ndjsonStream(settledEmptyThinkingTurn);
                return ndjsonStream(message.includes("think") ? slowThinkingTurn : slowTextTurn);
            }
            if (pathname.startsWith("/api/")) return ok({});
            return new Response('<html><div id="root"></div><script type="module" src="/harness.js"></script></html>', { headers: { "content-type": "text/html" } });
        },
    });
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

test("Before the final state, the panel has displayed the assistant text in multiple sections.", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url.toString());
        await page.evaluate(() => {
            const samples: string[] = [];
            (window as unknown as { streamSamples: string[] }).streamSamples = samples;
            setInterval(() => {
                const element = document.querySelector(".canvas-assistant-reply");
                if (element) samples.push((element as HTMLElement).innerText);
            }, 100);
        });
        await page.getByRole("button", { name: "start", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-testid="streaming"]')?.textContent === "true");
        // 终态在最后一次分片后 750ms 才到；这里必须已经能看到第三段，第四段还没到。
        await page.waitForFunction(
            () => (document.querySelector(".canvas-assistant-reply") as HTMLElement | null)?.innerText.includes("The content of the third paragraph.") === true,
            undefined, { timeout: 10_000 },
        );
        const beforeEnd = await page.evaluate(() => (document.querySelector(".canvas-assistant-reply") as HTMLElement | null)?.innerText || "");
        expect(beforeEnd).toContain("First paragraph content.");
        expect(beforeEnd).toContain("Second paragraph content.");
        expect(beforeEnd).toContain("The content of the third paragraph.");
        expect(beforeEnd).not.toContain("The fourth paragraph.");
        expect(await page.getByTestId("streaming").innerText()).toBe("true");

        await page.waitForFunction(() => document.querySelector('[data-testid="streaming"]')?.textContent === "false", undefined, { timeout: 10_000 });
        const samples = await page.evaluate(() => [...new Set((window as unknown as { streamSamples: string[] }).streamSamples)]);
        // 至少三个分开发出的片段各自单独出现过一次。
        expect(samples.filter(text => text.includes("First paragraph content.")).length).toBeGreaterThan(0);
        expect(samples.filter(text => text.includes("Second paragraph content.") && !text.includes("The content of the third paragraph.")).length).toBeGreaterThan(0);
        expect(samples.filter(text => text.includes("The content of the third paragraph.") && !text.includes("The fourth paragraph.")).length).toBeGreaterThan(0);
        expect(samples.at(-1)).toContain("The fourth paragraph.");
        expect(chatRequests).toBe(1);
    } finally { await page.close(); }
}, 40000);

test("Thinking is folded by default. When expanded, you can see the increment. The text and thinking are separated.", async () => {
    const page = await browser.newPage();
    const requestsBefore = chatRequests;
    try {
        await page.goto(server.url.toString());
        await page.evaluate(() => {
            const samples: string[] = [];
            (window as unknown as { reasoningSamples: string[] }).reasoningSamples = samples;
            setInterval(() => {
                const element = document.querySelector('[data-testid="assistant-reasoning"]');
                if (element) samples.push((element as HTMLElement).innerText);
            }, 100);
        });
        await page.getByRole("button", { name: "start thinking", exact: true }).click();
        const drawer = page.locator('[data-testid="assistant-reasoning"]');
        await drawer.waitFor({ timeout: 10_000 });
        // 默认折叠：只有标题，思考正文不在 DOM 里。
        const collapsed = await drawer.innerText();
        expect(collapsed).toContain("Thinking…");
        expect(collapsed).not.toContain("read canvas first");
        expect(await page.getByText("First read the two nodes on the canvas").count()).toBe(0);
        expect(await drawer.getByRole("button").getAttribute("aria-expanded")).toBe("false");

        // 即使展开操作晚于原来的固定发包间隔，也必须观察到两次独立渲染。
        await page.waitForTimeout(THINKING_GAP_MS * 2);
        await drawer.getByRole("button").click();
        await page.getByText("First read the two nodes on the canvas").first().waitFor({ timeout: 10_000 });
        expect(await drawer.innerText()).not.toContain("Look at the timeline again.");
        expect(await page.getByTestId("streaming").innerText()).toBe("true");
        await page.waitForFunction(() => (window as unknown as { reasoningSamples: string[] }).reasoningSamples.some(text => text.includes("read canvas first")), undefined, { timeout: 10_000 });
        await page.evaluate(() => fetch("/test/continue-thinking", { method: "POST" }));
        // 第二段思考到达：展开区里能看到增量，而不是一次到位。
        await page.getByText("Look at the timeline again.").first().waitFor({ timeout: 10_000 });
        // 正文开始显示时，用户展开的思考区不自动折回。
        await page.waitForFunction(
            () => (document.querySelector(".canvas-assistant-reply") as HTMLElement | null)?.innerText.includes("The first text paragraph.") === true,
            undefined, { timeout: 10_000 },
        );
        expect(await drawer.getByRole("button").getAttribute("aria-expanded")).toBe("true");

        await page.waitForFunction(() => document.querySelector('[data-testid="streaming"]')?.textContent === "false", undefined, { timeout: 10_000 });
        // 回合结束后标题改成「思考过程」，展开状态和内容都保留。
        await page.getByText("Now write down the conclusion.").first().waitFor({ timeout: 10_000 });
        const settled = await drawer.innerText();
        expect(settled).toContain("thought process");
        expect(settled).toContain("First read the two nodes on the canvas");
        expect(await drawer.getByRole("button").getAttribute("aria-expanded")).toBe("true");

        // 正文与思考分开：正文里没有思考文本，思考区不在正文节点里。
        const reply = await page.evaluate(() => (document.querySelector(".canvas-assistant-reply") as HTMLElement | null)?.innerText || "");
        expect(reply).toContain("The first text paragraph. Second paragraph of text.");
        expect(reply).not.toContain("read canvas first");
        expect(await page.evaluate(() => Boolean(document.querySelector('.canvas-assistant-reply [data-testid="assistant-reasoning"]')))).toBe(false);

        const samples = await page.evaluate(() => [...new Set((window as unknown as { reasoningSamples: string[] }).reasoningSamples)]);
        const bodies = samples.filter(text => text.includes("read canvas first"));
        expect(bodies.length).toBeGreaterThan(1);
        expect(bodies.some(text => !text.includes("Look at the timeline again."))).toBe(true);
        expect(bodies.some(text => text.includes("Look at the timeline again."))).toBe(true);
        expect(samples.at(-1)).toContain("Now write down the conclusion.");
        expect(chatRequests).toBe(requestsBefore + 1);
    } finally { await page.close(); }
}, 60000);

test("When the host clears his thoughts, the panel removes the old content", async () => {
    const page = await browser.newPage();
    const requestsBefore = chatRequests;
    try {
        await page.goto(server.url.toString());
        await page.getByRole("button", { name: "Clear your mind", exact: true }).click();
        const drawer = page.locator('[data-testid="assistant-reasoning"]');
        await drawer.waitFor({ timeout: 10_000 });
        // 宿主发来完整空数组：旧思考立刻撤掉，不留在面板上。
        await drawer.waitFor({ state: "detached", timeout: 10_000 });
        expect(await page.locator('[data-testid="assistant-reasoning"]').count()).toBe(0);
        await page.waitForFunction(() => document.querySelector('[data-testid="streaming"]')?.textContent === "false", undefined, { timeout: 10_000 });
        expect(await page.locator('[data-testid="assistant-reasoning"]').count()).toBe(0);
        expect(chatRequests).toBe(requestsBefore + 1);
    } finally { await page.close(); }
}, 40000);

test("The final state authoritative space thinking clears the old content displayed in the stream.", async () => {
    const page = await browser.newPage();
    const requestsBefore = chatRequests;
    try {
        await page.goto(server.url.toString());
        await page.getByRole("button", { name: "Final state cleared", exact: true }).click();
        const drawer = page.locator('[data-testid="assistant-reasoning"]');
        await drawer.waitFor({ timeout: 10_000 });
        await page.waitForFunction(() => document.querySelector('[data-testid="streaming"]')?.textContent === "false", undefined, { timeout: 10_000 });
        // 终态说这一轮没有可读思考：流里那段不能当成有效终态继续显示。
        await drawer.waitFor({ state: "detached", timeout: 10_000 });
        expect(await page.locator('[data-testid="assistant-reasoning"]').count()).toBe(0);
        expect(chatRequests).toBe(requestsBefore + 1);
    } finally { await page.close(); }
}, 40000);
