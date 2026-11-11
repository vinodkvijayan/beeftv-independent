import { describe, expect, test } from "bun:test";

import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { directorStageLocalCamera, directorStageLocalPoint, directorStagePoint, directorStageTransform, type DirectorStageTransform } from "@/lib/canvas/director/director-stage-transform";
import { resolveDirectorOrthographicFraming, resolveDirectorViewFraming } from "@/lib/canvas/director/director-view-modes";

const stage: DirectorStageTransform = { scale: 2, position: [3, 1, -4], rotation: [0, 90, 0] };

describe("Overall transformation of the director's stage scene", () => {
    test("Keep original coordinates when old archive has no new fields", () => {
        const scene = createDirectorScene();
        delete scene.stageTransform;
        expect(directorStageTransform(scene).scale).toBe(1);
        expect(directorStagePoint(directorStageTransform(scene), [1, 2, 3])).toEqual([1, 2, 3]);
    });

    test("Broken scaling and axis values fall back to unit transformations without polluting WebGL matrices", () => {
        const scene = createDirectorScene();
        scene.stageTransform = { scale: 0, position: [0, 0, 0], rotation: [0, 0, 0] };
        expect(directorStageTransform(scene).scale).toBe(1);
        scene.stageTransform = { scale: 2, position: [Number.NaN, 0, 0], rotation: [0, 0, 0] };
        expect(directorStageTransform(scene).position).toEqual([0, 0, 0]);
    });

    test("Points are reversible between scene/world coordinates, and pointer placement will not be misaligned with zoom rotation.", () => {
        const local: [number, number, number] = [1.5, 0, -2];
        const world = directorStagePoint(stage, local);
        const restored = directorStageLocalPoint(stage, world);
        restored.forEach((value, index) => expect(value).toBeCloseTo(local[index], 5));
    });

    test("CAM cameras share transforms with objects, and focal length and crop distance are synchronized with scale", () => {
        const scene = createDirectorScene();
        scene.stageTransform = stage;
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing?.position).toEqual(directorStagePoint(stage, scene.cameras[0].transform.position));
        expect(framing?.target).toEqual(directorStagePoint(stage, scene.cameras[0].target));
        expect(framing?.near).toBeCloseTo(scene.cameras[0].near * 2);
        expect(framing?.far).toBeCloseTo(scene.cameras[0].far * 2);
    });

    test("World view alignment reverts to scene local camera position when writing back", () => {
        const local = { position: [1, 2, 3] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
        const world = { ...local, position: directorStagePoint(stage, local.position), rotation: [0, Math.PI / 2, 0] as [number, number, number] };
        const restored = directorStageLocalCamera(stage, world);
        restored.position.forEach((value, index) => expect(value).toBeCloseTo(local.position[index], 5));
        restored.rotation.forEach((value) => expect(value).toBeCloseTo(0, 5));
    });

    test("Orthogonal bounding boxes translate with the scene", () => {
        const scene = createDirectorScene();
        const original = resolveDirectorOrthographicFraming({ scene, mode: "front" });
        scene.stageTransform = { scale: 1, position: [10, 0, 0], rotation: [0, 0, 0] };
        const moved = resolveDirectorOrthographicFraming({ scene, mode: "front" });
        expect(moved?.target[0]).toBeCloseTo((original?.target[0] ?? 0) + 10);
        expect(moved?.horizontalSpan).toBeCloseTo(original?.horizontalSpan ?? 0);
    });
});
