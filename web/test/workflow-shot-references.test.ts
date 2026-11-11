import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, resolveShotAssetMentionPrompt } from "@/pages/projects/detail/workflow-shot-references";

describe("workflow shot asset references", () => {
    test("builds ordered image references for bound media and characters", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(context.mentionReferences.map((reference) => reference.label)).toEqual(["rainy night street", "Lin Mo"]);
        expect(context.referenceImages.map((image) => image.id)).toEqual(["asset-scene", "asset-character"]);
        expect(context.referenceImages[1]?.storageKey).toBe("resource:character-cover");
    });

    test("resolves asset tokens to the submitted reference image order", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const [scene, character] = context.mentionReferences;
        const prompt = `let${canvasResourceMentionToken(character)} from${canvasResourceMentionToken(scene)} Get closer to the camera`;

        expect(resolveShotAssetMentionPrompt(prompt, context)).toContain("Let Picture 2 move closer to the camera from Picture 1");
    });

    test("rejects stale mentions after an asset is unbound", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(() => resolveShotAssetMentionPrompt("Follow @[asset:missing]", context)).toThrow("Not bound to current shot");
    });

    test("adds bound assets as editable mention tokens without duplicating existing mentions", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("Let @[asset:asset-character] come closer to the camera", context.mentionReferences);

        expect(prompt).toContain("@[asset:asset-character]");
        expect(prompt.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
        expect(prompt).toContain("[Scene and prop reference]\nRainy Night Street: @[asset:asset-scene]");
    });
});

function detail(): ProjectDetail {
    const scene = {
        id: "asset-scene",
        title: "rainy night street",
        mediaType: "image",
        category: "environment",
        status: "confirmed",
        primaryVersionId: "version-scene",
        versionCount: 1,
        usages: [],
        position: 0,
        storageKey: "resource:scene-image",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    const character = {
        id: "asset-character",
        title: "Lin Mo",
        mediaType: "entity",
        category: "character",
        status: "confirmed",
        primaryVersionId: "version-character",
        versionCount: 1,
        usages: [],
        position: 1,
        updatedAt: "2026-08-29T00:00:00Z",
        character: {
            versionId: "version-character",
            version: 1,
            definition: {},
            representations: [{ id: "representation-1", resourceId: "character-cover", mediaType: "image", role: "primary" }],
            visualStatus: "ready",
            voiceStatus: "missing",
        },
    } satisfies ProjectAsset;
    const audio = {
        id: "asset-audio",
        title: "sound of rain",
        mediaType: "audio",
        category: "other",
        status: "confirmed",
        primaryVersionId: "version-audio",
        versionCount: 1,
        usages: [],
        position: 2,
        storageKey: "resource:rain-audio",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    return {
        assets: [scene, character, audio],
        shotReferences: [
            { id: "reference-scene", shotId: "shot-1", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:00Z" },
            { id: "reference-character", shotId: "shot-1", assetVersionId: "version-character", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:01Z" },
            { id: "reference-audio", shotId: "shot-1", assetVersionId: "version-audio", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:02Z" },
            { id: "reference-other-shot", shotId: "shot-2", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:03Z" },
        ],
    } as ProjectDetail;
}
