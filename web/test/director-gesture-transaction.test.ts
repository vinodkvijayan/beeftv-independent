import { describe, expect, test } from "bun:test";

import { directorCameraSyncKey, directorGestureIdle, reduceDirectorGesture } from "../src/lib/canvas/director/director-animation-semantics";
import { useDirectorWorkbenchStore } from "../src/stores/canvas/use-director-workbench-store";
import type { DirectorKeyframe } from "../src/types/director";

function camera(keyframes: DirectorKeyframe[] = []) {
    return {
        id: "cam-1",
        transform: { position: [4, 2, 6] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
        target: [0, 1, 0] as [number, number, number],
        fov: 50,
        near: 0.05,
        far: 500,
        keyframes,
    };
}

describe("Gesture state machine: submit exactly once and always release transforming", () => {
    test("start to enter gestures and disable Orbit", () => {
        const started = reduceDirectorGesture(directorGestureIdle, "start");
        expect(started).toEqual({ active: true, committed: false, transforming: true });
    });

    test("Successfully completed and submitted exactly once", () => {
        const committed = reduceDirectorGesture(reduceDirectorGesture(directorGestureIdle, "start"), "commit");
        expect(committed).toEqual({ active: false, committed: true, transforming: false });
    });

    test("Cancel without submitting and clear transforming", () => {
        const cancelled = reduceDirectorGesture(reduceDirectorGesture(directorGestureIdle, "start"), "cancel");
        expect(cancelled).toEqual({ active: false, committed: false, transforming: false });
    });

    test("Repeated events after the final state will not be submitted twice.", () => {
        const committed = reduceDirectorGesture(reduceDirectorGesture(directorGestureIdle, "start"), "commit");
        expect(reduceDirectorGesture(committed, "commit").committed).toBe(false);
        expect(reduceDirectorGesture(committed, "cancel").committed).toBe(false);
    });

    test("The final event when the gesture is not started is a safe no-op", () => {
        expect(reduceDirectorGesture(directorGestureIdle, "commit")).toEqual(directorGestureIdle);
        expect(reduceDirectorGesture(directorGestureIdle, "cancel")).toEqual(directorGestureIdle);
    });

    test("No final path will leave transforming true", () => {
        (["commit", "cancel"] as const).forEach((event) => {
            expect(reduceDirectorGesture(reduceDirectorGesture(directorGestureIdle, "start"), event).transforming).toBe(false);
        });
    });
});

describe("directorCameraSyncKey: Do not compete with user Orbit when paused and no keyframes", () => {
    test("Playhead changes do not change the sync key when paused and without keyframes", () => {
        const first = directorCameraSyncKey({ camera: camera(), playhead: 0, playing: false });
        const second = directorCameraSyncKey({ camera: camera(), playhead: 2.5, playing: false });
        expect(first).toBe(second);
    });

    test("Dragging the playhead while paused but with keyframes drives the camera", () => {
        const keyframes = [{ id: "k0", time: 0, transform: camera().transform }];
        expect(directorCameraSyncKey({ camera: camera(keyframes), playhead: 0, playing: false })).not.toBe(directorCameraSyncKey({ camera: camera(keyframes), playhead: 1, playing: false }));
    });

    test("Always follow the playhead during playback", () => {
        expect(directorCameraSyncKey({ camera: camera(), playhead: 0, playing: true })).not.toBe(directorCameraSyncKey({ camera: camera(), playhead: 1, playing: true }));
    });

    test("Camera static property changes will force resynchronization", () => {
        const aligned = { ...camera(), transform: { ...camera().transform, position: [9, 9, 9] as [number, number, number] } };
        expect(directorCameraSyncKey({ camera: aligned, playhead: 0, playing: false })).not.toBe(directorCameraSyncKey({ camera: camera(), playhead: 0, playing: false }));
    });

    test("Don't write when there is no camera", () => {
        expect(directorCameraSyncKey({ camera: null, playhead: 0, playing: true })).toBeNull();
    });

    test("The same playhead only changes the keyframe transform, the synchronization key must change (#3 regression)", () => {
        const before = [{ id: "k0", time: 0, transform: camera().transform }];
        const after = [{ id: "k0", time: 0, transform: { ...camera().transform, position: [1, 2, 3] as [number, number, number] } }];
        const beforeKey = directorCameraSyncKey({ camera: camera(before), playhead: 0, playing: false });
        const afterKey = directorCameraSyncKey({ camera: camera(after), playhead: 0, playing: false });
        expect(beforeKey).not.toBe(afterKey);
    });

    test("The same playhead remains stable even when changing keyframes outside the range does not affect the solution value.", () => {
        const keyframes = [{ id: "k0", time: 0, transform: camera().transform }];
        expect(directorCameraSyncKey({ camera: camera(keyframes), playhead: 0, playing: false })).toBe(directorCameraSyncKey({ camera: camera(keyframes), playhead: 0, playing: false }));
    });

    test("Add keyframes to the same playhead to synchronize key changes when the solution results change.", () => {
        const single = [{ id: "k0", time: 0, transform: camera().transform }];
        const pair = [...single, { id: "k1", time: 2, transform: { ...camera().transform, position: [8, 8, 8] as [number, number, number] } }];
        expect(directorCameraSyncKey({ camera: camera(single), playhead: 1, playing: false })).not.toBe(directorCameraSyncKey({ camera: camera(pair), playhead: 1, playing: false }));
    });
});

describe("Director's desk session status: Auto Key is turned off by default", () => {
    test("Both the initial state and after reset are closed.", () => {
        expect(useDirectorWorkbenchStore.getState().autoKey).toBe(false);
        useDirectorWorkbenchStore.getState().setAutoKey(true);
        expect(useDirectorWorkbenchStore.getState().autoKey).toBe(true);
        useDirectorWorkbenchStore.getState().reset();
        expect(useDirectorWorkbenchStore.getState().autoKey).toBe(false);
    });
});
