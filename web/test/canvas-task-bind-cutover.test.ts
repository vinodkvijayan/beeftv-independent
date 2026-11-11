import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, test } from "bun:test";

import { bindBackendCanvasGenerationResult, CanvasBindFlushError, CanvasBindProjectionAdoptionError } from "@/services/canvas-generation-consumer";
import { ApiError } from "@/services/api/request";
import { CanvasBackendSubmitPausedError } from "@/services/canvas-revision-conflict";
import type { CanvasTaskBindReceipt } from "@/services/api/operations";
import { hydrateBackendGeneratedAsset, hydrateBackendGeneratedOutputs } from "@/services/project-asset-sync";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { getClientDiagnosticEvents, recordDiagnosticEvent, setDiagnosticUserScope } from "@/services/diagnostics/client-diagnostics";

const generationSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-generation.ts"), "utf8");
const consumerSource = readFileSync(resolve(import.meta.dir, "../src/services/canvas-generation-consumer.ts"), "utf8");
const syncSource = readFileSync(resolve(import.meta.dir, "../src/services/project-asset-sync.ts"), "utf8");

const completeImageAsset = {
    id: "generation_abc",
    kind: "image",
    title: "Generate graph",
    coverUrl: "https://example.com/a.png",
    tags: ["generate"],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    data: { dataUrl: "https://example.com/a.png", width: 8, height: 8, bytes: 12, mimeType: "image/png" },
} as Asset;

function canvasNode(id: string, title: string, metadata: CanvasNodeData["metadata"], position = { x: 11, y: 22 }): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title,
        position,
        width: 320,
        height: 220,
        metadata,
    };
}

function canvasProject(id: string, nodes: CanvasNodeData[], revision = 3): CanvasProject {
    return {
        id,
        revision,
        title: "canvas",
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

function succeededTask(): GenerationTask {
    return {
        id: "task-1",
        type: "canvas_image",
        status: "succeeded",
        prompt: "cat",
        attempts: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "generation_abc" }],
    };
}

test("normal output readiness retries emit one request and retain the earlier real failure", async () => {
    setDiagnosticUserScope("bind-readiness-retention");
    recordDiagnosticEvent({ category: "task", level: "error", code: "retained-conflict", message: "binding conflict" });
    const node = canvasNode("node-1", "target", { taskId: "task-1" });
    const project = canvasProject("canvas-1", [node], 4);
    useCanvasStore.setState({ projects: [project] });
    let attempts = 0;
    await bindBackendCanvasGenerationResult({
        canvasId: project.id, nodeId: node.id, task: succeededTask(), nodesRef: { current: [node] }, setNodes: () => {}, isCurrent: () => true,
        runtime: {
            hydrateOutputs: async () => undefined, persistDocument: async () => undefined,
            now: () => 0, sleep: async () => undefined,
            refreshTask: async () => succeededTask(), adoptConfirmedProjection: async () => project,
            bindOutput: async (input) => {
                if (++attempts <= 600) throw new ApiError("Still saving", { status: 409, reason: "output_not_ready" });
                return { op: "canvas.task.bind", opId: input.operationId, replayed: false, result: { bindingStatus: "bound", canvas: project, revision: 4 } };
            },
        },
    });
    const events = getClientDiagnosticEvents();
    expect(attempts).toBe(601);
    expect(events.filter(event => event.code === "generation_bind_requested")).toHaveLength(1);
    expect(events.filter(event => event.code === "generation_bind_refused")).toHaveLength(0);
    expect(events.some(event => event.code === "retained-conflict")).toBe(true);
});

