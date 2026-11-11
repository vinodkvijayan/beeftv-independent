import { expect, test } from "bun:test";
import { seedanceTaskOptions } from "../src/lib/seedance-task-constraints";
import { explainGenerationError } from "../src/lib/generation-error";
import { resolveVideoOperation } from "../src/lib/model-selection";

test("Seedance 2.5 locks explicit task options and preserves semantic reference via capabilityConfig.video.taskTypeConstraints", () => {
    for (const target of [{ taskTypeConstraints: true }, { video: { taskTypeConstraints: true } }, true] as const) {
        expect(seedanceTaskOptions(target, "9:16", 6, ["first_frame"], 0)).toEqual({ ratio: "adaptive", duration: 6 });
        expect(seedanceTaskOptions(target, "9:16", 6, ["reference_image"], 1, "reference_to_video")).toEqual({ ratio: "9:16", duration: 6 });
        expect(seedanceTaskOptions(target, "9:16", 6, [], 1, "inpaint")).toEqual({ ratio: "adaptive", duration: -1 });
        expect(seedanceTaskOptions(target, "9:16", 6, [], 1, "extend")).toEqual({ ratio: "adaptive", duration: 6 });
    }
    expect(seedanceTaskOptions({ taskTypeConstraints: false }, "9:16", 6, ["first_frame"], 0)).toEqual({ ratio: "9:16", duration: 6 });
});

test("backend TaskTypeConstraint failure copy explains how to correct the mode", () => {
    const message = "The screen ratio of the first and last frame modes needs to follow the first frame. Please change the aspect ratio to adaptive or use multi-material reference mode instead.";
    const error = explainGenerationError({ code: "invalid_params", message });
    expect(error.category).toBe("invalid_params");
    expect(error.reason).toBe("The screen ratio of the first and last frame modes must follow the first frame");
    expect(error.action).toContain("Adaptive");
    expect(error.blockAutomaticRetry).toBe(true);
    expect(explainGenerationError({ code: "invalid_params", message: error.message }).reason).toBe(error.reason);
    const persisted = `${error.message}Troubleshooting number: Task task_outer_456 · Request req_task_constraint_123.`;
    expect(explainGenerationError({ code: "invalid_params", message: persisted }).requestId).toBe("req_task_constraint_123");
    expect(explainGenerationError({ code: "invalid_params", message: persisted }).taskId).toBe("task_outer_456");
});

test("explicit reference and extension intent survives model selection", () => {
    const input = { imageCount: 1, characterCount: 0, videoCount: 0, audioCount: 0 };
    expect(resolveVideoOperation(input, "reference_to_video")).toBe("reference_to_video");
    expect(resolveVideoOperation({ ...input, videoCount: 1 }, "extend")).toBe("extend");
    expect(resolveVideoOperation({ ...input, videoCount: 1 })).toBe("reference_to_video");
});

test("temporary unavailable error inside failed task is actionable", () => {
 const e=explainGenerationError({error:{code:"model_temporarily_unavailable",message:"No available lines: Current price range standard No available lines yet"}});
 expect(e.category).toBe("provider_unavailable"); expect(e.reason).toBe("Model service is temporarily unavailable");
});
