import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { formatVideoResolutionLabel, normalizeVideoResolution, sortVideoResolutionOptions, videoDimensionsForRatioAndResolution, videoResolutionComparisonKey, VIDEO_RESOLUTION_CAPABILITY_OPTIONS, VIDEO_RESOLUTION_OPTIONS } from "../src/lib/video-generation-options";

describe("video generation resolution options", () => {
    test("Resolutions are displayed in ascending numerical order, retaining original values and model configuration order.", () => {
        const values = Object.freeze(["4K", "1080P", "768p", "480p", "2k", "720p"]);
        expect(sortVideoResolutionOptions(values)).toEqual(["480p", "720p", "768p", "1080P", "2k", "4K"]);
        expect(values).toEqual(["4K", "1080P", "768p", "480p", "2k", "720p"]);
        expect(sortVideoResolutionOptions([])).toEqual([]);
    });

    test("Non-numeric model gears retain their original position and order", () => {
        expect(sortVideoResolutionOptions(["auto", "1080p", "HD_Portrait", "480p", "768p vertical", "768p"])).toEqual(["auto", "480p", "HD_Portrait", "768p", "768p vertical", "1080p"]);
    });

    test("Unified ranges include 1440P and 4K, and common aliases are recognized", () => {
        expect(VIDEO_RESOLUTION_OPTIONS).toEqual([480, 720, 1080, 1440, 2160]);
        expect(VIDEO_RESOLUTION_CAPABILITY_OPTIONS).toEqual(["480p", "720p", "1080p", "1440p", "2160p"]);
        expect(normalizeVideoResolution("2k")).toBe("1440");
        expect(normalizeVideoResolution("1440p")).toBe("1440");
        expect(normalizeVideoResolution("4K")).toBe("2160");
    });

    test("Preserve model-declared non-standard gears instead of silently downgrading", () => {
        expect(normalizeVideoResolution("768p")).toBe("768");
        expect(normalizeVideoResolution("768p vertical")).toBe("768p vertical");
        expect(normalizeVideoResolution("HD_Portrait")).toBe("HD_Portrait");
        expect(videoResolutionComparisonKey("768P vertical")).toBe("768p vertical");
        expect(formatVideoResolutionLabel("768p vertical")).toBe("768P vertical");
    });

    test("Derive video dimensions based on current ratio and resolution", () => {
        expect(videoDimensionsForRatioAndResolution("16:9", "720p")).toEqual({ width: 1280, height: 720 });
        expect(videoDimensionsForRatioAndResolution("16:9", "1080P")).toEqual({ width: 1920, height: 1080 });
        expect(videoDimensionsForRatioAndResolution("16:9", "4K")).toEqual({ width: 3840, height: 2160 });
        expect(videoDimensionsForRatioAndResolution("9:16", "1080p")).toEqual({ width: 1080, height: 1920 });
        expect(videoDimensionsForRatioAndResolution("1:1", "1440p")).toEqual({ width: 1440, height: 1440 });
        expect(videoDimensionsForRatioAndResolution("adaptive", "1080p")).toBeUndefined();
    });

    test("Actual optional gears are limited by agreement", () => {
        expect(defaultModelCapabilityConfig("newapi-channel-2").video?.resolutions).toEqual(["480p", "720p", "1080p", "1440p", "2160p"]);
        expect(defaultModelCapabilityConfig("volcengine-ark-video").video?.resolutions).toEqual(["480p", "720p", "1080p"]);
        expect(defaultModelCapabilityConfig("volcengine-jimeng-video").video?.resolutions).toEqual(["720p"]);
        expect(defaultModelCapabilityConfig("gemini-veo").video?.resolutions).toEqual(["720p", "1080p"]);
    });

    test("Volcano Ark unknown model allows multi-modal reference by default but does not infer audio-only capabilities", () => {
        expect(defaultModelCapabilityConfig("volcengine-ark-video").video?.operations).toContain("reference_to_video");
        expect(defaultModelCapabilityConfig("volcengine-ark-video").video?.operations).not.toContain("audio_to_video");
    });
});
