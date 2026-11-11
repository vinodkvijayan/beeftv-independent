import { describe, expect, test } from "bun:test";

import {
    DIRECTOR_KEYFRAME_EPSILON,
    createDirectorActor,
    createDirectorCamera,
    createDirectorScene,
    interpolateDirectorTransform,
    removeDirectorBoneKeyframe,
    removeDirectorKeyframe,
    removeDirectorSceneKeyframe,
    resolveDirectorKeyframeProgress,
    setDirectorSceneKeyframeEasing,
    upsertDirectorBoneKeyframe,
    upsertDirectorKeyframe,
} from "../src/lib/canvas/director/director-scene";
import type { DirectorKeyframe, DirectorQuat, DirectorScene, DirectorTransform } from "../src/types/director";

const transformAt = (x: number): DirectorTransform => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

function seededKeyframes(): DirectorKeyframe[] {
    let keys: DirectorKeyframe[] = [];
    keys = upsertDirectorKeyframe(keys, 0, transformAt(0));
    keys = upsertDirectorKeyframe(keys, 1, transformAt(10));
    keys = upsertDirectorKeyframe(keys, 2, transformAt(20));
    return keys;
}

describe("Remove transform keyframe", () => {
    test("Delete by id only removes the target frame, keeping the rest in order", () => {
        const keys = seededKeyframes();
        const next = removeDirectorKeyframe(keys, keys[1].id);

        expect(next).toHaveLength(2);
        expect(next.map((k) => k.time)).toEqual([0, 2]);
        // 纯函数：不得改写入参。
        expect(keys).toHaveLength(3);
    });

    test("If the id does not exist, return the original reference to avoid meaningless re-rendering.", () => {
        const keys = seededKeyframes();
        expect(removeDirectorKeyframe(keys, "missing")).toBe(keys);
    });

    test("After deleting the empty array, an empty array is obtained, and the interpolation falls back to base.", () => {
        let keys = upsertDirectorKeyframe([], 1, transformAt(5));
        keys = removeDirectorKeyframe(keys, keys[0].id);
        expect(keys).toEqual([]);
        expect(interpolateDirectorTransform(transformAt(99), keys, 1).position[0]).toBe(99);
    });

    test("upsert uses the same tolerance, and the recorded frames must be deleted by id", () => {
        // 非整帧时间点最容易出现「记录能覆盖但删不掉」，这里锁住判据一致。
        let keys = upsertDirectorKeyframe([], 0.75, transformAt(3));
        keys = upsertDirectorKeyframe(keys, 0.75 + DIRECTOR_KEYFRAME_EPSILON / 2, transformAt(4));
        expect(keys).toHaveLength(1);
        expect(removeDirectorKeyframe(keys, keys[0].id)).toEqual([]);
    });
});

describe("keyframe easing", () => {
    test("linear / step / smooth produce different and definite interval progress", () => {
        expect(resolveDirectorKeyframeProgress(0.25, "linear")).toBe(0.25);
        expect(resolveDirectorKeyframeProgress(0.25, "step")).toBe(0);
        expect(resolveDirectorKeyframeProgress(0.25, "smooth")).toBeCloseTo(0.15625, 8);
        expect(resolveDirectorKeyframeProgress(-1, "linear")).toBe(0);
        expect(resolveDirectorKeyframeProgress(2, "linear")).toBe(1);
    });

    test("Interpolation reads the easing of the previous keyframe, and the old data defaults to linear", () => {
        const base = seededKeyframes().slice(0, 2);
        expect(interpolateDirectorTransform(transformAt(0), base, 0.25).position[0]).toBeCloseTo(2.5, 8);
        expect(interpolateDirectorTransform(transformAt(0), [{ ...base[0], easing: "step" }, base[1]], 0.25).position[0]).toBe(0);
        expect(interpolateDirectorTransform(transformAt(0), [{ ...base[0], easing: "smooth" }, base[1]], 0.25).position[0]).toBeCloseTo(1.5625, 8);
        expect(interpolateDirectorTransform(transformAt(0), [{ ...base[0], easing: "step" }, base[1]], 1).position[0]).toBe(10);
    });
});

