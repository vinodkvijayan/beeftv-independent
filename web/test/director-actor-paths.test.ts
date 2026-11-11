import { describe, expect, test } from "bun:test";

import { createDirectorActorPath, createDirectorActorPenPath, createDirectorActorPencilPath, editDirectorActorPathAtTime, removeDirectorActorPath, retimeDirectorActorPath, setDirectorActorPathFacing, updateDirectorActorPathTransform } from "@/lib/canvas/director/director-actor-paths";
import { createDirectorActor, interpolateDirectorTransform } from "@/lib/canvas/director/director-scene";

const actor = () => createDirectorActor("Role A", [0, 0, 0]);

describe("Director's stage character movement trajectory", () => {
    test("A straight path advances forward from the actor's current position, with the playhead and output reading the same set of keyframes", () => {
        const source = actor();
        const result = createDirectorActorPath(source, "line", 10);
        expect(result.motionPath).toMatchObject({ kind: "line", duration: 10, facePath: true });
        expect(result.motionPath?.transform.position).toEqual([0, 0, 2]);
        expect(result.keyframes.map((key) => key.time)).toEqual([0, 10]);
        expect(interpolateDirectorTransform(result.transform, result.keyframes, 2).position).toEqual([0, 0, 0.8]);
        expect(interpolateDirectorTransform(result.transform, result.keyframes, 10).position).toEqual([0, 0, 4]);
    });

    test("Changing track duration preserves spatial alignment but retimes keyframes", () => {
        const result = retimeDirectorActorPath(createDirectorActorPath(actor(), "line", 10), 5);
        expect(result.motionPath?.duration).toBe(5);
        expect(result.keyframes.map((key) => key.time)).toEqual([0, 5]);
        expect(interpolateDirectorTransform(result.transform, result.keyframes, 2.5).position).toEqual([0, 0, 2]);
    });

    test("The track properties only edit the interpolation position of the playhead and do not move the entire path.", () => {
        const created = createDirectorActorPath(actor(), "line", 10);
        const edited = editDirectorActorPathAtTime(created, 2, { ...created.transform, position: [1, 0, 0.8] });
        expect(edited.keyframes).toHaveLength(3);
        expect(interpolateDirectorTransform(edited.transform, edited.keyframes, 0).position).toEqual([0, 0, 0]);
        expect(interpolateDirectorTransform(edited.transform, edited.keyframes, 2).position).toEqual([1, 0, 0.8]);
        expect(interpolateDirectorTransform(edited.transform, edited.keyframes, 10).position).toEqual([0, 0, 4]);
    });

    test("The center and half-way positions of circular and rectangular paths are consistent with the reference page", () => {
        const ring = createDirectorActorPath(actor(), "ring", 10);
        expect(ring.motionPath?.transform.position).toEqual([-2, 0, 0]);
        expect(interpolateDirectorTransform(ring.transform, ring.keyframes, 5).position[0]).toBeCloseTo(-4, 5);
        const rectangle = createDirectorActorPath(actor(), "rectangle", 10);
        expect(rectangle.motionPath?.transform.position).toEqual([2, 0, 1.5]);
        expect(interpolateDirectorTransform(rectangle.transform, rectangle.keyframes, 5).position).toEqual([4, 0, 3]);
    });

    test("The circular trajectory is played with smooth sampling, but the timeline only exposes the start, half and end points", () => {
        const ring = createDirectorActorPath(actor(), "ring", 10);
        expect(ring.keyframes.length).toBeGreaterThan(20);
        const controls = ring.keyframes.filter((frame) => ring.motionPath?.controlKeyframeIds?.includes(frame.id));
        expect(controls.map((frame) => frame.time)).toEqual([0, 5, 10]);
        for (const frame of ring.keyframes) {
            const [x, , z] = frame.transform.position;
            expect(Math.hypot(x + 2, z)).toBeCloseTo(2, 5);
        }
    });

    test("Path position and proportional scaling move the entire trajectory without changing the actor's body proportions", () => {
        const created = createDirectorActorPath(actor(), "line", 10);
        const shifted = updateDirectorActorPathTransform(created, { ...created.motionPath!.transform, position: [1, 0, 2] });
        expect(shifted.keyframes.map((key) => key.transform.position)).toEqual([[1, 0, 0], [1, 0, 4]]);
        const scaled = updateDirectorActorPathTransform(shifted, { ...shifted.motionPath!.transform, scale: [2, 2, 2] });
        expect(scaled.keyframes.map((key) => key.transform.position)).toEqual([[1, 0, -2], [1, 0, 6]]);
        expect(scaled.transform.scale).toEqual(created.transform.scale);
    });

    test("Only changes the orbital rotation along the path orientation; restores the original orientation of the character after turning it off.", () => {
        const source = { ...actor(), transform: { ...actor().transform, rotation: [0, 0.4, 0] as [number, number, number] } };
        const ring = createDirectorActorPath(source, "ring", 10);
        expect(ring.keyframes.some((key) => key.transform.rotation[1] !== source.transform.rotation[1])).toBe(true);
        const unbound = setDirectorActorPathFacing(ring, false);
        expect(unbound.keyframes.every((key) => key.transform.rotation[1] === source.transform.rotation[1])).toBe(true);
    });

    test("When removing a track, the keyframes before creation are restored and the user's original animation is not cleared.", () => {
        const source = actor();
        const prior = [{ id: "manual", time: 1, transform: { ...source.transform, position: [3, 0, 0] as [number, number, number] } }];
        const withPath = createDirectorActorPath({ ...source, keyframes: prior }, "line", 10);
        expect(withPath.keyframes).not.toEqual(prior);
        const restored = removeDirectorActorPath(withPath);
        expect(restored.keyframes).toEqual(prior);
        expect(restored.motionPath).toBeUndefined();
    });

    test("The pencil trace is timed according to the spatial distance of the canvas gesture and starts from the actor's original position", () => {
        const result = createDirectorActorPencilPath(actor(), [{ x: 5, z: 8 }, { x: 8, z: 8 }, { x: 8, z: 12 }], 7);
        expect(result?.motionPath).toMatchObject({ kind: "pencil", duration: 7 });
        expect(result?.keyframes).toHaveLength(10);
        expect(result?.keyframes[0].transform.position).toEqual([0, 0, 0]);
        expect(result?.keyframes[4].transform.position[0]).toBeCloseTo(3, 8);
        expect(result?.keyframes[4].transform.position[2]).toBeCloseTo(1 / 9, 8);
        expect(result?.keyframes.at(-1)?.transform.position).toEqual([3, 0, 4]);
        expect(result?.keyframes.every((frame, index) => Math.abs(frame.time - 7 * index / 9) < 1e-8)).toBe(true);
        expect(result?.motionPath?.transform.position).toEqual([1.5, 0, 2]);
    });

    test("Pencil single-point gesture does not cover the actor's original track", () => {
        expect(createDirectorActorPencilPath(actor(), [{ x: 5, z: 8 }, { x: 5, z: 8 }], 7)).toBeNull();
    });

    test("Slow and small continuous dragging samples according to the accumulated displacement, and will not be misjudged as a single point.", () => {
        const result = createDirectorActorPencilPath(actor(), [{ x: 0, z: 0 }, { x: 0.03, z: 0 }, { x: 0.06, z: 0 }, { x: 0.09, z: 0 }], 3);
        expect(result?.keyframes.at(-1)?.transform.position[0]).toBeCloseTo(0.09, 5);
    });

    test("Pen point-by-point path starts from actor position, passes through control points, and retains editable control time points", () => {
        const result = createDirectorActorPenPath(actor(), [{ x: 2, z: 0 }, { x: 2, z: 2 }], 6);
        expect(result?.motionPath).toMatchObject({ kind: "pen", duration: 6 });
        expect(result?.motionPath?.transform.position).toEqual([1, 0, 1]);
        expect(result?.keyframes[0].transform.position).toEqual([0, 0, 0]);
        expect(result?.keyframes.at(-1)?.transform.position).toEqual([2, 0, 2]);
        expect(result?.keyframes.length).toBeGreaterThan(3);
        const controls = result!.keyframes.filter((frame) => result?.motionPath?.controlKeyframeIds?.includes(frame.id));
        expect(controls.map((frame) => frame.time)).toEqual([0, 3, 6]);
    });

    test("Repeatedly clicking the same point with the pen does not create an empty animation", () => {
        expect(createDirectorActorPenPath(actor(), [{ x: 0, z: 0 }, { x: 0, z: 0 }], 6)).toBeNull();
    });
});
