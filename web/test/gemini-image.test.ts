import { describe, expect, test } from "bun:test";

import { buildGeminiImageGenerationConfig, parseGeminiImageDataUrl } from "../src/lib/gemini-image";

describe("Gemini Images request helpers", () => {
    test("Use real MIME and bare base64 when splitting reference image data URL", () => {
        expect(parseGeminiImageDataUrl("data:image/jpeg;base64,aGVsbG8=")).toEqual({ mimeType: "image/jpeg", data: "aGVsbG8=" });
    });

    test("Reject empty images and non-image data URLs to avoid sending wrong reference images to Gemini", () => {
        expect(() => parseGeminiImageDataUrl("")).toThrow("Not getting valid image data URL");
        expect(() => parseGeminiImageDataUrl("data:text/plain;base64,aGVsbG8=")).toThrow("Invalid MIME type");
    });

    test("Map unified image options to Gemini imageConfig", () => {
        expect(buildGeminiImageGenerationConfig("16:9", "high")).toEqual({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
        });
        expect(buildGeminiImageGenerationConfig("auto", "auto")).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
    });
});
