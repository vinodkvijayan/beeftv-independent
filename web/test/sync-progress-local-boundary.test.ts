import { describe, expect, test } from "bun:test";

import { syncBeforeUnloadMessage, type SyncProjectProgress } from "../src/stores/use-sync-progress-store";

const progress: SyncProjectProgress[] = [{ projectId: "project-1", total: 1, completed: 0, phase: "saving", message: "Saving" }];

describe("sync progress local boundary", () => {
    test("uses the runtime mode instead of parsing an intermediate message", () => {
        expect(syncBeforeUnloadMessage(progress, true)).toBe("The canvas is being saved locally, please do not close the page.");
        expect(syncBeforeUnloadMessage(progress, false)).toBe("The canvas is being synced to the cloud, please do not close the page.");
    });

    test("does not warn when no project is actively saving", () => {
        expect(syncBeforeUnloadMessage([], true)).toBe("");
    });
});
