import { describe, expect, test } from "bun:test";

import { createDirectorCameraFromPreset, DIRECTOR_CAMERA_PRESETS } from "@/lib/canvas/director/director-camera-presets";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { resolveDirectorCameraLocalFraming } from "@/lib/canvas/director/director-view-modes";

describe("Director’s desk camera position preset", () => {
    test("The panel provides access to all LibTV cameras with non-duplicate names.", () => {
        expect(DIRECTOR_CAMERA_PRESETS.map((item) => item.label)).toEqual([
            "current perspective", "front mid shot", "Frontal close-up", "Frontal panorama", "Side tracking shot", "Side view", "back mid shot", "Panoramic shot from above",
            "45° overhead shot", "low angle shot", "low angle wide angle", "over the shoulder shot", "Over the shoulder shot (right)", "bird's eye view", "Dutch Cape",
        ]);
    });

    test("Preset to write different actual camera positions and optical parameters", () => {
        const medium = createDirectorCameraFromPreset({ presetId: "front-medium", name: "test", target: [1, 1, 2] });
        const close = createDirectorCameraFromPreset({ presetId: "front-close", name: "test", target: [1, 1, 2] });
        expect(medium.transform.position).not.toEqual(close.transform.position);
        expect(medium.fov).not.toBe(close.fov);
        expect(medium.target).toEqual([1, 1, 2]);
        expect(close.target).toEqual([1, 1, 2]);
    });

    test("The front, back and over-the-shoulder camera positions rotate together with the actor's direction", () => {
        const target: [number, number, number] = [1, 1, 2];
        const front = createDirectorCameraFromPreset({ presetId: "front-medium", name: "front", target });
        const back = createDirectorCameraFromPreset({ presetId: "back-medium", name: "back", target });
        const shoulder = createDirectorCameraFromPreset({ presetId: "shoulder-left", name: "Over the shoulder", target });
        const rotatedFront = createDirectorCameraFromPreset({ presetId: "front-medium", name: "Rotated front", target, subjectYaw: Math.PI / 2 });
        expect(front.transform.position[2]).toBeGreaterThan(target[2]);
        expect(back.transform.position[2]).toBeLessThan(target[2]);
        expect(shoulder.transform.position[2]).toBeLessThan(target[2]);
        expect(rotatedFront.transform.position[0]).toBeGreaterThan(target[0]);
        expect(rotatedFront.transform.position[2]).toBeCloseTo(target[2], 5);
    });

    test("The current viewing angle records the current position and orientation; both bird's-eye view and Dutch angle can be safely taken.", () => {
        const current = createDirectorCameraFromPreset({ presetId: "current", name: "current", target: [0, 1, 0], currentView: { position: [3, 2, 4], rotation: [0, 0, 0], scale: [1, 1, 1] } });
        expect(current.transform.position).toEqual([3, 2, 4]);
        expect(current.target).toEqual([3, 2, -1]);
        const birdEye = createDirectorCameraFromPreset({ presetId: "bird-eye", name: "bird's eye view", target: [0, 1, 0] });
        expect(birdEye.transform.position[1]).toBeGreaterThan(birdEye.target[1]);
        const dutch = createDirectorCameraFromPreset({ presetId: "dutch", name: "Dutch Cape", target: [0, 1, 0] });
        expect(dutch.transform.rotation[2]).not.toBe(0);
    });

    test("Side tracking is preset to bind the character's position and keep looking at the character", () => {
        const scene = createDirectorScene();
        const actor = scene.objects[0];
        const camera = createDirectorCameraFromPreset({
            presetId: "side-follow",
            name: "Side tracking shot",
            target: [actor.transform.position[0], actor.transform.position[1] + 1.2, actor.transform.position[2]],
            followTarget: { objectId: actor.id, position: actor.transform.position },
        });
        const movedScene = {
            ...scene,
            objects: scene.objects.map((item) => item.id === actor.id
                ? { ...item, transform: { ...item.transform, position: [actor.transform.position[0] + 3, actor.transform.position[1], actor.transform.position[2]] as [number, number, number] } }
                : item),
        };
        const before = resolveDirectorCameraLocalFraming(scene, camera, 0);
        const after = resolveDirectorCameraLocalFraming(movedScene, camera, 0);
        expect(camera.followObjectId).toBe(actor.id);
        expect(camera.lookAtMode).toBe("object");
        expect(camera.lookAtObjectId).toBe(actor.id);
        expect(after?.position[0]).toBeCloseTo((before?.position[0] || 0) + 3, 5);
        expect(after?.target[0]).toBeCloseTo((before?.target[0] || 0) + 3, 5);

        const staticFallback = createDirectorCameraFromPreset({ presetId: "side-follow", name: "side camera", target: [0, 1, 0] });
        expect(staticFallback.followObjectId).toBeUndefined();
        expect(staticFallback.lookAtObjectId).toBeUndefined();
    });
});
