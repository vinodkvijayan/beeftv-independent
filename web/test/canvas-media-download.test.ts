import { describe, expect, test } from "bun:test";

import { buildImageGenerationNodeTitle } from "@/lib/canvas/canvas-generation-title";
import { buildCanvasMediaDownloadFileName, canvasMediaFileExtension, mediaFileExtension, sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function mediaNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return {
        id: "image-1",
        type: CanvasNodeType.Image,
        title: "Three views of female star characters",
        position: { x: 0, y: 0 },
        width: 1024,
        height: 1024,
        metadata: { content: "data:image/png;base64,aW1hZ2U=", mimeType: "image/png", status: "success" },
        ...overrides,
    };
}

describe("canvas media download", () => {
    test("Library MIME aliases retain their true format suffix after file name sanitization", () => {
        for (const [mime, extension] of [["video/quicktime", "mov"], ["image/svg+xml", "svg"], ["audio/x-wav", "wav"], ["audio/mpeg", "mp3"], ["audio/mp4", "m4a"], ["image/jpeg; charset=utf-8", "jpg"]]) {
            const name = sanitizeDownloadFileName(`Chinese material.${mediaFileExtension(mime)}`);
            expect(name).toBe(`Chinese material.${extension}`);
        }
        expect(mediaFileExtension("application/octet-stream", "https://example.com/clip.webm?token=hidden")).toBe("webm");
        expect(mediaFileExtension("application/octet-stream", "blob:unknown")).toBeUndefined();
    });

    test("Generate file name based on canvas name, node name and local date", () => {
        expect(buildCanvasMediaDownloadFileName("Love letter to grandma", mediaNode(), new Date(2026, 7, 28, 12))).toBe("Love letter to grandma_Three views of female star characters_20260828.png");
    });

    test("Clean up cross-platform illegal characters and retain Chinese readable names", () => {
        const node = mediaNode({ title: "Female star/role: three views?" });
        expect(buildCanvasMediaDownloadFileName("Love letter to grandma | final draft", node, new Date(2026, 7, 28, 12))).toBe("Love Letter to Grandma_Final Draft_Female Star_Character_Three Views_20260828.png");
    });

    test("Truncating long names does not leave a trailing period that is not accepted by Windows", () => {
        const node = mediaNode({ title: `${"a".repeat(79)}.extra` });
        expect(buildCanvasMediaDownloadFileName("canvas", node, new Date(2026, 7, 28, 12))).toBe(`canvas_${"a".repeat(79)}_20260828.png`);
    });

    test("Prioritize video extensions by media MIME type", () => {
        expect(canvasMediaFileExtension(mediaNode({ type: CanvasNodeType.Video, metadata: { content: "https://example.com/video", mimeType: "video/webm" } }))).toBe("webm");
        expect(canvasMediaFileExtension(mediaNode({ type: CanvasNodeType.Video, metadata: { content: "https://example.com/video", mimeType: "video/quicktime" } }))).toBe("mov");
    });

    test("Identify extension from remote resource URL when MIME type is ambiguous", () => {
        expect(canvasMediaFileExtension(mediaNode({ metadata: { content: "https://example.com/result.jpeg?token=hidden", mimeType: "image/*" } }))).toBe("jpg");
    });

    test("Remove paths and illegal characters from export file names", () => {
        expect(sanitizeDownloadFileName("../role:three-view?.png")).toBe("Role_three views.png");
    });

    test("audio/wave and other WAV aliases download as .wav, do not fall back to mp3", () => {
        const now = new Date(2026, 8, 24, 12);
        for (const mimeType of ["audio/wave", "audio/wav", "audio/x-wav", "audio/vnd.wave"]) {
            const node = mediaNode({
                type: CanvasNodeType.Audio,
                title: "narration",
                metadata: { content: "blob:http://localhost/tts", mimeType, status: "success" },
            });
            expect(canvasMediaFileExtension(node)).toBe("wav");
            expect(buildCanvasMediaDownloadFileName("canvas", node, now)).toBe("canvas_narration_20260924.wav");
        }
    });
});

describe("generated image title", () => {
    test("Ordinary nodes continue to use prompt word summary", () => {
        expect(buildImageGenerationNodeTitle("A future city in the clouds", mediaNode({ title: "Original picture" }))).toBe("A future city in the clouds");
    });

    test("The copy sequence number is retained after the shortcut key copy node is generated.", () => {
        const source = mediaNode({ title: "Future City_copy2", metadata: { copiedFromNodeId: "source" } });
        expect(buildImageGenerationNodeTitle("future city", source)).toBe("Future City_copy2");
    });

    test("Version letters retained after parameter variant generation", () => {
        const source = mediaNode({ title: "Future city·C", metadata: { versionOfNodeId: "source", versionLabel: "C" } });
        expect(buildImageGenerationNodeTitle("future city", source)).toBe("Future city·C");
    });

    test("Copy variants and batch output to use unique titles", () => {
        const source = mediaNode({ title: "Future City_copy1 · B", metadata: { copiedFromNodeId: "source", versionOfNodeId: "source", versionLabel: "B" } });
        expect([0, 1].map((index) => buildImageGenerationNodeTitle("future city", source, index, 2))).toEqual(["Future City_copy1 · B · 1", "Future City_copy1 · B · 2"]);
    });

    test("The downloaded file name inherits the copy and version identifiers and no longer repeats each other.", () => {
        const now = new Date(2026, 7, 29, 12);
        const copy = mediaNode({ title: buildImageGenerationNodeTitle("future city", mediaNode({ title: "Future City_copy1", metadata: { copiedFromNodeId: "source" } })) });
        const variant = mediaNode({ title: buildImageGenerationNodeTitle("future city", mediaNode({ title: "Future city·C", metadata: { versionOfNodeId: "source", versionLabel: "C" } })) });
        expect(buildCanvasMediaDownloadFileName("free canvas", copy, now)).toBe("Free Canvas_Future City_copy1_20260829.png");
        expect(buildCanvasMediaDownloadFileName("free canvas", variant, now)).toBe("Free Canvas_Future City · C_20260829.png");
    });
});
