import { describe, expect, test } from "bun:test";
import * as cameraAid from "../src/lib/canvas/director/director-camera-aid";

const { directorCameraFrameSegments, directorCameraGuideSegments } = cameraAid;

describe("Director's desk auxiliary frame", () => {
    test("The auxiliary frame of the default camera is close to the body of the camera to avoid covering the characters and canvas from the director's perspective.", () => {
        const distance = (cameraAid as typeof cameraAid & { directorCameraAidDistance?: (targetDistance: number) => number }).directorCameraAidDistance;
        expect(distance?.(10)).toBe(1);
        expect(distance?.(4)).toBe(0.6);
        expect(distance?.(30)).toBe(1.2);
    });

    test("Only the edges of the viewing rectangle are drawn, and the camera position rays that pass through the screen are not drawn.", () => {
        const corners: [number, number, number][] = [
            [-2, 1, -3], [2, 1, -3], [2, -1, -3], [-2, -1, -3],
        ];
        expect(directorCameraFrameSegments(corners)).toEqual([
            corners[0], corners[1],
            corners[1], corners[2],
            corners[2], corners[3],
            corners[3], corners[0],
        ]);
    });

    test("On the reference page, both sides of the camera frame extend downward, but no diagonal lines are drawn through the characters.", () => {
        const corners: [number, number, number][] = [
            [-2, 1, -3], [2, 1, -3], [2, -1, -3], [-2, -1, -3],
        ];
        expect(directorCameraGuideSegments(corners)).toEqual([
            [-2, -1, -3], [-1.86, -2.8, -3],
            [2, -1, -3], [1.86, -2.8, -3],
        ]);
    });

    test("The active camera remains clickable even if it is not selected, and only the auxiliary frame that blocks the screen is hidden when it is close to the viewing angle.", () => {
        const visibility = (cameraAid as typeof cameraAid & { directorCameraAidVisibility?: (selected: boolean, nearViewer: boolean) => { body: boolean; guides: boolean; gizmo: boolean } }).directorCameraAidVisibility;
        expect(visibility?.(false, false)).toEqual({ body: true, guides: true, gizmo: false });
        expect(visibility?.(true, true)).toEqual({ body: true, guides: false, gizmo: true });
        expect(visibility?.(false, true)).toEqual({ body: false, guides: false, gizmo: false });
    });

    test("Empty spots on the canvas while dragging the handle cannot clear the camera position selection. Ordinary empty spots can still be deselected.", () => {
        const shouldClear = (cameraAid as typeof cameraAid & { shouldClearDirectorViewportSelection?: (drawing: boolean, transformClaimed: boolean) => boolean }).shouldClearDirectorViewportSelection;
        expect(shouldClear?.(false, true)).toBe(false);
        expect(shouldClear?.(false, false)).toBe(true);
        expect(shouldClear?.(true, false)).toBe(false);
    });
});
