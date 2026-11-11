import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePicker } from "../src/components/image-size-picker";
import { applyImageSizeSelection, imageSizeLabel } from "../src/components/image-settings-panel";
import { ImageSizePresetsEditor } from "../src/components/image-size-presets-editor";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultImageCapabilityConfig, normalizeImageValue, normalizeModelCapabilityConfig } from "../src/lib/model-capabilities";
import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, imagePresetForRatio, imagePresetValue, imageQualityForSelection, imageQualityForTier, imageSizeConfigWithPresets, imageSizePresets, imageTierAvailable } from "../src/lib/image-size-presets";
import { buildImageResolutionOptions } from "../src/lib/image-resolution-tiers";
import { resolveImageRequestSize, validateImageSize } from "../src/services/api/image-validation";
import { buildGeminiImageGenerationConfig } from "../src/lib/gemini-image";

describe("Unify image resolution and aspect ratio", () => {
    test("Default Gemini quality enumeration does not display unenabled 1K", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "nano-banana-pro-4k");
        profile.size = imageSizeConfigWithPresets(profile, IMAGE_RATIOS.map((ratio) => imagePresetForRatio("4k", ratio)));
        expect(profile.quality.supported).toBe(true);
        expect(imageTierAvailable(profile, "4k")).toBe(true);
        expect(imageTierAvailable(profile, "1k")).toBe(false);
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" quality="high" onChange={() => {}} />);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>1K/);
    });

    test("Fixed 4K models without quality parameters retain the administrator status, and will not fall back to 1K when reopened and customized proportions", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "nano-banana-pro-4k");
        profile.quality = { supported: false, values: [], default: "auto" };
        profile.size = imageSizeConfigWithPresets(profile, IMAGE_RATIOS.map((ratio) => imagePresetForRatio("4k", ratio)));
        expect(imageTierAvailable(profile, "4k")).toBe(true);
        expect(imageTierAvailable(profile, "1k")).toBe(false);
        expect(imageQualityForTier(profile, "4k")).toBeUndefined();
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" onChange={() => {}} />);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>[12]K/);
        expect(picker).toContain("3840 × 2160 px");
        expect(normalizeImageValue(profile, { size: "16:9", quality: "auto" }).quality).toBe("4k");
        expect(resolveImageRequestSize(profile, undefined, "16:9")).toEqual({ parameter: "aspect_ratio", value: "16:9" });
        profile.size.allowCustom = true;
        const custom = renderToStaticMarkup(<ImageSizePicker profile={profile} size="17:11" onChange={() => {}} />);
        expect(custom).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(custom).toContain("17:11 ·");
    });

    test("When there are no quality parameters, the 1K and 4K enabled by the administrator are open to users, and the unenabled 2K remains hidden.", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "test");
        profile.quality = { supported: false, values: [], default: "auto" };
        profile.size = imageSizeConfigWithPresets(profile, [...IMAGE_RATIOS.flatMap((ratio) => [imagePresetForRatio("1k", ratio), imagePresetForRatio("4k", ratio)])]);
        expect(imageTierAvailable(profile, "1k")).toBe(true);
        expect(imageTierAvailable(profile, "4k")).toBe(true);
        expect(imageTierAvailable(profile, "2k")).toBe(false);
        expect(imageQualityForSelection(profile, "4k")).toBe("4k");
        expect(normalizeImageValue(profile, { size: "16:9", quality: "4k" }).quality).toBe("4k");
        expect(buildGeminiImageGenerationConfig("16:9", "4k").imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "4K" });
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" onChange={() => {}} />);
        expect(picker).toMatch(/<button[^>]*>1K/);
        expect(picker).toMatch(/<button[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>2K/);
        expect(picker).not.toContain("The current protocol is not configured with independent resolution");
        const selected = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" quality="4k" onChange={() => {}} />);
        expect(selected).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(selected).not.toMatch(/aria-pressed="true"[^>]*>1K/);
        expect(selected).toContain("3840 × 2160 px");
        const editor = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} onChange={() => {}} />);
        expect(editor).not.toContain("The quality value corresponding to this gear needs to be configured first before the client will be opened.");
    });

    test("Real picture quality fields are not overridden by resolution preset inference", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "test");
        profile.quality = { supported: true, values: ["auto", "low", "medium", "high"], default: "auto" };
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("2k", "16:9"), imagePresetForRatio("4k", "16:9")]);
        expect(normalizeImageValue(profile, { size: "16:9", quality: "auto" }).quality).toBe("auto");
        expect(normalizeImageValue(profile, { size: "16:9", quality: "high" }).quality).toBe("high");
    });

    test("Submit both size and true quality levels when scaling protocol switches to 4K", () => {
        const changes: Array<[string, string]> = [];
        applyImageSizeSelection((key, value) => changes.push([key, value]), "16:9", "high");
        expect(changes).toEqual([["size", "16:9"], ["quality", "high"]]);
    });

    test("Pixel protocol sends real pixels after switching from old ratio configuration to 4K without falling back to 1K", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = { parameter: "size", values: ["16:9"], default: "16:9", allowCustom: true };
        const value = imagePresetValue(profile, imagePresetForRatio("4k", "16:9"));
        expect(value).toBe("3840x2160");
        expect(resolveImageRequestSize(profile, "auto", value)).toEqual({ parameter: "size", value: "3840x2160" });
        const legacy = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" onChange={() => {}} />);
        expect(legacy).toContain("1824 × 1024 px");
        const reopened = renderToStaticMarkup(<ImageSizePicker profile={profile} size="3840x1920" onChange={() => {}} />);
        expect(reopened).not.toMatch(/<button[^>]*>4K/);
        expect(reopened).toContain("2:1 · 3840 × 1920 px");
    });

    test("Commonly used proportions maintain clear dimensions, and equivalent proportions are normalized", () => {
        expect(imagePresetForRatio("1k", "16:9").size).toBe("1824x1024");
        expect(imagePresetForRatio("4k", "9:16").size).toBe("2160x3840");
        expect(imagePresetForRatio("1k", "32：18")).toEqual(imagePresetForRatio("1k", "16:9"));
        expect(imagePresetForRatio("2k", "7:3").ratio).toBe("21:9");
        expect(imagePresetForRatio("2k", "34:22").ratio).toBe("17:11");
    });

    test("Three presets and any reasonable ratio can meet the pixel range", () => {
        for (const tier of IMAGE_RESOLUTIONS)
            for (const ratio of [...IMAGE_RATIOS, "17:11", "21:8", "42:18", "3:1", "1:3", "99999:99998"]) {
                const preset = imagePresetForRatio(tier, ratio);
                expect(() => validateImageSize(preset.width, preset.height, true)).not.toThrow();
            }
        for (const ratio of ["0:9", "4:1", "1:4", "NaN:1", "1.5:1", "999999999:1"]) {
            expect(() => imagePresetForRatio("1k", ratio)).toThrow();
        }
    });

    test("1K preset at 21:9 meets upstream's 16 pixel alignment requirement", () => {
        expect(imagePresetForRatio("1k", "21:9").size).toBe("2048x880");
    });

    test("Fixed ratio editor includes three sizes: 4:5 and 5:4", () => {
        expect(IMAGE_RATIOS).toContain("4:5");
        expect(IMAGE_RATIOS).toContain("5:4");
        expect(imagePresetForRatio("1k", "4:5").size).toBe("1024x1280");
        expect(imagePresetForRatio("2k", "4:5").size).toBe("1792x2240");
        expect(imagePresetForRatio("4k", "4:5").size).toBe("2560x3200");
        expect(imagePresetForRatio("1k", "5:4").size).toBe("1280x1024");
        expect(imagePresetForRatio("2k", "5:4").size).toBe("2240x1792");
        expect(imagePresetForRatio("4k", "5:4").size).toBe("3200x2560");
    });

    test("Admin settings synchronization supports values, defaults, and maintains precise dimensions", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = { parameter: "size", values: ["1920x1080"], default: "1920x1080", allowCustom: false };
        const existing = imageSizePresets(profile);
        const added = imagePresetForRatio("1k", "17:11");
        profile.size = imageSizeConfigWithPresets(profile, [...existing, added]);
        expect(profile.size.values).toEqual(["1920x1080", added.size]);
        expect(profile.size.default).toBe("1920x1080");
        expect(resolveImageRequestSize(profile, undefined, "1920x1080")?.value).toBe("1920x1080");
        expect(normalizeModelCapabilityConfig({ version: 1, image: profile }).image?.size.presets).toEqual(profile.size.presets);
        expect(imageSizeConfigWithPresets(profile, [added]).default).toBe(added.size);
    });

    test("Non-standard exact pixels do not disappear from options", () => {
        expect(buildImageResolutionOptions(["1360x880"])[0]).toMatchObject({ size: "1360x880", ratio: "17:11" });
        expect(buildImageResolutionOptions(["0x1024", "1024x0"])).toEqual([]);
    });

    test("Scale protocol sends scale and resolution separately and does not treat custom permissions as 4K capabilities", () => {
        const grok = defaultImageCapabilityConfig("grok-image", "grok-imagine-image");
        grok.size.allowCustom = true;
        expect(imageTierAvailable(grok, "4k")).toBe(false);
        expect(imageSizePresets(grok).some((preset) => preset.tier === "4k")).toBe(false);
        const gemini = defaultImageCapabilityConfig("gemini-image", "test");
        const preset = imagePresetForRatio("4k", "16:9");
        expect(buildGeminiImageGenerationConfig(imagePresetValue(gemini, preset), imageQualityForTier(gemini, "4k")).imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "4K" });
        gemini.size.allowCustom = true;
        const reopened = renderToStaticMarkup(<ImageSizePicker profile={gemini} size="17:11" quality="high" onChange={() => {}} />);
        expect(reopened).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(reopened).toContain("17:11");
    });

    test("The combination of ratio and gear must be in the gear configuration. If customization is allowed, the ratio is released.", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "test");
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "16:9")]);
        expect(() => resolveImageRequestSize(profile, "medium", "1:1")).toThrow("Current resolution");
        expect(resolveImageRequestSize(profile, "medium", "16:9")).toEqual({ parameter: "aspect_ratio", value: "16:9" });
        profile.size.allowCustom = true;
        expect(resolveImageRequestSize(profile, "medium", "1:1")?.value).toBe("1:1");
    });

    test("Administrators fixedly display three gears, the client hides unsupported gears, and hides when not sending sizes.", () => {
        const profile = defaultImageCapabilityConfig("grok-image", "grok-imagine-image");
        profile.size.allowCustom = true;
        const editor = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} onChange={() => {}} />);
        for (const label of ["1K", "2K", "4K"]) expect(editor).toMatch(new RegExp(`<strong[^>]*>${label}</strong>`));
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" quality="2k" onChange={() => {}} />);
        expect(picker).not.toMatch(/<button[^>]*>4K/);
        expect(picker).toContain("Conversion reference");
        profile.size.parameter = "none";
        expect(renderToStaticMarkup(<ImageSizePicker profile={profile} size="auto" onChange={() => {}} />)).toBe("");
    });

    test("The empty position is always hidden and will not be displayed even if it is customized; the old size does not cause the proportion area to be empty.", () => {
        for (const protocol of ["openai-image", "gemini-image"]) {
            const profile = defaultImageCapabilityConfig(protocol, "test");
            profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("4k", "16:9")]);
            for (const allowCustom of [false, true]) {
                profile.size.allowCustom = allowCustom;
                const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size={profile.size.parameter === "aspect_ratio" ? "16:9" : "2752x1536"} quality="medium" onChange={() => {}} />);
                expect(picker).toMatch(/<button[^>]*>1K/);
                expect(picker).toMatch(/<button[^>]*>4K/);
                expect(picker).not.toMatch(/<button[^>]*>2K/);
                expect(picker).not.toContain("Scale not configured");
                expect(picker).toContain('title="1:1 · 1024 × 1024"');
                expect(picker).not.toMatch(/aria-pressed="true"[^>]*>1K/);
            }
        }
    });

    test("When only one file is configured, only that file will be displayed; when it is empty, the automatic size and custom entry will be retained.", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("4k", "16:9")]);
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="3840x2160" onChange={() => {}} />);
        expect(picker).not.toMatch(/<button[^>]*>[12]K/);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
        profile.size = imageSizeConfigWithPresets(profile, []);
        profile.size.allowCustom = true;
        const empty = renderToStaticMarkup(<ImageSizePicker profile={profile} size="auto" onChange={() => {}} />);
        expect(empty).not.toContain('class="image-size-tiers"');
        expect(empty).not.toContain('class="image-size-label"');
        expect(empty).toContain("automatic size");
        expect(empty).toContain("Custom scale or size");
    });

    test("The administrator ratio can be directly clicked and entered. The default output no longer uses the drop-down box.", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("1k", "16:9")]);
        const editor = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} onChange={() => {}} />);
        expect(editor).not.toContain('role="combobox"');
        expect(editor).not.toContain("ant-select");
        for (const tier of ["1K", "2K", "4K"]) {
            expect(editor).toContain(`aria-label="${tier} Custom scale"`);
            expect(editor).toContain(`aria-label="Add${tier} Proportion"`);
            expect(editor).toContain(`aria-label="${tier} 16:9"`);
        }
        expect(editor).toContain('aria-label="Default output"');
        expect(editor).not.toContain("Select none");
        expect(editor).not.toContain("Select all");
        expect(editor).toContain('aria-label="Enable 1K spec"');
        expect(editor).toContain('aria-label="Enable 2K spec"');
        expect(editor).toContain('aria-label="Enable 4K spec"');
        const readOnly = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} disabled onChange={() => {}} />);
        const buttons = [...readOnly.matchAll(/<button\b[^>]*>/g)];
        expect(buttons.length).toBeGreaterThan(24);
        expect(buttons.every(([button]) => button.includes('disabled=""'))).toBe(true);
    });

    test("The image protocol size occupies the entire row and precedes the auxiliary parameters, and the video layout is not affected.", () => {
        const image = renderToStaticMarkup(<ModelCapabilityEditor capability="image" section="protocol" />);
        expect(image).toContain("admin-image-protocol-grid");
        expect(image).toContain("admin-image-size-card");
        expect(image.indexOf("Dimensions")).toBeLessThan(image.indexOf("Output quantity"));
        const video = renderToStaticMarkup(<ModelCapabilityEditor capability="video" section="protocol" />);
        expect(video).not.toContain("admin-image-protocol-grid");
    });
});

test("Midjourney exposes only priced native tiers and preserves declared aspect ratio", () => {
 const profile = defaultImageCapabilityConfig("openai-image","midjourney-v8.2");
 expect(imageSizeLabel("1456x816",profile)).toBe("16:9 · 1K");
 expect(profile.size.presets?.some((preset) => preset.tier === "2k")).toBe(false);
});