describe("Object property group keyframes", () => {
    test("Playback interpolation does not change unrecorded rotation and scale when only position is recorded", () => {
        const base: DirectorTransform = { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
        const keys: DirectorKeyframe[] = [
            { id: "start", time: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] }, positionKeyed: true, rotationKeyed: false, scaleKeyed: false },
            { id: "end", time: 2, transform: { position: [10, 0, 0], rotation: [0, 1, 0], scale: [3, 3, 3] }, positionKeyed: true, rotationKeyed: false, scaleKeyed: false },
        ];
        const rendered = interpolateDirectorTransform(base, keys, 1);
        expect(rendered.position).toEqual([5, 0, 0]);
        expect(rendered.rotation).toEqual([0, 0, 0]);
        expect(rendered.scale).toEqual([1, 1, 1]);
    });

    test("Canceling the position frame only removes the position attribute and retains the rotation frame at the same time.", () => {
        const scene = createDirectorScene("Property group track");
        const actor = createDirectorActor("Role A");
        const key: DirectorKeyframe = { id: "at-1", time: 1, transform: transformAt(4), positionKeyed: true, rotationKeyed: true, scaleKeyed: false };
        const seeded: DirectorScene = { ...scene, objects: [{ ...actor, keyframes: [key] }] };
        const next = removeDirectorSceneKeyframe(seeded, { track: "object-transform", objectId: actor.id, keyframeId: key.id, channel: "position" });
        expect(next.objects[0].keyframes).toHaveLength(1);
        expect(next.objects[0].keyframes[0]).toMatchObject({ positionKeyed: false, rotationKeyed: true, scaleKeyed: false });
        expect(seeded.objects[0].keyframes[0]).toEqual(key);
    });
});

describe("Delete bone keyframes", () => {
    const rotation: DirectorQuat = [0, 0, 0, 1];

    test("Track retains remaining frames after deletion", () => {
        let tracks = upsertDirectorBoneKeyframe([], "hips", 0, rotation);
        tracks = upsertDirectorBoneKeyframe(tracks, "hips", 1, rotation);
        const target = tracks[0].keyframes[0].id;

        const next = removeDirectorBoneKeyframe(tracks, "hips", target);
        expect(next).toHaveLength(1);
        expect(next[0].keyframes).toHaveLength(1);
        expect(next[0].keyframes[0].time).toBe(1);
    });

    test("After the track is deleted, the entire track is removed, leaving no empty sub-tracks.", () => {
        const tracks = upsertDirectorBoneKeyframe([], "head", 0, rotation);
        const next = removeDirectorBoneKeyframe(tracks, "head", tracks[0].keyframes[0].id);
        expect(next).toEqual([]);
    });

    test("Returns the original reference when the bone or id does not exist", () => {
        const tracks = upsertDirectorBoneKeyframe([], "head", 0, rotation);
        expect(removeDirectorBoneKeyframe(tracks, "hips", tracks[0].keyframes[0].id)).toBe(tracks);
        expect(removeDirectorBoneKeyframe(tracks, "head", "missing")).toBe(tracks);
    });

    test("Only affects the target bone, leaving other tracks unchanged.", () => {
        let tracks = upsertDirectorBoneKeyframe([], "hips", 0, rotation);
        tracks = upsertDirectorBoneKeyframe(tracks, "head", 0, rotation);
        const next = removeDirectorBoneKeyframe(tracks, "hips", tracks[0].keyframes[0].id);
        expect(next.map((t) => t.bone)).toEqual(["head"]);
    });
});

