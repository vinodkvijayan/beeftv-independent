import { expect, test } from "bun:test";
import { generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";

for (const [stage, label] of [["delivery_paused", "Retrieval of results has been suspended"], ["delivery_timed_out", "The download times out, you can continue to retrieve the original results"]]) {
    test(`${stage} keeps generation success separate from result delivery`, () => {
        const task = { status: "succeeded" as const, stage };
        expect(generationTaskStatusLabel(task)).toBe("Result to be retrieved");
        expect(generationTaskStageLabel(task)).toBe(label);
        expect(generationTaskShowsProgress(task)).toBe(false);
    });
}
