import { describe, expect, test } from "bun:test";
import { Euler, Quaternion } from "three";

import { resolveDirectorBoneRotation } from "../src/lib/canvas/director/director-animation-semantics";
import type { DirectorBoneKeyframe, DirectorQuat } from "../src/types/director";

function quat(x: number, y: number, z: number): DirectorQuat {
    return new Quaternion().setFromEuler(new Euler(x, y, z)).toArray() as DirectorQuat;
}

function boneKey(id: string, time: number, rotation: DirectorQuat): DirectorBoneKeyframe {
    return { id, time, rotation };
}

function expectQuat(actual: DirectorQuat | null, expected: DirectorQuat) {
    expect(actual).not.toBeNull();
    actual!.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
}

describe("Bone evaluation priority: Still/Pose or Action -> Static Override -> Bone Keyframes", () => {
    test("When there are only rest and poses, the rotation is not written back, and the mixer/rest result is retained by the caller.", () => {
        expect(resolveDirectorBoneRotation({ rest: quat(0, 0.2, 0), poseDelta: quat(0, 0.1, 0), time: 0 })).toBeNull();
    });

    test("Static overrides take precedence over stills and poses", () => {
        const override = quat(0, 0.7, 0);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0, 0.2, 0), poseDelta: quat(0, 0.1, 0), override, time: 0 }), override);
    });

    test("Bone keyframes take precedence over static overrides", () => {
        const keyed = quat(0, 1.2, 0);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0, 0.2, 0), override: quat(0, 0.7, 0), keyframes: [boneKey("k0", 0, keyed)], time: 0 }), keyed);
    });

    test("Interpolation between key frames, precise hit of endpoints", () => {
        const start = quat(0, 0, 0);
        const end = quat(0, Math.PI / 2, 0);
        const keyframes = [boneKey("k0", 0, start), boneKey("k1", 2, end)];
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0, 0.3, 0), keyframes, time: 0 }), start);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0, 0.3, 0), keyframes, time: 2 }), end);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0, 0.3, 0), keyframes, time: 1 }), quat(0, Math.PI / 4, 0));
    });

    test("The action clip is used as the lowest layer input, and the override still takes effect.", () => {
        const motion = quat(0, 0.9, 0);
        const override = quat(0, 0.4, 0);
        expectQuat(resolveDirectorBoneRotation({ motion, override, time: 0 }), override);
        expect(resolveDirectorBoneRotation({ motion, time: 0 })).toBeNull();
    });

    test("When there are action clips, pose increments are not involved, and keyframes still have the highest priority.", () => {
        const keyed = quat(0, 1.1, 0);
        expectQuat(resolveDirectorBoneRotation({ motion: quat(0, 0.9, 0), poseDelta: null, rest: null, keyframes: [boneKey("k0", 0, keyed)], time: 0 }), keyed);
    });
});

describe("Finger bones use the same set of rules", () => {
    test("Finger covering takes precedence over sitting", () => {
        const override = quat(0.5, 0, 0);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0.1, 0, 0), override, time: 0 }), override);
    });

    test("Finger keyframes take precedence over finger overlays", () => {
        const keyed = quat(0.9, 0, 0);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0.1, 0, 0), override: quat(0.5, 0, 0), keyframes: [boneKey("f0", 0, keyed)], time: 0 }), keyed);
    });

    test("Empty tracks return to the coverage value and do not produce illegal rotations.", () => {
        const override = quat(0.2, 0, 0);
        expectQuat(resolveDirectorBoneRotation({ rest: quat(0.1, 0, 0), override, keyframes: [], time: 0 }), override);
    });
});
