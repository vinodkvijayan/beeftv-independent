import { describe, expect, test } from "bun:test";

import { localTaskHistoryFromProjects } from "../src/lib/local-task-history";
import { CanvasNodeType } from "../src/types/canvas";

describe("local task history", () => {
    test("derives a completed local task from a persisted canvas node", () => {
        const tasks = localTaskHistoryFromProjects([
            {
                id: "canvas-1",
                title: "local canvas",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:01:00.000Z",
                nodes: [{
                    id: "node-1",
                    type: CanvasNodeType.Image,
                    title: "mountain shots",
                    position: { x: 0, y: 0 },
                    width: 320,
                    height: 240,
                    metadata: { prompt: "Generate mountain shots", status: "success", content: "data:image/png;base64,local", taskCompletedAt: "2026-01-01T00:01:00.000Z" },
                }],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "dots",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
                directorScenes: [],
            },
        ]);

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ id: "local:canvas-1:node-1", status: "succeeded", type: "canvas_image", projectId: "canvas-1", previewKind: "image" });
    });

    test("keeps owned resource ids on image, video, and audio history payloads", () => {
        const resourceUrl = "http://127.0.0.1:3184/api/resources/audio-owned/file";
        const tasks = localTaskHistoryFromProjects([
            {
                id: "7vvfM674HnenwTekmj88V",
                title: "audio canvas",
                createdAt: "2026-09-24T00:00:00.000Z",
                updatedAt: "2026-09-24T00:01:00.000Z",
                nodes: [
                    {
                        id: "audio-1",
                        type: CanvasNodeType.Audio,
                        title: "Historical audio",
                        position: { x: 0, y: 0 },
                        width: 320,
                        height: 320,
                        metadata: { prompt: "a narration", status: "success", content: resourceUrl, storageKey: "resource:audio-owned", mimeType: "audio/mpeg", bytes: 4096, durationMs: 5600, taskId: "task-audio" },
                    },
                    {
                        id: "video-1",
                        type: CanvasNodeType.Video,
                        title: "historical video",
                        position: { x: 0, y: 0 },
                        width: 720,
                        height: 405,
                        metadata: { prompt: "a shot", status: "success", content: "http://127.0.0.1:3184/api/resources/video-owned/file", storageKey: "resource:video-owned", mimeType: "video/mp4", bytes: 8192 },
                    },
                    {
                        id: "image-1",
                        type: CanvasNodeType.Image,
                        title: "historical pictures",
                        position: { x: 0, y: 0 },
                        width: 720,
                        height: 405,
                        metadata: { prompt: "a still frame", status: "success", content: "http://127.0.0.1:3184/api/resources/image-owned/file", storageKey: "resource:image-owned", mimeType: "image/png", bytes: 2048 },
                    },
                ],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "dots",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
                directorScenes: [],
            },
        ]);

        const audio = JSON.parse(tasks.find((task) => task.type === "canvas_audio")?.resultJson || "{}");
        const video = JSON.parse(tasks.find((task) => task.type === "canvas_video")?.resultJson || "{}");
        const image = JSON.parse(tasks.find((task) => task.type === "canvas_image")?.resultJson || "{}");
        expect(audio.audio).toMatchObject({ storageKey: "resource:audio-owned", url: resourceUrl, dataUrl: resourceUrl });
        expect(video.video).toMatchObject({ storageKey: "resource:video-owned" });
        expect(image.images[0]).toMatchObject({ storageKey: "resource:image-owned" });
    });
});
