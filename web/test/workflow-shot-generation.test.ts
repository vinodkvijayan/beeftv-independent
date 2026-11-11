import { expect, spyOn, test } from "bun:test";

import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import { submitBackendGenerationTask, type GenerationTaskDependencies } from "../src/services/api/generation-task";
import type { GenerationTask } from "../src/services/api/task-center";
import type { ProjectDetail } from "../src/services/api/projects";
import { buildShotAssetReferenceContext, resolveShotAssetMentionPrompt } from "../src/pages/projects/detail/workflow-shot-references";
import * as resources from "../src/services/api/resources";
import * as storage from "../src/services/file-storage";

function videoTaskConfig() {
    const channel = createModelChannel({
        id: "minimax",
        name: "MiniMax",
        baseUrl: "https://api.minimaxi.com",
        apiKey: "test-key",
        interfaceType: "minimax-video",
        models: ["MiniMax-H3"],
        modelProfiles: [{ model: "MiniMax-H3", capability: "video", protocol: "minimax-video", billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "MiniMax-H3");
    return { ...defaultConfig, channels: [channel], model, videoModel: model };
}

test("production workbench does not silently drop bound voice samples before backend validation", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();

    expect(source).toContain('const generationReferenceAudios = generationCapability === "video" ? shotAssetReferenceContext.referenceAudios : [];');
    expect(source).not.toContain("selectedVideoProfile?.references.maxAudios");
});

test("shot generation submits historical character image, current voice and asset prompt", async () => {
    const detail = {
        assets: [
            {
                id: "character-1",
                title: "Zhang Tianhao",
                category: "character",
                mediaType: "image",
                primaryVersionId: "character-version-2",
                character: {
                    versionId: "character-version-2",
                    definition: { voiceLanguage: "mandarin", voiceAge: "young male", voiceTimbre: "Slightly tired and shocked" },
                    representations: [{ id: "representation-1", resourceId: "character-image-1", mediaType: "image/png", role: "primary" }],
                    voice: { profile: { sampleResourceId: "character-audio-1", language: "mandarin", timbre: "Calm" }, instructions: "inner monologue tone" },
                },
            },
            {
                id: "scene-1",
                title: "Scene at the bottom of the pit",
                category: "environment",
                mediaType: "image",
                primaryVersionId: "scene-version-1",
                storageKey: "resource:scene-image-1",
            },
        ],
        shotReferences: [
            {
                shotId: "shot-1",
                assetVersionId: "character-version-1",
                status: "linked",
                asset: {
                    id: "character-1",
                    title: "Zhang Tianhao",
                    category: "character",
                    mediaType: "entity",
                    primaryVersionId: "character-version-2",
                    character: {
                        versionId: "character-version-2",
                        definition: { voiceLanguage: "mandarin", voiceAge: "young male", voiceTimbre: "Slightly tired and shocked" },
                        representations: [{ id: "representation-2", resourceId: "character-image-2", mediaType: "image/png", role: "primary" }],
                        voice: { profile: { sampleResourceId: "character-audio-1", language: "mandarin", timbre: "Calm" }, instructions: "inner monologue tone" },
                    },
                },
                referencedVersion: {
                    id: "character-version-1",
                    assetId: "character-1",
                    version: 1,
                    representations: [{ id: "representation-1", resourceId: "character-image-1", mediaType: "image/png", role: "primary" }],
                },
            },
            { shotId: "shot-1", assetVersionId: "scene-version-1", status: "linked" },
        ],
    } as ProjectDetail;

    const context = buildShotAssetReferenceContext(detail, "shot-1");
    const prompt = resolveShotAssetMentionPrompt("Zhang Tianhao opens his eyes @[asset:scene-1]", context, { dialogue: "Have I traveled through time? The good-for-nothing young master of the Zhang family in Wasi country?" });

    expect(context.referenceImages).toHaveLength(2);
    expect(context.referenceImages[0]?.storageKey).toBe("resource:character-image-1");
    expect(context.referenceAudios).toHaveLength(1);
    expect(context.referenceAudios[0]?.storageKey).toBe("resource:character-audio-1");
    expect(context.resolvedCharacterVersions).toEqual([{ assetId: "character-1", versionId: "character-version-1" }]);
    expect(prompt).toContain("Zhang Tianhao in Picture 2 Open your eyes");
    expect(prompt).toContain("- Zhang Tianhao: Character reference: Picture 1; Sound reference: Audio 1");
    expect(prompt).toContain("Voice portrait: Mandarin; young male; slightly tired and shocked; inner monologue tone");
    expect(prompt).toContain("Scene lines: Have I traveled through time? The good-for-nothing young master of the Zhang family in Wasi country?");
    expect(prompt).toContain("- Scene at the bottom of the pit: Scene reference: Picture 2");

    let createdInput: Parameters<GenerationTaskDependencies["createTask"]>[0] | undefined;
    const task = {
        id: "shot-task-1",
        type: "canvas_video",
        status: "queued",
        prompt,
        attempts: 0,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
    } satisfies GenerationTask;
    // Task creation is already a fixture boundary; resource metadata must also
    // come from its API fixture rather than the test runner's browser storage.
    const resourceMetadata = spyOn(resources, "getResource").mockResolvedValue({ id: "character-audio-1", durationMs: 2500, mimeType: "audio/mpeg" } as resources.RemoteResource);
    const browserBlob = spyOn(storage, "getMediaBlob").mockRejectedValue(new Error("known resource metadata must not read browser media"));
    try {
        await submitBackendGenerationTask({
            projectId: "project-1",
            mode: "video",
            prompt,
            config: videoTaskConfig(),
            referenceImages: context.referenceImages,
            referenceAudios: context.referenceAudios,
            metadata: { shotId: "shot-1", videoEditOperation: "reference_to_video" },
        }, {
            createTask: async (input) => { createdInput = input; return task; },
            waitTask: async () => { throw new Error("should not wait"); },
            runLocal: async () => ({ mode: "video" }),
            createId: () => "id-1",
            now: () => "2026-08-30T00:00:00.000Z",
        });
        expect(resourceMetadata).toHaveBeenCalledWith("character-audio-1", expect.objectContaining({ params: { metadata: "ensure" } }));
        expect(browserBlob).not.toHaveBeenCalled();
    } finally {
        resourceMetadata.mockRestore();
        browserBlob.mockRestore();
    }

    expect(createdInput?.prompt).toContain("【Asset Reference】");
    expect(createdInput?.input.referenceImages.map((reference) => reference.storageKey)).toEqual(["resource:character-image-1", "resource:scene-image-1"]);
    expect(createdInput?.input.referenceAudios.map((reference) => reference.storageKey)).toEqual(["resource:character-audio-1"]);
    expect(createdInput?.input.referenceAudios[0]?.durationMs).toBe(2500);
});

test("background generation submission returns after task creation without waiting", async () => {
    let waitCalls = 0;
    const task = {
        id: "task-1",
        type: "canvas_video",
        status: "queued",
        prompt: "role play",
        attempts: 0,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
    } satisfies GenerationTask;
    const dependencies: GenerationTaskDependencies = {
        createTask: async () => task,
        waitTask: async () => {
            waitCalls += 1;
            throw new Error("should not wait");
        },
        runLocal: async () => ({ mode: "video" }),
        createId: () => "id-1",
        now: () => "2026-08-30T00:00:00.000Z",
    };

    const submitted = await submitBackendGenerationTask({
        projectId: "project-1",
        mode: "video",
        prompt: "role play",
        config: videoTaskConfig(),
        metadata: { shotId: "shot-1", videoEditOperation: "reference_to_video" },
    }, dependencies);

    expect(submitted).toBe(task);
    expect(waitCalls).toBe(0);
});
