import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";

let browser: Browser;

beforeAll(async () => {
    browser = await chromium.launch();
});

afterAll(async () => {
    await browser.close();
});

test("Folder full-screen browsing layer lists the contents, search can be filtered, Esc and \"folder\" can be closed", async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/canvas-folder-browser-modal-harness.tsx"],
        target: "browser",
        define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
        plugins: [{ name: "alias", setup(builder) {
            builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find(item => item.path.endsWith(".js"))!.text();

    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    await page.route("https://folder.test/**", route => route.fulfill(route.request().url().endsWith("/harness.js")
        ? { contentType: "application/javascript", body: script }
        : { contentType: "text/html", body: `<div id="root"></div><script type="module" src="/harness.js"></script>` }));
    await page.goto("https://folder.test/");

    const dialog = page.locator('[aria-label="Lens Collection Folder Contents"]');
    await dialog.waitFor({ timeout: 5_000 }).catch((error) => { throw new Error(`${error.message}Page error:${pageErrors.join("\n")}`); });
    expect(await page.locator("[data-folder-browser-card]").count()).toBe(6);
    expect(await page.getByRole("button", { name: "Open lens 1" }).count()).toBe(1);

    await page.getByPlaceholder("Search for nodes in a folder...").fill("Ending");
    expect(await page.locator("[data-folder-browser-card]").count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open the end credits" }).count()).toBe(1);

    await page.getByPlaceholder("Search for nodes in a folder...").fill("");
    expect(await page.locator("[data-folder-browser-card]").count()).toBe(6);

    await page.keyboard.press("Escape");
    expect((await page.evaluate(() => (window as any).folderProbe.events()))).toContain("close");

    await page.getByRole("button", { name: "Collapse folder" }).click();
    const events: string[] = await page.evaluate(() => (window as any).folderProbe.events());
    expect(events.filter((event) => event === "close")).toHaveLength(2);
}, 60_000);
