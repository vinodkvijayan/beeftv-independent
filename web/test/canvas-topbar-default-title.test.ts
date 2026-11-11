import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

describe("BeefTV canvas top bar", () => {
    test("maps the local project placeholder to the workspace label", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
        expect(source).toContain('workspaceProject?.title === "Unnamed project" || !workspaceProject?.title ? "Unnamed workspace" : workspaceProject.title');
        expect(source).toContain("The project library remains");
    });
});
