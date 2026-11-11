// Real React/Chrome interactions against mock local APIs; no paid model calls.
import { createServer } from "vite";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, plugins: [{
    name: "transcription-test-page",
    configureServer(server) {
        server.middlewares.use("/__transcription_test", async (_req, res) => {
            const html = await server.transformIndexHtml("/__transcription_test", '<html><body><div id="root"></div><script type="module" src="/test/fixtures/canvas-transcription-runtime.tsx"></script></body></html>');
            res.setHeader("Content-Type", "text/html"); res.end(html);
        });
    },
}] });
let browser;
try {
    await server.listen();
    const address = server.httpServer.address();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
    page.on("requestfailed", request => console.error("Failed request:", request.url(), request.failure()?.errorText));
    const submissions = [];
    let holdResult = false;
    const result = { segments: [{ startMs: 250, endMs: 1750, text: "Hello, automatic subtitles" }], language: "zh" };
    await page.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        const envelope = data => route.fulfill({ json: { code: 0, data, msg: "ok" } });
        if (path === "/api/beeftv/connection/models") { await new Promise(resolve => setTimeout(resolve, 4500)); return envelope({ models: [
            { id: "hy-asr-3.0-preview", supportedEndpointTypes: ["audio.transcriptions"] },
            { id: "minimax-speech-2.8-hd", supportedEndpointTypes: ["audio.speech"] },
        ] }); }
        if (path === "/api/timeline/transcriptions") {
            await new Promise(resolve => setTimeout(resolve, 4500));
            submissions.push(route.request().postDataJSON());
            return envelope({ id: "transcription-fixture", status: "succeeded", resultJson: JSON.stringify(result) });
        }
        if (path === "/api/tasks/transcription-fixture") return envelope({ id: "transcription-fixture", status: holdResult ? "running" : "succeeded", stage: "Transcribing", resultJson: JSON.stringify(result) });
        return route.fulfill({ status: 500, json: { code: 500, msg: `Unexpected test route ${path}` } });
    });
    await page.goto(`http://127.0.0.1:${address.port}/__transcription_test`);
    await page.getByRole("toolbar", { name: "Node shortcut tool" }).getByRole("button", { name: "subtitles", exact: true }).click().catch(async error => { console.error("Toolbar DOM:", await page.locator("body").innerHTML()); throw error; });
    assert.equal(await page.getByTestId("selected-node").textContent(), "video-fixture");
    await page.getByTestId("toolbar-container").evaluate(element => { element.style.width = "380px"; });
    await page.getByRole("toolbar", { name: "Node shortcut tool" }).getByRole("button", { name: "subtitles", exact: true }).click();
    await page.getByRole("button", { name: "Read the BeefTV transcription model" }).click();
    await page.getByRole("combobox", { name: "Transcription model" }).click();
    await page.getByText("hy-asr-3.0-preview · BeefTV", { exact: true }).last().click();
    assert.equal(await page.getByText("minimax-speech-2.8-hd", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Automatically transcribe subtitles" }).click();
    try { await page.getByText("1 subtitle has been identified and can be edited and saved or exported as SRT", { exact: true }).waitFor(); }
    catch (error) { console.error("Rendered state:", await page.locator("body").innerText(), "Submissions:", submissions); throw error; }
    const entries = JSON.parse(await page.getByTestId("subtitles").textContent());
    assert.deepEqual(entries, [{ startMs: 250, endMs: 1750, text: "Hello, automatic subtitles", index: 1 }]);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].model, "hy-asr-3.0-preview");
    assert.equal(submissions[0].resourceId, "resource-fixture");
    assert.equal(submissions[0].projectId, "project-fixture");
    assert.ok(submissions[0].clientOperationId);
    holdResult = true;
    await page.getByRole("button", { name: "Automatically transcribe subtitles" }).click();
    await page.getByRole("status").filter({ hasText: "Transcribing" }).waitFor();
    await page.getByText("After closing the window, the transcription task will still continue and can be viewed in the task center.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close test window" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="running"]')?.textContent === "false");
    result.segments[0].text = "Cannot write after closing";
    holdResult = false;
    await page.getByRole("button", { name: "reopen" }).click();
    assert.equal(await page.getByRole("button", { name: "Automatically transcribe subtitles" }).isEnabled(), true);
    assert.deepEqual(JSON.parse(await page.getByTestId("subtitles").textContent()), entries);
    await page.getByRole("button", { name: "Close test window" }).click();
    await page.getByRole("button", { name: "Switch audio and video materials" }).click();
    await page.getByRole("toolbar", { name: "Node shortcut tool" }).getByRole("button", { name: "subtitles", exact: true }).click();
    assert.equal(await page.getByTestId("selected-node").textContent(), "audio-fixture");
    assert.equal(await page.getByRole("button", { name: "Automatically transcribe subtitles" }).isVisible(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: real video/audio CanvasNodeToolbar subtitle button clicks, cloud catalog selection, task submission, timed subtitle attachment, close/reopen; no paid requests");
} finally {
    await browser?.close();
    await server.close();
}
