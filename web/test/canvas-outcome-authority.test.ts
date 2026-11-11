import { expect, test } from "bun:test";
import { canvasGenerationTaskNodes } from "../src/pages/canvas/canvas-generation-failure";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { GenerationTask } from "../src/stores/use-config-store";

const savedNode = (): CanvasNodeData => ({
    id: "clip",
    title: "lens",
    type: CanvasNodeType.Video,
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: {
        taskId: "task-1",
        taskOutcome: { phase: "retrievable", regenerate: "blocked", reason: "delivery_pending" },
    },
});

test("When the backend has determined that the result cannot be retrieved, the frontend cannot change it back to \"continue retrieval\".", () => {
    const [synced] = canvasGenerationTaskNodes([savedNode()], "clip", {
        id: "task-1",
        type: "canvas_video",
        status: "succeeded",
        outcome: { phase: "failed", regenerate: "blocked", reason: "result_unrecoverable" },
        error: "The generated results are irretrievable",
    } as GenerationTask);
    expect(synced.metadata?.taskOutcome).toEqual({ phase: "failed", regenerate: "blocked", reason: "result_unrecoverable" });
    expect(synced.metadata?.status).toBe("error");
    expect(synced.metadata?.errorDetails).toContain("Not retrievable");
});
