import { describe, expect, test } from "bun:test";
import { assetToClipKind, makeClipFromAsset } from "@/lib/timeline/asset-ingest";
import type { ProjectAsset } from "@/services/api/projects";

function makeAsset(overrides: Partial<ProjectAsset>): ProjectAsset {
    return {
        id: "ast-1",
        title: "Demo Video",
        mediaType: "video",
        category: "video",
        status: "ready",
        versionCount: 1,
        usages: [],
        position: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        storageKey: "assets/ast-1/master.mp4",
        ...overrides,
    };
}

describe("assetToClipKind", () => {
    test("Mapping video/audio/image/text", () => {
        expect(assetToClipKind("video")).toBe("video");
        expect(assetToClipKind("audio")).toBe("audio");
        expect(assetToClipKind("image")).toBe("image");
        expect(assetToClipKind("text")).toBe("text");
    });

    test("Unknown media type returns null", () => {
        expect(assetToClipKind("archive")).toBeNull();
        expect(assetToClipKind("")).toBeNull();
    });
});

describe("makeClipFromAsset", () => {
    const options = { trackId: "track-video-1", startMs: 12_000, id: "asset:ast-1:1" };

    test("Generate video clip and directMedia reference assets", () => {
        const clip = makeClipFromAsset(makeAsset({}), options);
        expect(clip).not.toBeNull();
        expect(clip).toMatchObject({
            id: "asset:ast-1:1",
            kind: "video",
            nodeId: "asset:ast-1",
            trackId: "track-video-1",
            startMs: 12_000,
            durationMs: 3_000,
            title: "Demo Video",
            directMedia: {
                id: "ast-1",
                kind: "video",
                title: "Demo Video",
                storageKey: "assets/ast-1/master.mp4",
            },
        });
    });

    test("Default duration can be overridden", () => {
        const clip = makeClipFromAsset(makeAsset({}), { ...options, defaultDurationMs: 500 });
        expect(clip?.durationMs).toBe(500);
    });

    test("Use asset prefix when there is no id", () => {
        const clip = makeClipFromAsset(makeAsset({}), { trackId: options.trackId, startMs: 0 });
        expect(clip?.id).toBe("asset:ast-1");
    });

    test("audio assets map to audio kind", () => {
        const clip = makeClipFromAsset(makeAsset({ mediaType: "audio", category: "audio" }), options);
        expect(clip?.kind).toBe("audio");
        expect(clip?.directMedia?.kind).toBe("audio");
    });

    test("text is out of bounds with an unknown media type", () => {
        expect(makeClipFromAsset(makeAsset({ mediaType: "text" }), options)).toBeNull();
        expect(makeClipFromAsset(makeAsset({ mediaType: "script" }), options)).toBeNull();
    });

    test("Input assets are not modified", () => {
        const asset = makeAsset({});
        const before = JSON.stringify(asset);
        makeClipFromAsset(asset, options);
        expect(JSON.stringify(asset)).toBe(before);
    });
});
