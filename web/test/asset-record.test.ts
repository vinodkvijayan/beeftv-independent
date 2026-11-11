import { describe, expect, test } from "bun:test";

import { parseAssetRecord, parseAssetRecordList } from "@/lib/asset-record";

const completeImage = {
    id: "image-1",
    kind: "image",
    title: "full picture",
    coverUrl: "https://example.com/a.png",
    tags: ["role"],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    data: { dataUrl: "https://example.com/a.png", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
};

describe("parseAssetRecord", () => {
    test("accepts a complete image asset", () => {
        expect(parseAssetRecord(completeImage).tags).toEqual(["role"]);
    });

    test("rejects missing or malformed tags", () => {
        expect(() => parseAssetRecord({ ...completeImage, tags: undefined })).toThrow(/tags/);
        expect(() => parseAssetRecord({ ...completeImage, tags: ["role", 1] })).toThrow(/tags/);
    });

    test("rejects incomplete image data instead of filling zeros", () => {
        expect(() => parseAssetRecord({
            ...completeImage,
            data: undefined,
        })).toThrow(/data/);
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { dataUrl: "", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
        })).toThrow(/dataUrl 或 storageKey/);
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { dataUrl: "https://example.com/a.png", width: 0, height: 1, bytes: 1, mimeType: "image/png" },
        })).toThrow(/width/);
    });

    test("rejects wildcard and cross-kind MIME metadata", () => {
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { ...completeImage.data, mimeType: "image/*" },
        })).toThrow(/具体 MIME/);
        expect(() => parseAssetRecord({
            ...completeImage,
            data: { ...completeImage.data, mimeType: "audio/mpeg" },
        })).toThrow(/不匹配/);
        expect(parseAssetRecord({
            ...completeImage,
            data: { ...completeImage.data, mimeType: "application/octet-stream" },
        }).kind).toBe("image");
    });

    test("parseAssetRecordList names the failing record", () => {
        expect(() => parseAssetRecordList([{ ...completeImage, id: "bad", tags: undefined }])).toThrow(/素材 bad/);
    });
});

const completeVideo = {
    id: "video-1",
    kind: "video",
    title: "Generate video",
    coverUrl: "https://example.com/a.mp4",
    tags: ["generate"],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    data: { url: "https://example.com/a.mp4", width: 720, height: 1280, bytes: 1, mimeType: "video/mp4" },
};

describe("parseAssetRecord video size", () => {
    test("The width and height are unknown (0) and released, and the video is stored as usual.", () => {
        const parsed = parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, width: 0, height: 0 } });
        expect(parsed.kind).toBe("video");
        if (parsed.kind === "video") {
            expect(parsed.data.width).toBe(0);
            expect(parsed.data.height).toBe(0);
        }
    });

    test("Negative numbers and illegal values are still rejected", () => {
        expect(() => parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, width: -1 } })).toThrow(/width/);
        expect(() => parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, height: Number.NaN } })).toThrow(/height/);
        expect(() => parseAssetRecord({ ...completeVideo, data: { ...completeVideo.data, width: "720" } })).toThrow(/width/);
    });

    test("Images are not affected: zero size is still rejected", () => {
        expect(() => parseAssetRecord({ ...completeImage, data: { ...completeImage.data, width: 0, height: 1 } })).toThrow(/width/);
    });
});
