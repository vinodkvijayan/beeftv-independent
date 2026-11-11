import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("create empty state keeps the banner and composer in document flow", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    const layoutStart = styles.indexOf("/* Empty layout convergence: maintain the document flow order of the picture area, copywriting and input area");
    const layoutEnd = styles.indexOf("/* ===== Material library", layoutStart);
    const layout = styles.slice(layoutStart, layoutEnd);

    expect(layoutStart).toBeGreaterThanOrEqual(0);
    expect(layoutEnd).toBeGreaterThan(layoutStart);
    expect(layout).toContain("justify-content: flex-start;");
    expect(layout).toContain("flex: 0 0 auto;");
    expect(layout).toContain("margin: 0 auto 20px;");
    expect(layout).not.toContain("margin: auto auto 20px;");
    expect(layout).not.toContain("margin: 26px auto auto;");
});
