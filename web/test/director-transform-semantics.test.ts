import { describe, expect, test } from "bun:test";
import { Euler, Vector3 } from "three";

import {
    advanceDirectorPlayhead,
    applyDirectorTransformDelta,
    directorTransformDelta,
    resolveDirectorCameraAlignment,
    resolveDirectorCameraMoveKeyframes,
    resolveDirectorCameraMoveLookAtMode,
    resolveDirectorCameraMoveTransform,
    resolveDirectorKeyframeRecord,
    resolveDirectorObjectTransformEdit,
    snapDirectorTime,
} from "../src/lib/canvas/director/director-animation-semantics";
import { createDirectorCamera, directorTransformPathLength, finiteDirectorTransformKeyframes, interpolateDirectorTransform } from "../src/lib/canvas/director/director-scene";
import type { DirectorKeyframe, DirectorTransform } from "../src/types/director";

function transform(position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): DirectorTransform {
    return { position, rotation, scale };
}

function keyframe(id: string, time: number, value: DirectorTransform): DirectorKeyframe {
    return { id, time, transform: value };
}

describe("snapDirectorTime", () => {
    test("Snap by frame rate and clip to non-negative", () => {
        expect(snapDirectorTime(1.031, 24)).toBeCloseTo(1.0416666, 6);
        expect(snapDirectorTime(-0.4, 24)).toBe(0);
        expect(snapDirectorTime(1.031, 0)).toBeCloseTo(1.0416666, 6);
    });
});

describe("Camera snaps to current view", () => {
    test("Update base transform when there are no keyframes", () => {
        const camera = createDirectorCamera();
        const aligned = transform([9, 3, 2]);
        const next = resolveDirectorCameraAlignment(camera, aligned, 1);
        expect(next.transform).toEqual(aligned);
        expect(next.keyframes).toEqual([]);
    });

    test("Write the current time keyframe when there is a track, and CAM will immediately display the alignment result without losing other frames.", () => {
        const camera = {
            ...createDirectorCamera(),
            keyframes: [keyframe("start", 0, transform([0, 0, 0])), keyframe("end", 2, transform([10, 0, 0]))],
        };
        const aligned = transform([4, 5, 6]);
        const next = resolveDirectorCameraAlignment(camera, aligned, 1);
        expect(next.transform).toBe(camera.transform);
        expect(next.keyframes).toHaveLength(3);
        expect(interpolateDirectorTransform(next.transform, next.keyframes, 1)).toEqual(aligned);
        expect(next.keyframes.find((item) => item.id === "start")).toEqual(camera.keyframes[0]);
        expect(next.keyframes.find((item) => item.id === "end")).toEqual(camera.keyframes[1]);
    });

    test("Re-establish position keyframes when moving optical-specific frames and preserve focus", () => {
        const camera = { ...createDirectorCamera(), keyframes: [
            keyframe("start", 0, transform([0, 0, 0])),
            { ...keyframe("focus", 1, transform([5, 0, 0])), positionKeyed: false, target: [1, 1, 0] as [number, number, number] },
            keyframe("end", 2, transform([10, 0, 0])),
        ] };
        const next = resolveDirectorCameraAlignment(camera, transform([6, 0, 0]), 1);
        expect(next.keyframes[1].id).toBe("focus");
        expect(next.keyframes[1].positionKeyed).toBe(true);
        expect(next.keyframes[1].target).toEqual([1, 1, 0]);
        expect(next.keyframes[1].transform.position).toEqual([6, 0, 0]);
    });
});

