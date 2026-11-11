import { describe, expect, test } from "bun:test";

import { buildVideoFrameNodes } from "../src/lib/canvas/canvas-video-frame-nodes";
import { captureVideoFrames, normalizeVideoFrameTimes, resolveVideoFramePresetTimeMs, videoFrameFetchCredentials, videoFrameSeekSeconds, waitForPresentedVideoFrame } from "../src/lib/canvas/canvas-video-frame";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const sourceNode: CanvasNodeData = {
    id: "video-source",
    type: CanvasNodeType.Video,
    title: "Test video",
    position: { x: 100, y: 200 },
    width: 640,
    height: 360,
    metadata: { workflowKind: "shot", workflowTitle: "Shot 1", shotIndex: 1 },
};

describe("normalizeVideoFrameTimes", () => {
    test("Sort by time, deduplicate and limit to decodable range", () => {
        expect(normalizeVideoFrameTimes([1500, 0, 1500.4, -20, 16000, Number.NaN], 15000)).toEqual([0, 1500, 14900]);
    });

    test("The time point will not be returned when the video duration is invalid.", () => {
        expect(normalizeVideoFrameTimes([0, 1000], 0)).toEqual([]);
    });

    test("When the video duration is not recorded in advance, the end frame preset will automatically align to the real end frame after the video is decoded.", () => {
        const presetTimeMs = resolveVideoFramePresetTimeMs("last", 0, 0);
        expect(presetTimeMs).toBe(Number.MAX_SAFE_INTEGER);
        expect(normalizeVideoFrameTimes([presetTimeMs], 8000)).toEqual([7900]);
    });
});

describe("resolveVideoFramePresetTimeMs & videoFrameFetchCredentials", () => {
    test("Supports calculation of first frame, current frame and last frame of known/unknown duration", () => {
        expect(resolveVideoFramePresetTimeMs("first", 6000, 2300)).toBe(0);
        expect(resolveVideoFramePresetTimeMs("current", 6000, 2300)).toBe(2300);
        expect(resolveVideoFramePresetTimeMs("last", 6000, 2300)).toBe(5999);
        expect(resolveVideoFramePresetTimeMs("last", 0, 0)).toBe(Number.MAX_SAFE_INTEGER);
    });

    test("Credential policies that distinguish protected resource paths from cross-origin CDN direct links", () => {
        expect(videoFrameFetchCredentials("/api/resources/res-123/file")).toBe("include");
        expect(videoFrameFetchCredentials("http://127.0.0.1:8080/api/resources/res-123/file")).toBe("include");
        expect(videoFrameFetchCredentials("blob:http://localhost:5173/abc")).toBe("same-origin");
    });
});

describe("videoFrameSeekSeconds", () => {
    test("The first frame is also forced to seek to the decodable time point to prevent the cached video from drawing a black frame at 0ms.", () => {
        expect(videoFrameSeekSeconds(0, 6000)).toBe(0.001);
        expect(videoFrameSeekSeconds(1500, 6000)).toBe(1.5);
        expect(videoFrameSeekSeconds(14900, 15000)).toBe(14.9);
    });
});

