import { describe, expect, test } from "bun:test";

import { buildEmotionPrompt, emotionProviderMask, normalizeEmotionPromptForProvider, resolveEmotionEditPlan } from "../src/lib/canvas/canvas-emotion";

const faceBox = { id: "face-1", x: 120, y: 80, width: 160, height: 180, source: "detected" as const };
const editRegion = { x: 40, y: 20, width: 320, height: 360 };

describe("emotion edit provider plan", () => {
    test("keeps provider mask when the selected image model supports it", () => {
        expect(resolveEmotionEditPlan(true)).toEqual({ mode: "provider-mask", includeMask: true });
    });

    test("falls back visibly to local compositing when the provider does not support masks", () => {
        const plan = resolveEmotionEditPlan(false);
        expect(plan).toEqual({
            mode: "local-composite",
            includeMask: false,
            notice: "The current channel does not support masks, use face cropping and local feathering fusion",
        });
        expect(emotionProviderMask(plan, { dataUrl: "data:image/png;base64,bWFzaw==" })).toBeUndefined();
    });

    test("does not promise a provider mask in the shared emotion prompt", () => {
        const prompt = buildEmotionPrompt(
            { presetId: "emotion-0-0", intimacy: 0, arousal: 0, characterName: "role 1", faceBox },
            editRegion,
        );

        expect(prompt).not.toContain("transparency mask");
        expect(prompt).not.toContain("white mask");
        expect(prompt).toContain("target face frame");
    });

    test("removes legacy mask promises before retrying an existing emotion node", () => {
        const legacyPrompt = [
            "Only the face corresponding to the target frame and its transparent mask is allowed to be modified.",
            "The input image has been cropped to the head area of the target character; editing is allowed within the transparent mask, the white mask area must remain unchanged, and absolutely no content should be generated or modified outside the mask.",
        ].join("\n");

        const prompt = normalizeEmotionPromptForProvider(legacyPrompt);
        expect(prompt).not.toContain("transparency mask");
        expect(prompt).not.toContain("white mask");
        expect(prompt).toContain("Target face frame and its adjacent expression area");
    });
});