describe("Generate the first and last frames of the camera movement", () => {
    test("Advance, zoom out, and orbit are calculated relative to the current focus; pan and tilt rotate the camera without panning.", () => {
        const start = transform([0, 2, 0]);
        const target: [number, number, number] = [10, 2, 0];
        const pushed = resolveDirectorCameraMoveTransform(start, target, "push_in");
        const pulled = resolveDirectorCameraMoveTransform(start, target, "pull_out");
        const panned = resolveDirectorCameraMoveTransform(start, target, "pan_right");
        const tilted = resolveDirectorCameraMoveTransform(start, target, "tilt_up");
        const orbited = resolveDirectorCameraMoveTransform(start, target, "orbit_left");

        expect(pushed.position).toEqual([2, 2, 0]);
        expect(pulled.position).toEqual([-2, 2, 0]);
        expect(panned.position).toEqual(start.position);
        expect(panned.rotation[1]).toBeLessThan(0);
        expect(tilted.position).toEqual(start.position);
        expect(tilted.rotation[0]).toBeGreaterThan(0);
        expect(resolveDirectorCameraMoveLookAtMode("coordinates", "pan_left")).toBe("rotation");
        expect(resolveDirectorCameraMoveLookAtMode("object", "orbit_left")).toBe("object");
        expect(new Vector3(...orbited.position).distanceTo(new Vector3(...target))).toBeCloseTo(10);
        expect(orbited.position[2]).toBeGreaterThan(0);
    });

    test("Keep the manual intermediate frames, existing ids and easing, and only update the first and last transforms", () => {
        const existing: DirectorKeyframe[] = [{ ...keyframe("start", 0, transform([9, 0, 0])), easing: "step" }, { ...keyframe("manual", 1, transform([4, 2, 0])), easing: "smooth" }, keyframe("end", 2, transform([8, 0, 0]))];
        const next = resolveDirectorCameraMoveKeyframes(existing, transform([0, 0, 0]), transform([2, 0, 0]), 2);
        expect(next.map((item) => item.id)).toEqual(["start", "manual", "end"]);
        expect(next[0].transform.position).toEqual([0, 0, 0]);
        expect(next[1]).toEqual(existing[1]);
        expect(next[2].transform.position).toEqual([2, 0, 0]);
        expect(next[0].easing).toBe("step");
    });

    test("The empty track generates two ordered first and last frames.", () => {
        const next = resolveDirectorCameraMoveKeyframes([], transform([0, 0, 0]), transform([0, 0, -2]), 3);
        expect(next.map((item) => item.time)).toEqual([0, 3]);
    });
});

describe("Playhead loop advance", () => {
    test("Preserve margin when crossing end of shot", () => {
        expect(advanceDirectorPlayhead(1.9, 0.3, 2)).toBeCloseTo(0.2, 8);
    });

    test("Safe fallback of illegal playheads, increments and durations", () => {
        expect(advanceDirectorPlayhead(Number.NaN, 0.5, 2)).toBe(0.5);
        expect(advanceDirectorPlayhead(1, Number.NaN, 2)).toBe(1);
        expect(advanceDirectorPlayhead(1, 1, 0)).toBe(0);
    });
});

describe("Transform trajectory statistics", () => {
    test("Accumulate spatial paths in chronological order, and do not regard the input array order as the path order.", () => {
        const keys = [keyframe("end", 2, transform([3, 4, 0])), keyframe("start", 0, transform([0, 0, 0])), keyframe("middle", 1, transform([0, 4, 0]))];
        expect(directorTransformPathLength(keys)).toBe(7);
        expect(keys.map((key) => key.id)).toEqual(["end", "start", "middle"]);
    });

    test("Ignore segments containing illegal coordinates to avoid NaN pollution in trajectory display judgment.", () => {
        const keys = [keyframe("valid", 0, transform([0, 0, 0])), keyframe("invalid", 1, transform([Number.NaN, 2, 0])), keyframe("valid-again", 2, transform([3, 4, 0]))];
        expect(directorTransformPathLength(keys)).toBe(0);
    });

    test("Track rendering filters out illegal times and coordinates, and does not pass NaN/Infinity to Three", () => {
        const keys = [keyframe("start", 0, transform([0, 0, 0])), keyframe("bad-time", Number.NaN, transform([1, 0, 0])), keyframe("bad-position", 1, transform([Number.POSITIVE_INFINITY, 0, 0])), keyframe("end", 2, transform([2, 0, 0]))];
        const renderable = finiteDirectorTransformKeyframes(keys);
        expect(renderable.map((item) => item.id)).toEqual(["start", "end"]);
        expect(renderable.flatMap((item) => [item.time, ...item.transform.position]).every(Number.isFinite)).toBe(true);
    });

    test("Pure rotation frames must not falsify character movement trajectories", () => {
        const keys: DirectorKeyframe[] = [
            { ...keyframe("start", 0, transform([0, 0, 0])), positionKeyed: false, rotationKeyed: true },
            { ...keyframe("end", 2, transform([5, 0, 0])), positionKeyed: false, rotationKeyed: true },
        ];
        expect(finiteDirectorTransformKeyframes(keys)).toEqual([]);
        expect(directorTransformPathLength(keys)).toBe(0);
    });
});