describe("backend canvas bind cutover", () => {
    test("use-canvas-generation binds succeeded backend tasks without snapshot doublewrite", () => {
        const applyStart = generationSource.indexOf("const applyGenerationTaskResult = useCallback(");
        const applyEnd = generationSource.indexOf("const retrieveTaskResult = useCallback", applyStart);
        const apply = generationSource.slice(applyStart, applyEnd);
        expect(apply).toContain("bindBackendCanvasGenerationResult");
        expect(apply).not.toContain("applyStoredTaskResult");
        expect(apply).not.toContain("persistCanvasGenerationEffect");
        expect(apply).not.toContain("consumeGenerationTaskNode");
        expect(apply).not.toContain("applyRecoveredGenerationTaskResultToNodes");

        const recoverStart = generationSource.indexOf("export async function recoverCanvasGenerationTaskNode");
        const recoverEnd = generationSource.indexOf("export function useCanvasGeneration", recoverStart);
        const recover = generationSource.slice(recoverStart, recoverEnd);
        expect(recover).toContain("await input.applyGenerationTaskResult");
        expect(recover).not.toContain("storyboardRowsFromTask");
    });

    test("bind helper flushes the journal then binds generation fields only", () => {
        const bindStart = consumerSource.indexOf("export async function bindBackendCanvasGenerationResult");
        const bindEnd = consumerSource.indexOf("async function defaultAdoptConfirmedProjection", bindStart);
        const bind = consumerSource.slice(bindStart, bindEnd);
        expect(bind).toContain("persistDocument");
        expect(bind).toContain("bindOutput");
        expect(bind).toContain("adoptConfirmedProjection");
        expect(bind).toContain("CanvasBindFlushError");
        expect(bind).toContain("persistDocument(capturedCanvasId, { nodes: live.nodes, connections: live.connections })");
        expect(bind).toContain("isCanvasRevisionConflict");
        expect(bind).toContain("CanvasBackendSubmitPausedError");
        expect(bind).toContain("adoptConfirmedProjection(canonical)");
        expect(bind).not.toContain("overlayBoundGenerationOnLiveCanvas");
        expect(bind).not.toContain("overlayGenerationReceiptOnNode");
        expect(bind).not.toContain("recordConfirmedBindProjection");
        expect(bind).not.toContain("persistCanvasGenerationEffect");
        expect(bind).not.toContain("applyExternalCanvasRevision");
        expect(consumerSource).not.toContain("overlayBoundGenerationOnLiveCanvas");
        expect(consumerSource).toContain("runtime.persistDocument ?? persistCanvasDocument");
        expect(consumerSource).toContain("return adopt(project);");
    });

    test("message consumers hydrate backend outputs instead of rematerializing", () => {
        const start = syncSource.indexOf("export async function consumeGenerationTaskMessage");
        const end = syncSource.indexOf("export function generationTaskMaterializedUrls", start);
        const consume = syncSource.slice(start, end);
        expect(consume).toContain("hasBackendDeliveredGenerationOutputs");
        expect(consume).toContain("hydrateBackendGeneratedOutputs");
        expect(consume).toContain("bindBackendConversationMessageResult");
        expect(consume).not.toContain("uploadGeneratedAssetToConfiguredSources");
    });
});

test("late bind after switching canvases never projects the old graph into the new canvas", async () => {
    const oldNode = canvasNode("node-1", "old canvas", { taskId: "task-1" });
    const replacement = canvasNode("node-2", "current canvas", {});
    const server = canvasProject("canvas-1", [oldNode], 4);
    useCanvasStore.setState({ projects: [server] });
    const nodesRef = { current: [replacement] };
    let current = true;
    let uiWrites = 0;
    await bindBackendCanvasGenerationResult({
        canvasId: "canvas-1", nodeId: oldNode.id, task: succeededTask(), nodesRef,
        isCurrent: () => current, setNodes: () => { uiWrites++; },
        runtime: {
            hydrateOutputs: async () => undefined, persistDocument: async () => undefined,
            bindOutput: async (input) => {
                current = false;
                return { op: "canvas.task.bind", opId: input.operationId, replayed: false, revision: 4,
                    result: { applied: true, bindingStatus: "bound", canvasId: "canvas-1", nodeId: oldNode.id, taskId: "task-1", canvas: server, revision: 4 } };
            },
            adoptConfirmedProjection: async () => server,
        },
    });
    expect(uiWrites).toBe(0);
    expect(nodesRef.current).toEqual([replacement]);
});

describe("hydrateBackendGeneratedAsset", () => {
    test("inserts the backend asset without downloading or uploading a blob", async () => {
        const written: Asset[] = [];
        const fetched: string[] = [];
        const asset = await hydrateBackendGeneratedAsset("generation_abc", undefined, {
            getAsset: async (id) => {
                fetched.push(id);
                return { asset: completeImageAsset };
            },
            readAssets: () => [],
            writeAsset: (item) => {
                written.push(item);
            },
        });
        expect(fetched).toEqual(["generation_abc"]);
        expect(asset.id).toBe("generation_abc");
        expect(written).toHaveLength(1);
        expect(written[0]?.id).toBe("generation_abc");
    });

    test("reuses an already hydrated asset and does not refetch", async () => {
        let fetches = 0;
        const asset = await hydrateBackendGeneratedAsset("generation_abc", undefined, {
            getAsset: async () => {
                fetches += 1;
                return { asset: completeImageAsset };
            },
            readAssets: () => [completeImageAsset],
            writeAsset: () => {
                throw new Error("should not rewrite");
            },
        });
        expect(fetches).toBe(0);
        expect(asset.id).toBe("generation_abc");
    });

    test("hydrates every delivered output id", async () => {
        const fetched: string[] = [];
        await hydrateBackendGeneratedOutputs(
            {
                outputs: [
                    { outputIndex: 0, mediaType: "image", materializedAssetId: "generation_abc" },
                    { outputIndex: 1, mediaType: "image", materializedAssetId: "generation_def" },
                ],
            },
            undefined,
            {
                getAsset: async (id) => {
                    fetched.push(id);
                    return { asset: { ...completeImageAsset, id } };
                },
                readAssets: () => [],
                writeAsset: () => undefined,
            },
        );
        expect(fetched).toEqual(["generation_abc", "generation_def"]);
    });
});

function bindReceipt(project: CanvasProject, nodeId: string, extra: Partial<CanvasTaskBindReceipt> = {}): CanvasTaskBindReceipt {
    const node = project.nodes.find((item) => item.id === nodeId);
    return {
        applied: true,
        canvasId: project.id,
        nodeId,
        taskId: "task-1",
        bindingStatus: "bound",
        content: "/api/resources/res-1/file",
        storageKey: "resource:res-1",
        assetId: "generation_abc",
        revision: project.revision,
        canvas: project,
        node,
        ...extra,
    };
}