describe("removeDirectorSceneKeyframe: the only dispatch entry for timeline deletion", () => {
    const rotation: DirectorQuat = [0, 0, 0, 1];

    /** 一个带对象 transform 帧、骨骼帧和摄影机帧的完整场景。 */
    function seededScene() {
        const base = createDirectorScene("Delete test");
        const actor = {
            ...createDirectorActor("Actor A"),
            keyframes: upsertDirectorKeyframe(upsertDirectorKeyframe([], 0, transformAt(0)), 1, transformAt(10)),
            boneTracks: upsertDirectorBoneKeyframe(upsertDirectorBoneKeyframe([], "hips", 0, rotation), "head", 0.5, rotation),
        };
        const camera = { ...createDirectorCamera("Camera A"), keyframes: upsertDirectorKeyframe([], 2, transformAt(5)) };
        const scene: DirectorScene = { ...base, objects: [actor], cameras: [camera] };
        return { scene, actor, camera };
    }

    test("Delete the object transform frame and only move the target object", () => {
        const { scene, actor } = seededScene();
        const next = removeDirectorSceneKeyframe(scene, { track: "object-transform", objectId: actor.id, keyframeId: actor.keyframes[0].id });

        expect(next).not.toBe(scene);
        expect(next.objects[0].keyframes.map((key) => key.time)).toEqual([1]);
        // 骨骼轨道和摄影机不受影响，保持原引用。
        expect(next.objects[0].boneTracks).toBe(actor.boneTracks);
        expect(next.cameras).toBe(scene.cameras);
    });

    test("Delete the skeleton frame and remove all empty sub-tracks.", () => {
        const { scene, actor } = seededScene();
        const hips = actor.boneTracks.find((track) => track.bone === "hips");
        const next = removeDirectorSceneKeyframe(scene, { track: "object-bone", objectId: actor.id, bone: "hips", keyframeId: hips!.keyframes[0].id });

        expect(next.objects[0].boneTracks?.map((track) => track.bone)).toEqual(["head"]);
        expect(next.objects[0].keyframes).toBe(actor.keyframes);
    });

    test("Delete the camera frame and only move the target camera", () => {
        const { scene, camera } = seededScene();
        const next = removeDirectorSceneKeyframe(scene, { track: "camera", cameraId: camera.id, keyframeId: camera.keyframes[0].id });

        expect(next.cameras[0].keyframes).toEqual([]);
        expect(next.objects).toBe(scene.objects);
    });

    test("Deleting the focus or angle sub-track will not delete the position and another optical track at the same time", () => {
        const { scene, camera } = seededScene();
        const key = { ...camera.keyframes[0], rotationKeyed: false, target: [1, 1.2, 0] as [number, number, number], fov: 35 };
        const withOptics: DirectorScene = { ...scene, cameras: [{ ...camera, keyframes: [key] }] };
        const noFocus = removeDirectorSceneKeyframe(withOptics, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "focus" });
        expect(noFocus.cameras[0].keyframes).toHaveLength(1);
        expect(noFocus.cameras[0].keyframes[0].target).toBeUndefined();
        expect(noFocus.cameras[0].keyframes[0].fov).toBe(35);
        expect(noFocus.cameras[0].keyframes[0].transform).toEqual(key.transform);

        const noFov = removeDirectorSceneKeyframe(withOptics, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "fov" });
        expect(noFov.cameras[0].keyframes[0].target).toEqual([1, 1.2, 0]);
        expect(noFov.cameras[0].keyframes[0].fov).toBeUndefined();
        const noPosition = removeDirectorSceneKeyframe(withOptics, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "position" });
        expect(noPosition.cameras[0].keyframes).toHaveLength(1);
        expect(noPosition.cameras[0].keyframes[0].positionKeyed).toBe(false);
        expect(noPosition.cameras[0].keyframes[0].target).toEqual([1, 1.2, 0]);
        expect(noPosition.cameras[0].keyframes[0].fov).toBe(35);
        const withRotation: DirectorScene = { ...scene, cameras: [{ ...camera, keyframes: [{ ...key, rotationKeyed: true }] }] };
        const noRotation = removeDirectorSceneKeyframe(withRotation, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "rotation" });
        expect(noRotation.cameras[0].keyframes[0].rotationKeyed).toBe(false);
        expect(noRotation.cameras[0].keyframes[0].positionKeyed).not.toBe(false);
        expect(noRotation.cameras[0].keyframes[0].target).toEqual([1, 1.2, 0]);
        const opticalOnly = removeDirectorSceneKeyframe(noPosition, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "focus" });
        const empty = removeDirectorSceneKeyframe(opticalOnly, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "fov" });
        expect(empty.cameras[0].keyframes).toEqual([]);
        expect(withOptics.cameras[0].keyframes[0]).toEqual(key);
        expect(removeDirectorSceneKeyframe(noFocus, { track: "camera", cameraId: camera.id, keyframeId: key.id, channel: "focus" })).toBe(noFocus);
    });

    test("Misses always return the same scene reference: the caller skips history and saving accordingly.", () => {
        const { scene, actor, camera } = seededScene();
        // 对象存在但帧 id 不存在。
        expect(removeDirectorSceneKeyframe(scene, { track: "object-transform", objectId: actor.id, keyframeId: "missing" })).toBe(scene);
        // 对象本身不存在。
        expect(removeDirectorSceneKeyframe(scene, { track: "object-transform", objectId: "missing", keyframeId: actor.keyframes[0].id })).toBe(scene);
        // 骨骼轨道不存在。
        expect(removeDirectorSceneKeyframe(scene, { track: "object-bone", objectId: actor.id, bone: "leftHand", keyframeId: "missing" })).toBe(scene);
        // 摄影机不存在。
        expect(removeDirectorSceneKeyframe(scene, { track: "camera", cameraId: "missing", keyframeId: camera.keyframes[0].id })).toBe(scene);
    });

    test("When the object does not have boneTracks, deleting the bone frame does not create an empty array.", () => {
        const base = createDirectorScene("no bones");
        const object = { ...createDirectorActor("Actor B"), boneTracks: undefined };
        const scene: DirectorScene = { ...base, objects: [object] };
        expect(removeDirectorSceneKeyframe(scene, { track: "object-bone", objectId: object.id, bone: "hips", keyframeId: "any" })).toBe(scene);
    });

    test("Do not change the written parameters: the original scene and the original array remain intact", () => {
        const { scene, actor } = seededScene();
        removeDirectorSceneKeyframe(scene, { track: "object-transform", objectId: actor.id, keyframeId: actor.keyframes[0].id });
        expect(scene.objects[0].keyframes).toHaveLength(2);
    });
});

