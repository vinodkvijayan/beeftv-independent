import { describe, expect, test } from "bun:test";

import { listVideoReferenceModels, validateVideoSegmentBatch, videoReferenceOperationError, videoReferenceRegenerationError, videoReferenceSegmentError } from "../src/lib/canvas/canvas-video-regeneration";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { defaultConfig, type AiConfig, type ModelChannel } from "../src/stores/use-config-store";

function supportedVideoConfig(overrides: { model?: string; maxVideos?: number; maxVideoDurationSeconds?: number; operations?: string[]; baseUrl?: string } = {}): AiConfig {
    const model = overrides.model || "seedance-1.0-pro";
    const capability = defaultModelCapabilityConfig("newapi-channel-2", model);
    if (capability.video) {
        capability.video.references.maxVideos = overrides.maxVideos ?? 3;
        capability.video.references.maxVideoDurationSeconds = overrides.maxVideoDurationSeconds ?? 15;
        capability.video.operations = overrides.operations ?? ["text_to_video", "image_to_video", "extend"];
    }
    const channel: ModelChannel = {
        id: "test",
        name: "test channel",
        baseUrl: overrides.baseUrl || "https://api.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        interfaceType: "newapi-channel-2",
        models: [model],
        scope: "user",
        modelProfiles: [
            {
                model,
                capability: "video",
                protocol: "newapi-channel-2",
                billingMode: "per_second",
                unitPriceMicrocredits: 1,
                capabilityConfig: capability,
            },
        ],
    };
    return {
        ...defaultConfig,
        model: `test::${model}`,
        videoModel: `test::${model}`,
        models: [`test::${model}`],
        videoModels: [`test::${model}`],
        channels: [channel],
        baseUrl: channel.baseUrl,
    };
}

describe("videoReferenceRegenerationError", () => {
    test("A prompt will be returned when the model does not support the reference video.", () => {
        const config: AiConfig = { ...defaultConfig, model: "default::grok-imagine-video", videoModel: "default::grok-imagine-video" };
        expect(videoReferenceRegenerationError(config)).toContain("Reference videos are not supported");
    });

    test("Returns a prompt when the model has no available generation mode.", () => {
        const config = supportedVideoConfig({ operations: [] });
        expect(videoReferenceRegenerationError(config)).toContain("No video generation mode available");
    });

    test("The model supports reference videos and has no errors when there is a mode available", () => {
        expect(videoReferenceRegenerationError(supportedVideoConfig())).toBe("");
    });
});

describe("videoReferenceOperationError", () => {
    test("Return a prompt when the selected mode is not among the model capabilities", () => {
        const config = supportedVideoConfig({ operations: ["text_to_video", "image_to_video", "extend"] });
        expect(videoReferenceOperationError(config, "inpaint")).toContain("The selected build mode is not supported");
    });

    test("No errors when selected mode is within model capabilities", () => {
        expect(videoReferenceOperationError(supportedVideoConfig(), "extend")).toBe("");
    });
});

describe("listVideoReferenceModels", () => {
    test("Default configuration has no reference video model available", () => {
        const config: AiConfig = { ...defaultConfig, model: "default::grok-imagine-video", videoModel: "default::grok-imagine-video" };
        expect(listVideoReferenceModels(config)).toEqual([]);
    });

    test("Only return models that support reference videos and have available modes", () => {
        expect(listVideoReferenceModels(supportedVideoConfig())).toEqual(["test::seedance-1.0-pro"]);
    });

    test("Filter out models with no available generation mode", () => {
        const config = supportedVideoConfig({ operations: [] });
        expect(listVideoReferenceModels(config)).toEqual([]);
    });

    test("Filter out channel models without configured API Key", () => {
        const config = supportedVideoConfig();
        config.channels[0].apiKey = "";
        expect(listVideoReferenceModels(config)).toEqual([]);
    });

    test("connected BeefTV with empty key stays selectable", () => {
        const config = supportedVideoConfig();
        config.channels[0] = {
            ...config.channels[0],
            id: "beeftv",
            pinned: true,
            apiKey: "",
            credentialRef: "beeftv",
            hasApiKey: true,
            models: ["seedance-1.0-pro"],
        };
        config.channels[0].modelProfiles![0].videoCapabilitiesVersion = "fixture-v1";
        config.model = "beeftv::seedance-1.0-pro";
        config.videoModel = "beeftv::seedance-1.0-pro";
        expect(listVideoReferenceModels(config)).toEqual(["beeftv::seedance-1.0-pro"]);
    });
});

describe("videoReferenceSegmentError", () => {
    test("A prompt will be returned when the clip exceeds the model reference video limit.", () => {
        const config = supportedVideoConfig({ maxVideoDurationSeconds: 15 });
        expect(videoReferenceSegmentError(config, 16000)).toContain("Cannot exceed the current model reference video limit (15 seconds)");
    });

    test("Seedance returns a prompt when a single segment is less than 2 seconds", () => {
        const config = supportedVideoConfig({ model: "seedance-1.0-pro" });
        expect(videoReferenceSegmentError(config, 1500)).toContain("at least 2 seconds");
    });

    test("Legal segment length is correct", () => {
        expect(videoReferenceSegmentError(supportedVideoConfig(), 5000)).toBe("");
    });
});

describe("validateVideoSegmentBatch", () => {
    test("There are no errors when the model, mode, and clip duration are all legal.", () => {
        expect(validateVideoSegmentBatch(supportedVideoConfig(), [{ startMs: 2000, endMs: 5000 }], "extend")).toBe("");
    });

    test("The first error is returned when the model does not support the reference video", () => {
        const config: AiConfig = { ...defaultConfig, model: "default::grok-imagine-video", videoModel: "default::grok-imagine-video" };
        expect(validateVideoSegmentBatch(config, [{ startMs: 2000, endMs: 5000 }], "extend")).toContain("Reference videos are not supported");
    });

    test("Operation error returned when mode is not in model capabilities", () => {
        expect(validateVideoSegmentBatch(supportedVideoConfig(), [{ startMs: 2000, endMs: 5000 }], "inpaint")).toContain("The selected build mode is not supported");
    });

    test("A fragment error is returned when the fragment exceeds the maximum model duration.", () => {
        expect(validateVideoSegmentBatch(supportedVideoConfig({ maxVideoDurationSeconds: 15 }), [{ startMs: 0, endMs: 16000 }], "extend")).toContain("Cannot exceed the current model reference video limit");
    });
});
