import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../src/stores/use-sync-progress-store.ts"), "utf8");

describe("local sync unload warning", () => {
    test("uses local wording when all active progress entries are local", () => {
        expect(source).toContain('const localOnly = progress.every((item) => item.message?.includes("local"));');
        expect(source).toContain('localOnly ? "The canvas is being saved locally, please do not close the page." : "The canvas is being synchronized to the cloud, please do not close the page."');
    });
});
