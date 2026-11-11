import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
for (const width of [1440, 390]) for (const dark of [false, true]) test(`reference transport and storage check ${width} dark=${dark}`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
        await page.goto(server.url + "?transport&auto" + (dark ? "&dark" : ""));
        await page.getByRole("combobox", { name: "Picture transfer method" }).click();
        await page.getByText("Directly upload materials", { exact: true }).click();
        await page.getByRole("combobox", { name: "Video transmission method" }).click();
        await page.locator(".ant-select-dropdown:visible").getByText("Manually fill in the HTTPS link", { exact: true }).click();
        await page.getByRole("button", { name: "Save and test upload" }).click();
        await page.getByText("Storage test passed", { exact: true }).waitFor();
        await page.getByText("Upload, public read and test file cleanup all passed", { exact: true }).waitFor();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: import.meta.dir + `/../../output/reference-transport-${width}-${dark}.png`, fullPage: true });
        await page.getByRole("textbox", { name: "S3 endpoint" }).fill("https://changed.example.com");
        expect(await page.getByText("Storage test passed", { exact: true }).count()).toBe(0);
        expect(errors).toEqual([]);
    } finally { await page.close(); }
}, 30000);

test("failed storage check keeps an actionable HTTP status", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url + "?transport&auto&test-error");
        await page.getByRole("button", { name: "Save and test upload" }).click();
        await page.getByText("Storage test failed", { exact: true }).waitFor();
        await page.getByText(/HTTP 403/).waitFor();
        expect(await page.getByText("Storage test passed", { exact: true }).count()).toBe(0);
    } finally { await page.close(); }
}, 30000);

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
for (const width of [1440, 390]) for (const dark of [false, true]) test(`storage password matches ordinary field height ${width} dark=${dark}`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
        await page.goto(server.url + (dark ? "?dark" : ""));
        const secret = page.locator('input[aria-label="Secret Access Key"]');
        await secret.waitFor({ state: "visible" });
        const geometry = () => secret.evaluate(input => {
            const wrapper = input.closest(".ant-input-affix-wrapper")!;
            const ordinary = document.querySelector('input[aria-label="bucket public network address"]')!;
            return {
                password: wrapper.getBoundingClientRect().height,
                ordinary: ordinary.getBoundingClientRect().height,
                innerBackground: getComputedStyle(input).backgroundColor,
            };
        });
        let bounds = await geometry();
        expect(bounds.ordinary).toBe(38);
        expect(bounds.password).toBe(bounds.ordinary);
        expect(bounds.innerBackground).toBe("rgba(0, 0, 0, 0)");
        await secret.fill("fixture-secret");
        await secret.focus();
        bounds = await geometry();
        expect(bounds.password).toBe(bounds.ordinary);
        // CI 的无头浏览器里眼睛图标可能量不出尺寸；这里只验证切换明文后的高度，直接触发点击。
        await page.locator(".ant-input-password-icon").dispatchEvent("click");
        expect(await secret.getAttribute("type")).toBe("text");
        bounds = await geometry();
        expect(bounds.password).toBe(bounds.ordinary);
        expect(bounds.innerBackground).toBe("rgba(0, 0, 0, 0)");
    } finally {
        await page.close();
    }
}, 30000);
beforeAll(async () => {
    const stubs: Record<string, string> = {
        "@/services/model-config-repository": "export const flushModelConfig=async()=>{}; export const getModelConfigPersistenceState=()=>({dirty:false,status:'ready'});",
        "@/services/local-workspace-sync": "export const saveRemoteUserDataNow=async()=>{};",
        "@/lib/canvas/canvas-project-generation": "export const isAudioFile=(file)=>file.type.startsWith('audio/');",
    };
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/storage-feedback-harness.tsx"],
        target: "browser",
        define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
        plugins: [
            {
                name: "aliases",
                setup(builder) {
                    builder.onResolve({ filter: /^@\// }, (args) => (args.path in stubs ? { path: args.path, namespace: "stub" } : { path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
                    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "tsx", resolveDir: import.meta.dir }));
                },
            },
        ],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
    const stylesheet = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwindcss({ base: import.meta.dir + "/.." })]).process(await Bun.file(stylesheet).text(), { from: stylesheet })).css
        + (await Promise.all(["beeftv-local-overrides.css", "workspace-product.css"].map(file => Bun.file(import.meta.dir + "/../src/styles/" + file).text()))).join("\n")
        + (await Promise.all(build.outputs.filter(output => output.path.endsWith(".css")).map(output => output.text()))).join("\n");
    let fixtureCanvasDocumentMB = 64;
    let rejectNextCanvasLimitPatch = false;
    server = Bun.serve({
        port: 0,
        fetch: async (req) => {
            const url = new URL(req.url);
            const path = url.pathname;
            if (path === "/app.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
            if (path === "/style.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
            if (path === "/api/resources/storage-usage") {
                if (req.method === "GET") {
                    return Response.json({ code: 0, msg: "ok", data: { usage: { usedBytes: 0, totalBytes: 1024 ** 3 }, canvasDocumentMB: fixtureCanvasDocumentMB } });
                }
                if (req.method === "PATCH") {
                    if (rejectNextCanvasLimitPatch) {
                        rejectNextCanvasLimitPatch = false;
                        return Response.json({ code: 500, msg: "Failed to write capacity configuration" }, { status: 500 });
                    }
                    const body = (await req.json()) as { canvasDocumentMB?: number };
                    fixtureCanvasDocumentMB = Number(body.canvasDocumentMB ?? 64);
                    return Response.json({ code: 0, msg: "ok", data: { canvasDocumentMB: fixtureCanvasDocumentMB } });
                }
            }
            if (url.searchParams.has("reject-canvas-limit")) {
                rejectNextCanvasLimitPatch = true;
                fixtureCanvasDocumentMB = 64;
            }
            return new Response('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>', {
                headers: { "Content-Type": "text/html" },
            });
        },
    });
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);
afterAll(async () => {
    await browser?.close();
    server?.stop(true);
}, 30000);
test("migration restart advice stays visible while technical details are collapsed", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url + "?migration-error");
        await page.getByRole("button", { name: "Select folder", exact: true }).click();
        await page.getByRole("button", { name: "Migrate old data and use new directory" }).click();
        await page.getByText("The migration is not completed, the original data has been retained, but the workspace cannot be reopened. Please restart BeefTV", { exact: true }).waitFor();
        expect(await page.getByText(/fixture failure/).isVisible()).toBe(false);
        await page.getByText("Error details", { exact: true }).click();
        expect(await page.getByText(/fixture failure/).isVisible()).toBe(true);
    } finally {
        await page.close();
    }
}, 30000);
test("failed cleanup closes stale confirmation and retains honest retry state", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url + "?cleanup-error");
        expect(await page.getByText(/原目录可能已部分清理/).count()).toBe(0);
        await page.screenshot({ path: import.meta.dir + "/../../output/storage-before-cleanup.png" });
        await page.getByRole("button", { name: "Clean up the original directory and free up disk space" }).click();
        await page.getByRole("button", { name: "Confirm and clean", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByText("The temporary file is still in use, please restart BeefTV and clean it again. The current storage directory is not affected", { exact: true }).waitFor();
        expect(await page.getByText(/原数据仍保留在/).count()).toBe(0);
        await page.getByText(/请保留当前存储目录/).waitFor();
        await page.screenshot({ path: import.meta.dir + "/../../output/storage-cleanup-interrupted.png" });
        await page.getByRole("button", { name: "Clean up the original directory and free up disk space" }).click();
        await page.getByText(/可释放约 0.0 GB/).waitFor();
    } finally {
        await page.close();
    }
}, 30000);
for (const width of [1440, 390])
    for (const dark of [false, true])
        test(`storage and URL entry ${width}px dark=${dark}`, async () => {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            try {
                await page.goto(server.url + (dark ? "?dark" : ""));
                await page.getByRole("button", { name: "Select folder", exact: true }).click();
                expect(await page.getByRole("textbox", { name: "New storage directory" }).inputValue()).toBe("D:\\BeefTV");
                await page.getByRole("button", { name: "Migrate old data and use new directory" }).click();
                await page.getByText("Current directory: D:\\BeefTV", { exact: true }).waitFor();
                await page.getByRole("button", { name: "Clean up the original directory and free up disk space" }).click();
                await page.getByRole("button", { name: "Confirm and clean", exact: true }).click();
                await page.getByRole("button", { name: "Clean up the original directory and free up disk space" }).waitFor({ state: "detached" });
                await page.getByRole("button", { name: "Add test material" }).click();
                const input = page.getByRole("textbox", { name: "Online material address" });
                await input.fill("http://cdn.example.com/image.png");
                expect(await page.getByRole("button", { name: "Add link", exact: true }).isDisabled()).toBe(true);
                await input.fill("https://cdn.example.com/image.png");
                const bounds = await page.getByRole("dialog").boundingBox();
                expect(bounds!.x).toBeGreaterThanOrEqual(0);
                expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
                await page.screenshot({ path: import.meta.dir + `/../../output/storage-url-${width}-${dark}.png` });
                await page.getByRole("button", { name: "Add link", exact: true }).click();
                await page.getByText("image:https://cdn.example.com/image.png", { exact: true }).waitFor();
                await page.getByRole("textbox", { name: "S3 endpoint", exact: true }).fill("https://s3.example.com");
                await page.getByRole("textbox", { name: "Secret Access Key", exact: true }).fill("fixture-secret");
                await page.getByRole("button", { name: "Save object storage configuration" }).click();
                await page.getByPlaceholder("Saved, leave blank to keep").waitFor();
                expect(await page.getByRole("textbox", { name: "Secret Access Key", exact: true }).inputValue()).toBe("");
                expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
                expect(errors).toEqual([]);
            } finally {
                await page.close();
            }
        }, 30000);