describe("resolveDirectorObjectTransformEdit: Auto Key on", () => {
    test("Only write a single keyframe in the adsorption playhead, and the base and other keyframes remain unchanged.", () => {
        const base = transform([0, 0, 0]);
        const keyframes = [keyframe("k0", 0, transform([0, 0, 0])), keyframe("k2", 2, transform([4, 0, 0]))];
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: transform([2, 0, 0]), edited: transform([2, 5, 0]), autoKey: true, time: 1 });
        expect(edit.transform).toEqual(base);
        expect(edit.keyframes).toHaveLength(3);
        expect(edit.keyframes.find((item) => item.time === 1)?.transform.position).toEqual([2, 5, 0]);
        expect(edit.keyframes.find((item) => item.id === "k0")?.transform.position).toEqual([0, 0, 0]);
        expect(edit.keyframes.find((item) => item.id === "k2")?.transform.position).toEqual([4, 0, 0]);
    });

    test("Repeated editing at the same time reuses the same keyframe instead of adding new ones", () => {
        const edit = resolveDirectorObjectTransformEdit({ base: transform([0, 0, 0]), keyframes: [keyframe("k1", 1, transform([1, 0, 0]))], rendered: transform([1, 0, 0]), edited: transform([9, 0, 0]), autoKey: true, time: 1 });
        expect(edit.keyframes).toHaveLength(1);
        expect(edit.keyframes[0].transform.position).toEqual([9, 0, 0]);
    });

    test("When some attributes are already framed, the automatic keyframe editing position will enable the position without accidentally turning on the zoom.", () => {
        const base = transform([0, 0, 0]);
        const keyframes: DirectorKeyframe[] = [{ id: "rotation-only", time: 1, transform: base, positionKeyed: false, rotationKeyed: true, scaleKeyed: false }];
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: base, edited: transform([5, 0, 0]), autoKey: true, time: 1 });
        expect(edit.keyframes).toHaveLength(1);
        expect(edit.keyframes[0]).toMatchObject({ positionKeyed: true, rotationKeyed: true, scaleKeyed: false });
        expect(interpolateDirectorTransform(base, edit.keyframes, 1).position).toEqual([5, 0, 0]);
    });
});

describe("resolveDirectorObjectTransformEdit:Auto Key off", () => {
    test("When there are no keyframes, base is rewritten directly and the exact value entered by the user is retained.", () => {
        const edited = transform([1.5, 2.25, -3], [0.1, 0.2, 0.3], [2, 2, 2]);
        const edit = resolveDirectorObjectTransformEdit({ base: transform([0, 0, 0]), keyframes: [], rendered: transform([0, 0, 0]), edited, autoKey: false, time: 0.5 });
        expect(edit.transform).toEqual(edited);
        expect(edit.keyframes).toEqual([]);
    });

    test("When there are keyframes, move the entire increment to base and all keyframes, and the edit will be immediately visible.", () => {
        const base = transform([0, 0, 0]);
        const keyframes = [keyframe("k0", 0, transform([0, 0, 0])), keyframe("k2", 2, transform([4, 0, 0]))];
        const rendered = interpolateDirectorTransform(base, keyframes, 1);
        expect(rendered.position).toEqual([2, 0, 0]);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered, edited: transform([2, 3, 0]), autoKey: false, time: 1 });
        expect(edit.keyframes).toHaveLength(2);
        expect(edit.transform.position).toEqual([0, 3, 0]);
        expect(edit.keyframes[0].transform.position).toEqual([0, 3, 0]);
        expect(edit.keyframes[1].transform.position).toEqual([4, 3, 0]);
        // 编辑后在同一时间点的渲染值等于用户所见的编辑值。
        expect(interpolateDirectorTransform(edit.transform, edit.keyframes, 1).position).toEqual([2, 3, 0]);
    });
});

