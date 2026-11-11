import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workbench = readFileSync("src/components/canvas/director/canvas-director-workbench.tsx", "utf8");
const viewport = readFileSync("src/components/canvas/director/director-viewport.tsx", "utf8");

describe("Track selection and deletion on the director's desk", () => {
    test("The left material bar no longer mounts an additional complete 3D viewport", () => {
        const leftDock = workbench.split('data-director-left-dock="true"')[1]?.split("</aside>")[0] || "";
        expect(leftDock).not.toContain("<DirectorViewport");
    });

    test("Clicking directly on the track line will select the entire track", () => {
        expect(viewport).toMatch(/<Line[^>]*onPointerDown=.*onSelectPath/);
    });

    test("Delete preferentially deletes entire actor or camera tracks rather than individual control points or objects", () => {
        const deleteStart = workbench.indexOf('case "delete-selected":');
        const deleteEnd = workbench.indexOf('case "undo":', deleteStart);
        const deleteBranch = workbench.slice(deleteStart, deleteEnd);
        expect(deleteBranch.indexOf("selectedPathKeyframe")).toBeGreaterThanOrEqual(0);
        expect(deleteBranch.indexOf("selectedPathKeyframe")).toBeLessThan(deleteBranch.indexOf("selectedCamera"));
        expect(deleteBranch).toContain("removeDirectorActorPath");
        expect(deleteBranch).toContain("camera.drawnPath.originalKeyframes");
        expect(deleteBranch).not.toContain("deleteKeyframe");
    });
});
