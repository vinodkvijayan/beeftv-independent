import { describe, expect, test } from "bun:test";

import { imageResponseFormatSelectable, resolveImageResponseFormat, type ImageCapabilityConfig } from "../src/lib/model-capabilities";

function profileWith(responseFormat: ImageCapabilityConfig["responseFormat"]) {
    return { responseFormat } as ImageCapabilityConfig;
}

describe("Image response_format value", () => {
    test("This parameter will not be sent when it is not enabled.", () => {
        expect(resolveImageResponseFormat(profileWith({ supported: false, value: "url" }))).toBeNull();
    });

    test("When no value has been selected, send it by b64_json. The behavior of the old channel remains unchanged.", () => {
        expect(resolveImageResponseFormat(profileWith({ supported: true }))).toBe("b64_json");
    });

    test("If url is selected, send url", () => {
        expect(resolveImageResponseFormat(profileWith({ supported: true, value: "url" }))).toBe("url");
    });

    test("Only the general OpenAI image request channel is allowed to select the url", () => {
        expect(imageResponseFormatSelectable("openai-image", "third-party-image")).toBe(true);
        expect(imageResponseFormatSelectable("openai-image", "hy-image-v3")).toBe(false);
        expect(imageResponseFormatSelectable("grok-image", "grok-2-image")).toBe(false);
    });

    test("Seedream uses a dedicated request body and does not provide this selector.", () => {
        expect(imageResponseFormatSelectable("openai-image", "seedream-4-5-251128")).toBe(false);
        expect(imageResponseFormatSelectable("openai-image", "seedream-4-0-250828")).toBe(false);
        expect(imageResponseFormatSelectable("openai-image", "vendor::seedream-5-0-pro-260225")).toBe(false);
    });
});