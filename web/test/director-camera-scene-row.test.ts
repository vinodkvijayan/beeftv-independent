import { describe, expect, test } from "bun:test";
import { createDirectorScene, toggleDirectorCameraLock, toggleDirectorCameraVisibility, visibleDirectorCameras } from "../src/lib/canvas/director/director-scene";
import { resolveDirectorActiveCamera } from "../src/lib/canvas/director/director-view-modes";

describe("Director's desk scene row", () => {
    test("Hide the current camera only hides the editor auxiliary graphics and does not change the lens reference or camera framing.", () => {
        const scene = createDirectorScene();
        const camera = scene.cameras[0];
        const hidden = toggleDirectorCameraVisibility(scene, camera.id);
        expect(hidden.cameras[0].visible).toBe(false);
        expect(visibleDirectorCameras(hidden)).toEqual([]);
        expect(hidden.shots).toEqual(scene.shots);
        expect(resolveDirectorActiveCamera(hidden)?.id).toBe(camera.id);
        expect(toggleDirectorCameraVisibility(hidden, camera.id).cameras[0].visible).toBe(true);
        expect(visibleDirectorCameras(scene)).toEqual(scene.cameras);
    });

    test("The camera position lock can be switched, and unknown camera positions will not cause historical changes.", () => {
        const scene = createDirectorScene();
        const camera = scene.cameras[0];
        expect(toggleDirectorCameraLock(scene, camera.id).cameras[0].locked).toBe(true);
        expect(toggleDirectorCameraLock(toggleDirectorCameraLock(scene, camera.id), camera.id).cameras[0].locked).toBe(false);
        expect(toggleDirectorCameraLock(scene, "missing")).toBe(scene);
        expect(toggleDirectorCameraVisibility(scene, "missing")).toBe(scene);
    });
});
