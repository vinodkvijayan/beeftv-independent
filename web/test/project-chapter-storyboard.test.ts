import { describe, expect, test } from "bun:test";

import {
    chapterStoryboardAssets,
    chapterStoryboardCharacters,
    chapterStoryboardReplaceImpact,
    storyboardRowsToProjectShots,
} from "@/pages/projects/detail/chapter-storyboard-production";
import type { ProjectDetail } from "@/services/api/projects";
import type { StoryboardRow } from "@/types/canvas";

describe("Chapter storyboard writing and storyboard production", () => {
    test("Completely map storyboard task results into shot scripts", () => {
        const shots = storyboardRowsToProjectShots([storyboardRow()], projectDetail());

        expect(shots).toHaveLength(1);
        expect(shots[0]).toMatchObject({
            title: "Shot 01",
            description: "Lin Mo pushed the door open and entered the old house on a rainy night.",
            durationMs: 5000,
            revision: {
                plotDescription: "Lin Mo pushed the door open and entered the old house on a rainy night.",
                dialogue: "Lin Mo: Is there anyone?",
                shotSize: "medium shot",
                cameraAngle: "Head-up, 35mm",
                cameraMovement: "advance slowly",
                imagePrompt: "Lin Mo in the old house on a rainy night",
                videoPrompt: "Lin Mo pushed the door open and the camera slowly advanced\n\n【Character Reference】\nLin Mo: @[asset:character-1]\n\n[Scene and prop reference]\nOld envelope: @[asset:prop-1]",
                continuityNotes: "Lin Mo stopped inside the door, still holding the doorknob with his right hand.",
                actionBeats: [{ description: "0-2 seconds to push the door; 2-5 seconds to look around" }],
            },
        });
        expect(shots[0].assetVersionIds).toEqual(expect.arrayContaining(["asset-version-1", "asset-version-2"]));
        expect(shots[0].revision.action).toContain("Performance Scheduling: Lin Mo opened the door cautiously and looked around the room");
        expect(shots[0].revision.action).toContain("Sound: the sound of rain and the friction of wooden doors");
    });

    test("Submit confirmed characters and unconfirmed characters in this chapter to storyboard tasks", () => {
        const detail = projectDetail();

        expect(chapterStoryboardCharacters(detail, "chapter-1")).toEqual([
            { assetId: "character-1", versionId: "character-version-1", name: "Lin Mo", definition: { appearance: "Black trench coat" } },
            { name: "Zhang Tianhao", definition: { role: "Protagonist" } },
        ]);
        expect(chapterStoryboardAssets(detail).map((asset) => ({ id: asset.id, type: asset.type, characterVersionId: asset.characterVersionId }))).toEqual([
            { id: "character-1", type: "character", characterVersionId: "character-version-1" },
            { id: "prop-1", type: "image", characterVersionId: undefined },
        ]);
    });

    test("Replacement confirmation statistics related data that will be deleted in this chapter", () => {
        expect(chapterStoryboardReplaceImpact(projectDetail(), "chapter-1")).toEqual({
            shotCount: 1,
            revisionCount: 1,
            referenceCount: 1,
            artifactCount: 1,
            candidateCount: 1,
        });
    });
});

function storyboardRow(): StoryboardRow {
    return {
        id: "row-1", shotNumber: 1, durationSeconds: 5,
        plotDescription: "Lin Mo pushed the door open and entered the old house on a rainy night.", dialogue: "Lin Mo: Is there anyone?", characters: [{ characterName: "Lin Mo", characterAssetId: "character-1", characterVersionId: "character-version-1" }],
        narrativeIntent: "build suspense", viewerPOV: "Follow Lin Mo", performanceBlocking: "Lin Mo opened the door cautiously and looked around the room",
        shotSize: "medium shot", emotion: "Be alert", lightingAndAtmosphere: "The intersection of cool moonlight and indoor warm light", audioEffects: "The sound of rain and the friction of wooden doors",
        camera: "Head-up, 35mm", motion: "advance slowly", timeBeats: "0-2 seconds to push the door; 2-5 seconds to look around",
        imageGenerationPrompt: "Lin Mo in the old house on a rainy night", videoMotionPrompt: "Lin Mo pushed the door open and the camera slowly advanced",
        mustHave: [], optionalDetails: [], continuityOut: "Lin Mo stopped inside the door, still holding the doorknob with his right hand.", negativePrompt: "Screen text", assetBindings: [{ nodeId: "prop-1", role: "prop", priority: 80 }],
    };
}

function projectDetail(): ProjectDetail {
    return {
        project: { id: "project-1", userId: "user-1", name: "rainy night", type: "short_drama", aspectRatio: "16:9", sourceType: "novel", description: "", stylePresetId: "urban-live-action", status: "active", revision: 1, createdAt: "", updatedAt: "" },
        units: [], canvases: [], canvasUnitLinks: [], assetFolders: [], workflows: [],
        assets: [
            { id: "character-1", title: "Lin Mo", mediaType: "image", category: "character", status: "ready", primaryVersionId: "asset-version-1", versionCount: 1, usages: [], position: 0, updatedAt: "", character: { versionId: "character-version-1", version: 1, definition: { appearance: "Black trench coat" }, representations: [], visualStatus: "ready", voiceStatus: "missing" } },
            { id: "prop-1", title: "old envelope", mediaType: "image", category: "prop", status: "ready", primaryVersionId: "asset-version-2", versionCount: 1, usages: [], position: 1, previewText: "yellowed old envelope", updatedAt: "" },
            { id: "draft-prop", title: "Unfinished props", mediaType: "image", category: "prop", status: "draft", versionCount: 0, usages: [], position: 2, updatedAt: "" },
        ],
        shots: [{ id: "shot-1", projectId: "project-1", unitId: "chapter-1", currentRevisionId: "revision-1", title: "SC.01", description: "old storyboard", position: 0, durationMs: 3000, status: "draft", createdAt: "", updatedAt: "" }],
        shotRevisions: [{ id: "revision-1", shotId: "shot-1", version: 1, plotDescription: "old storyboard", action: "", dialogue: "", shotSize: "", cameraAngle: "", cameraMovement: "", durationMs: 3000, imagePrompt: "", videoPrompt: "", negativePrompt: "", continuityNotes: "", actionBeatsJson: "[]", createdAt: "" }],
        shotArtifacts: [{ id: "artifact-1", projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", type: "storyboard", version: 1, status: "ready", selected: true, metadataJson: "{}", createdAt: "", updatedAt: "" }],
        shotReferences: [{ id: "reference-1", shotId: "shot-1", assetVersionId: "asset-version-1", role: "reference", status: "linked", createdAt: "" }],
        assetCandidates: [
            { id: "candidate-1", projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", name: "umbrella", category: "prop", status: "pending_confirmation", detailsJson: "{}", createdAt: "", updatedAt: "" },
            { id: "candidate-character-1", projectId: "project-1", unitId: "chapter-1", name: "Zhang Tianhao", category: "character", status: "pending_confirmation", detailsJson: JSON.stringify({ role: "Protagonist" }), createdAt: "", updatedAt: "" },
            { id: "candidate-character-other", projectId: "project-1", unitId: "chapter-2", name: "Another chapter character", category: "character", status: "pending_confirmation", detailsJson: "{}", createdAt: "", updatedAt: "" },
        ],
    };
}