describe("setDirectorSceneKeyframeEasing: Update by track and remain pure function", () => {
    test("Objects, bones and cameras can all be updated independently", () => {
        const base = createDirectorScene("Easing test");
        const actor = {
            ...createDirectorActor("actor"),
            keyframes: upsertDirectorKeyframe([], 0, transformAt(0)),
            boneTracks: upsertDirectorBoneKeyframe([], "hips", 0, [0, 0, 0, 1]),
        };
        const camera = { ...createDirectorCamera("camera"), keyframes: upsertDirectorKeyframe([], 0, transformAt(1)) };
        const scene: DirectorScene = { ...base, objects: [actor], cameras: [camera] };

        const objectNext = setDirectorSceneKeyframeEasing(scene, { track: "object-transform", objectId: actor.id, keyframeId: actor.keyframes[0].id }, "smooth");
        expect(objectNext.objects[0].keyframes[0].easing).toBe("smooth");
        expect(objectNext.cameras).toBe(scene.cameras);

        const boneNext = setDirectorSceneKeyframeEasing(scene, { track: "object-bone", objectId: actor.id, bone: "hips", keyframeId: actor.boneTracks[0].keyframes[0].id }, "step");
        expect(boneNext.objects[0].boneTracks?.[0].keyframes[0].easing).toBe("step");

        const cameraNext = setDirectorSceneKeyframeEasing(scene, { track: "camera", cameraId: camera.id, keyframeId: camera.keyframes[0].id }, "linear");
        expect(cameraNext.cameras[0].keyframes[0].easing).toBe("linear");
        expect(scene.objects[0].keyframes[0].easing).toBeUndefined();
    });

    test("Returns the original scene reference when the target does not exist", () => {
        const scene = createDirectorScene("missing");
        expect(setDirectorSceneKeyframeEasing(scene, { track: "camera", cameraId: "missing", keyframeId: "missing" }, "smooth")).toBe(scene);
    });
});
