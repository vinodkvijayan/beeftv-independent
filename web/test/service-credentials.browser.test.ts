import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// 截图目录与 BeefTV PR 流程一致：/tmp/beeftv-pr-shots/<需求号>/
const shotDirectory = process.env.BEEFTV_SHOT_DIR || "/tmp/beeftv-pr-shots/27";
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/model-service-credentials-harness.tsx"], target: "browser", define: {
        "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"',
    }, plugins: [{ name: "source", setup(builder) {
        builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: "model-logo", namespace: "test-icons" }));
        builder.onLoad({ filter: /.*/, namespace: "test-icons" }, () => ({ contents: "export function ModelLogo() { return null; }", loader: "js" }));
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const cssPath = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwind({ base: import.meta.dir + "/.." })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css
        + readFileSync(import.meta.dir + "/../src/styles/beeftv-local-overrides.css", "utf8")
        + readFileSync(import.meta.dir + "/../src/styles/workspace-product.css", "utf8")
        + await build.outputs.find((output) => output.path.endsWith(".css"))!.text();
    const providers = [
        // 真实目录里文本要用的 chat-completion 也在，否则旧连接补出来的文本协议找不到定义。
        { id: "chat-completion", name: "OpenAI Chat Completions", create: "POST /chat/completions", contentType: "application/json", authType: "bearer" },
        { id: "volcengine-ark-video", name: "Volcengine Ark Seedance", create: "POST /api/v3/contents/generations/tasks", poll: "GET /api/v3/contents/generations/tasks/{task_id}", contentType: "application/json", authType: "bearer" },
        { id: "volcengine-ark-agent-plan-video", name: "Volcengine Ark Agent Plan Seedance", create: "POST /api/plan/v3/contents/generations/tasks", poll: "GET /api/plan/v3/contents/generations/tasks/{task_id}", contentType: "application/json", authType: "bearer" },
        { id: "volcengine-jimeng-video", name: "Volcengine Jimeng Video", create: "POST /?Action=CVSync2AsyncSubmitTask", poll: "GET /?Action=CVSync2AsyncGetResult", contentType: "application/json", authType: "volcengine-v4" },
    ].map((provider) => ({ ...provider, version: "1.0.0", vendor: "BeefTV", categories: [provider.id === "chat-completion" ? "text" : "video"], scopes: ["user.custom-channel"], enabled: true }));
    server = Bun.serve({ port: 0, fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/harness.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
        if (url.pathname === "/harness.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (url.pathname === "/api/plugins/catalog") return Response.json({ code: 0, data: { providers }, msg: "ok" });
        // 方舟没有 OpenAI 格式的模型目录：这里复现真实返回，让界面走「读不到」的分支。
        if (url.pathname === "/api/ai/models") return Response.json({ code: 502, data: null, msg: "The model service does not provide this model directory interface. Please check the address or add the model manually.", reason: "catalog_unsupported" }, { status: 502 });
        if (url.pathname.startsWith("/api/")) return Response.json({ code: 0, data: {}, msg: "ok" });
        const dark = url.searchParams.get("theme") === "dark";
        return new Response(`<html class="${dark ? "dark" : ""}"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/harness.css"><body class="app-product-overlays"><div id="root" class="app-product-workspace"></div><script type="module" src="/harness.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
    } });
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
    mkdirSync(shotDirectory, { recursive: true });
}, 180000);
afterAll(async () => { server?.stop(true); await browser?.close(); }, 60000);

const savedOf = (page: Page) => page.evaluate(() => (globalThis as unknown as { __saved: Array<{ apiKey: string; secretKey?: string; models: string[]; profiles: Array<{ model: string; capability: string }> }> }).__saved);

/** bun 的 expect 没有 poll：自己等保存结果落下来，避免用固定 sleep 猜。 */
async function waitForSaved(page: Page, count: number, label: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if ((await savedOf(page)).length >= count) return;
        await page.waitForTimeout(100);
    }
    throw new Error(`${label}: Waited for 5 seconds and still not saved.`);
}

async function openConnectionStep(scenario: string) {
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(server.url.toString() + `?scenario=${scenario}`);
    // initial 通道从第 2 步进来，回到「连接信息」看凭证字段。
    await page.getByRole("button", { name: "connection information", exact: true }).click();
    await page.getByText("connection name", { exact: true }).waitFor();
    return page;
}

async function openModelsStep(scenario: string) {
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(server.url.toString() + `?scenario=${scenario}`);
    await page.getByText("Choose the model you want to use", { exact: true }).waitFor();
    return page;
}

/** 「保存并使用」在第二步，「连接信息」在第一步：跳过目录读取进第二步才点得到保存。 */
async function openSaveStep(scenario: string) {
    const page = await openConnectionStep(scenario);
    await page.getByRole("button", { name: "Add model manually", exact: true }).click();
    await page.getByRole("button", { name: "Save and use", exact: true }).waitFor();
    return page;
}

async function shot(page: Page, name: string) {
    await page.screenshot({ path: `${shotDirectory}/${name}.png` });
}

test("an Ark connection without a protocol names both key kinds instead of one generic API Key", async () => {
    const page = await openConnectionStep("ark-none");
    try {
        expect(await page.locator('input[aria-label="API Key"]').count()).toBe(1);
        // 两类 Key 的对比和即梦的凭证都在同一个字段说明里，全部可见后再截图。
        await page.getByText("Ark has two types of Keys, which cannot be mixed.").waitFor();
        await page.getByText("Agent Plan exclusive Key is configured with /api/plan/v3").waitFor();
        await page.getByText("After selecting the model and protocol, it will be written which one to fill in.").waitFor();
        await page.waitForTimeout(400);
        await shot(page, "01-ark-two-key-kinds");
    } finally { await page.close(); }
}, 60000);

test("a manually added model keeps the type the user picked, and adding without one is refused", async () => {
    const page = await openConnectionStep("ark-none");
    try {
        await page.locator('input[aria-label="API Key"]').fill("synthetic-key");
        await page.getByRole("button", { name: "Read model", exact: true }).click();
        await page.getByText("Volcano Ark does not provide a model directory in OpenAI format").waitFor();
        // 真实的上游错误原因要留着，不能被替代掉。
        await page.getByText("The model service does not provide this model directory interface").waitFor();
        await shot(page, "02-ark-catalog-unavailable");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByText("Choose the model you want to use", { exact: true }).waitFor();
        // 类型不再替用户默认成「文本」：目录读不到时，seedance 这类视频模型曾被存成文本。
        expect((await page.locator(".model-service-manual .ant-select").textContent())?.trim()).toBe("Select type");
        await page.locator('input[aria-label="Model ID"]').fill("doubao-seedance-2.5");
        // antd 会在两个汉字的按钮文案里插入空格，按文案匹配取不到，直接点这一行的按钮。
        await page.locator(".model-service-manual button").click();
        await page.getByText("Please select the model type first, then click \"Add\"").waitFor();
        expect(await page.locator(".model-service-model").count()).toBe(0);
        expect(await page.getByText("0 selected").count()).toBe(1);
        await shot(page, "03-manual-type-required");
        // 筛选区也有「视频」两个字，只有下拉弹层里的选项才算选类型。
        await page.locator(".model-service-manual .ant-select").click();
        await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: "video" }).click();
        await page.locator(".model-service-manual button").click();
        // 选完类型下拉仍在展开：截图前先收起来，避免挡住底部按钮。
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        // 断言必须落在这一行模型上：页面里常驻的「视频」筛选项会让全局查找假通过。
        const row = page.locator(".model-service-model").filter({ hasText: "doubao-seedance-2.5" });
        await row.waitFor();
        expect(await row.locator(".model-service-kind").textContent()).toBe("video");
        expect(await page.getByText("1 selected").count()).toBe(1);
        // 加完一个模型，类型回到未选：下一个模型要重新选，不会被上一次的视频带走。
        expect((await page.locator(".model-service-manual .ant-select").textContent())?.trim()).toBe("Select type");
        await shot(page, "03b-manual-model-added");
        // 界面文字正确不等于存对了：再看真正提交给保存的能力。
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await waitForSaved(page, 1, "Manually add video models");
        expect((await savedOf(page))[0].profiles).toEqual([{ model: "doubao-seedance-2.5", capability: "video" }]);
    } finally { await page.close(); }
}, 60000);

test("an Agent Plan model asks for the Agent Plan key, and mixing both key kinds blocks saving", async () => {
    const page = await openConnectionStep("agent-plan");
    try {
        expect(await page.locator('input[aria-label="Agent Plan Exclusive Key"]').count()).toBe(1);
        await page.getByText("Only fill in the Agent Plan exclusive Key. Filling in a normal Ark Key will cause the call to fail and may result in extra charges.").waitFor();
        await shot(page, "04-agent-plan-key");
    } finally { await page.close(); }

    const native = await openConnectionStep("ark-native");
    try {
        expect(await native.locator('input[aria-label="Ark API Key"]').count()).toBe(1);
        await native.getByText("Agent Plan Exclusive Key Do not fill in here").waitFor();
        await shot(native, "08-ark-native-key");
    } finally { await native.close(); }

    const mixed = await openSaveStep("ark-mixed");
    try {
        // 不用点任何按钮，选完模型就能看到要拆连接。
        await mixed.getByText("Please split into two connections").first().waitFor();
        await mixed.locator(".model-service-feedback").waitFor();
        await shot(mixed, "05-ark-mixed-keys");
        // 真点保存也不能落地：混用凭证会被拦在提交前。
        await mixed.getByRole("button", { name: "Save and use", exact: true }).click();
        await mixed.getByText("Please split into two connections").first().waitFor();
        expect((await savedOf(mixed)).length).toBe(0);
    } finally { await mixed.close(); }
}, 60000);

test("a Jimeng connection needs the paired Secret Key, and saves both keys once it has them", async () => {
    const page = await openSaveStep("jimeng");
    try {
        await page.getByRole("button", { name: "connection information", exact: true }).click();
        expect(await page.locator('input[aria-label="Access Key（AK）"]').count()).toBe(1);
        // 需要两个密钥时高级设置自动展开，Secret Key 就在眼前。
        await page.getByText("Secret Key (SK) · Required", { exact: true }).waitFor();
        await page.getByText("AK/SK signature of Dream with Volcano engine").waitFor();
        await page.locator('input[aria-label="Access Key（AK）"]').fill("synthetic-ak");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await page.getByText("Please fill in the Secret Key (SK): This interface requires two keys. If one is missing, the signature will fail.", { exact: true }).waitFor();
        expect((await savedOf(page)).length).toBe(0);
        // 截图要同时看到「必填的 Secret Key」和底下那条缺 SK 的提示。
        await page.locator('input[aria-label="Secret Key（SK）"]').scrollIntoViewIfNeeded();
        await shot(page, "06-jimeng-ak-sk-required");
        // 补齐 SK 之后能正常保存，且两个密钥都进了保存内容。
        // 拦截保存会退回第 1 步，所以这里不需要再点「连接信息」。
        await page.locator('input[aria-label="Secret Key（SK）"]').fill("synthetic-sk");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await waitForSaved(page, 1, "Complete AK/SK");
        expect((await savedOf(page))[0]).toMatchObject({ apiKey: "synthetic-ak", secretKey: "synthetic-sk" });
    } finally { await page.close(); }
}, 60000);

test("an already saved Jimeng connection is not blocked when the workspace hides its keys", async () => {
    const page = await openSaveStep("jimeng-saved");
    try {
        await page.getByRole("button", { name: "connection information", exact: true }).click();
        // 外部工作区回读的样子：AK 和 SK 字段都是空串，后端用 hasSecretKey 说明 SK 已经存过。
        // 这种连接重填 AK 时不能要求重填 SK，保存时后端沿用原来那份。
        expect(await page.locator('input[aria-label="Access Key（AK）"]').inputValue()).toBe("");
        expect(await page.locator('input[aria-label="Secret Key（SK）"]').inputValue()).toBe("");
        // 重新填 AK 是本来就要做的事（旧值被隐去）；填完不能再被要求重填后端已保存的 SK。
        await page.locator('input[aria-label="Access Key（AK）"]').fill("refilled-ak");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await waitForSaved(page, 1, "Connection with saved credentials");
        expect((await savedOf(page))[0]).toMatchObject({ apiKey: "refilled-ak", secretKey: "" });
    } finally { await page.close(); }
}, 60000);

test("a legacy text model without a profile cannot hide the second key kind at save time", async () => {
    const page = await openConnectionStep("ark-legacy-text");
    try {
        // 文本模型还没写过 profile，草稿上只看得到 Agent Plan 这一种 Key。
        expect(await page.locator('input[aria-label="Agent Plan Exclusive Key"]').count()).toBe(1);
        await page.locator('input[aria-label="Agent Plan Exclusive Key"]').fill("synthetic-plan-key");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        // 保存时会按最终提交的 profiles 复查：文本模型补成普通方舟协议，和 Agent Plan 就是混用。
        await page.getByText("Please split into two connections").first().waitFor();
        await page.waitForTimeout(300);
        expect((await savedOf(page)).length).toBe(0);
    } finally { await page.close(); }
}, 60000);

test("switching a saved API-key connection to Jimeng still asks for the Secret Key", async () => {
    const page = await openSaveStep("jimeng-switched");
    try {
        await page.getByRole("button", { name: "connection information", exact: true }).click();
        // 这条连接后端只存过 API Key，没有 SK 可沿用：只填 AK 不能放行。
        expect(await page.locator('input[aria-label="Secret Key（SK）"]').inputValue()).toBe("");
        await page.locator('input[aria-label="Access Key（AK）"]').fill("refilled-ak");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await page.getByText("Please fill in the Secret Key (SK): This interface requires two keys. If one is missing, the signature will fail.", { exact: true }).waitFor();
        expect((await savedOf(page)).length).toBe(0);
        // 补上 SK 之后才能保存，两个密钥一起提交。
        await page.locator('input[aria-label="Secret Key（SK）"]').fill("synthetic-sk");
        await page.getByRole("button", { name: "Add model manually", exact: true }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await waitForSaved(page, 1, "Add SK after changing the agreement");
        expect((await savedOf(page))[0]).toMatchObject({ apiKey: "refilled-ak", secretKey: "synthetic-sk" });
    } finally { await page.close(); }
}, 60000);

test("the model-level protocol panel says where each of the two keys goes", async () => {
    const page = await openModelsStep("jimeng");
    try {
        await page.getByRole("button", { name: "Advanced model setup and testing", exact: true }).click();
        await page.getByRole("button", { name: "Configure using", exact: true }).click();
        // 选中签名协议时，模型面板直接说明两个密钥分别填在哪。
        const hint = page.getByText(/两个密钥签名：「连接信息」的密钥栏填Access Key（AK）/);
        await hint.waitFor();
        // 等弹层动画结束，再把提示滚进可视区，否则截图是半透明的滚动中途。
        await page.waitForTimeout(600);
        await hint.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const box = await page.locator(".ant-modal").last().boundingBox();
        if (!box) throw new Error("Model configuration elastic layer not found");
        await page.screenshot({ path: `${shotDirectory}/07-model-protocol-credential-hint.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 900) } });
    } finally { await page.close(); }
}, 60000);

