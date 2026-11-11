import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { rebaseCanvasDocumentThreeWay, settleInFlightGenerationOverlay } from "../src/lib/canvas/canvas-document-rebase";
import { isolateCopiedNodeMetadata } from "../src/lib/canvas/canvas-node-copy";
import { sameNodeSemanticData } from "../src/lib/canvas/canvas-project-domain";
import { insertCanvasResourceMentionAtSelection } from "../src/lib/canvas/canvas-text-mention";
import { canvasGenerationTaskNodes } from "../src/pages/canvas/canvas-generation-failure";
import type { GenerationTask } from "../src/services/api/task-center";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, title: string, metadata: CanvasNodeData["metadata"] = {}, position = { x: 0, y: 0 }): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title, position, width: 320, height: 220, metadata };
}

function project(nodes: CanvasNodeData[], revision: number, title = "canvas"): CanvasProject {
    return {
        id: "c1",
        revision,
        title,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
}

describe("settleInFlightGenerationOverlay", () => {
    test("settle comment matches overlay empty-string exception", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/canvas-document-rebase.ts"), "utf8");
        expect(source).not.toContain("Content written by humans (including empty strings) is retained");
        expect(source).toContain("Empty content on loading/error is overlay");
        expect(source).toContain("Non-empty content written by humans is retained");
        expect(source).toContain("Empty strings on non-overlay are retained according to real editing");
        expect(source).toContain("Different taskId will not write back the old storageKey");
    });

    test("in-flight loading overlay adopts remote success and keeps Agent sibling nodes", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", prompt: "cat" });
        const camp = node("node-camp", "Autumn travel camping table", { status: "idle" }, { x: 80, y: 40 });
        const lake = node("node-lake", "Autumn travel·Lakeside traverse", { status: "idle" }, { x: 160, y: 40 });
        const base = project([original, camp, lake], 10);
        const local = project([
            { ...original, metadata: { taskId: "task-1", status: "loading", taskStatus: "running", taskProgress: 42, taskStage: "Pictured", prompt: "cat" } },
            camp,
            lake,
        ], 10);
        const remote = project([
            { ...original, metadata: { taskId: "task-1", status: "success", taskStatus: "succeeded", taskProgress: 100, content: "https://media/gen", storageKey: "res-gen", prompt: "cat" } },
            camp,
            lake,
        ], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes.map((item) => item.id)).toEqual(["image-origin", "node-camp", "node-lake"]);
        expect(rebased.project.nodes[0]?.metadata?.status).toBe("success");
        expect(rebased.project.nodes[0]?.metadata?.content).toBe("https://media/gen");
        expect(rebased.project.nodes[1]?.title).toBe("Autumn travel camping table");
        expect(rebased.project.nodes[2]?.title).toBe("Autumn travel·Lakeside traverse");
    });

    test("same-field human content edit keeps local value and remains a recoverable conflict", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", content: "old picture" });
        const base = project([original], 10);
        const local = project([{ ...original, metadata: { taskId: "task-1", status: "loading", content: "Content modified by humans" } }], 10);
        const remote = project([{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]?.metadata?.content).toBe("Content modified by humans");
        expect(settled.nodes[0]?.metadata?.status).toBe("loading");
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(true);
        expect(rebased.project.nodes[0]?.metadata?.content).toBe("Content modified by humans");
        expect(rebased.project.nodes[0]?.metadata?.status).not.toBe("success");
    });

    test("new task deleting content adopts remote success as a normal clear of the old result", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-old", status: "success", content: "old picture", storageKey: "old-key" });
        const base = project([original], 10);
        const local = project([{
            ...original,
            metadata: { taskId: "task-2", status: "loading", taskStatus: "running", taskProgress: 12, prompt: "cat" },
        }], 10);
        const remote = project([{
            ...original,
            metadata: { taskId: "task-2", status: "success", taskStatus: "succeeded", taskProgress: 100, content: "https://media/new", storageKey: "res-new", prompt: "cat" },
        }], 14);
        expect(Object.prototype.hasOwnProperty.call(local.nodes[0]?.metadata || {}, "content")).toBe(false);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]?.metadata?.status).toBe("success");
        expect(settled.nodes[0]?.metadata?.content).toBe("https://media/new");
        expect(settled.nodes[0]?.metadata?.storageKey).toBe("res-new");
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes[0]?.metadata?.content).toBe("https://media/new");
    });

    test("same-task in-flight empty overlay adopts remote bound success", () => {
        const original = node("node-dlu63hran9ns-43e87554d6", "Autumn travel", {
            taskId: "e24cb37f0a7d146afc8560456d88a550",
            status: "success",
            taskStatus: "succeeded",
            content: "/api/resources/8edbd8862c4714bbe42424d83e63bc08/file",
            storageKey: "resource:8edbd8862c4714bbe42424d83e63bc08",
        });
        const base = project([original], 34);
        const local = project([{ ...original, metadata: { ...original.metadata, status: "loading", content: "", storageKey: undefined, assetId: undefined } }], 34);
        const remote = project([original], 34);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]?.metadata?.status).toBe("success");
        expect(settled.nodes[0]?.metadata?.content).toBe("/api/resources/8edbd8862c4714bbe42424d83e63bc08/file");
        expect(settled.nodes[0]?.metadata?.storageKey).toBe("resource:8edbd8862c4714bbe42424d83e63bc08");
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes[0]?.metadata?.status).toBe("success");
        expect(rebased.project.nodes[0]?.metadata?.storageKey).toBe("resource:8edbd8862c4714bbe42424d83e63bc08");
    });

    test("in-flight nonempty human content still wins over remote success", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", content: "old picture", storageKey: "old-key" });
        const base = project([original], 10);
        const local = project([{ ...original, metadata: { taskId: "task-1", status: "loading", content: "Content modified by humans" } }], 10);
        const remote = project([{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]?.metadata?.content).toBe("Content modified by humans");
        expect(settled.nodes[0]?.metadata?.status).toBe("loading");
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(true);
        expect(rebased.project.nodes[0]?.metadata?.content).toBe("Content modified by humans");
    });

    test("baseline empty content on first generation is not treated as a human clear", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", content: "" });
        const base = project([original], 10);
        const local = project([{ ...original, metadata: { taskId: "task-1", status: "loading", content: "", taskStatus: "running" } }], 10);
        const remote = project([{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]?.metadata?.status).toBe("success");
        expect(settled.nodes[0]?.metadata?.content).toBe("https://media/gen");
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
    });

    test("remote taskStatus succeeded without bound media is not authoritative completion", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", content: "old picture" });
        const base = project([original], 10);
        const local = project([{
            ...original,
            metadata: { taskId: "task-1", status: "loading", content: "https://local-kept", storageKey: "local-key", taskStatus: "running" },
        }], 10);
        const remote = project([{
            ...original,
            metadata: { taskId: "task-1", status: "loading", taskStatus: "succeeded", taskProgress: 100, content: "" },
        }], 21);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]).toBe(local.nodes[0]);
        expect(settled.nodes[0]?.metadata?.status).toBe("loading");
        expect(settled.nodes[0]?.metadata?.content).toBe("https://local-kept");
        expect(settled.nodes[0]?.metadata?.storageKey).toBe("local-key");
        expect(settled.nodes[0]?.metadata?.taskStatus).toBe("running");
    });

    test("remote success without media result does not clear local media fields", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", content: "old picture" });
        const base = project([original], 10);
        const local = project([{
            ...original,
            metadata: { taskId: "task-1", status: "error", content: "https://local-kept", storageKey: "local-key", errorDetails: "Canvas has been updated elsewhere" },
        }], 10);
        const remote = project([{
            ...original,
            metadata: { taskId: "task-1", status: "success", taskStatus: "succeeded", content: "" },
        }], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]).toBe(local.nodes[0]);
        expect(settled.nodes[0]?.metadata?.content).toBe("https://local-kept");
        expect(settled.nodes[0]?.metadata?.storageKey).toBe("local-key");
        expect(settled.nodes[0]?.metadata?.status).toBe("error");
    });

    test("idle or human non-overlay status is not overwritten by remote bound success", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", content: "old picture" });
        const base = project([original], 10);
        const idleLocal = project([{ ...original, metadata: { taskId: "task-1", status: "idle", content: "old picture", prompt: "Humans changed the prompt" } }], 10);
        const successLocal = project([{ ...original, metadata: { taskId: "task-1", status: "success", content: "Pictures left by humans" } }], 10);
        const remote = project([{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }], 14);
        const settledIdle = settleInFlightGenerationOverlay({ base, local: idleLocal, remote });
        const settledSuccess = settleInFlightGenerationOverlay({ base, local: successLocal, remote });
        expect(settledIdle.nodes[0]).toBe(idleLocal.nodes[0]);
        expect(settledIdle.nodes[0]?.metadata?.status).toBe("idle");
        expect(settledIdle.nodes[0]?.metadata?.content).toBe("old picture");
        expect(settledIdle.nodes[0]?.metadata?.prompt).toBe("Humans changed the prompt");
        expect(settledSuccess.nodes[0]).toBe(successLocal.nodes[0]);
        expect(settledSuccess.nodes[0]?.metadata?.content).toBe("Pictures left by humans");
    });

    test("error overlay of the same in-flight task adopts remote bound success", () => {
        const original = node("image-origin", "Original picture", { taskId: "task-1", status: "idle", prompt: "cat" });
        const base = project([original], 10);
        const local = project([{
            ...original,
            metadata: {
                taskId: "task-1",
                status: "error",
                generationErrorCode: "canvas_conflict",
                errorDetails: "The cloud canvas has been updated and coverage has stopped; please keep the local draft and load the latest version",
                prompt: "cat",
            },
        }], 10);
        const remote = project([{
            ...original,
            metadata: { taskId: "task-1", status: "success", taskStatus: "succeeded", content: "https://media/gen", storageKey: "res-gen", prompt: "cat" },
        }], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]?.metadata?.status).toBe("success");
        expect(settled.nodes[0]?.metadata?.content).toBe("https://media/gen");
        expect(settled.nodes[0]?.metadata?.errorDetails).toBeUndefined();
        expect(settled.nodes[0]?.metadata?.generationErrorCode).toBeUndefined();
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
    });

    test("new-task overlay does not adopt a different remote task's bound success", () => {
        const original = node("node-dlu63hran9ns-43e87554d6", "Autumn travel", {
            taskId: "e24cb37f0a7d146afc8560456d88a550",
            status: "success",
            taskStatus: "succeeded",
            content: "/api/resources/8edbd8862c4714bbe42424d83e63bc08/file",
            storageKey: "resource:8edbd8862c4714bbe42424d83e63bc08",
        });
        const base = project([original], 34);
        const local = project([{
            ...original,
            metadata: { taskId: "task-new", status: "loading", taskStatus: "running", prompt: "new tips" },
        }], 34);
        const remote = project([original], 34);
        expect(Object.prototype.hasOwnProperty.call(local.nodes[0]?.metadata || {}, "content")).toBe(false);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]).toBe(local.nodes[0]);
        expect(settled.nodes[0]?.metadata?.taskId).toBe("task-new");
        expect(settled.nodes[0]?.metadata?.status).toBe("loading");
        expect(settled.nodes[0]?.metadata?.storageKey).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(settled.nodes[0]?.metadata || {}, "content")).toBe(false);
    });

    test("real human empty-string clear on non-overlay is not settled as overlay", () => {
        const original = node("image-origin", "Original picture", {
            taskId: "task-1",
            status: "success",
            content: "old picture",
            storageKey: "old-key",
        });
        const base = project([original], 10);
        const local = project([{ ...original, metadata: { ...original.metadata, content: "" } }], 10);
        const remote = project([original], 14);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        expect(settled.nodes[0]).toBe(local.nodes[0]);
        expect(settled.nodes[0]?.metadata?.status).toBe("success");
        expect(settled.nodes[0]?.metadata?.content).toBe("");
        expect(settled.nodes[0]?.metadata?.storageKey).toBe("old-key");
    });

    test("settled overlay and stale running bound node both resolve taskOutcome to ready", () => {
        const inFlightOutcome = { phase: "running" as const, regenerate: "blocked" as const, reason: "in_flight" };
        const original = node("image-origin", "Original picture", {
            taskId: "task-1",
            status: "loading",
            taskStatus: "running",
            taskOutcome: inFlightOutcome,
        });
        const remoteBoundWithoutOutcome = project([
            node("image-origin", "Original picture", {
                taskId: "task-1",
                status: "success",
                taskStatus: "succeeded",
                taskProgress: 100,
                content: "/api/resources/res-1/file",
                storageKey: "resource:res-1",
                assetId: "asset-1",
            }),
        ], 12);
        const settledFromLoading = settleInFlightGenerationOverlay({
            base: project([original], 10),
            local: project([original], 10),
            remote: remoteBoundWithoutOutcome,
        });
        expect(settledFromLoading.nodes[0]?.metadata?.taskOutcome).toEqual({
            phase: "ready",
            regenerate: "allowed",
            reason: "result_ready",
        });

        const staleBoundLocal = project([
            node("image-origin", "Original picture", {
                taskId: "task-1",
                status: "success",
                taskStatus: "succeeded",
                taskProgress: 100,
                content: "/api/resources/res-1/file",
                storageKey: "resource:res-1",
                assetId: "asset-1",
                taskOutcome: inFlightOutcome,
            }),
        ], 12);
        const settledFromStaleSuccess = settleInFlightGenerationOverlay({
            base: remoteBoundWithoutOutcome,
            local: staleBoundLocal,
            remote: remoteBoundWithoutOutcome,
        });
        expect(settledFromStaleSuccess.nodes[0]?.metadata?.taskOutcome).toEqual({
            phase: "ready",
            regenerate: "allowed",
            reason: "result_ready",
        });
    });
});

