import { describe, expect, test } from "bun:test";
import { directorAxisHeads, directorOrientationForMode } from "@/lib/canvas/director/director-orientation-gizmo";

describe("Director's desk directional ball", () => {
    test("Five selectable axes and one lower axis shown only", () => {
        const heads = directorAxisHeads([0, 0, 0, 1]);
        expect(heads).toHaveLength(6);
        expect(heads.filter((head) => head.mode).map((head) => head.mode).sort()).toEqual(["back", "front", "left", "right", "top"]);
        expect(heads.find((head) => head.id === "x+")?.x).toBe(60);
        expect(heads.find((head) => head.id === "y+")?.y).toBe(12);
        expect(heads.find((head) => head.id === "z+")?.depth).toBe(1);
    });

    test("The orthogonal direction ball is projected according to the viewing mode, and the free viewing angle maintains the camera quaternion.", () => {
        const free = [0, 0.2, 0, 0.98] as const;
        expect(directorOrientationForMode("free", [...free])).toEqual([...free]);
        expect(directorAxisHeads(directorOrientationForMode("right", [...free])).find((head) => head.id === "x+")?.depth).toBeGreaterThan(0.99);
        expect(directorAxisHeads(directorOrientationForMode("top", [...free])).find((head) => head.id === "y+")?.depth).toBeGreaterThan(0.99);
    });
});
