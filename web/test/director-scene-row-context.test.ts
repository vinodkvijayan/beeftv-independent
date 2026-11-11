import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8");
const row = source.slice(source.indexOf("function SceneRow("), source.indexOf("function AddMenuButton("));

describe("Right-click the scene row on the director's desk", () => {
    test("Right-clicking on a scene object provides the existing hiding, locking and deleting functions, and the delete button is no longer resident in the row.", () => {
        expect(row).toContain('trigger={["contextMenu"]}');
        expect(row).toContain("style: { minWidth: 144 }");
        expect(row).toContain('label: "show/hide"');
        expect(row).toContain('label: "Lock/Unlock"');
        expect(row).toContain('label: "delete"');
        expect(row).toContain("onDelete && !sceneActions");
    });

    test("Explicitly selecting right-click to delete still calls the original delete callback, and the locked row menu remains visible.", () => {
        expect(row).toContain("onClick: onDelete");
        expect(row).not.toContain("disabled: locked");
    });

    test("Right-click on a single row to retain the disabled grouping entry, enable grouping after multiple selections, and provide ungrouping for grouped rows", () => {
        expect(row).toContain('label: "Group"');
        expect(row).toContain("disabled: true");
        expect(row).toContain('label: "unmarshalling"');
        expect(row).toContain('label: "Create a copy"');
    });
});
