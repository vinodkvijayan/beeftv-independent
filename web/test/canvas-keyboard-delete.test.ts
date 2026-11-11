import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyboardSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-keyboard.ts"), "utf8");

describe("Canvas keyboard removal", () => {
    test("Prevent the browser's default behavior and end the current event after handling Delete/Backspace", () => {
        const deleteBlock = keyboardSource.match(/if \(event\.key === "Delete" \|\| event\.key === "Backspace"\) \{[\s\S]*?\n            \}/)?.[0] || "";
        expect(deleteBlock).toContain("event.preventDefault();");
        expect(deleteBlock).toContain("event.stopPropagation();");
        expect(deleteBlock).toContain("return;");
    });
});