describe("waitForPresentedVideoFrame", () => {
    test("Do not allow drawing to continue before requestVideoFrameCallback is triggered.", async () => {
        let callback: (() => void) | undefined;
        let resolved = false;
        const video = {
            requestVideoFrameCallback: (next: () => void) => {
                callback = next;
                return 1;
            },
            play: async () => undefined,
            pause: () => undefined,
        } as unknown as HTMLVideoElement;

        const presented = waitForPresentedVideoFrame(video, 1000).then(() => { resolved = true; });
        await Promise.resolve();
        expect(resolved).toBe(false);
        callback?.();
        await presented;
        expect(resolved).toBe(true);
    });

    test("Actively decode and play when taking frames, and pause after the video frames are actually presented.", async () => {
        const calls: string[] = [];
        let callback: (() => void) | undefined;
        const video = {
            requestVideoFrameCallback: (next: () => void) => {
                callback = next;
                return 1;
            },
            cancelVideoFrameCallback: () => calls.push("cancel-frame"),
            play: async () => {
                calls.push("play");
                callback?.();
            },
            pause: () => calls.push("pause"),
        } as unknown as HTMLVideoElement;

        await waitForPresentedVideoFrame(video, 1000);

        expect(calls).toEqual(["play", "pause"]);
    });

    test("Fails when the video does not actually render the frame, and does not save the undecoded black frame as the result", async () => {
        const video = {
            requestVideoFrameCallback: () => 1,
            cancelVideoFrameCallback: () => undefined,
            play: async () => undefined,
            pause: () => undefined,
        } as unknown as HTMLVideoElement;

        await expect(waitForPresentedVideoFrame(video, 1)).rejects.toThrow("Video picture decoding timeout");
    });

    test("When seek reaches near the last frame, it waits for the actually rendered video frame, without relying on the black screen after ended.", async () => {
        const events = new EventTarget();
        let paused = false;
        let framePresented = false;
        const video = {
            duration: 14,
            currentTime: 13.9,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            requestVideoFrameCallback: (callback: () => void) => {
                queueMicrotask(() => {
                    framePresented = true;
                    callback();
                });
                return 1;
            },
            play: async () => {
                queueMicrotask(() => events.dispatchEvent(new Event("ended")));
            },
            pause: () => { paused = true; },
        } as unknown as HTMLVideoElement;

        await waitForPresentedVideoFrame(video, 100);

        expect(paused).toBe(true);
        expect(framePresented).toBe(true);
    });

    test("When the playback directly triggers ended after seeking to the last frame and there is no subsequent new frame, if the picture has been decoded, the frame fetching is completed.", async () => {
        const events = new EventTarget();
        let paused = false;
        const video = {
            duration: 15,
            currentTime: 14.9,
            readyState: 2,
            videoWidth: 1280,
            videoHeight: 720,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            requestVideoFrameCallback: () => 1,
            cancelVideoFrameCallback: () => undefined,
            play: async () => {
                queueMicrotask(() => events.dispatchEvent(new Event("ended")));
            },
            pause: () => { paused = true; },
        } as unknown as HTMLVideoElement;

        await waitForPresentedVideoFrame(video, 100);

        expect(paused).toBe(true);
    });

    test("If the playback of the decoded video advances but does not trigger the rendering callback or ended, the scene at the offset time point will not be regarded as successful.", async () => {
        const events = new EventTarget();
        const video = {
            duration: 15,
            currentTime: 2.0,
            readyState: 2,
            videoWidth: 1280,
            videoHeight: 720,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            requestVideoFrameCallback: () => 1,
            cancelVideoFrameCallback: () => undefined,
            play: async () => {
                video.currentTime = 3.5;
            },
            pause: () => undefined,
        } as unknown as HTMLVideoElement;

        await expect(waitForPresentedVideoFrame(video, 5)).rejects.toThrow("Video picture decoding timeout");
    });

    test("At non-last frame time points (such as 1s from the end), when the presentation callback is not triggered, even if the playback reaches ended, the last frame will not be pretended to be the target frame.", async () => {
        const events = new EventTarget();
        const video = {
            duration: 10,
            currentTime: 9.0,
            readyState: 2,
            videoWidth: 1280,
            videoHeight: 720,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            requestVideoFrameCallback: () => 1,
            cancelVideoFrameCallback: () => undefined,
            play: async () => {
                video.currentTime = 10;
                queueMicrotask(() => events.dispatchEvent(new Event("ended")));
            },
            pause: () => undefined,
        } as unknown as HTMLVideoElement;

        await expect(waitForPresentedVideoFrame(video, 20)).rejects.toThrow("Video picture decoding timeout");
    });
});

