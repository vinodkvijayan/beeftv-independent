import { describe, expect, test } from "bun:test";

import { createDirectorReproScene } from "../src/lib/canvas/director/director-repro-fixture";
import { resolveDirectorCameraLocalFraming, resolveDirectorViewFraming } from "../src/lib/canvas/director/director-view-modes";
import { resolveDirectorCameraGizmoEdit, resolveDirectorCameraMoveKeyframes, resolveDirectorCameraMoveLookAtMode, resolveDirectorCameraMoveTransform } from "../src/lib/canvas/director/director-animation-semantics";
import { bindDirectorCameraFollow, removeDirectorCameraBindingsForObject, unbindDirectorCameraFollow } from "../src/lib/canvas/director/director-camera-binding";
import type { DirectorCamera, DirectorVec3 } from "../src/types/director";

const movedScene = () => {
    const scene = createDirectorReproScene();
    const object = scene.objects[0];
    return { ...scene, objects: [{ ...object, keyframes: [
        { id: "k0", time: 0, transform: object.transform },
        { id: "k2", time: 2, transform: { ...object.transform, position: [2, 0.5, 0] as DirectorVec3 } },
    ] }, ...scene.objects.slice(1)] };
};

describe("The camera on the director's desk follows and watches", () => {
    test("The camera movement retains the gaze mode, and the camera rotation switches to rotation drive and truly changes the framing.", () => {
        const scene = createDirectorReproScene();
        const camera = scene.cameras[0];
        const movedTransform = { ...camera.transform, position: [camera.transform.position[0] + 2, camera.transform.position[1], camera.transform.position[2]] as DirectorVec3 };
        const moved = resolveDirectorCameraGizmoEdit({ camera, from: camera.transform, edited: movedTransform, rawTime: 0, snappedTime: 0 });
        expect(moved.lookAtMode).toBe(camera.lookAtMode);
        expect(moved.transform.position).toEqual(movedTransform.position);
        expect(moved.target).toEqual(camera.target);

        const rotatedTransform = { ...camera.transform, rotation: [0, Math.PI / 2, 0] as DirectorVec3 };
        const rotated = resolveDirectorCameraGizmoEdit({ camera, from: camera.transform, edited: rotatedTransform, rawTime: 0, snappedTime: 0 });
        expect(rotated.lookAtMode).toBe("rotation");
        expect(rotated.target).toEqual(camera.target);
        const framing = resolveDirectorCameraLocalFraming(scene, rotated, 0);
        expect(framing?.target[0]).toBeCloseTo(camera.transform.position[0] - 1, 5);
        expect(framing?.target[1]).toBeCloseTo(camera.transform.position[1], 5);
        expect(framing?.target[2]).toBeCloseTo(camera.transform.position[2], 5);
    });

    test("The camera manipulator uses the raw playhead to get the rendering starting point and the adsorption playhead to write key frames.", () => {
        const scene = createDirectorReproScene();
        const camera = scene.cameras[0];
        const trajectory = {
            ...camera,
            keyframes: [
                { id: "start", time: 0, transform: camera.transform },
                { id: "end", time: 2, transform: { ...camera.transform, position: [10, 2.7, 6.8] as DirectorVec3 } },
            ],
        };
        const rawTime = 1.02;
        const from = { ...camera.transform, position: [7.452, 2.7, 6.8] as DirectorVec3 };
        const edited = { ...from, position: [7.452, 3.7, 6.8] as DirectorVec3 };
        const result = resolveDirectorCameraGizmoEdit({ camera: trajectory, from, edited, rawTime, snappedTime: 1 });
        const inserted = result.keyframes.find((frame) => frame.time === 1);
        expect(inserted?.transform.position).toEqual([7.452, 3.7, 6.8]);
        expect(result.keyframes.map((frame) => frame.time)).toEqual([0, 1, 2]);
    });

    test("The current screen does not jump after binding and following, and the camera retains its relative position when the character moves.", () => {
        const scene = movedScene();
        const camera = bindDirectorCameraFollow(scene.cameras[0], scene, scene.objects[0].id, 0);
        const next = { ...scene, cameras: [camera] };
        expect(resolveDirectorViewFraming({ scene: next, mode: "camera", playhead: 0 })?.position).toEqual([4.8, 2.7, 6.8]);
        expect(resolveDirectorViewFraming({ scene: next, mode: "camera", playhead: 1 })?.position).toEqual([5.8, 2.7, 6.8]);
    });

    test("The gaze character uses the current frame position, and the camera position is not affected by the gaze binding.", () => {
        const scene = movedScene();
        const camera = { ...scene.cameras[0], lookAtObjectId: scene.objects[0].id };
        const framing = resolveDirectorViewFraming({ scene: { ...scene, cameras: [camera] }, mode: "camera", playhead: 1 });
        expect(framing?.position).toEqual([4.8, 2.7, 6.8]);
        expect(framing?.target).toEqual([1, 0.5, 0]);
    });

    test("Manual rotation to change gaze direction; follow and gaze fall back safely after target removal", () => {
        const scene = createDirectorReproScene();
        const camera = { ...scene.cameras[0], transform: { ...scene.cameras[0].transform, position: [0, 1, 5] as DirectorVec3, rotation: [0, Math.PI / 2, 0] as DirectorVec3 }, lookAtMode: "rotation" as const };
        const rotation = resolveDirectorViewFraming({ scene: { ...scene, cameras: [camera] }, mode: "camera", playhead: 0 });
        expect(rotation?.target[0]).toBeCloseTo(-1, 5);
        expect(rotation?.target[1]).toBeCloseTo(1, 5);
        expect(rotation?.target[2]).toBeCloseTo(5, 5);
        const deleted = { ...camera, lookAtMode: "object" as const, lookAtObjectId: "deleted", followObjectId: "deleted", followAnchor: [0, 0, 0] as DirectorVec3 };
        const fallback = resolveDirectorViewFraming({ scene: { ...scene, cameras: [deleted] }, mode: "camera", playhead: 0 });
        expect(fallback?.position).toEqual([0, 1, 5]);
        expect(fallback?.target).toEqual(camera.target);
    });

    test("Pan/tilt keyframes change gaze direction in CAM with fixed camera position", () => {
        const scene = createDirectorReproScene();
        const base = { ...scene.cameras[0], transform: { ...scene.cameras[0].transform, position: [0, 1, 5] as DirectorVec3 }, target: [0, 1, 0] as DirectorVec3 };
        const panEnd = resolveDirectorCameraMoveTransform(base.transform, base.target, "pan_right");
        const panCamera = {
            ...base,
            lookAtMode: resolveDirectorCameraMoveLookAtMode(base.lookAtMode, "pan_right"),
            keyframes: resolveDirectorCameraMoveKeyframes([], base.transform, panEnd, 2),
        };
        const start = resolveDirectorCameraLocalFraming(scene, panCamera, 0);
        const end = resolveDirectorCameraLocalFraming(scene, panCamera, 2);
        expect(end?.position).toEqual(start?.position);
        expect(end?.target[0]).toBeGreaterThan(start?.target[0] || 0);

        const tiltEnd = resolveDirectorCameraMoveTransform(base.transform, base.target, "tilt_up");
        const tiltCamera = {
            ...base,
            lookAtMode: resolveDirectorCameraMoveLookAtMode(base.lookAtMode, "tilt_up"),
            keyframes: resolveDirectorCameraMoveKeyframes([], base.transform, tiltEnd, 2),
        };
        expect(resolveDirectorCameraLocalFraming(scene, tiltCamera, 2)?.target[1]).toBeGreaterThan(base.target[1]);
    });

    test("When deleting a followed or watched object, only the corresponding binding is cleared.", () => {
        const scene = createDirectorReproScene();
        const camera: DirectorCamera = {
            ...scene.cameras[0],
            followObjectId: "target-a",
            followAnchor: [1, 2, 3],
            lookAtMode: "object",
            lookAtObjectId: "target-b",
        };
        const withoutFollow = removeDirectorCameraBindingsForObject(camera, "target-a", scene, 0);
        expect(withoutFollow).toEqual({ ...camera, followObjectId: undefined, followAnchor: undefined });
        const withoutLookAt = removeDirectorCameraBindingsForObject(withoutFollow, "target-b", scene, 0);
        expect(withoutLookAt).toEqual({ ...withoutFollow, lookAtMode: "coordinates", lookAtObjectId: undefined });
        expect(removeDirectorCameraBindingsForObject(camera, "other", scene, 0)).toBe(camera);
    });

    test("Free-view camera auxiliary graphics share the current frame view with CAM and can resolve inactive cameras", () => {
        const scene = movedScene();
        const first = bindDirectorCameraFollow(scene.cameras[0], scene, scene.objects[0].id, 0);
        const second: DirectorCamera = { ...first, id: "other-camera", transform: { ...first.transform, position: [0, 2, 8] } };
        const withCameras = { ...scene, cameras: [first, second] };
        expect(resolveDirectorCameraLocalFraming(withCameras, first, 1)?.position).toEqual([5.8, 2.7, 6.8]);
        expect(resolveDirectorCameraLocalFraming(withCameras, second, 1)?.position).toEqual([1, 2, 8]);
        expect(resolveDirectorCameraLocalFraming(withCameras, first, 1)?.target).toEqual(resolveDirectorViewFraming({ scene: withCameras, mode: "camera", playhead: 1 })?.target);
    });

    test("Unfollowing retains the current composition and superimposes the displacement to the existing position keyframe", () => {
        const scene = movedScene();
        const base = scene.cameras[0];
        const camera: DirectorCamera = {
            ...base,
            keyframes: [
                { id: "c0", time: 0, transform: base.transform },
                { id: "c2", time: 2, transform: { ...base.transform, position: [6.8, 2.7, 6.8] } },
            ],
        };
        const bound = bindDirectorCameraFollow(camera, scene, scene.objects[0].id, 0);
        const before = resolveDirectorCameraLocalFraming(scene, bound, 1);
        const detached = unbindDirectorCameraFollow(bound, scene, 1);
        const after = resolveDirectorCameraLocalFraming(scene, detached, 1);
        expect(after?.position).toEqual(before?.position);
        expect(after?.target).toEqual(before?.target);
        expect(detached.followObjectId).toBeUndefined();
        expect(detached.followAnchor).toBeUndefined();
        expect(detached.keyframes.map((frame) => frame.transform.position[0])).toEqual([5.8, 7.8]);
        expect(detached.transform.position[0]).toBe(5.8);
    });

    test("When deleting the object being followed and watched, the camera composition at the moment of deletion is retained.", () => {
        const scene = movedScene();
        const targetId = scene.objects[0].id;
        const followed = bindDirectorCameraFollow(scene.cameras[0], scene, targetId, 0);
        const camera: DirectorCamera = { ...followed, lookAtMode: "object", lookAtObjectId: targetId };
        const before = resolveDirectorCameraLocalFraming(scene, camera, 1);
        const detached = removeDirectorCameraBindingsForObject(camera, targetId, scene, 1);
        const after = resolveDirectorCameraLocalFraming({ ...scene, objects: scene.objects.filter((object) => object.id !== targetId) }, detached, 1);
        expect(after?.position).toEqual(before?.position);
        expect(after?.target).toEqual(before?.target);
        expect(detached.followObjectId).toBeUndefined();
        expect(detached.lookAtMode).toBe("coordinates");
    });

    test("The current frame does not jump when switching from one following target to another", () => {
        const scene = movedScene();
        const first = bindDirectorCameraFollow(scene.cameras[0], scene, scene.objects[0].id, 0);
        const before = resolveDirectorCameraLocalFraming(scene, first, 1);
        const switched = bindDirectorCameraFollow(first, scene, scene.objects[1].id, 1);
        const after = resolveDirectorCameraLocalFraming(scene, switched, 1);
        expect(after?.position).toEqual(before?.position);
        expect(after?.target).toEqual(before?.target);
        expect(switched.followObjectId).toBe(scene.objects[1].id);
    });
});
