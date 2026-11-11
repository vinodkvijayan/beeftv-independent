import { expect, test } from "bun:test";

import { restoreDirectorPlaybackOnEnd, waitForDirectorCaptureCamera } from "../src/lib/canvas/director/director-output-camera";

test("Close the recording and return the playback status synchronously. The old recording that is late will not be overwritten by the finally restart session.", () => {
    const controller = new AbortController();
    let state = { playing: false, playhead: 3, viewMode: "free" };
    const initial = state;
    let restores = 0;
    const finish = restoreDirectorPlaybackOnEnd(controller.signal, () => { state = initial; restores++; });
    state = { playing: true, playhead: 0, viewMode: "camera" };
    controller.abort();
    expect(state).toEqual(initial);
    state = { playing: false, playhead: 8, viewMode: "orthographic" };
    finish();
    expect(state.playhead).toBe(8);
    expect(restores).toBe(1);
});

test("The output must wait for the active camera to take over rendering and stabilize for one frame before starting recording.", async () => {
    let camera: "free" | "camera" | null = "free";
    let frames = 0;
    await waitForDirectorCaptureCamera(() => camera, async () => {
        frames += 1;
        if (frames === 2) camera = "camera";
    });
    expect(frames).toBe(3);
});

test("The director's perspective will not be recorded when there is no valid camera position.", async () => {
    let frames = 0;
    await expect(waitForDirectorCaptureCamera(() => "free", async () => { frames += 1; }, 3)).rejects.toThrow("No seats available");
    expect(frames).toBe(3);
});