describe("bindBackendCanvasGenerationResult", () => {
    beforeEach(() => {
        useCanvasStore.setState({ projects: [] });
    });

    test("flushes drafts then overlays generation fields without replacing title or sibling drafts", async () => {
        const bound = canvasNode("node-1", "Manual title", { taskId: "task-1", status: "loading", prompt: "cat" }, { x: 11, y: 22 });
        const sibling = canvasNode("node-2", "No draft submitted", { status: "idle", prompt: "Modified locally" }, { x: 40, y: 50 });
        const live = canvasProject("canvas-1", [bound, sibling], 3);
        const server = canvasProject("canvas-1", [
            { ...bound, metadata: { ...bound.metadata, status: "success", content: "/api/resources/res-1/file", storageKey: "resource:res-1", assetId: "generation_abc" } },
            sibling,
        ], 4);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [bound, sibling] };
        const setNodesLog: CanvasNodeData[][] = [];
        const order: string[] = [];
        let adopted: CanvasProject | undefined;

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                const next = typeof value === "function" ? value(nodesRef.current) : value;
                nodesRef.current = next;
                setNodesLog.push(next);
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async () => {
                    order.push("flush");
                },
                bindOutput: async (input) => {
                    order.push("bind");
                    return {
                        op: "canvas.task.bind",
                        opId: input.operationId,
                        replayed: false,
                        revision: 4,
                        result: bindReceipt(server, "node-1", { effectKey: input.operationId }),
                    };
                },
                adoptConfirmedProjection: async (project) => {
                    order.push("adopt");
                    adopted = project;
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(order).toEqual(["flush", "bind", "adopt"]);
        const nextBound = nodesRef.current.find((item) => item.id === "node-1");
        const nextSibling = nodesRef.current.find((item) => item.id === "node-2");
        expect(nextBound?.title).toBe("Manual title");
        expect(nextBound?.position).toEqual({ x: 11, y: 22 });
        expect(nextBound?.metadata?.prompt).toBe("cat");
        expect(nextBound?.metadata?.status).toBe("success");
        expect(nextBound?.metadata?.content).toBe("/api/resources/res-1/file");
        expect(nextSibling?.title).toBe("No draft submitted");
        expect(nextSibling?.metadata?.prompt).toBe("Modified locally");
        expect(adopted?.nodes.find((item) => item.id === "node-1")?.metadata?.content).toBe("/api/resources/res-1/file");
        expect(adopted?.nodes.find((item) => item.id === "node-2")?.title).toBe("No draft submitted");
        expect(useCanvasStore.getState().projects[0]?.revision).toBe(4);
        expect(setNodesLog.length).toBeGreaterThan(0);
    });

    test("late response after canvas switch still binds the original canvas and leaves the next canvas untouched", async () => {
        const originalNode = canvasNode("node-1", "Original canvas node", { taskId: "task-1", status: "loading" });
        const nextNode = canvasNode("node-next", "next canvas", { status: "idle", prompt: "exact draft" });
        const original = canvasProject("canvas-1", [originalNode], 3);
        const next = canvasProject("canvas-2", [nextNode], 1);
        const server = canvasProject("canvas-1", [
            { ...originalNode, metadata: { ...originalNode.metadata, status: "success", content: "/api/resources/res-1/file" } },
        ], 4);
        useCanvasStore.setState({ projects: [original, next] });
        const nodesRef = { current: [originalNode] };
        let liveCurrent = true;

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => liveCurrent,
            nodesRef,
            setNodes: (value) => {
                const nextNodes = typeof value === "function" ? value(nodesRef.current) : value;
                nodesRef.current = nextNodes;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async (id) => {
                    expect(id).toBe("canvas-1");
                },
                bindOutput: async (input) => {
                    liveCurrent = false;
                    nodesRef.current = [nextNode];
                    return {
                        op: "canvas.task.bind",
                        opId: input.operationId,
                        replayed: false,
                        revision: 4,
                        result: bindReceipt(server, "node-1", { effectKey: input.operationId }),
                    };
                },
                adoptConfirmedProjection: async (project) => {
                    useCanvasStore.setState((state) => ({
                        projects: state.projects.map((item) => (item.id === project.id ? project : item)),
                    }));
                    return project;
                },
            },
        });

        expect(nodesRef.current[0]?.id).toBe("node-next");
        expect(nodesRef.current[0]?.title).toBe("next canvas");
        expect(nodesRef.current[0]?.metadata?.prompt).toBe("exact draft");
        expect(nodesRef.current[0]?.metadata?.content).toBeUndefined();
        const storedOriginal = useCanvasStore.getState().projects.find((project) => project.id === "canvas-1");
        const storedNext = useCanvasStore.getState().projects.find((project) => project.id === "canvas-2");
        expect(storedOriginal?.nodes[0]?.metadata?.content).toBe("/api/resources/res-1/file");
        expect(storedOriginal?.nodes[0]?.title).toBe("Original canvas node");
        expect(storedNext?.nodes[0]?.title).toBe("next canvas");
        expect(storedNext?.nodes[0]?.metadata?.prompt).toBe("exact draft");
        expect(storedNext?.nodes[0]?.metadata?.content).toBeUndefined();
    });

    test("attach errors do not fall back to a full snapshot write", async () => {
        const bound = canvasNode("node-1", "Manual title", { taskId: "task-1", status: "loading" });
        useCanvasStore.setState({ projects: [canvasProject("canvas-1", [bound])] });
        const nodesRef = { current: [bound] };
        let adopted = 0;

        await expect(
            bindBackendCanvasGenerationResult({
                canvasId: "canvas-1",
                nodeId: "node-1",
                task: succeededTask(),
                isCurrent: () => true,
                nodesRef,
                setNodes: (value) => {
                    nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                },
                runtime: {
                    hydrateOutputs: async () => undefined,
                    persistDocument: async () => undefined,
                    bindOutput: async () => {
                        throw new Error("Binding failed");
                    },
                    adoptConfirmedProjection: async () => {
                        adopted += 1;
                        return undefined;
                    },
                },
            }),
        ).rejects.toThrow("Binding failed");

        expect(adopted).toBe(0);
        expect(nodesRef.current[0]?.metadata?.status).toBe("loading");
        expect(nodesRef.current[0]?.title).toBe("Manual title");
    });

    test("flush failure leaves the draft and does not bind or advance the journal", async () => {
        const bound = canvasNode("node-1", "Manual title", { taskId: "task-1", status: "loading", prompt: "exact draft" });
        useCanvasStore.setState({ projects: [canvasProject("canvas-1", [bound])] });
        const nodesRef = { current: [bound] };
        let boundCalls = 0;
        let adopted = 0;

        await expect(
            bindBackendCanvasGenerationResult({
                canvasId: "canvas-1",
                nodeId: "node-1",
                task: succeededTask(),
                isCurrent: () => true,
                nodesRef,
                setNodes: (value) => {
                    nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                },
                runtime: {
                    hydrateOutputs: async () => undefined,
                    persistDocument: async () => {
                        throw new Error("revision conflict");
                    },
                    bindOutput: async () => {
                        boundCalls += 1;
                        throw new Error("should not bind");
                    },
                    adoptConfirmedProjection: async () => {
                        adopted += 1;
                        return undefined;
                    },
                },
            }),
        ).rejects.toBeInstanceOf(CanvasBindFlushError);

        expect(boundCalls).toBe(0);
        expect(adopted).toBe(0);
        expect(nodesRef.current[0]?.metadata?.prompt).toBe("exact draft");
        expect(nodesRef.current[0]?.metadata?.status).toBe("loading");
    });

    test("After Agent adds other nodes, persist 409 still binds the successful result and retains the new node.", async () => {
        const bound = canvasNode("image-origin", "Original picture", { taskId: "task-1", status: "loading", prompt: "cat", taskProgress: 42, taskStage: "Pictured" });
        const camp = canvasNode("node-camp", "Autumn travel camping table", { status: "idle" }, { x: 80, y: 40 });
        const lake = canvasNode("node-lake", "Autumn travel·Lakeside traverse", { status: "idle" }, { x: 160, y: 40 });
        const live = canvasProject("canvas-1", [bound, camp, lake], 10);
        const server = canvasProject("canvas-1", [
            { ...bound, metadata: { ...bound.metadata, status: "success", taskStatus: "succeeded", taskProgress: 100, content: "/api/resources/res-1/file", storageKey: "resource:res-1", assetId: "generation_abc" } },
            camp,
            lake,
        ], 14);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [bound, camp, lake] };
        const order: string[] = [];

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "image-origin",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async () => {
                    order.push("flush");
                    throw new ApiError("The cloud canvas has been updated and coverage has stopped; please keep the local draft and load the latest version", { status: 409, reason: "conflict" });
                },
                bindOutput: async (input) => {
                    order.push("bind");
                    return {
                        op: "canvas.task.bind",
                        opId: input.operationId,
                        replayed: false,
                        revision: 14,
                        result: bindReceipt(server, "image-origin", { effectKey: input.operationId, revision: 14 }),
                    };
                },
                adoptConfirmedProjection: async (project) => {
                    order.push("adopt");
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(order).toEqual(["flush", "bind", "adopt"]);
        expect(nodesRef.current.find((item) => item.id === "image-origin")?.metadata?.status).toBe("success");
        expect(nodesRef.current.find((item) => item.id === "image-origin")?.metadata?.content).toBe("/api/resources/res-1/file");
        expect(nodesRef.current.find((item) => item.id === "node-camp")?.title).toBe("Autumn travel camping table");
        expect(nodesRef.current.find((item) => item.id === "node-lake")?.title).toBe("Autumn travel·Lakeside traverse");
        expect(useCanvasStore.getState().projects[0]?.revision).toBe(14);
        expect(nodesRef.current).toEqual(useCanvasStore.getState().projects[0]?.nodes);
    });

    test("When canvas submission is paused, the success result is still bound, and the pause is not regarded as a generation failure.", async () => {
        const bound = canvasNode("node-1", "Original picture", { taskId: "task-1", status: "loading" });
        const sibling = canvasNode("node-2", "Agent new lens", { status: "idle" });
        const live = canvasProject("canvas-1", [bound, sibling], 10);
        const server = canvasProject("canvas-1", [
            { ...bound, metadata: { ...bound.metadata, status: "success", content: "/api/resources/res-1/file" } },
            sibling,
        ], 11);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [bound, sibling] };
        let boundCalls = 0;

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async () => {
                    throw new CanvasBackendSubmitPausedError();
                },
                bindOutput: async (input) => {
                    boundCalls += 1;
                    return {
                        op: "canvas.task.bind",
                        opId: input.operationId,
                        replayed: false,
                        revision: 11,
                        result: bindReceipt(server, "node-1", { revision: 11 }),
                    };
                },
                adoptConfirmedProjection: async (project) => {
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(boundCalls).toBe(1);
        expect(nodesRef.current.find((item) => item.id === "node-1")?.metadata?.status).toBe("success");
        expect(nodesRef.current.find((item) => item.id === "node-2")?.title).toBe("Agent new lens");
    });

    test("replay of an old bind does not overlay generation onto a newer-task node", async () => {
        const newer = canvasNode("node-1", "New task title", {
            taskId: "task-b",
            status: "success",
            content: "/api/resources/res-b/file",
            storageKey: "resource:res-b",
            assetId: "generation_b",
            prompt: "new tasks",
        });
        const live = canvasProject("canvas-1", [newer], 8);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [newer] };
        const adopted: CanvasProject[] = [];

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async () => undefined,
                bindOutput: async (input) => ({
                    op: "canvas.task.bind",
                    opId: input.operationId,
                    replayed: true,
                    revision: 8,
                    result: {
                        ...bindReceipt(live, "node-1", {
                            taskId: "task-1",
                            bindingStatus: "replaced",
                            historical: { taskId: "task-1", content: "/api/resources/res-a/file", storageKey: "resource:res-a", assetId: "generation_abc" },
                            content: "/api/resources/res-a/file",
                            storageKey: "resource:res-a",
                            assetId: "generation_abc",
                        }),
                    },
                }),
                adoptConfirmedProjection: async (project) => {
                    adopted.push(project);
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(nodesRef.current[0]?.metadata?.taskId).toBe("task-b");
        expect(nodesRef.current[0]?.metadata?.content).toBe("/api/resources/res-b/file");
        expect(nodesRef.current[0]?.title).toBe("New task title");
        expect(useCanvasStore.getState().projects[0]?.nodes[0]?.metadata?.content).toBe("/api/resources/res-b/file");
        expect(adopted[0]?.nodes[0]?.metadata?.content).toBe("/api/resources/res-b/file");
    });

    test("deleted server node plus stale client copy is not rewritten with the old generation", async () => {
        const stale = canvasNode("node-1", "deleted copy", { taskId: "task-1", status: "success", content: "/api/resources/res-old/file" });
        const live = canvasProject("canvas-1", [stale], 3);
        const server = canvasProject("canvas-1", [], 5);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [stale] };

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async () => undefined,
                bindOutput: async (input) => ({
                    op: "canvas.task.bind",
                    opId: input.operationId,
                    replayed: true,
                    revision: 5,
                    result: {
                        applied: true,
                        canvasId: "canvas-1",
                        nodeId: "node-1",
                        taskId: "task-1",
                        bindingStatus: "deleted",
                        historical: { content: "/api/resources/res-old/file" },
                        content: "/api/resources/res-old/file",
                        canvas: server,
                        revision: 5,
                    },
                }),
                adoptConfirmedProjection: async (project) => {
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(nodesRef.current).toHaveLength(0);
        expect(useCanvasStore.getState().projects[0]?.nodes).toHaveLength(0);
    });

    test("missing receipt canvas throws instead of confirming a local snapshot revision", async () => {
        const bound = canvasNode("node-1", "Manual title", { taskId: "task-1", status: "loading" });
        useCanvasStore.setState({ projects: [canvasProject("canvas-1", [bound], 3)] });
        const nodesRef = { current: [bound] };
        let adopted = 0;

        await expect(
            bindBackendCanvasGenerationResult({
                canvasId: "canvas-1",
                nodeId: "node-1",
                task: succeededTask(),
                isCurrent: () => true,
                nodesRef,
                setNodes: (value) => {
                    nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                },
                runtime: {
                    hydrateOutputs: async () => undefined,
                    persistDocument: async () => undefined,
                    bindOutput: async (input) => ({
                        op: "canvas.task.bind",
                        opId: input.operationId,
                        replayed: false,
                        revision: 9,
                        result: { applied: true, canvasId: "canvas-1", nodeId: "node-1", taskId: "task-1", bindingStatus: "bound", revision: 9 },
                    }),
                    adoptConfirmedProjection: async () => {
                        adopted += 1;
                        return undefined;
                    },
                },
            }),
        ).rejects.toBeInstanceOf(CanvasBindProjectionAdoptionError);

        expect(adopted).toBe(0);
        expect(useCanvasStore.getState().projects[0]?.revision).toBe(3);
        expect(nodesRef.current[0]?.metadata?.status).toBe("loading");
    });

    test("same-task manual content edit is kept after replay", async () => {
        const edited = canvasNode("node-1", "Manual title", { taskId: "task-1", status: "success", content: "Narration edited by hand", prompt: "cat" });
        const live = canvasProject("canvas-1", [edited], 6);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [edited] };

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                persistDocument: async () => undefined,
                bindOutput: async (input) => ({
                    op: "canvas.task.bind",
                    opId: input.operationId,
                    replayed: true,
                    revision: 6,
                    result: bindReceipt(live, "node-1", {
                        bindingStatus: "bound",
                        content: "Narration edited by hand",
                        historical: { content: "/api/resources/res-1/file" },
                    }),
                }),
                adoptConfirmedProjection: async (project) => {
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(nodesRef.current[0]?.metadata?.content).toBe("Narration edited by hand");
        expect(nodesRef.current[0]?.title).toBe("Manual title");
        expect(useCanvasStore.getState().projects[0]?.nodes[0]?.metadata?.content).toBe("Narration edited by hand");
    });

    test("unrelated remote edit is adopted from the canonical canvas and a crash before live projection leaves it unresolved", async () => {
        const bound = canvasNode("node-1", "Manual title", { taskId: "task-1", status: "loading" });
        const remoteSibling = canvasNode("node-remote", "Shots just added by someone else", { status: "idle", prompt: "Remote editing" });
        const live = canvasProject("canvas-1", [bound], 3);
        const server = canvasProject("canvas-1", [
            { ...bound, metadata: { ...bound.metadata, status: "success", content: "/api/resources/res-1/file" } },
            remoteSibling,
        ], 5);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [bound] };
        const adopted: CanvasProject[] = [];
        let crash = true;

        const runtime = {
            hydrateOutputs: async () => undefined,
            persistDocument: async () => undefined,
            bindOutput: async (input: { operationId: string }) => ({
                op: "canvas.task.bind",
                opId: input.operationId,
                replayed: false,
                revision: 5,
                result: bindReceipt(server, "node-1", { effectKey: input.operationId }),
            }),
            adoptConfirmedProjection: async (project: CanvasProject) => {
                adopted.push(project);
                if (crash) {
                    crash = false;
                    throw new Error("crash after ack");
                }
                useCanvasStore.setState({ projects: [project] });
                return project;
            },
        };

        await expect(
            bindBackendCanvasGenerationResult({
                canvasId: "canvas-1",
                nodeId: "node-1",
                task: succeededTask(),
                isCurrent: () => true,
                nodesRef,
                setNodes: (value) => {
                    nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                },
                runtime,
            }),
        ).rejects.toThrow("crash after ack");
        expect(adopted[0]?.nodes.find((item) => item.id === "node-remote")?.title).toBe("Shots just added by someone else");
        expect(useCanvasStore.getState().projects[0]?.nodes.find((item) => item.id === "node-remote")).toBeUndefined();

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-1",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime,
        });
        expect(nodesRef.current.find((item) => item.id === "node-remote")?.title).toBe("Shots just added by someone else");
        expect(useCanvasStore.getState().projects[0]?.nodes.find((item) => item.id === "node-remote")?.metadata?.prompt).toBe("Remote editing");
    });

    test("self-heals unbound reference media and batch roots when flush hits canvas media asset guard error", async () => {
        const target = canvasNode("node-target", "Build target", { taskId: "task-1", status: "loading", prompt: "cat" });
        const unboundRef = canvasNode("node-ref", "Reference picture", {
            status: "success",
            content: "/api/resources/res-ref/file",
            storageKey: "resource:res-ref",
        });
        const batchPrimary = canvasNode("node-batch-child", "subplot", {
            status: "success",
            content: "/api/resources/res-batch/file",
            storageKey: "resource:res-batch",
            assetId: "asset-batch",
            batchRootId: "node-batch-root",
        });
        const batchRoot = canvasNode("node-batch-root", "Group root", {
            status: "success",
            content: "/api/resources/res-batch/file",
            storageKey: "resource:res-batch",
            isBatchRoot: true,
            primaryImageId: "node-batch-child",
        });
        const live = canvasProject("canvas-1", [target, unboundRef, batchPrimary, batchRoot], 3);
        const server = canvasProject("canvas-1", [
            { ...target, metadata: { ...target.metadata, status: "success", content: "/api/resources/res-1/file", storageKey: "resource:res-1", assetId: "generation_abc" } },
            { ...unboundRef, metadata: { ...unboundRef.metadata, assetId: "asset-ref-healed" } },
            batchPrimary,
            { ...batchRoot, metadata: { ...batchRoot.metadata, assetId: "asset-batch" } },
        ], 4);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [target, unboundRef, batchPrimary, batchRoot] };
        const ensuredNodeIds: string[] = [];
        let persistAttempts = 0;

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-target",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                ensureNodeAsset: async ({ node }) => {
                    ensuredNodeIds.push(node.id);
                    return {
                        assetId: node.id === "node-ref" ? "asset-ref-healed" : "asset-batch",
                        created: true,
                        linkedToProject: false,
                        confirmed: true,
                    };
                },
                persistDocument: async (_id, patch) => {
                    persistAttempts += 1;
                    const batchRootNode = patch.nodes?.find((item) => item.id === "node-batch-root");
                    expect(batchRootNode?.metadata?.assetId).toBe("asset-batch");
                    const refNode = patch.nodes?.find((item) => item.id === "node-ref");
                    if (persistAttempts === 1) {
                        expect(refNode?.metadata?.assetId).toBeUndefined();
                        throw new ApiError("The canvas media has not yet entered the material library, please wait for synchronization to complete and try again.", { status: 400 });
                    }
                    expect(refNode?.metadata?.assetId).toBe("asset-ref-healed");
                },
                bindOutput: async (input) => ({
                    op: "canvas.task.bind",
                    opId: input.operationId,
                    replayed: false,
                    revision: 4,
                    result: bindReceipt(server, "node-target", { effectKey: input.operationId }),
                }),
                adoptConfirmedProjection: async (project) => {
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(persistAttempts).toBe(2);
        expect(ensuredNodeIds).toContain("node-ref");
        expect(nodesRef.current.find((item) => item.id === "node-target")?.metadata?.status).toBe("success");
        expect(nodesRef.current.find((item) => item.id === "node-ref")?.metadata?.assetId).toBe("asset-ref-healed");
        expect(nodesRef.current.find((item) => item.id === "node-batch-root")?.metadata?.assetId).toBe("asset-batch");
    });

    test("preserves distinct assetIds on nodes sharing a resource and clears mismatched assetId on open canvas when ensure returns empty", async () => {
        useAssetStore.setState({
            assets: [
                {
                    id: "asset-wrong",
                    kind: "image",
                    title: "Wrong associated material",
                    coverUrl: "/api/resources/res-other/file",
                    tags: [],
                    createdAt: "2026-09-24T00:00:00.000Z",
                    updatedAt: "2026-09-24T00:00:00.000Z",
                    data: {
                        dataUrl: "/api/resources/res-other/file",
                        storageKey: "resource:res-other",
                        width: 100,
                        height: 100,
                        bytes: 10,
                        mimeType: "image/png",
                    },
                },
            ],
        });
        const target = canvasNode("node-target", "target node", { taskId: "task-1", status: "loading" });
        const copyA = canvasNode("node-copy-a", "Copy A", {
            status: "success",
            content: "/api/resources/res-shared/file",
            storageKey: "resource:res-shared",
            assetId: "asset-copy-a",
        });
        const copyB = canvasNode("node-copy-b", "Copy B", {
            status: "success",
            content: "/api/resources/res-shared/file",
            storageKey: "resource:res-shared",
            assetId: "asset-copy-b",
        });
        const mismatched = canvasNode("node-mismatched", "mismatched node", {
            status: "success",
            content: "/api/resources/res-unensured/file",
            storageKey: "resource:res-unensured",
            assetId: "asset-wrong",
        });
        const live = canvasProject("canvas-1", [target, copyA, copyB, mismatched], 3);
        const server = canvasProject("canvas-1", [
            { ...target, metadata: { ...target.metadata, status: "success", content: "/api/resources/res-1/file", storageKey: "resource:res-1", assetId: "generation_abc" } },
            copyA,
            copyB,
            { ...mismatched, metadata: { ...mismatched.metadata, assetId: undefined } },
        ], 4);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [target, copyA, copyB, mismatched] };
        let persistAttempts = 0;

        await bindBackendCanvasGenerationResult({
            canvasId: "canvas-1",
            nodeId: "node-target",
            task: succeededTask(),
            isCurrent: () => true,
            nodesRef,
            setNodes: (value) => {
                nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
            },
            runtime: {
                hydrateOutputs: async () => undefined,
                ensureNodeAsset: async ({ node }) => ({
                    assetId: node.id === "node-mismatched" ? "" : (node.metadata?.assetId || ""),
                    created: false,
                    linkedToProject: false,
                    confirmed: node.id !== "node-mismatched",
                }),
                persistDocument: async (_id, patch) => {
                    persistAttempts += 1;
                    if (persistAttempts === 1) {
                        throw new ApiError("Canvas media and material library records are inconsistent, please re-synchronize.", { status: 400 });
                    }
                    expect(patch.nodes?.find((item) => item.id === "node-copy-a")?.metadata?.assetId).toBe("asset-copy-a");
                    expect(patch.nodes?.find((item) => item.id === "node-copy-b")?.metadata?.assetId).toBe("asset-copy-b");
                    expect(patch.nodes?.find((item) => item.id === "node-mismatched")?.metadata?.assetId).toBeUndefined();
                },
                bindOutput: async (input) => ({
                    op: "canvas.task.bind",
                    opId: input.operationId,
                    replayed: false,
                    revision: 4,
                    result: bindReceipt(server, "node-target", { effectKey: input.operationId }),
                }),
                adoptConfirmedProjection: async (project) => {
                    useCanvasStore.setState({ projects: [project] });
                    return project;
                },
            },
        });

        expect(persistAttempts).toBe(2);
        expect(nodesRef.current.find((item) => item.id === "node-copy-a")?.metadata?.assetId).toBe("asset-copy-a");
        expect(nodesRef.current.find((item) => item.id === "node-copy-b")?.metadata?.assetId).toBe("asset-copy-b");
        expect(nodesRef.current.find((item) => item.id === "node-mismatched")?.metadata?.assetId).toBeUndefined();
    });

    test("keeps declared assetId when local asset row is missing or has no readable resourceId yet, and aborts heal cleanly if canvas unmounts mid-heal", async () => {
        useAssetStore.setState({
            assets: [
                {
                    id: "asset-no-res-id",
                    kind: "image",
                    title: "Materials whose resource IDs have not yet been resolved",
                    coverUrl: "blob:http://localhost/local-preview",
                    tags: [],
                    createdAt: "2026-09-24T00:00:00.000Z",
                    updatedAt: "2026-09-24T00:00:00.000Z",
                    data: {
                        dataUrl: "blob:http://localhost/local-preview",
                        width: 100,
                        height: 100,
                        bytes: 10,
                        mimeType: "image/png",
                    },
                },
            ],
        });
        const target = canvasNode("node-target", "target node", { taskId: "task-1", status: "loading" });
        const missingRowNode = canvasNode("node-missing-row", "Remote confirmed but local not hydrated", {
            status: "success",
            content: "/api/resources/res-missing-row/file",
            storageKey: "resource:res-missing-row",
            assetId: "asset-server-only",
        });
        const noResIdNode = canvasNode("node-no-res-id", "Local no resource ID material", {
            status: "success",
            content: "/api/resources/res-no-res-id/file",
            storageKey: "resource:res-no-res-id",
            assetId: "asset-no-res-id",
        });
        const live = canvasProject("canvas-1", [target, missingRowNode, noResIdNode], 3);
        const server = canvasProject("canvas-1", [
            { ...target, metadata: { ...target.metadata, status: "success", content: "/api/resources/res-1/file", storageKey: "resource:res-1", assetId: "generation_abc" } },
            missingRowNode,
            noResIdNode,
        ], 4);
        useCanvasStore.setState({ projects: [live] });
        const nodesRef = { current: [target, missingRowNode, noResIdNode] };
        let persistAttempts = 0;
        let currentMounted = true;
        const observedExplicitIds: Array<string | undefined> = [];

        let bindAttempts = 0;

        await expect(
            bindBackendCanvasGenerationResult({
                canvasId: "canvas-1",
                nodeId: "node-target",
                task: succeededTask(),
                isCurrent: () => currentMounted,
                nodesRef,
                setNodes: (value) => {
                    nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                },
                runtime: {
                    hydrateOutputs: async () => undefined,
                    ensureNodeAsset: async ({ node }) => {
                        observedExplicitIds.push(node.metadata?.assetId);
                        if (node.id === "node-missing-row") {
                            currentMounted = false;
                            return {
                                assetId: "asset-server-only-updated",
                                created: false,
                                linkedToProject: false,
                                confirmed: true,
                            };
                        }
                        return {
                            assetId: node.metadata?.assetId || "fallback-id",
                            created: false,
                            linkedToProject: false,
                            confirmed: true,
                        };
                    },
                    persistDocument: async () => {
                        persistAttempts += 1;
                        if (persistAttempts === 1) {
                            throw new ApiError("The canvas media has not yet entered the material library, please wait for synchronization to complete and try again.", { status: 400 });
                        }
                    },
                    bindOutput: async (input) => {
                        bindAttempts += 1;
                        return {
                            op: "canvas.task.bind",
                            opId: input.operationId,
                            replayed: false,
                            revision: 4,
                            result: bindReceipt(server, "node-target", { effectKey: input.operationId }),
                        };
                    },
                    adoptConfirmedProjection: async (project) => {
                        useCanvasStore.setState({ projects: [project] });
                        return project;
                    },
                },
            }),
        ).rejects.toMatchObject({ name: "AbortError" });

        expect(persistAttempts).toBe(1);
        expect(bindAttempts).toBe(0);
        expect(observedExplicitIds).toEqual(["asset-server-only"]);
        expect(nodesRef.current.find((item) => item.id === "node-missing-row")?.metadata?.assetId).toBe("asset-server-only");
        expect(nodesRef.current.find((item) => item.id === "node-no-res-id")?.metadata?.assetId).toBe("asset-no-res-id");
        expect(useCanvasStore.getState().projects[0]?.nodes.find((item) => item.id === "node-missing-row")?.metadata?.assetId).toBe("asset-server-only");
        expect(useCanvasStore.getState().projects[0]?.nodes.find((item) => item.id === "node-no-res-id")?.metadata?.assetId).toBe("asset-no-res-id");
    });
});