describe("Compatibility of unedited scenes", () => {
    test("Single keyframe scenes are rendered by this keyframe before and after editing.", () => {
        const base = transform([0, 0, 0]);
        const keyframes = [keyframe("only", 1, transform([7, 0, 0]))];
        expect(interpolateDirectorTransform(base, keyframes, 0).position).toEqual([7, 0, 0]);
        expect(interpolateDirectorTransform(base, keyframes, 5).position).toEqual([7, 0, 0]);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: transform([7, 0, 0]), edited: transform([7, 2, 0]), autoKey: false, time: 3 });
        expect(edit.keyframes).toHaveLength(1);
        expect(interpolateDirectorTransform(edit.transform, edit.keyframes, 3).position).toEqual([7, 2, 0]);
    });

    test("Zero incremental editing does not change the rendering results of any existing keyframes", () => {
        const base = transform([1, 1, 1], [0, 0.3, 0], [2, 2, 2]);
        const keyframes = [keyframe("a", 0, transform([0, 0, 0])), keyframe("b", 4, transform([8, 2, 0]))];
        const rendered = interpolateDirectorTransform(base, keyframes, 2);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered, edited: rendered, autoKey: false, time: 2 });
        [0, 1, 2, 3, 4].forEach((time) => {
            const before = interpolateDirectorTransform(base, keyframes, time);
            const after = interpolateDirectorTransform(edit.transform, edit.keyframes, time);
            after.position.forEach((value, index) => expect(value).toBeCloseTo(before.position[index], 10));
            after.scale.forEach((value, index) => expect(value).toBeCloseTo(before.scale[index], 10));
        });
    });
});

