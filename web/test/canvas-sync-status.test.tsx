import { describe, expect, test } from "bun:test";
import { canvasSyncStatusView } from "@/pages/canvas/canvas-sync-status";

describe("Local canvas save state", () => {
    test("Both queuing and submission show that it is being saved, but it does not say that it has been saved in advance.", () => {
        for (const phase of ["pending", "saving", "uploading"] as const) {
            expect(canvasSyncStatusView(true, { phase })).toEqual({ label: "Saving", tone: "saving", detail: "Saving to local machine." });
        }
    });

    test("After the server accepts it, it will be displayed as saved locally.", () => {
        expect(canvasSyncStatusView(true, { phase: "done", message: "Canvas saved" })).toEqual({ label: "Saved locally", tone: "saved", detail: "The canvas is saved locally." });
        expect(canvasSyncStatusView(true, undefined).label).toBe("Saved locally");
    });

    test("If the save fails, it means that the modification is still on the local machine and a retry will be given.", () => {
        expect(canvasSyncStatusView(true, { phase: "error", message: "The save is not completed and the modifications are still retained on this machine." })).toEqual({
            label: "Save failed",
            tone: "failed",
            detail: "The save is not completed and the modifications are still retained on this machine.",
            action: "retry-save",
        });
    });

    test("If there is a conflict, it will show that it has not been saved, and it will give \"use the latest version\" and explain that the draft will be saved first.", () => {
        const view = canvasSyncStatusView(true, { phase: "conflict", message: "The canvas has been modified by other entries and this change has not been submitted; the existing content has been retained on this machine" });
        expect(view.label).toBe("Version conflict · not saved");
        expect(view.tone).toBe("failed");
        expect(view.action).toBe("use-latest");
        expect(view.note).toContain("draft");
        // 本地模式不把内部入口说法带给用户。
        expect(`${view.detail}${view.note}`).not.toContain("entrance");
    });
});

describe("Cloud canvas save status remains intact", () => {
    test("Conflict, not synchronized, saving, saved", () => {
        expect(canvasSyncStatusView(false, { phase: "conflict", message: "conflict" })).toMatchObject({ label: "Version conflict · Not synchronized", tone: "failed", detail: "conflict", action: "load-cloud" });
        expect(canvasSyncStatusView(false, undefined)).toMatchObject({ label: "Not synced yet", tone: "failed", detail: "Cloud saving has not been confirmed yet, please keep local content" });
        expect(canvasSyncStatusView(false, { phase: "saving" })).toMatchObject({ label: "Saving", tone: "saving" });
        expect(canvasSyncStatusView(false, { phase: "done" })).toMatchObject({ label: "saved", tone: "saved", detail: "Canvas has been synced to the cloud", note: undefined });
        expect(canvasSyncStatusView(false, { phase: "error" })).toMatchObject({ label: "Not saved in cloud", tone: "failed" });
    });
});