describe("captureVideoFrames", () => {
    test("Ignore old mediaTime callbacks when capturing multiple time points in succession and remove temporary nodes after the end", async () => {
        const originalDocument = globalThis.document;
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;

        const appendedNodes: unknown[] = [];
        let removedCount = 0;
        let revokedUrl = "";
        const drawnTimes: number[] = [];
        const events = new EventTarget();

        let currentTime = 0;
        let nextHandle = 1;
        let latestCallback: ((now: number, meta: { mediaTime: number }) => void) | undefined;

        const fakeVideo = {
            muted: false,
            playsInline: false,
            preload: "",
            src: "",
            style: {} as Record<string, string>,
            duration: 5,
            readyState: 2,
            videoWidth: 640,
            videoHeight: 360,
            get currentTime() {
                return currentTime;
            },
            set currentTime(val: number) {
                if (val > 1) {
                    // Simulate stale queued callback from previous frame firing before seek completes
                    latestCallback?.(16, { mediaTime: 0.001 });
                }
                currentTime = val;
                queueMicrotask(() => {
                    if (val < 1) {
                        latestCallback?.(16, { mediaTime: val });
                    }
                    events.dispatchEvent(new Event("seeked"));
                });
            },
            load: () => {
                if (fakeVideo.src) {
                    queueMicrotask(() => events.dispatchEvent(new Event("loadeddata")));
                }
            },
            play: async () => {
                queueMicrotask(() => latestCallback?.(32, { mediaTime: currentTime }));
            },
            pause: () => undefined,
            removeAttribute: () => { fakeVideo.src = ""; },
            remove: () => { removedCount += 1; },
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            requestVideoFrameCallback: (cb: (now: number, meta: { mediaTime: number }) => void) => {
                latestCallback = cb;
                return nextHandle++;
            },
            cancelVideoFrameCallback: () => undefined,
        };

        const fakeCanvas = {
            width: 0,
            height: 0,
            getContext: () => ({
                drawImage: () => {
                    drawnTimes.push(currentTime);
                },
            }),
            toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob(["png"], { type: "image/png" })),
        };

        URL.createObjectURL = () => "blob:test-video";
        URL.revokeObjectURL = (url: string) => { revokedUrl = url; };
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                body: {
                    appendChild: (node: unknown) => appendedNodes.push(node),
                },
                createElement: (tag: string) => (tag === "video" ? fakeVideo : fakeCanvas),
            },
        });

        try {
            const result = await captureVideoFrames(new Blob(["mp4"], { type: "video/mp4" }), [0, 2000]);
            expect(result.failures).toEqual([]);
            expect(result.frames.map((f) => f.timeMs)).toEqual([0, 2000]);
            expect(drawnTimes).toEqual([0.001, 2]);
            expect(appendedNodes).toHaveLength(1);
            expect(removedCount).toBe(1);
            expect(revokedUrl).toBe("blob:test-video");
        } finally {
            Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
        }
    });
});

describe("buildVideoFrameNodes", () => {
    test("Create traceable image nodes for each time point and maintain a grid layout", () => {
        const nodes = buildVideoFrameNodes(sourceNode, [
            { timeMs: 0, image: { url: "blob:first", storageKey: "image:first", width: 1280, height: 720, bytes: 10, mimeType: "image/png" } },
            { timeMs: 1500, image: { url: "blob:middle", storageKey: "image:middle", width: 1280, height: 720, bytes: 20, mimeType: "image/png" } },
            { timeMs: 14999, image: { url: "blob:last", storageKey: "image:last", width: 1280, height: 720, bytes: 30, mimeType: "image/png" } },
        ]);

        expect(nodes).toHaveLength(3);
        expect(nodes.every((node) => node.type === CanvasNodeType.Image && node.title.startsWith("screenshot"))).toBe(true);
        expect(new Set(nodes.map((node) => node.id)).size).toBe(3);
        expect(nodes.map((node) => node.metadata?.videoFrameTimeMs)).toEqual([0, 1500, 14999]);
        expect(nodes.every((node) => node.metadata?.videoFrameSourceNodeId === sourceNode.id)).toBe(true);
        expect(nodes.every((node) => node.metadata?.workflowKind === "shot" && node.metadata?.shotIndex === 1)).toBe(true);
        expect(nodes[0].position.x).toBe(sourceNode.position.x + sourceNode.width + 96);
        expect(nodes[1].position.x).toBeGreaterThan(nodes[0].position.x);
        expect(nodes[2].position.y).toBeGreaterThan(nodes[0].position.y);
    });

    test("When repeatedly capturing the same video, the new results will be placed in addition to the existing results.", () => {
        const frame = { timeMs: 0, image: { url: "blob:first", storageKey: "image:first", width: 1280, height: 720, bytes: 10, mimeType: "image/png" } };
        const first = buildVideoFrameNodes(sourceNode, [frame]);
        const second = buildVideoFrameNodes(sourceNode, [frame], [sourceNode, ...first]);

        const firstRight = first[0].position.x + first[0].width;
        const firstBottom = first[0].position.y + first[0].height;
        const secondRight = second[0].position.x + second[0].width;
        const secondBottom = second[0].position.y + second[0].height;
        const separated = second[0].position.x >= firstRight
            || secondRight <= first[0].position.x
            || second[0].position.y >= firstBottom
            || secondBottom <= first[0].position.y;

        expect(separated).toBe(true);
    });
});