describe("Zero value and proportional behavior of scaling increments", () => {
    test("Use absolute offset when source scale is 0, no Infinity or NaN will be generated", () => {
        const delta = directorTransformDelta(transform([0, 0, 0], [0, 0, 0], [0, 0, 0]), transform([0, 0, 0], [0, 0, 0], [3, 0, 1.5]));
        expect(delta.scaleRatio).toEqual([1, 1, 1]);
        expect(delta.scaleOffset).toEqual([3, 0, 1.5]);
        const applied = applyDirectorTransformDelta(transform([0, 0, 0], [0, 0, 0], [0, 0, 0]), delta);
        applied.scale.forEach((value) => expect(Number.isFinite(value)).toBe(true));
        expect(applied.scale).toEqual([3, 0, 1.5]);
    });

    test("Non-zero scaling takes place proportionally and is applied to other keyframes proportionally.", () => {
        const delta = directorTransformDelta(transform([0, 0, 0], [0, 0, 0], [2, 2, 2]), transform([0, 0, 0], [0, 0, 0], [3, 3, 3]));
        expect(delta.scaleRatio).toEqual([1.5, 1.5, 1.5]);
        expect(applyDirectorTransformDelta(transform([0, 0, 0], [0, 0, 0], [4, 4, 4]), delta).scale).toEqual([6, 6, 6]);
    });

    test("Rotation increments remain deterministic over the entire path (asserted by orientation rather than Euler triples)", () => {
        const delta = directorTransformDelta(transform([0, 0, 0], [0, 0, 0]), transform([0, 0, 0], [0, Math.PI / 2, 0]));
        const applied = applyDirectorTransformDelta(transform([0, 0, 0], [0, 0, 0]), delta);
        expect(applied.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
        // 连续两次同一增量等价于 yaw π；欧拉 XYZ 的规范分支会写成 (π, 0, π)，因此比较朝向。
        const twice = applyDirectorTransformDelta(applied, delta);
        const forward = new Vector3(0, 0, 1).applyEuler(new Euler(...twice.rotation));
        expect(forward.x).toBeCloseTo(0, 6);
        expect(forward.z).toBeCloseTo(-1, 6);
    });
});

describe("The division of labor between raw playhead and snapped purpose time (#2 Return)", () => {
    // 24fps 下 1.02s 落在两个帧格之间：snapped = 1.0，raw = 1.02。
    const fps = 24;
    const rawTime = 1.02;
    const snappedTime = snapDirectorTime(rawTime, fps);
    const base = transform([0, 0, 0]);
    const keyframes = [keyframe("k0", 0, transform([0, 0, 0])), keyframe("k2", 2, transform([20, 0, 0]))];

    test("Precondition: raw and snapped really solve for different values.", () => {
        expect(snappedTime).toBeCloseTo(1, 6);
        expect(interpolateDirectorTransform(base, keyframes, rawTime).position[0]).toBeCloseTo(10.2, 6);
        expect(interpolateDirectorTransform(base, keyframes, snappedTime).position[0]).toBeCloseTo(10, 6);
    });

    test("Record key frames: use raw for values and snapped for writing times.", () => {
        const record = resolveDirectorKeyframeRecord({ base, keyframes, rawTime, snappedTime });
        expect(record.time).toBeCloseTo(1, 6);
        // 取错时间会写成 10（rendered-at-snapped），这里必须是 10.2（rendered-at-raw）。
        expect(record.transform.position[0]).toBeCloseTo(10.2, 6);
        const written = record.keyframes.find((item) => Math.abs(item.time - snappedTime) < 0.001);
        expect(written?.transform.position[0]).toBeCloseTo(10.2, 6);
    });

    test("The position diamond only switches the position group, a second click removes this group without creating an empty frame", () => {
        const first = resolveDirectorKeyframeRecord({ base, keyframes: [], rawTime: 1, snappedTime: 1, channel: "position" });
        expect(first.keyframes).toHaveLength(1);
        expect(first.keyframes[0]).toMatchObject({ positionKeyed: true, rotationKeyed: false, scaleKeyed: false });
        const second = resolveDirectorKeyframeRecord({ base, keyframes: first.keyframes, rawTime: 1, snappedTime: 1, channel: "position" });
        expect(second.keyframes).toEqual([]);
    });

    test("Add the position to the same frame that already has a rotation group, and then cancel the position and still retain the rotation.", () => {
        const rotation = resolveDirectorKeyframeRecord({ base, keyframes: [], rawTime: 1, snappedTime: 1, channel: "rotation" });
        const withPosition = resolveDirectorKeyframeRecord({ base, keyframes: rotation.keyframes, rawTime: 1, snappedTime: 1, channel: "position" });
        expect(withPosition.keyframes[0]).toMatchObject({ positionKeyed: true, rotationKeyed: true, scaleKeyed: false });
        const withoutPosition = resolveDirectorKeyframeRecord({ base, keyframes: withPosition.keyframes, rawTime: 1, snappedTime: 1, channel: "position" });
        expect(withoutPosition.keyframes).toHaveLength(1);
        expect(withoutPosition.keyframes[0]).toMatchObject({ positionKeyed: false, rotationKeyed: true, scaleKeyed: false });
    });

    test("The incremental starting point of AutoKey OFF must be rendered-at-raw, otherwise it will drift at raw after editing.", () => {
        const edited = transform([10.2, 4, 0]);
        const fromRaw = interpolateDirectorTransform(base, keyframes, rawTime);
        const correct = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: fromRaw, edited, autoKey: false, time: snappedTime });
        const afterCorrect = interpolateDirectorTransform(correct.transform, correct.keyframes, rawTime);
        afterCorrect.position.forEach((value, index) => expect(value).toBeCloseTo(edited.position[index], 6));

        // 用 snapped 求起点是原缺陷：编辑后在 raw 处不等于用户所见的编辑值。
        const fromSnapped = interpolateDirectorTransform(base, keyframes, snappedTime);
        const drifted = resolveDirectorObjectTransformEdit({ base, keyframes, rendered: fromSnapped, edited, autoKey: false, time: snappedTime });
        const afterDrift = interpolateDirectorTransform(drifted.transform, drifted.keyframes, rawTime);
        expect(Math.abs(afterDrift.position[0] - edited.position[0])).toBeGreaterThan(0.1);
    });

    test("AutoKey ON only writes one snap frame when between raw and snapped", () => {
        const rendered = interpolateDirectorTransform(base, keyframes, rawTime);
        const edit = resolveDirectorObjectTransformEdit({ base, keyframes, rendered, edited: transform([10.2, 7, 0]), autoKey: true, time: snappedTime });
        expect(edit.keyframes).toHaveLength(3);
        const written = edit.keyframes.find((item) => Math.abs(item.time - snappedTime) < 0.001);
        expect(written?.transform.position[1]).toBeCloseTo(7, 6);
        expect(edit.keyframes.some((item) => Math.abs(item.time - rawTime) < 0.001)).toBe(false);
    });
});
