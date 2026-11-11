import { describe, expect, test } from "bun:test";

import { createDirectorReproScene } from "../src/lib/canvas/director/director-repro-fixture";
import { appendDirectorScreenshot, nextDirectorScreenshotName } from "../src/lib/canvas/director/director-session";

const capture = {
    id: "capture-1", name: "main camera-shot-01", storageKey: "resource:image-1", url: "/api/resources/image-1",
    width: 1920, height: 1080, createdAt: "2026-09-29T00:00:00.000Z",
};

describe("Director's desk camera screenshot record", () => {
    test("Other edits made to the scene while attached to the specified shot and retained", () => {
        const scene = createDirectorReproScene();
        const edited = { ...scene, title: "New title during upload" };
        const next = appendDirectorScreenshot(edited, { sceneId: scene.id, shotId: scene.activeShotId, screenshot: capture });
        expect(next.title).toBe("New title during upload");
        expect(next.shots.find((shot) => shot.id === scene.activeShotId)?.screenshots).toEqual([capture]);
        expect(edited.shots.find((shot) => shot.id === scene.activeShotId)?.screenshots).toBeUndefined();
    });

    test("Wrong location is not written when a scene or shot has been switched or deleted", () => {
        const scene = createDirectorReproScene();
        expect(appendDirectorScreenshot(scene, { sceneId: "other-scene", shotId: scene.activeShotId, screenshot: capture })).toBe(scene);
        expect(appendDirectorScreenshot(scene, { sceneId: scene.id, shotId: "missing-shot", screenshot: capture })).toBe(scene);
    });

    test("Each screenshot uses the aircraft seat name and incremental number, and does not reuse the previous one's name.", () => {
        expect(nextDirectorScreenshotName("Seat 3", 0)).toBe("Camera position 3-shot-01");
        expect(nextDirectorScreenshotName("Seat 3", 1)).toBe("Camera position 3-shot-02");
    });
});
