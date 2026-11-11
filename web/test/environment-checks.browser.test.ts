import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let requests = 0;

beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/environment-checks-harness.tsx"], target: "browser", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "fixture-aliases", setup(builder) {
        builder.onResolve({ filter: /^@\// }, args => args.path === "@/services/api/request" ? { path: args.path, namespace: "http-fixture" } : { path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) });
        builder.onLoad({ filter: /.*/, namespace: "http-fixture" }, () => ({ loader: "ts", contents: `export const http={post:async(path,body)=>{const response=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('fixture unavailable');return response.json();}};export const apiClient={};` }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find(item => item.path.endsWith(".js"))!.text();
    const buildPreflight = () => Bun.build({ entrypoints: [import.meta.dir + "/../src/main.tsx"], target: "browser", plugins: [{ name: "bootstrap-boundary", setup(builder) {
        builder.onResolve({ filter: /bootstrap-workspace$/ }, () => ({ path: "workspace", namespace: "workspace-fixture" }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        builder.onLoad({ filter: /.*/, namespace: "workspace-fixture" }, () => ({ loader: "js", contents: `export async function startApplication(){window.workspaceStarts=(window.workspaceStarts||0)+1;if(location.search.includes('fail'))throw Error('synthetic-private-path-and-secret');document.getElementById('root').textContent='工作区已打开';}` }));
    } }] });
    // CI 上偶发一次 Bun.build 报入口文件找不到（文件就在仓库里，前后构建都正常），重试一次即可。
    let preflightBuild = await buildPreflight();
    if (!preflightBuild.success && preflightBuild.logs.some((log) => String(log).includes("ModuleNotFound"))) {
        preflightBuild = await buildPreflight();
    }
    if (!preflightBuild.success) throw new Error(preflightBuild.logs.join("\n"));
    const preflightScript = await preflightBuild.outputs.find(item => item.path.endsWith(".js"))!.text();
    const stylesheet = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwindcss({ base: import.meta.dir + "/.." })]).process(await Bun.file(stylesheet).text(), { from: stylesheet })).css;
    server = Bun.serve({ port: 0, async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/preflight.js") return new Response(preflightScript, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/preflight") return new Response('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/preflight.js"></script>', { headers: { "Content-Type": "text/html" } });
        if (path === "/app.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/style.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path === "/api/diagnostics/environment") {
            const body = await req.json();
            if (body.repair !== true) return new Response("unexpected repair request", { status: 400 });
            requests++;
            return Response.json({ checks: [
                { id: "directory-tmp", title: "Temporary file directory", status: "repaired", detail: "The missing directory has been rebuilt and rechecked; existing files have not been modified.", cases: ["ENV-0006"] },
                { id: "media-tool", title: "Video processing tools", status: "warning", detail: "No executable video processing tool found. Some video previews, transcoding and exporting will be unavailable, please reinstall from the official installation package.", cases: ["ENV-0014"] },
            ] });
        }
        return new Response('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>', { headers: { "Content-Type": "text/html" } });
    } });
    const executablePath = process.env.CHROME_PATH;
    browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
    mkdirSync(import.meta.dir + "/../../output/environment-check", { recursive: true });
}, 60000);

afterAll(async () => { await browser?.close(); server?.stop(true); });

for (const width of [390, 1440]) for (const dark of [false, true]) test(`environment diagnosis ${width} dark=${dark}`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(7000);
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("environment fixture page error:", error.message); });
    try {
        await page.addInitScript(() => { Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }); });
        await page.goto(server.url + (dark ? "?dark" : ""), { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Environmental self-check", exact: true }).waitFor();
        await page.getByText("Fixed", { exact: true }).waitFor();
        await page.getByText("The missing directory has been rebuilt and rechecked; existing files have not been modified.", { exact: true }).waitFor();
        expect(await page.evaluate(() => (window as any).createTestBusinessID().length)).toBe(21);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        const before = requests;
        const response = page.waitForResponse(item => item.url().endsWith("/api/diagnostics/environment") && item.request().method() === "POST");
        await page.getByRole("button", { name: "recheck", exact: true }).click();
        await response;
        await page.waitForFunction(() => document.querySelector('[aria-label="Recheck"]')?.getAttribute("aria-busy") === "false");
        expect(await page.getByRole("button", { name: "recheck", exact: true }).isEnabled()).toBe(true);
        expect(requests).toBeGreaterThan(before);
        expect((await page.evaluate(() => indexedDB.databases())).filter(db => db.name?.startsWith("beeftv-environment-probe-")).length).toBe(0);
        await page.screenshot({ path: import.meta.dir + `/../../output/environment-check/${width}-${dark}.png` });
        expect(errors).toEqual([]);
    } catch (error) {
        console.error("environment fixture state:", await page.locator("body").innerText().catch(() => "page unavailable"));
        throw error;
    } finally { await page.close(); }
}, 30000);

for (const missing of ["structuredClone", "indexedDB", "getRandomValues"]) test(`real entry blocks bootstrap before missing ${missing}`, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
    try {
        await page.addInitScript((key) => {
            Object.defineProperty(key === "getRandomValues" ? crypto : globalThis, key, { value: undefined, configurable: true });
            Object.defineProperty(Element.prototype, "replaceChildren", { value: undefined, configurable: true });
        }, missing);
        await page.goto(server.url + "preflight");
        await page.getByRole("heading", { name: "The operating environment needs to be updated" }).waitFor();
        expect(await page.evaluate(() => (window as any).workspaceStarts || 0)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.getByRole("button", { name: "reload" }).waitFor();
        if (missing === "structuredClone") await page.screenshot({ path: import.meta.dir + "/../../output/environment-check/preflight-390.png" });
    } finally { await page.close(); }
}, 15000);

test("real entry starts once and hides raw bootstrap errors", async () => {
    for (const failure of [false, true]) {
        const page = await browser.newPage();
        try {
            await page.goto(server.url + "preflight" + (failure ? "?fail" : ""));
            await page.getByText(failure ? "The workspace cannot be opened temporarily" : "Workspace is open", { exact: true }).waitFor();
            expect(await page.evaluate(() => (window as any).workspaceStarts)).toBe(1);
            expect(await page.locator("body").innerText()).not.toContain("synthetic-private-path-and-secret");
        } finally { await page.close(); }
    }
}, 15000);

test("denied browser storage and unavailable backend stay distinct", async () => {
    const page = await browser.newPage();
    try {
        await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException("blocked", "SecurityError"); }; });
        await page.route("**/api/diagnostics/environment", route => route.fulfill({ status: 503, body: "unavailable" }));
        await page.goto(server.url.toString());
        await page.getByText("The local service check has not been completed. The following are only the browser check results. Please confirm that the backend is running and try again.", { exact: true }).waitFor();
        await page.getByText("The local cache cannot be written to, please check privacy settings, storage, or update the runtime.", { exact: true }).waitFor();
        const startup = await page.evaluate(() => (window as any).runStartupEnvironmentCheck());
        expect(startup.checks.find((item: any) => item.id === "indexed-db").status).toBe("error");
        expect(startup.checks.find((item: any) => item.id === "check-unavailable").status).toBe("unknown");
    } finally { await page.close(); }
}, 30000);
