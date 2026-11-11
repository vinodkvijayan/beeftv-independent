import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../src/services/local-workspace-sync.ts"), "utf8");

test("syncLocalCanvasSnapshot synthesizes the document fields and submits them once, and the viewport only stays locally.", () => {
    expect(source).toContain("const { viewport, ...documentPatch } = patch;");
    expect(source).toContain("if (viewport) useCanvasStore.getState().updateProject(id, { viewport });");
    expect(source).toContain("if (Object.keys(documentPatch).length > 0) await persistCanvasDocument(id, documentPatch);");
    expect(source).not.toContain("await syncLocalCanvasProjectToBackend(id)");
    expect(source).not.toContain("documentPatch.nodes || documentPatch.connections");
});

test("loadCanvasProjectForEditing restores historyRestore instead of opening the current draft", () => {
    expect(source).toContain("if (options.historyRestore)");
    expect(source).toContain("restoreLocalCanvasProjectFromHistory(id, options.historyRestore)");
    expect(source).not.toContain("if (options.historyRestore) {\n    const project = await openLocalCanvasProjectFromBackend");
});
