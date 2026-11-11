import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const versionHistory = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/canvas-version-history.tsx"), "utf8");

describe("canvas version history", () => {
    test("local workspace reads persisted snapshots and keeps drafts on a separate list", () => {
        expect(versionHistory).toContain("listCanvasHistory(projectId, controller.signal)");
        expect(versionHistory).toContain("getCanvasHistoryEntry(projectId, entry.id, controller.signal)");
        expect(versionHistory).toContain("readCanvasSyncDrafts(projectId)");
        expect(versionHistory).not.toContain("if (!open || localOnly) return");
        expect(versionHistory).not.toContain("loadPersistedCanvasVersion");
        expect(versionHistory).not.toContain("partitionCanvasVersionHistory");
        expect(versionHistory).not.toContain("canvas-version-history-source");

        const savedTab = versionHistory.slice(versionHistory.indexOf('data-tab="cloud"'), versionHistory.indexOf('data-tab="draft"'));
        const draftTab = versionHistory.slice(versionHistory.indexOf('data-tab="draft"'), versionHistory.indexOf("id=\"canvas-version-list\""));
        expect(savedTab).toContain("saved version");
        expect(savedTab).toContain("{entries.length}");
        expect(draftTab).toContain("native draft");
        expect(draftTab).toContain("{displayDrafts.length}");
        expect(versionHistory).toContain("for (const entry of entries)");
        expect(versionHistory).toContain("{displayDrafts.map((draft)");
        expect(versionHistory).not.toContain("Cloud history");
        expect(versionHistory).not.toContain("When opening the record, the cloud is");
    });

    test("snapshot read failure is not an empty list, and restore stays a confirm click", () => {
        expect(versionHistory).toContain('setError(cause instanceof Error? cause.message: "Failed to read historical version")');
        expect(versionHistory).toContain("!entries.length && !error");
        expect(versionHistory).toContain("!displayDrafts.length && !draftError");
        expect(versionHistory).toContain("history.restore");
        expect(versionHistory).toContain("modal.confirm");
        expect(versionHistory).toContain("The current canvas is backed up before restoring, and native drafts are retained. A new version will be generated after recovery.");
        expect(versionHistory).toContain("onClick={history.restore}");
    });
});
