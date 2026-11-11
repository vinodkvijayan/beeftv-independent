import { describe, expect, test } from "bun:test";

import { chapterStoryboardApprovalSnapshot, chapterStoryboardRecoveryDecision, chapterTaskIdentity } from "@/pages/projects/detail/project-chapter-ai";
import type { GenerationTask } from "@/services/api/task-center";

describe("Chapter generation task refresh recovery", () => {
    test("Prioritize identifying chapters and actions from the security client context of the task list", () => {
        expect(chapterTaskIdentity(task({
            clientContext: {
                domainProjectId: "project-1",
                chapterId: "chapter-1",
                chapterOperation: "characters",
            },
        }))).toEqual({ chapterId: "chapter-1", kind: "characters" });
    });

    test("Task details can be used to restore the storyboarding operation from the desensitized input metadata.", () => {
        expect(chapterTaskIdentity(task({
            inputJson: JSON.stringify({
                metadata: {
                    domainProjectId: "project-1",
                    chapterId: "chapter-2",
                    source: "short-drama-chapter-storyboard",
                },
            }),
        }))).toEqual({ chapterId: "chapter-2", kind: "storyboard" });
    });

    test("Irrelevant, missing chapters, or corrupted quest inputs will not have chapter buttons associated with them", () => {
        expect(chapterTaskIdentity(task({ inputJson: "{" }))).toBeNull();
        expect(chapterTaskIdentity(task({ inputJson: JSON.stringify({ metadata: { operation: "chapter_character_breakdown" } }) }))).toBeNull();
        expect(chapterTaskIdentity(task({ inputJson: JSON.stringify({ metadata: { chapterId: "chapter-1", operation: "other" } }) }))).toBeNull();
    });

    test("Read the original approval snapshot from the task input and reject it with the current page version on top", () => {
        const current = { revision: 9, shotIds: ["shot-a"] };
        const snapshot = chapterStoryboardApprovalSnapshot(JSON.stringify({
            metadata: {
                domainProjectId: "project-1",
                chapterId: "chapter-1",
                source: "short-drama-chapter-storyboard",
                approvedRevision: 4,
                approvedShotIds: ["shot-a"],
            },
        }));
        expect(snapshot).toEqual({ revision: 4, shotIds: ["shot-a"] });
        expect(snapshot).not.toEqual(current);
    });

    test("After refreshing, the real receipts are classified: skipped if written, enter verification if not written", () => {
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: true })).toEqual({ action: "skip" });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false })).toEqual({ action: "review" });
    });

    test("Unwritten results will not be automatically written even if the original approved snapshot is still available", () => {
        const snapshot = chapterStoryboardApprovalSnapshot(JSON.stringify({
            metadata: {
                source: "short-drama-chapter-storyboard",
                approvedRevision: 5,
                approvedShotIds: ["shot-a"],
            },
        }));
        expect(snapshot).toEqual({ revision: 5, shotIds: ["shot-a"] });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false })).toEqual({ action: "review" });
    });

    test("The recovery path uses task identity and frozen snapshots instead of guessing based on timestamps.", async () => {
        const source = await Bun.file(new URL("../src/pages/projects/detail/chapters.tsx", import.meta.url)).text();
        const helper = await Bun.file(new URL("../src/pages/projects/detail/project-chapter-ai.ts", import.meta.url)).text();
        const createStoryboard = source.slice(source.indexOf("const createStoryboard"));
        const applyRecovery = source.slice(source.indexOf("const applyPendingStoryboardRecovery"));
        expect(helper).toContain("approvedRevision: input.approvedRevision");
        expect(helper).toContain("approvedShotIds: input.approvedShotIds.slice()");
        expect(helper).toContain("taskId: completed.id");
        expect(source).toContain("listChapterApplyReceipts");
        expect(source).toContain("sourceTaskId");
        expect(source).toContain("queryGenerationTask(task.id)");
        expect(source).toContain("Write after checking");
        expect(createStoryboard.indexOf("const approvedRevision")).toBeLessThan(createStoryboard.indexOf("confirmStoryboardReplacement"));
        expect(applyRecovery.indexOf("const reviewedRevision")).toBeLessThan(applyRecovery.indexOf("confirmRecoveredStoryboardWrite"));
        expect(source).not.toContain("chapterTaskResultAlreadyApplied");
        expect(source).not.toContain("shot.updatedAt");
        expect(source).not.toMatch(/storeGeneratedStoryboard\([^;]*detail\.project\.revision/);
        expect(source).toContain("error.reason === \"project_unit_shots_changed\"");
        expect(source).toContain("error.reason === \"project_revision_conflict\"");
        expect(source).not.toContain('error.reason === "conflict"');
        expect(source).not.toContain("The storyboard of this chapter has changed, please refresh and confirm again.");
        expect(source).not.toContain("The project has been updated by other operations, please reload before saving.");
        expect(source).not.toContain("The storyboards generated before refreshing are still there");
    });
});

function task(overrides: Partial<GenerationTask>): GenerationTask {
    return {
        id: "task-1",
        type: "text",
        status: "running",
        prompt: "",
        attempts: 1,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        ...overrides,
    };
}
