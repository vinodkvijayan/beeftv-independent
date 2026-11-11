import { expect, test } from "bun:test";

import { selectDirectorRecordingMimeType, waitForDirectorDecodedFrame } from "../src/lib/canvas/director/director-recording-format";

test("The director's desk prioritizes recording H.264 MP4 that can be played on the desktop instead of VP9 WebM", () => {
    const supported = new Set(["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9"]);
    expect(selectDirectorRecordingMimeType((type) => supported.has(type))).toBe("video/mp4;codecs=avc1.42E01E");
});

test("Fallback to available WebM only when the recording environment does not support MP4", () => {
    expect(selectDirectorRecordingMimeType((type) => type === "video/webm;codecs=vp8")).toBe("video/webm;codecs=vp8");
});

test("Only reading the media does not count as a successful export, and you must wait until the first frame that can be decoded.", async () => {
    const video = new EventTarget() as HTMLVideoElement;
    let settled = false;
    const pending = waitForDirectorDecodedFrame(video, 100).then(() => { settled = true; });
    video.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();
    expect(settled).toBe(false);
    video.dispatchEvent(new Event("loadeddata"));
    await pending;
    expect(settled).toBe(true);
});

test("When the media decoding error is reported, the video is refused to be written back as a successful node.", async () => {
    const video = new EventTarget() as HTMLVideoElement;
    const pending = waitForDirectorDecodedFrame(video, 100);
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow("Unable to decode");
});
