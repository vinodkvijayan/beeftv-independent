import { expect, test } from "bun:test";
import { seedanceReferenceRatioWarning } from "../src/lib/seedance-channel-warning";
import { seedanceSettingsConstraints } from "../src/lib/seedance-task-constraints";
import { explainGenerationError } from "../src/lib/generation-error";

const request = { model: "seedance-2.5", credentialRef: "beeftv", videoCount: 1, ratio: "16:9", operation: "reference_to_video" };
test("only affected routes and reference-video requests require informed consent", () => {
    expect(seedanceReferenceRatioWarning(request)?.content).toContain("No automatic refund");
    expect(seedanceReferenceRatioWarning({ ...request, model: "seedance-2.0" })?.okText).toBe("accept risk and generate");
    for (const patch of [{ model: "seedance-2.0-fast" }, { model: "seedance-2.0-mini" }, { videoCount: 0 }, { ratio: "adaptive" }, { operation: "extend" }, { operation: "inpaint" }, { credentialRef: "", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }, { credentialRef: "", baseUrl: "https://whatstoken.ai.attacker.invalid" }]) {
        expect(seedanceReferenceRatioWarning({ ...request, ...patch })).toBeUndefined();
    }
    expect(seedanceReferenceRatioWarning({ ...request, credentialRef: "", baseUrl: "https://www.whatstoken.ai/api/v3" })).toBeDefined();
});

test("mode-specific controls keep free ratio in reference mode and unlock on model change", () => {
    const constrained = { taskTypeConstraints: true };
    const unconstrained = { taskTypeConstraints: false };
    expect(seedanceSettingsConstraints(constrained, 1, 0, 0).ratioLabel).toBe("Follow the first frame");
    expect(seedanceSettingsConstraints(constrained, 1, 1, 1, "reference_to_video").ratioLabel).toBeUndefined();
    expect(seedanceSettingsConstraints(constrained, 1, 0, 0, "reference_to_video").ratioLabel).toBeUndefined();
    expect(seedanceSettingsConstraints(unconstrained, 1, 0, 0).ratioLabel).toBeUndefined();
    expect(seedanceSettingsConstraints(constrained, 0, 1, 0, "inpaint")).toEqual({ ratioLabel: "Suiyuan video", durationLocked: true });
});

test("specific frame errors survive task-log serialization", () => {
    for (const reason of ["Unable to read first frame image size", "The ratio of the first frame image exceeds the support range of the current model", "The proportion of the first frame image is inconsistent with the current settings"]) {
        const first = explainGenerationError({ code: "invalid_params", message: `${reason}. Please change the first frame image or adjust the aspect ratio and try again.` });
        expect(first.category).toBe("invalid_params");
        expect(first.reason).toBe(reason);
        expect(first.message).not.toContain("Check model, size");
    }
});
