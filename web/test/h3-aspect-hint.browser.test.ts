import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
const errors: string[] = [];

beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/h3-aspect-hint-harness.tsx"], target: "browser", define: {
        "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"',
    }, plugins: [{ name: "source", setup(builder) {
        builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: "model-logo", namespace: "test-icons" }));
        builder.onLoad({ filter: /.*/, namespace: "test-icons" }, () => ({ contents: "export function ModelLogo() { return null; }", loader: "js" }));
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    // Use the same PostCSS plugin as Vite, compiling current source rather than stale dist assets.
    const cssPath = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwind({ base: import.meta.dir + "/.." })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css
        + readFileSync(import.meta.dir + "/../src/styles/beeftv-local-overrides.css", "utf8")
        + readFileSync(import.meta.dir + "/../src/styles/workspace-product.css", "utf8");
    server = Bun.serve({ port: 0, fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/harness.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
        if (url.pathname === "/harness.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (url.pathname.startsWith("/api/")) return Response.json({ code: 0, data: {}, msg: "ok" });
        const dark = url.searchParams.get("theme") === "dark";
        return new Response(`<html class="${dark ? "dark" : ""}"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/harness.css"><body class="app-product-overlays"><div id="root" class="app-product-workspace"></div><script type="module" src="/harness.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
    } });
    if (!(await fetch(`${server.url}harness.css`)).ok) throw new Error("Product CSS failed to load");
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);

afterAll(async () => { server?.stop(true); await browser?.close(); }, 30000);

async function open(width = 1280, dark = false) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url.toString() + (dark ? "?theme=dark" : ""));
    await page.getByRole("button", { name: /高级设置：.*随首帧图片/ }).waitFor();
    return page;
}

async function assertLocked(page: Page, frame = "first frame", savedSize = "9:16") {
    await page.getByRole("button", { name: new RegExp(`Advanced settings: .*Subject to${frame}pictures`) }).click();
    const panel = page.locator(".canvas-image-settings-popover");
    const help = `The video ratio is given by${frame}Pictures decide. If you need other ratios, please crop or enlarge the image first and then generate the video.`;
    await panel.getByText(help, { exact: true }).waitFor();
    expect(await panel.getByRole("button", { name: "9:16", exact: true }).count()).toBe(0);
    expect(await panel.getByText(/^W\s/).count()).toBe(0);
    expect(await page.getByTestId("saved-size").textContent()).toBe(savedSize);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await panel.evaluate((element) => getComputedStyle(element).getPropertyValue("--fs-label").trim())).toBe("11px");
}

async function assertCharacterWarning(page: Page) {
    await page.getByRole("button", { name: /高级设置：.*16:9/ }).click();
    const panel = page.locator(".canvas-image-settings-popover");
    await panel.getByText("When using a character cassette with a reference image, it cannot be used at the same time as the specified first and last frames. Please remove the character card, or cancel the specification of the first and last frames before generating again.", { exact: true }).waitFor();
    expect(await panel.getByRole("button", { name: "9:16", exact: true }).isVisible()).toBe(true);
}

test("actual prompt panel updates keyframe hints, reconnects and changes H3 modes", async () => {
    const page = await open();
    try {
        await assertLocked(page);
        await page.getByRole("button", { name: "Only use last frame", exact: true }).click();
        await assertLocked(page, "last frame");
        await page.getByRole("button", { name: "First and last frames", exact: true }).click();
        await assertLocked(page);
        await page.getByRole("button", { name: "disconnect picture", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*9:16/ }).click();
        await page.locator(".canvas-image-settings-popover").getByRole("button", { name: "16:9", exact: true }).click();
        expect(await page.getByTestId("saved-size").textContent()).toBe("16:9");
        await page.getByRole("button", { name: "Access pictures", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*随首帧图片/ }).waitFor();
        await page.getByRole("button", { name: "minimax-h3-max", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*随首帧图片/ }).waitFor();
        await page.getByRole("button", { name: "minimax-h3", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*随首帧图片/ }).waitFor();
        await page.getByRole("button", { name: "Specify first frame", exact: true }).click();
        await page.getByRole("button", { name: "Add character card", exact: true }).click();
        await assertCharacterWarning(page);
        await page.getByRole("button", { name: "Only use last frame", exact: true }).click();
        await assertCharacterWarning(page);
        await page.getByRole("button", { name: "general reference", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*16:9/ }).click();
        await page.locator(".canvas-image-settings-popover").getByRole("button", { name: "9:16", exact: true }).click();
        expect(await page.getByTestId("saved-size").textContent()).toBe("9:16");
        await page.getByRole("button", { name: "minimax-h3-max-turbo", exact: true }).click();
        await page.getByRole("button", { name: "Only character cards", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*9:16/ }).click();
        await page.getByText("When the first and last frames are generated, the scale follows the actual reference image; multi-material reference generation uses the selected scale.", { exact: true }).waitFor();
        expect(errors).toEqual([]);
    } finally { await page.close(); }
}, 30000);

test("keyframe explanation fits light desktop and dark 390px panels", async () => {
    for (const [width, dark] of [[1280, false], [390, true]] as const) {
        const page = await open(width, dark);
        try {
            await assertLocked(page);
            expect(await page.getByText("The video ratio is determined by the first frame of the image. If you need other ratios, please crop or enlarge the image first and then generate the video.", { exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).toBe("12px");
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            if (process.env.BEEFTV_UI_EVIDENCE_DIR) {
                mkdirSync(process.env.BEEFTV_UI_EVIDENCE_DIR, { recursive: true });
                await page.locator(".canvas-image-settings-popover").screenshot({ path: `${process.env.BEEFTV_UI_EVIDENCE_DIR}/h3-aspect-${dark ? "dark-390" : "light-desktop"}.png` });
            }
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }
}, 30000);

test("Max and Turbo reference ratios remain editable alongside H3 advanced controls", async () => {
    const page = await open();
    try {
        for (const model of ["minimax-h3-max", "minimax-h3-max-turbo"]) {
            await page.getByRole("button", { name: model, exact: true }).click();
            await page.getByRole("button", { name: "general reference", exact: true }).click();
            await page.getByRole("button", { name: /高级设置：.*9:16/ }).click();
            const panel = page.locator(".canvas-image-settings-popover");
            await panel.getByRole("button", { name: "16:9", exact: true }).click();
            expect(await page.getByTestId("saved-size").textContent()).toBe("16:9");
            await panel.getByRole("button", { name: "9:16", exact: true }).click();
            await panel.getByText("MiniMax H3 Advanced Settings", { exact: true }).click();
            await panel.getByRole("spinbutton", { name: "random seed", exact: true }).fill("42");
            await panel.getByRole("spinbutton", { name: "random seed", exact: true }).press("Tab");
            expect(await page.getByTestId("saved-seed").textContent()).toBe("42");
            await page.getByRole("button", { name: /高级设置：.*9:16/ }).click();
        }
        expect(errors).toEqual([]);
    } finally { await page.close(); }
}, 30000);

test("Styles keyframes lock ratios and unresolved character views leave them editable", async () => {
    const page = await open();
    try {
        await page.getByRole("button", { name: "Add character card", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*9:16/ }).click();
        const panel = page.locator(".canvas-image-settings-popover");
        await panel.getByText("When the first and last frames are generated, the scale follows the actual reference image; multi-material reference generation uses the selected scale.", { exact: true }).waitFor();
        await panel.getByRole("button", { name: "16:9", exact: true }).click();
        expect(await page.getByTestId("saved-size").textContent()).toBe("16:9");
        await page.getByRole("button", { name: "disconnect picture", exact: true }).click();
        await page.getByRole("button", { name: "Access pictures", exact: true }).click();
        await page.getByRole("button", { name: "H3 hand drawn", exact: true }).click();
        await assertLocked(page, "first frame", "16:9");
        await page.getByRole("button", { name: "disconnect picture", exact: true }).click();
        await page.getByRole("button", { name: /高级设置：.*16:9/ }).click();
        await panel.getByRole("button", { name: "9:16", exact: true }).click();
        expect(await page.getByTestId("saved-size").textContent()).toBe("9:16");
        expect(errors).toEqual([]);
    } finally { await page.close(); }
}, 30000);