describe("rebaseCanvasDocumentThreeWay node timestamps", () => {
    const stamp = (item: CanvasNodeData): CanvasNodeData => ({ ...item, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });

    test("remote delete drops a node whose local copy only gained createdAt/updatedAt", () => {
        const assistant = node("a1", "Helper text");
        const kept = node("k1", "Reserve");
        const result = rebaseCanvasDocumentThreeWay({
            base: project([assistant, kept], 7),
            local: project([stamp(assistant), kept], 7),
            remote: project([kept], 8),
        });
        expect(result.conflict).toBe(false);
        expect(result.project.nodes.map((item) => item.id)).toEqual(["k1"]);
    });

    test("remote delete of a locally retitled node is still a conflict and keeps the local node", () => {
        const assistant = node("a1", "Helper text");
        const result = rebaseCanvasDocumentThreeWay({
            base: project([assistant], 7),
            local: project([{ ...stamp(assistant), title: "Locally modified title" }], 7),
            remote: project([], 8),
        });
        expect(result.conflict).toBe(true);
        expect(result.project.nodes.map((item) => item.title)).toEqual(["Locally modified title"]);
    });

    test("node-level updatedAt differences and backend null-cleared bind fields do not cause false conflicts", () => {
        const baseNode: CanvasNodeData = {
            ...node("v1", "Storyboard video", {
                taskId: "task-1",
                status: "loading",
                taskStatus: "running",
                taskStage: "generating",
                errorDetails: "old error",
            }),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        const localNode: CanvasNodeData = {
            ...baseNode,
            updatedAt: "2026-01-01T00:00:05.000Z",
            metadata: {
                ...baseNode.metadata,
                taskProgress: 35,
                taskUpdatedAt: "2026-01-01T00:00:05.000Z",
            },
        };
        const remoteNode: CanvasNodeData = {
            ...baseNode,
            updatedAt: "2026-01-01T00:00:09.000Z",
            metadata: {
                taskId: "task-1",
                status: "success",
                taskStatus: "succeeded",
                taskProgress: 100,
                content: "/api/resources/res-v1/file",
                storageKey: "resource:res-v1",
                assetId: "asset-v1",
                taskStage: null as unknown as undefined,
                errorDetails: null as unknown as undefined,
            },
        };
        const base = project([baseNode], 10);
        const local = project([localNode], 10);
        const remote = project([remoteNode], 11);
        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes[0]?.metadata?.status).toBe("success");
        expect(rebased.project.nodes[0]?.metadata?.taskStage).toBeUndefined();
        expect(rebased.project.nodes[0]?.metadata?.errorDetails).toBeUndefined();
    });

    test("same-task in-flight polling telemetry differences do not trigger rebase conflict", () => {
        const baseNode = node("v1", "Storyboard video", {
            taskId: "task-running",
            status: "loading",
            taskStatus: "running",
            taskProgress: 10,
            taskStage: "queued",
            taskUpdatedAt: "2026-01-01T00:00:01.000Z",
        });
        const localNode = {
            ...baseNode,
            updatedAt: "2026-01-01T00:00:04.000Z",
            metadata: {
                ...baseNode.metadata,
                taskProgress: 45,
                taskStage: "rendering",
                taskUpdatedAt: "2026-01-01T00:00:04.000Z",
            },
        };
        const remoteNode = {
            ...baseNode,
            updatedAt: "2026-01-01T00:00:02.000Z",
            metadata: {
                ...baseNode.metadata,
                taskProgress: 20,
                taskStage: "rendering",
                taskUpdatedAt: "2026-01-01T00:00:02.000Z",
            },
        };
        const rebased = rebaseCanvasDocumentThreeWay({
            base: project([baseNode], 10),
            local: project([localNode], 10),
            remote: project([remoteNode], 11),
        });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes[0]?.metadata?.taskProgress).toBe(45);
    });

    test("canvasGenerationTaskNodes preserves array reference when running poll only changes updatedAt", () => {
        const initialTask: GenerationTask = {
            id: "task-poll-1",
            type: "canvas_video",
            status: "running",
            stage: "generating",
            progress: 30,
            prompt: "Shot 1",
            attempts: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
        };
        const boundNodes = canvasGenerationTaskNodes([node("v1", "Shot 1")], "v1", initialTask);
        const pollTickNodes = canvasGenerationTaskNodes(boundNodes, "v1", {
            ...initialTask,
            updatedAt: "2026-01-01T00:00:04.000Z",
            durationMs: 4000,
        });
        expect(pollTickNodes).toBe(boundNodes);

        const progressedNodes = canvasGenerationTaskNodes(boundNodes, "v1", {
            ...initialTask,
            progress: 60,
            updatedAt: "2026-01-01T00:00:06.000Z",
        });
        expect(progressedNodes).not.toBe(boundNodes);
        expect(progressedNodes[0]?.metadata?.taskProgress).toBe(60);
    });

    test("task failure transition and subsequent retry submission do not trigger false rebase conflict", () => {
        const baseNode = node("v1", "Storyboard video", {
            taskId: "task-1",
            status: "loading",
            taskStatus: "running",
            taskProgress: 20,
            taskUpdatedAt: "2026-01-01T00:00:02.000Z",
            prompt: "Let the protagonist turn around",
        });
        const failedRemoteNode = node("v1", "Storyboard video", {
            taskId: "task-1",
            status: "error",
            taskStatus: "failed",
            errorDetails: "Upstream request timeout",
            generationErrorCode: "timeout",
            taskOutcome: { phase: "failed", regenerate: "confirm", reason: "outcome_unknown" },
            taskUpdatedAt: "2026-01-01T00:00:08.000Z",
            prompt: "Let the protagonist turn around",
        });
        const resubmittedLocalNode = node("v1", "Storyboard video", {
            taskId: "task-2",
            status: "loading",
            taskStatus: "running",
            taskProgress: 5,
            taskUpdatedAt: "2026-01-01T00:00:12.000Z",
            prompt: "Make the protagonist turn around and smile",
        });
        const rebased = rebaseCanvasDocumentThreeWay({
            base: project([baseNode], 10),
            local: project([resubmittedLocalNode], 10),
            remote: project([failedRemoteNode], 11),
        });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes[0]?.metadata?.status).toBe("loading");
        expect(rebased.project.nodes[0]?.metadata?.taskId).toBe("task-2");
        expect(rebased.project.nodes[0]?.metadata?.errorDetails).toBeUndefined();
        expect(rebased.project.nodes[0]?.metadata?.prompt).toBe("Make the protagonist turn around and smile");
    });

    test("insertCanvasResourceMentionAtSelection inserts token at cursor offset instead of always appending", () => {
        const ref = { id: "ref-1", nodeId: "img-1", kind: "image" as const, label: "Picture 1", title: "character diagram", active: true };
        const middle = insertCanvasResourceMentionAtSelection("Let the protagonist walk to the door and then turn around", ref, { start: 1, end: 1 });
        expect(middle.prompt).toBe("Let @[node:img-1] the protagonist walk to the door and then turn around");
        expect(middle.cursor).toBe("let@[node:img-1]".length);

        const tail = insertCanvasResourceMentionAtSelection("Let the protagonist walk to the door", ref, null);
        expect(tail.prompt).toBe("Let the protagonist walk to the door @[node:img-1]");
    });

    test("sameNodeSemanticData ignores in-flight poll telemetry keys and isolateCopiedNodeMetadata strips generatedFromNodeId", () => {
        const n1 = node("v1", "video", { status: "loading", taskId: "t1", taskProgress: 10, taskUpdatedAt: "t1" });
        const n2 = node("v1", "video", { status: "loading", taskId: "t1", taskProgress: 65, taskUpdatedAt: "t2", taskStage: "rendering" });
        expect(sameNodeSemanticData(n1, n2)).toBe(true);

        const copiedMeta = isolateCopiedNodeMetadata(
            node("v2", "video copy", {
                content: "/api/resources/r1/file",
                generatedFromNodeId: "img-origin",
                generationFailure: { category: "request_failed", retryable: true, summary: "err", detail: "err" } as never,
                taskOutcomeSource: "synthetic",
            }),
            new Map(),
        );
        expect(copiedMeta.generatedFromNodeId).toBeUndefined();
        expect(copiedMeta.generationFailure).toBeUndefined();
        expect(copiedMeta.taskOutcomeSource).toBeUndefined();
    });
});