test("enabled own storage supplies links and public-read failures allow manual HTTPS retry", async () => {
    for (const reject of [false, true]) {
        const page = await browser.newPage();
        try {
            await page.goto(server.url + "?auto" + (reject ? "&reject" : ""));
            await page.getByRole("button", { name: "Generate tests", exact: true }).click();
            if (reject) {
                await page.getByText("Object storage upload not completed", { exact: true }).waitFor();
                expect(await page.getByRole("button", { name: "Use link and generate" }).isDisabled()).toBe(true);
                await page.getByRole("textbox", { name: "Reference pictures", exact: true }).fill("https://cdn.example.com/manual-image");
                await page.getByRole("button", { name: "Use link and generate" }).click();
            }
            await page.getByText(reject ? "https://cdn.example.com/manual-image" : "https://cdn.example.com/owned-image", { exact: true }).waitFor();
            expect(await page.getByRole("dialog").count()).toBe(0);
        } finally {
            await page.close();
        }
    }
}, 30000);
test("custom single-canvas capacity limit can be customized or set to unlimited", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(String(server.url) + "?reject-canvas-limit");
        const input = page.getByRole("textbox", { name: "Maximum capacity of a single canvas (MB)" });
        await input.waitFor({ state: "visible" });
        expect(await input.inputValue()).toBe("64");
        await input.fill("128");
        await page.getByRole("button", { name: "Save capacity settings", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Failed to write capacity configuration" }).waitFor();
        await page.getByText(/当前生效上限：64 MB/).waitFor();
        await input.fill("256");
        await page.getByRole("button", { name: "Save capacity settings", exact: true }).click();
        await page.getByText(/当前生效上限：256 MB/).waitFor();
        await page.getByRole("button", { name: "no limit", exact: true }).click();
        await page.getByText(/当前生效上限：不限制/).waitFor();
        expect(await input.inputValue()).toBe("0");
    } finally {
        await page.close();
    }
}, 30000);