test("reduced motion keeps manual and row type pickers selectable, and choosing one video protocol configures sibling video models", async () => {
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    try {
        await page.goto(server.url.toString() + "?scenario=compatible-seedance");
        await page.getByText("Choose the model you want to use", { exact: true }).waitFor();

        // 在减少动态效果（Windows 常见设置）下，手动输入 ID 的类型下拉仍可在视口内展开并选择。
        await page.locator('input[aria-label="Model ID"]').fill("doubao-seedance-2-0-mini-260615");
        await page.locator(".model-service-manual .ant-select").click();
        const popup = page.locator(".model-service-type-select-popup:not(.ant-select-dropdown-hidden)").last();
        await popup.waitFor();
        const box = (await popup.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        await popup.locator(".ant-select-item-option").filter({ hasText: "text" }).click();
        await page.locator(".model-service-manual button").click();

        // 已添加列表里的模型也可以直接点行内类型下拉改成「视频」。
        const miniRow = page.locator(".model-service-model").filter({ hasText: "doubao-seedance-2-0-mini-260615" });
        await miniRow.waitFor();
        expect(await miniRow.locator(".model-service-kind").textContent()).toBe("text");
        await miniRow.locator(".model-service-kind").click();
        await page.locator(".model-service-type-select-popup:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-item-option").filter({ hasText: "video" }).click();
        expect(await miniRow.locator(".model-service-kind").textContent()).toBe("video");

        // 点「保存并使用」时若缺接口格式，自动弹出协议配置框；选一次协议即同步给同渠道未配置的同能力视频模型。
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await page.getByText("Edit model usage configuration").waitFor();
        await page.getByText("Volcengine Ark Seedance", { exact: true }).click();
        await page.getByRole("button", { name: /^完\s*成$/ }).click();
        await page.getByRole("button", { name: "Save and use", exact: true }).click();
        await waitForSaved(page, 1, "Multiple video models on the same channel can be saved after synchronizing the agreement.");
        expect((await savedOf(page))[0].profiles).toEqual([
            { model: "doubao-seedance-2-0-260128", capability: "video" },
            { model: "doubao-seedance-2-0-fast-260128", capability: "video" },
            { model: "doubao-seedance-2-0-mini-260615", capability: "video" },
        ]);
    } finally { await page.close(); }
}, 60000);
