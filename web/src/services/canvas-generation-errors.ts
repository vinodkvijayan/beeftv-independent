import { CanvasBackendSubmitPausedError, isCanvasRevisionConflict } from "@/services/canvas-revision-conflict";
import { explainGenerationError } from "@/lib/generation-error";

export class CanvasGenerationDurableAckError extends Error {
    readonly code: "canvas_conflict" | "result_apply_failed" | "result_target_unavailable";
    readonly cause: unknown;

    constructor(cause: unknown) {
        const explanation = explainGenerationError(cause);
        const code = isCanvasRevisionConflict(cause) ? "canvas_conflict" : explanation.category === "result_target_unavailable" ? "result_target_unavailable" : "result_apply_failed";
        super(code === "canvas_conflict" ? "The build results have been retained and the canvas has not been updated yet" : code === "result_target_unavailable" ? explanation.message : "The generated results have been retained and have not been put back into the canvas.");
        this.name = "CanvasGenerationDurableAckError";
        this.code = code;
        this.cause = cause;
    }
}

export class CanvasGenerationMaterializationError extends Error {
    readonly code = "download_failed";
    readonly cause: unknown;

    constructor(cause?: unknown) {
        super("The generated results have not been retrieved yet, you can continue to retrieve them.");
        this.name = "CanvasGenerationMaterializationError";
        this.cause = cause;
    }
}

export class CanvasGenerationTargetSaveError extends Error {
    constructor(cause?: unknown, message?: string) {
        const detail = isCanvasRevisionConflict(cause) || cause instanceof CanvasBackendSubmitPausedError
            ? "Canvas saving has been suspended and generation has not started this time. Please click Save Status at the top of the canvas, follow the prompts and try again."
            : "The canvas has not been saved and generation has not started. Please handle the canvas save prompt and try again.";
        super(message ?? detail, { cause });
        this.name = "CanvasGenerationTargetSaveError";
    }
}

export class CanvasGenerationOutputMissingError extends Error {
    readonly code = "results_missing";
    constructor(index: number) {
        super(`The original task did not return to the${index + 1} Pictures, existing results have been retained, please check the task details`);
        this.name = "CanvasGenerationOutputMissingError";
    }
}
