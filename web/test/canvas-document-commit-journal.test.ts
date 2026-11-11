import { beforeEach, describe, expect, mock, test } from "bun:test";

type Stored = Map<string, string>;
const stored: Stored = new Map();
let activeScope = "guest";
let failNextSetItem = false;
let failSetItemOn = 0;
let setItemCount = 0;

function isRetryableStatus(status?: number) {
    return status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

class ApiError extends Error {
    status?: number;
    code?: number;
    reason?: string;
    retryable: boolean;
    constructor(message: string, options: { status?: number; code?: number; reason?: string; retryable?: boolean } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = options.status;
        this.code = options.code;
        this.reason = options.reason;
        this.retryable = options.retryable ?? isRetryableStatus(options.status ?? options.code);
    }
}

const server = {
    missingCreateReceipt: false,
    revision: 1,
    document: null as Record<string, unknown> | null,
    commits: [] as Array<{ opId: string; expectedRevision: number; title: string; nodeIds?: string[] }>,
    receipts: new Map<string, { revision: number; title: string }>(),
    failNext: null as { status?: number; retryable?: boolean; reason?: string; transport?: boolean } | null,
    hold: null as Promise<void> | null,
    holdDispatch: null as Promise<void> | null,
    dispatchWaiting: false,
    postStarted: 0,
    abortAfterCommit: false,
    deletes: [] as string[],
    deleteStarted: 0,
    deleteHold: null as Promise<void> | null,
    /** Opt-in compare-and-set: a commit without a receipt must name the current revision. */
    enforceRevision: false,
};

mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: (scope?: string) => ({
        getItem: async (name: string) => stored.get(`${scope ?? activeScope}:${name}`) ?? null,
        setItem: async (name: string, value: string) => {
            setItemCount += 1;
            if (failNextSetItem || (failSetItemOn > 0 && setItemCount === failSetItemOn)) {
                failNextSetItem = false;
                throw new Error("IndexedDB unavailable");
            }
            stored.set(`${scope ?? activeScope}:${name}`, value);
        },
        removeItem: async (name: string) => { stored.delete(`${scope ?? activeScope}:${name}`); },
    }),
    localForageStorage: {
        getItem: async (name: string) => stored.get(`${activeScope}:${name}`) ?? null,
        setItem: async (name: string, value: string) => { stored.set(`${activeScope}:${name}`, value); },
        removeItem: async (name: string) => { stored.delete(`${activeScope}:${name}`); },
    },
}));

mock.module("@/lib/user-scope", () => ({
    getActiveUserScope: () => activeScope,
    setActiveUserScope: (userId?: string | null) => {
        activeScope = userId || "guest";
    },
    onStorageNamespaceChange: () => () => {},
    scopedStorageKey: (name: string, scope = activeScope) => `${name}:user:${scope}`,
    scopedLocalStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));

const actualRequest = await import("@/services/api/request");
mock.module("@/services/api/request", () => ({
    ...actualRequest,
    ApiError,
    apiBaseURL: "/api",
    compactApiParams: (params: Record<string, unknown>) => params,
    http: {
        get: async (_path: string) => {
            if (server.holdDispatch) {
                server.dispatchWaiting = true;
                await server.holdDispatch;
                server.dispatchWaiting = false;
            }
            return { project: server.document };
        },
        put: async (_path: string, _body: unknown) => {
            if (server.holdDispatch) {
                server.dispatchWaiting = true;
                await server.holdDispatch;
                server.dispatchWaiting = false;
            }
            if (server.missingCreateReceipt) return {};
            return { project: { id: "c1", revision: 1 } };
        },
        post: async (_path: string, body: { opId: string; params: { expectedRevision: number; document: { title: string; nodes?: Array<{ id: string }> } } }) => {
            if (server.holdDispatch) {
                server.dispatchWaiting = true;
                await server.holdDispatch;
                server.dispatchWaiting = false;
            }
            server.postStarted += 1;
            if (server.hold) await server.hold;
            if (server.failNext?.transport) {
                server.failNext = null;
                throw new TypeError("Failed to fetch");
            }
            if (server.failNext) {
                const failure = server.failNext;
                server.failNext = null;
                const options: { status?: number; reason?: string; retryable?: boolean } = { status: failure.status, reason: failure.reason };
                if (failure.retryable !== undefined) options.retryable = failure.retryable;
                throw new ApiError("Save failed", options);
            }
            const existing = server.receipts.get(body.opId);
            if (existing) {
                return {
                    op: "canvas.document.commit",
                    opId: body.opId,
                    replayed: true,
                    caller: "manual",
                    revision: existing.revision,
                    result: { canvasId: "c1", revision: existing.revision, updatedAt: "2026-01-01T00:00:00.000Z" },
                };
            }
            if (server.enforceRevision && body.params.expectedRevision !== server.revision) {
                throw new ApiError("The canvas has been modified by another entry", { status: 409, reason: "stale_revision" });
            }
            server.revision += 1;
            const document = body.params.document as { title: string; nodes?: Array<{ id: string }> };
            server.commits.push({
                opId: body.opId,
                expectedRevision: body.params.expectedRevision,
                title: document.title,
                nodeIds: (document.nodes ?? []).map((node) => node.id),
            });
            server.receipts.set(body.opId, { revision: server.revision, title: document.title });
            server.document = { ...body.params.document, id: "c1", revision: server.revision };
            if (server.abortAfterCommit) {
                server.abortAfterCommit = false;
                throw new DOMException("The operation was aborted", "AbortError");
            }
            return {
                op: "canvas.document.commit",
                opId: body.opId,
                replayed: false,
                caller: "manual",
                revision: server.revision,
                result: { canvasId: "c1", revision: server.revision, updatedAt: "2026-01-01T00:00:00.000Z" },
            };
        },
        delete: async (path: string) => {
            if (server.holdDispatch) {
                server.dispatchWaiting = true;
                await server.holdDispatch;
                server.dispatchWaiting = false;
            }
            server.deleteStarted += 1;
            if (server.deleteHold) await server.deleteHold;
            server.deletes.push(path);
            return undefined;
        },
    },
}));

mock.module("@/services/local-workspace-sync", () => ({ notifyCanvasRefresh: () => {} }));
mock.module("@/services/canvas-sync-drafts", () => ({ preserveCanvasSyncDraft: async () => 1 }));
mock.module("@/stores/use-asset-store", () => ({ useAssetStore: { getState: () => ({ assets: [] }) } }));
mock.module("@/services/workspace-mode", () => ({ isLocalWorkspaceMode: () => true }));
mock.module("@/services/api/resources", () => ({ resourceIdFromStorageKey: () => "" }));

const { persistCanvasDocument, refreshLocalCanvasProjectIfChanged, resetLocalCanvasBackendSaveState, syncLocalCanvasProjectToBackend, hasUnconfirmedCanvasEdits, selectPreferredCanvasProject, adoptServerConfirmedGenerationPatch, openLocalCanvasProjectFromBackend, setCanvasProjectionStoreFlushForTest, CanvasBackendSubmitPausedError, CanvasProjectionError } = await import("@/services/local-workspace-repository");
const { useCanvasStore, canvasDocumentBase, canvasExternalRevisionConflict, clearCanvasDocumentBase, clearCanvasExternalRevisionConflict, recordCanvasDocumentBase, CANVAS_STORE_KEY } = await import("@/stores/canvas/use-canvas-store");
const { CanvasJournalError, clearCanvasPendingProjection, loadCanvasOperationJournal, peekCanvasOperationJournal, recordConfirmedCanvasCommit, resetCanvasOperationJournalMemory, saveCanvasOperationJournal, setCanvasJournalStorageDelay, updateCanvasOperationJournal } = await import("@/services/canvas-operation-journal");
const { canvasBackendSubmitPaused, pauseCanvasBackendSubmit } = await import("@/services/canvas-revision-conflict");
const { projectSyncProgress, useSyncProgressStore } = await import("@/stores/use-sync-progress-store");
const { flushCanvasStorePersistence, canvasDurableSnapshot, registerCanvasGenerationPersistenceAttempt, withCanvasStorePersistenceSuppressed } = await import("@/stores/canvas/use-canvas-store");

function canvas(title: string, revision = 1, patch: Record<string, unknown> = {}) {
    return {
        id: "c1",
        revision,
        title,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...patch,
    } as never;
}

function node(id: string, title: string, patch: Record<string, unknown> = {}) {
    return { id, type: "image", title, position: { x: 0, y: 0 }, width: 320, height: 220, metadata: {}, ...patch };
}

function connection(id: string, fromNodeId: string, toNodeId: string) {
    return { id, fromNodeId, toNodeId };
}

async function seedConfirmed(doc: ReturnType<typeof canvas> = canvas("baseline", 1), scope = activeScope) {
    await saveCanvasOperationJournal({
        userScope: scope,
        canvasId: "c1",
        confirmedRevision: (doc as { revision: number }).revision,
        confirmedSnapshot: doc,
        inFlight: null,
    });
    recordCanvasDocumentBase(doc as never, scope);
    useCanvasStore.setState({ projects: [doc as never] });
}

test("If the image node is deleted during real saving, the deletion will be submitted again and the generation will not be started.", async () => {
    const { persistCanvasGenerationTarget } = await import("@/services/canvas-generation-target");
    const target = node("image-target", "new pictures");
    await seedConfirmed(canvas("baseline"));
    useCanvasStore.getState().updateProject("c1", { nodes: [target as never] });
    let release!: () => void;
    server.hold = new Promise<void>((resolve) => { release = resolve; });
    const saving = persistCanvasGenerationTarget({ projectId: "c1", nodeId: target.id });
    // Attach rejection before releasing the held HTTP acknowledgement.
    const rejected = saving.catch((error: unknown) => error);
    await waitUntil(() => server.postStarted === 1);
    useCanvasStore.getState().updateProject("c1", { nodes: [] });
    release();
    expect(await rejected).toMatchObject({ message: "The generation node no longer exists and generation has not started." });
    expect((server.document as { nodes: unknown[] }).nodes).toEqual([]);
    expect(useCanvasStore.getState().openProject("c1")?.nodes).toEqual([]);
});

test("Real saving of multiple pictures serially reads the latest canvas without overwriting another completed picture", async () => {
    const { persistCanvasGenerationTarget } = await import("@/services/canvas-generation-target");
    const first = node("image-a", "A");
    const second = node("image-b", "B");
    await seedConfirmed(canvas("baseline"));
    const connections = [connection("ab", first.id, second.id)];
    useCanvasStore.getState().updateProject("c1", { nodes: [first, second] as never, connections });
    let release!: () => void;
    server.hold = new Promise<void>((resolve) => { release = resolve; });
    const savingA = persistCanvasGenerationTarget({ projectId: "c1", nodeId: first.id });
    const savingB = persistCanvasGenerationTarget({ projectId: "c1", nodeId: second.id });
    await waitUntil(() => server.postStarted === 1);
    useCanvasStore.getState().updateProject("c1", { nodes: [node(first.id, "A", { metadata: { taskId: "task-a", status: "success", content: "/a.png" } }), second] as never });
    release();
    await Promise.all([savingA, savingB]);
    const document = server.document as { nodes: Array<{ id: string; metadata: Record<string, unknown> }>; connections: unknown[] };
    expect(document.nodes.find((item) => item.id === first.id)?.metadata).toMatchObject({ taskId: "task-a", status: "success", content: "/a.png" });
    expect(document.connections).toEqual(connections);
    expect(document.nodes.map((item) => item.id)).toEqual([first.id, second.id]);
});

async function holdJournalWrite() {
    let release = () => {};
    let waiting = false;
    let held = false;
    setCanvasJournalStorageDelay({
        beforeSet: async () => {
            if (held) return;
            held = true;
            waiting = true;
            await new Promise<void>((resolve) => { release = resolve; });
        },
    });
    return {
        wait: () => waitUntil(() => waiting),
        resume: () => {
            setCanvasJournalStorageDelay(null);
            release();
        },
    };
}

async function waitUntil(predicate: () => boolean, attempts = 80) {
    for (let attempt = 0; attempt < attempts && !predicate(); attempt += 1) await Promise.resolve();
    expect(predicate()).toBe(true);
}

beforeEach(() => {
    stored.clear();
    resetCanvasOperationJournalMemory();
    resetLocalCanvasBackendSaveState();
    activeScope = "guest";
    failNextSetItem = false;
    failSetItemOn = 0;
    setItemCount = 0;
    server.revision = 1;
    server.missingCreateReceipt = false;
    server.document = canvas("baseline", 1);
    server.commits = [];
    server.receipts.clear();
    server.failNext = null;
    server.hold = null;
    server.holdDispatch = null;
    server.dispatchWaiting = false;
    server.postStarted = 0;
    server.abortAfterCommit = false;
    server.deletes = [];
    server.deleteStarted = 0;
    server.deleteHold = null;
    server.enforceRevision = false;
    useSyncProgressStore.getState().clearAll();
    clearCanvasExternalRevisionConflict("guest", "c1");
    clearCanvasExternalRevisionConflict("user-a", "c1");
    clearCanvasExternalRevisionConflict("user-b", "c1");
    useCanvasStore.setState({ projects: [canvas("baseline", 1)] });
    recordCanvasDocumentBase(canvas("baseline", 1));
});

describe("Canvas document submission journal", () => {
    test("revision 76 confirmed graph survives cache projection, restart and revision 77 ordinary save", async () => {
        await useCanvasStore.persist.rehydrate();
        const nodes = Array.from({ length: 10 }, (_, index) => node(`n${index}`, `Node ${index}`));
        nodes[0]!.metadata = { generationEffectKeys: ["old-broken-result"], status: "error" } as never;
        // Revision 69 precedes the Agent's node creation (70) and six edge writes (71-76).
        const base = canvas("baseline", 69, { nodes: nodes.slice(0, 4) });
        await seedConfirmed(base);
        await flushCanvasStorePersistence();
        const edges = Array.from({ length: 6 }, (_, index) => connection(`e${index}`, `n${index}`, `n${index + 1}`));
        const remoteNodes = structuredClone(nodes);
        remoteNodes[2]!.metadata = { generationEffectKeys: ["attach-result"], content: "/api/resources/video/file", status: "success" } as never;
        server.revision = 76;
        server.document = canvas("baseline", 76, { nodes: remoteNodes, connections: edges });
        await openLocalCanvasProjectFromBackend("c1");
        expect(canvasDurableSnapshot(activeScope, "c1")?.nodes).toHaveLength(10);
        expect(canvasDurableSnapshot(activeScope, "c1")?.connections).toEqual(edges);
        expect(canvasDurableSnapshot(activeScope, "c1")?.nodes[2]?.metadata).toEqual(remoteNodes[2]!.metadata);
        // Restart consumes persisted browser data and the durable journal, not the old live store.
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [] }));
        resetCanvasOperationJournalMemory();
        resetLocalCanvasBackendSaveState();
        await useCanvasStore.persist.rehydrate();
        await openLocalCanvasProjectFromBackend("c1");
        useCanvasStore.getState().updateProject("c1", { title: "Manual name change" });
        await syncLocalCanvasProjectToBackend("c1");
        expect(server.revision).toBe(77);
        expect(server.document?.connections).toEqual(edges);
        expect((server.document?.nodes as typeof nodes)[2]!.metadata).toEqual(remoteNodes[2]!.metadata);
        expect(peekCanvasOperationJournal("c1")?.confirmedRevision).toBe(77);
    });

    test("unconfirmed generation rolls back only its edges and nodes while keeping manual edits and deletions", async () => {
        await useCanvasStore.persist.rehydrate();
        const nodes = [node("n1", "One"), node("n2", "Two")];
        const removed = connection("manual-delete", "n1", "n2");
        const modified = connection("manual-edit", "n1", "n2");
        await seedConfirmed(canvas("baseline", 1, { nodes, connections: [removed, modified] }));
        await flushCanvasStorePersistence();
        const generated = node("generated", "Unconfirmed", { metadata: { generationEffectKeys: ["pending"] } });
        const genEdge = connection("generation-existing-endpoints", "n1", "n2");
        const unregister = registerCanvasGenerationPersistenceAttempt(activeScope, "c1", "pending", {
            previousNodes: nodes as never, nodes: [...nodes, generated] as never,
            previousConnections: [removed, modified], connections: [removed, modified, genEdge],
        });
        try {
            const manual = { ...modified, toNodeId: "n1" };
            const added = connection("manual-add", "n2", "n1");
            useCanvasStore.getState().updateProject("c1", {
                nodes: [{ ...nodes[0]!, title: "Manual title" }, nodes[1]!, generated] as never,
                connections: [manual, added, genEdge, connection("rolled-back-endpoint", "n1", "generated"), connection("invalid", "missing", "n2")],
            });
            await flushCanvasStorePersistence();
            const saved = canvasDurableSnapshot(activeScope, "c1")!;
            expect(saved.connections).toEqual([manual, added]);
            expect(saved.nodes.map((item) => item.id)).toEqual(["n1", "n2"]);
            expect(saved.nodes[0]!.title).toBe("Manual title");
        } finally { unregister(); }
    });

    test("an unrelated unconfirmed stamp cannot restore a manually deleted confirmed edge", async () => {
        await useCanvasStore.persist.rehydrate();
        const nodes = [node("n1", "One"), node("n2", "Two")];
        await seedConfirmed(canvas("baseline", 1, { nodes, connections: [connection("e", "n1", "n2")] }));
        await flushCanvasStorePersistence();
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...nodes[0]!, metadata: { generationEffectKeys: ["not-confirmed"] } }, nodes[1]!] as never,
            connections: [],
        });
        await flushCanvasStorePersistence();
        expect(canvasDurableSnapshot(activeScope, "c1")?.connections).toEqual([]);
        expect(canvasDurableSnapshot(activeScope, "c1")?.nodes[0]?.metadata?.generationEffectKeys).toBeUndefined();
    });

    test("First save 200, but the lack of canvas receipt cannot confirm the success. The draft is retained and can be tried again.", async () => {
        clearCanvasDocumentBase("c1");
        useCanvasStore.setState({ projects: [canvas("new canvas", 0)] });
        server.missingCreateReceipt = true;
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow("Invalid canvas save receipt");
        expect(useCanvasStore.getState().openProject("c1")?.title).toBe("new canvas");
        expect(useCanvasStore.getState().openProject("c1")?.revision).toBe(0);
        expect(peekCanvasOperationJournal("c1")?.confirmedRevision || 0).toBe(0);
        server.missingCreateReceipt = false;
        await syncLocalCanvasProjectToBackend("c1");
        expect(useCanvasStore.getState().openProject("c1")?.revision).toBe(1);
    });

    test("The clean cache adopts the backend, and the difference copy whose revision does not exceed the baseline adopts the expired cache and adopts the backend.", () => {
        const localClean = canvas("baseline", 1);
        const backend = canvas("Assistant corrected", 2);
        recordCanvasDocumentBase(localClean);
        expect(selectPreferredCanvasProject(localClean, backend).title).toBe("Assistant corrected");

        // 与基线内容不同、但 revision 未超过基线：本地没有比服务端已确认基线更新的
        // 内容（过期缓存，例如画布随后被 agent API 改写），read 必须采用后端，
        // 否则过期空副本会永久压过服务端新版本。
        const localStale = canvas("local draft", 1);
        recordCanvasDocumentBase(canvas("baseline", 1));
        expect(selectPreferredCanvasProject(localStale, backend).title).toBe("Assistant corrected");
    });

    test("revision rules: empty local/expired cache adopts backend, unsaved drafts after baseline remain local", () => {
        // 空 local：直接采用后端。
        expect(selectPreferredCanvasProject(null, canvas("Assistant corrected", 2)).title).toBe("Assistant corrected");

        // 过期缓存：local.revision < 基线 revision < backend.revision。
        recordCanvasDocumentBase(canvas("baseline", 2));
        expect(selectPreferredCanvasProject(canvas("Expired cache", 1), canvas("Assistant corrected", 3)).title).toBe("Assistant corrected");

        // 真草稿：revision 高于已记录基线，确有未保存的新编辑，保留本地。
        recordCanvasDocumentBase(canvas("baseline", 2));
        expect(selectPreferredCanvasProject(canvas("local draft", 3), canvas("Assistant corrected", 3)).title).toBe("local draft");
    });

    test("rehydrate cannot overwrite an applied backend revision with an expired cache", async () => {
        // 启动时后端读取已完成：内存中是服务端 rev2 内容。
        const applied = canvas("Assistant corrected", 2, { nodes: [node("n1", "One")] });
        useCanvasStore.setState({ projects: [applied] });
        // IndexedDB 残留 rev1 过期空副本（例如画布随后被 agent API 改写的场景）。
        stored.set(`${activeScope}:${CANVAS_STORE_KEY}`, JSON.stringify({
            state: { projects: [canvas("expired empty copy", 1)] },
            version: 0,
            storageRevision: 1,
            tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} },
        }));
        try {
            await useCanvasStore.persist.rehydrate();
            const kept = useCanvasStore.getState().openProject("c1");
            expect(kept?.revision).toBe(2);
            expect(kept?.title).toBe("Assistant corrected");
            expect(kept?.nodes.map((item) => item.id)).toEqual(["n1"]);
        } finally {
            stored.delete(`${activeScope}:${CANVAS_STORE_KEY}`);
        }
    });

    test("When the memory is empty, rehydrate is still loaded according to the cache (offline operation in seconds will not be affected)", async () => {
        useCanvasStore.setState({ projects: [] });
        stored.set(`${activeScope}:${CANVAS_STORE_KEY}`, JSON.stringify({
            state: { projects: [canvas("Cache canvas", 1, { nodes: [node("n1", "One")] })] },
            version: 0,
            storageRevision: 1,
            tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} },
        }));
        try {
            await useCanvasStore.persist.rehydrate();
            expect(useCanvasStore.getState().openProject("c1")?.title).toBe("Cache canvas");
        } finally {
            stored.delete(`${activeScope}:${CANVAS_STORE_KEY}`);
        }
    });

    test("Startup recovery submission cannot be overwritten with loading empty overlay confirmed success+storageKey", async () => {
        const node1 = node("image-1790921196364-0djku", "pictures", {
            metadata: {
                taskId: "016077a262cc8f86b127e1cad4b6bf9f",
                status: "loading",
                taskStatus: "succeeded",
                content: "",
                errorDetails: "Restoring build status from Task Center...",
            },
        });
        const node2 = node("node-dlu63hran9ns-43e87554d6", "pictures", {
            metadata: {
                taskId: "e24cb37f0a7d146afc8560456d88a550",
                status: "success",
                taskStatus: "succeeded",
                content: "/api/resources/8edbd8862c4714bbe42424d83e63bc08/file",
                storageKey: "resource:8edbd8862c4714bbe42424d83e63bc08",
                assetId: "generation_b4ef53b7ce14b86365c28d172bd64fc5591175be1667e8ecc9717775babc87d5",
            },
        });
        const confirmed = canvas("Unnamed project", 34, { nodes: [node1, node2] });
        await seedConfirmed(confirmed);
        server.revision = 34;
        server.document = confirmed as never;
        const overlay = [
            { ...node1, metadata: { ...node1.metadata, errorDetails: undefined } },
            { ...node2, metadata: { taskId: node2.metadata.taskId, status: "loading", taskStatus: "succeeded", content: "" } },
        ];
        expect("resultJson" in overlay[1].metadata).toBe(false);
        await persistCanvasDocument("c1", { nodes: overlay });
        const committed = server.document as { nodes: Array<{ id: string; metadata?: Record<string, unknown> }> };
        const second = committed.nodes.find((item) => item.id === node2.id);
        expect(second?.metadata?.status).toBe("success");
        expect(second?.metadata?.storageKey).toBe("resource:8edbd8862c4714bbe42424d83e63bc08");
        expect(second?.metadata?.content).toBe("/api/resources/8edbd8862c4714bbe42424d83e63bc08/file");
        const live = useCanvasStore.getState().openProject("c1")?.nodes.find((item) => item.id === node2.id);
        expect(live?.metadata?.storageKey).toBe("resource:8edbd8862c4714bbe42424d83e63bc08");
        expect(live?.metadata?.status).toBe("success");
    });

    test("When opening the canvas, local loading and empty overlay cannot block the success of the same task on the backend.", async () => {
        const node2 = node("node-dlu63hran9ns-43e87554d6", "pictures", {
            metadata: {
                taskId: "e24cb37f0a7d146afc8560456d88a550",
                status: "success",
                taskStatus: "succeeded",
                content: "/api/resources/8edbd8862c4714bbe42424d83e63bc08/file",
                storageKey: "resource:8edbd8862c4714bbe42424d83e63bc08",
            },
        });
        const confirmed = canvas("Unnamed project", 34, { nodes: [node2] });
        const overlay = canvas("Unnamed project", 34, {
            nodes: [{ ...node2, metadata: { taskId: node2.metadata.taskId, status: "loading", taskStatus: "succeeded", content: "" } }],
        });
        await seedConfirmed(confirmed);
        useCanvasStore.setState({ projects: [overlay as never] });
        server.revision = 34;
        server.document = confirmed as never;
        const opened = await openLocalCanvasProjectFromBackend("c1");
        const openedNode = opened?.nodes.find((item) => item.id === node2.id);
        expect(openedNode?.metadata?.status).toBe("success");
        expect(openedNode?.metadata?.storageKey).toBe("resource:8edbd8862c4714bbe42424d83e63bc08");
        expect(useCanvasStore.getState().openProject("c1")?.nodes[0]?.metadata?.storageKey).toBe("resource:8edbd8862c4714bbe42424d83e63bc08");
    });

    test("Submitting a new task after clearing the content key will not write back the storageKey of the old task.", async () => {
        const oldNode = node("node-dlu63hran9ns-43e87554d6", "pictures", {
            metadata: {
                taskId: "e24cb37f0a7d146afc8560456d88a550",
                status: "success",
                taskStatus: "succeeded",
                content: "/api/resources/8edbd8862c4714bbe42424d83e63bc08/file",
                storageKey: "resource:8edbd8862c4714bbe42424d83e63bc08",
            },
        });
        await seedConfirmed(canvas("Unnamed project", 34, { nodes: [oldNode] }));
        server.revision = 34;
        await persistCanvasDocument("c1", {
            nodes: [{ ...oldNode, metadata: { taskId: "task-new", status: "loading", taskStatus: "running", prompt: "new tips" } }],
        });
        const committed = (server.document as { nodes: Array<{ metadata?: Record<string, unknown> }> }).nodes[0];
        expect(committed.metadata?.taskId).toBe("task-new");
        expect(committed.metadata?.status).toBe("loading");
        expect(committed.metadata?.storageKey).toBeUndefined();
    });

    test("When the network is unknown, try again to reuse the same operationId and payload, and open another one after subsequent editing.", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "first time" });
        server.failNext = { status: 503 };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.inFlight?.operationId).toBeTruthy();
        expect(journal.inFlight?.payload.document.title).toBe("first time");
        const firstId = journal.inFlight!.operationId;

        useCanvasStore.getState().updateProject("c1", { title: "second time" });
        await syncLocalCanvasProjectToBackend("c1");

        expect(server.commits[0]?.opId).toBe(firstId);
        expect(server.commits[0]?.title).toBe("first time");
        expect(server.commits[1]?.opId).not.toBe(firstId);
        expect(server.commits[1]?.title).toBe("second time");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
    });

    test("Reuse the same operationId when there is no HTTP response", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "Submit offline" });
        server.failNext = { retryable: false };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        const firstId = (await loadCanvasOperationJournal("c1")).inFlight?.operationId;
        expect(firstId).toBeTruthy();
        await syncLocalCanvasProjectToBackend("c1");
        expect(server.commits).toEqual([expect.objectContaining({ opId: firstId, title: "Submit offline" })]);
    });

    test("Transport layer TypeError retains same operationId as draft", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "Transfer failed" });
        server.failNext = { transport: true };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(TypeError);
        const firstId = (await loadCanvasOperationJournal("c1")).inFlight?.operationId;
        expect(firstId).toBeTruthy();
        expect(useCanvasStore.getState().projects[0].title).toBe("Transfer failed");
        await syncLocalCanvasProjectToBackend("c1");
        expect(server.commits).toEqual([expect.objectContaining({ opId: firstId, title: "Transfer failed" })]);
    });

    test("Cancellation after the server has submitted: keep the operationId, and do not open a new revision for playback", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "Still there after cancellation" });
        server.abortAfterCommit = true;
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(DOMException);
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.inFlight?.operationId).toBeTruthy();
        expect(journal.inFlight?.payload.document.title).toBe("Still there after cancellation");
        expect(useCanvasStore.getState().projects[0].title).toBe("Still there after cancellation");
        const firstId = journal.inFlight!.operationId;
        expect(server.commits).toEqual([expect.objectContaining({ opId: firstId, title: "Still there after cancellation" })]);

        await syncLocalCanvasProjectToBackend("c1");
        expect(server.commits).toHaveLength(1);
        expect((await loadCanvasOperationJournal("c1")).inFlight).toBeNull();
        expect(useCanvasStore.getState().projects[0].title).toBe("Still there after cancellation");
    });

    test("Rejected remote writes MUST NOT be recorded as saved", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "conflict draft" });
        server.failNext = { status: 409, reason: "stale_revision" };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        expect(useCanvasStore.getState().projects[0].title).toBe("conflict draft");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("baseline");
        expect((await loadCanvasOperationJournal("c1")).inFlight).toBeNull();
    });

    test("Explicit persist retains local drafts when encountering stale revisions", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "conflict draft" });
        server.failNext = { status: 409, reason: "stale_revision" };
        await expect(persistCanvasDocument("c1", { nodes: [] })).rejects.toThrow();
        expect(useCanvasStore.getState().projects[0].title).toBe("conflict draft");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("baseline");
    });

    test("User scope isolation: another user’s payload will not be replayed", async () => {
        await saveCanvasOperationJournal({
            userScope: "user-b",
            canvasId: "c1",
            confirmedRevision: 9,
            confirmedSnapshot: canvas("someone else's", 9),
            inFlight: {
                operationId: "foreign-op",
                expectedRevision: 9,
                payload: { canvasId: "c1", expectedRevision: 9, document: canvas("someone else's", 9) },
            },
        });
        activeScope = "user-a";
        resetCanvasOperationJournalMemory();
        const loaded = await loadCanvasOperationJournal("c1", "user-a");
        expect(loaded.inFlight).toBeNull();
        expect(loaded.confirmedSnapshot).toBeNull();
    });

    test("Dirty drafts remain unconfirmed relative to the recorded baseline after restarting", async () => {
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1),
            inFlight: null,
        });
        useCanvasStore.getState().updateProject("c1", { title: "Unconfirmed draft" });
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
        resetCanvasOperationJournalMemory();
        clearCanvasDocumentBase("c1");
        await loadCanvasOperationJournal("c1");
        useCanvasStore.setState({ projects: [canvas("Unconfirmed draft", 1)] });
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
        // revision 规则：本地 revision 未超过基线时 read 采用后端（内容差异不再无条件
        // 保留本地）；草稿仍被 hasUnconfirmedCanvasEdits 识别为未确认，后续由
        // 三方对账/冲突候选流程处理，不会被当作已确认内容覆盖。
        expect(selectPreferredCanvasProject(canvas("Unconfirmed draft", 1), canvas("Assistant corrected", 2)).title).toBe("Assistant corrected");
    });

    test("Corrupted journal fail-closed, no no-ops are created", async () => {
        stored.set("guest:canvas-document-journal:c1", "{not-json");
        await expect(loadCanvasOperationJournal("c1")).rejects.toBeInstanceOf(CanvasJournalError);
        expect(peekCanvasOperationJournal("c1")).toBeUndefined();

        stored.set("guest:canvas-document-journal:c1", JSON.stringify({ userScope: "guest", canvasId: "c1" }));
        await expect(loadCanvasOperationJournal("c1")).rejects.toBeInstanceOf(CanvasJournalError);
        expect(peekCanvasOperationJournal("c1")).toBeUndefined();
    });

    test("IndexedDB does not publish the memory log when writing fails, and uses the new operationId for next save.", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "Not yet placed" });
        failNextSetItem = true;
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow("IndexedDB unavailable");
        expect(server.postStarted).toBe(0);
        expect(peekCanvasOperationJournal("c1")?.inFlight).toBeFalsy();
        expect(useCanvasStore.getState().projects[0].title).toBe("Not yet placed");

        await syncLocalCanvasProjectToBackend("c1");
        expect(server.commits).toHaveLength(1);
        expect(server.commits[0]?.title).toBe("Not yet placed");
        expect((await loadCanvasOperationJournal("c1")).inFlight).toBeNull();
    });

    test("Refresh and non-matching ack shall not clear unconfirmed operations, confirmedRevision shall not be rolled back", async () => {
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1),
            inFlight: {
                operationId: "op-keep",
                expectedRevision: 1,
                payload: { canvasId: "c1", expectedRevision: 1, document: canvas("On the way", 1) },
            },
        });
        await recordConfirmedCanvasCommit(canvas("Refresh", 4));
        let journal = await loadCanvasOperationJournal("c1");
        expect(journal.inFlight?.operationId).toBe("op-keep");
        expect(journal.confirmedRevision).toBe(4);
        expect(journal.confirmedSnapshot?.title).toBe("Refresh");

        await recordConfirmedCanvasCommit(canvas("Older receipt", 2), "guest", { ackOperationId: "other-op" });
        journal = await loadCanvasOperationJournal("c1");
        expect(journal.inFlight?.operationId).toBe("op-keep");
        expect(journal.confirmedRevision).toBe(4);
        expect(journal.confirmedSnapshot?.title).toBe("Refresh");

        await recordConfirmedCanvasCommit(canvas("Confirm", 6), "guest", { ackOperationId: "op-keep" });
        journal = await loadCanvasOperationJournal("c1");
        expect(journal.inFlight).toBeNull();
        expect(journal.confirmedRevision).toBe(6);
    });

    test("External writing and then playback after losing the response: The original operation is confirmed by the receipt. If the subsequent editing conflicts with the same field on the remote end, it will be retained locally and paused.", async () => {
        server.enforceRevision = true;
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1),
            inFlight: null,
        });
        useCanvasStore.getState().updateProject("c1", { title: "first time" });
        server.abortAfterCommit = true;
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(DOMException);
        const firstId = (await loadCanvasOperationJournal("c1")).inFlight?.operationId;
        expect(firstId).toBeTruthy();

        useCanvasStore.getState().updateProject("c1", { title: "Later editors" });
        server.revision = 5;
        server.document = canvas("Assistant corrected", 5);
        // 在途提交结果未知：刷新既不合并也不暂停，先等原 operationId 重放拿到真实回执。
        expect(await refreshLocalCanvasProjectIfChanged("c1")).toBeUndefined();
        expect(useCanvasStore.getState().projects[0].title).toBe("Later editors");
        expect((await loadCanvasOperationJournal("c1")).inFlight?.operationId).toBe(firstId);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(1);
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect(canvasExternalRevisionConflict("guest", "c1")).toBeUndefined();

        // 重放拿到原回执；后来的编辑按 revision 2 提交被拒，读回 revision 5 后标题两边都改过：保留本地并暂停。
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.inFlight).toBeNull();
        expect(journal.confirmedRevision).toBe(2);
        expect(journal.confirmedSnapshot?.title).toBe("first time");
        expect(useCanvasStore.getState().projects[0].title).toBe("Later editors");
        expect(canvasBackendSubmitPaused("c1")).toBe(true);
        expect(canvasExternalRevisionConflict("guest", "c1")?.remoteRevision).toBe(5);
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(CanvasBackendSubmitPausedError);
        expect(server.commits).toEqual([
            expect.objectContaining({ opId: firstId, title: "first time" }),
        ]);
        expect((server.document as { title: string }).title).toBe("Assistant corrected");
    });

    test("When adding an external node, another node is changed locally: Refresh the three-way merge, keep both sides, and submit according to the latest revision.", async () => {
        server.enforceRevision = true;
        const localNode = node("n1", "Shot 1");
        const remoteAdded = node("n2", "Added by assistant");
        useCanvasStore.setState({ projects: [canvas("baseline", 1, { nodes: [localNode] })] });
        recordCanvasDocumentBase(canvas("baseline", 1, { nodes: [localNode] }));
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1, { nodes: [localNode] }),
            inFlight: null,
        });
        useCanvasStore.getState().updateProject("c1", { nodes: [{ ...localNode, title: "local name change" }] as never });

        server.revision = 5;
        server.document = canvas("The assistant added nodes", 5, { nodes: [localNode, remoteAdded] });
        const applied = await refreshLocalCanvasProjectIfChanged("c1");
        expect(applied?.nodes.map((item) => item.id)).toEqual(["n1", "n2"]);

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes.map((item) => item.id)).toEqual(["n1", "n2"]);
        expect(live.nodes[0].title).toBe("local name change");
        expect(live.title).toBe("The assistant added nodes");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(5);
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("The assistant added nodes");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect(canvasExternalRevisionConflict("guest", "c1")).toBeUndefined();
        expect(projectSyncProgress("c1")?.phase).toBe("pending");

        await syncLocalCanvasProjectToBackend("c1");
        expect(server.commits).toEqual([expect.objectContaining({ expectedRevision: 5, nodeIds: ["n1", "n2"] })]);
        const saved = server.document as { title: string; nodes: Array<{ id: string; title: string }> };
        expect(saved.nodes.map((item) => item.title)).toEqual(["local name change", "Added by assistant"]);
        expect(saved.title).toBe("The assistant added nodes");
        expect(useCanvasStore.getState().projects[0].nodes[0].title).toBe("local name change");
    });

    test("Same as canvas journal update serial, the last write is based on the latest snapshot in the queue", async () => {
        let releaseGet = () => {};
        const getHold = new Promise<void>((resolve) => { releaseGet = resolve; });
        let gets = 0;
        resetCanvasOperationJournalMemory();
        setCanvasJournalStorageDelay({
            beforeGet: async () => {
                gets += 1;
                if (gets === 1) await getHold;
            },
        });

        const first = updateCanvasOperationJournal("c1", "guest", (current) => ({
            ...current,
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1),
        }));
        await waitUntil(() => gets === 1);
        const second = updateCanvasOperationJournal("c1", "guest", (current) => ({
            ...current,
            inFlight: {
                operationId: "op-keep",
                expectedRevision: current.confirmedRevision,
                payload: { canvasId: "c1", expectedRevision: current.confirmedRevision, document: canvas("On the way", current.confirmedRevision) },
            },
        }));
        releaseGet();
        await first;
        await second;
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.confirmedRevision).toBe(1);
        expect(journal.inFlight?.operationId).toBe("op-keep");
        expect(journal.confirmedSnapshot?.title).toBe("baseline");
    });

    test("If the payload in transit given by peek is tampered with, the serialized request will not be overwritten.", async () => {
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1),
            inFlight: {
                operationId: "op-keep",
                expectedRevision: 1,
                payload: { canvasId: "c1", expectedRevision: 1, document: canvas("On the way", 1) },
            },
        });
        const peeked = peekCanvasOperationJournal("c1");
        expect(peeked?.inFlight?.payload.document.title).toBe("On the way");
        (peeked!.inFlight!.payload.document as { title: string }).title = "tamper";
        expect(peekCanvasOperationJournal("c1")?.inFlight?.payload.document.title).toBe("On the way");
    });

    test("Do not treat HTTP receipt as saved when log confirmation write fails", async () => {
        useCanvasStore.getState().updateProject("c1", { title: "Unconfirmed receipt" });
        failSetItemOn = 2;
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow("IndexedDB unavailable");
        expect(server.postStarted).toBe(1);
        expect(server.commits).toHaveLength(1);
        expect(peekCanvasOperationJournal("c1")?.inFlight?.payload.document.title).toBe("Unconfirmed receipt");
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("baseline");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
    });

    test("Document submission shall not be issued when the flush of the undisk projection fails, and pending will not be acked.", async () => {
        const generated = node("n-gen", "Generate results", { metadata: { storageKey: "res-gen" } });
        const base = canvas("baseline", 1, { nodes: [node("n1", "Shot 1")] });
        const remote = canvas("generate", 4, { nodes: [node("n1", "Shot 1"), generated] });
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 4,
            confirmedSnapshot: remote,
            inFlight: null,
            pendingProjection: { identity: "proj-keep", revision: 4, base, remote },
        });
        useCanvasStore.setState({ projects: [canvas("local draft", 1, { nodes: [{ ...node("n1", "Shot 1"), title: "local name change" }] })] });
        setCanvasProjectionStoreFlushForTest(async () => { throw new Error("IndexedDB hung"); });
        await expect(persistCanvasDocument("c1", { title: "local draft" })).rejects.toBeInstanceOf(CanvasProjectionError);
        expect(server.postStarted).toBe(0);
        expect(server.commits).toEqual([]);
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.pendingProjection?.identity).toBe("proj-keep");
        expect(journal.confirmedRevision).toBe(4);
    });

    test.each(["loading", "error"])("The binding receipt of the same version still settles the local %s status, retains the prompt word and the new node", async (status) => {
        const completed = node("image-result", "pictures", {
            metadata: { taskId: "task-result", status: "success", taskStatus: "succeeded", content: "/api/resources/result/file", storageKey: "resource:result", prompt: "Original tip" },
        });
        const confirmed = canvas("Confirmed", 329, { nodes: [completed] });
        await seedConfirmed(confirmed);
        useCanvasStore.getState().updateProject("c1", {
            nodes: [
                { ...completed, metadata: { taskId: "task-result", status, taskStatus: "running", content: "", errorDetails: "Old write-back prompts", prompt: "New user tips" } },
                node("local-only", "local new node"),
            ] as never,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(confirmed);

        expect(adopted.nodes[0].metadata).toMatchObject({ status: "success", content: "/api/resources/result/file", storageKey: "resource:result", prompt: "New user tips" });
        expect(adopted.nodes.map((item) => item.id)).toEqual(["image-result", "local-only"]);
        expect(useCanvasStore.getState().openProject("c1")?.nodes).toEqual(adopted.nodes);
        expect(adopted.nodes[0].metadata?.errorDetails).toBeUndefined();
        expect(server.postStarted).toBe(0);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(329);
        server.revision = 329;
        server.document = confirmed;
        server.enforceRevision = true;
        await syncLocalCanvasProjectToBackend("c1");
        expect(server.commits).toHaveLength(1);
        expect(server.commits[0].expectedRevision).toBe(329);
        expect((server.document as { nodes: Array<{ metadata: Record<string, unknown> }> }).nodes[0].metadata.status).toBe("success");
    });

    test("Binding receipts of the same version does not resolve existing conflicts, nor does it cover new tasks or human image changes.", async () => {
        const completed = node("image-result", "pictures", {
            metadata: { taskId: "task-result", status: "success", content: "/api/resources/result/file", storageKey: "resource:result" },
        });
        const confirmed = canvas("Confirmed", 329, { nodes: [completed] });
        await seedConfirmed(confirmed);
        pauseCanvasBackendSubmit("c1");
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...completed, metadata: { taskId: "task-result", status: "loading", content: "" } }] as never,
        });
        expect((await adoptServerConfirmedGenerationPatch(confirmed)).nodes[0].metadata?.status).toBe("success");
        expect(canvasBackendSubmitPaused("c1")).toBe(true);
        for (const metadata of [
            { taskId: "task-new", status: "loading", content: "" },
            { taskId: "task-result", status: "loading", content: "Pictures changed by users" },
            { taskId: "task-result", status: "idle", content: "" },
        ]) {
            useCanvasStore.getState().updateProject("c1", { nodes: [{ ...completed, metadata }] as never });
            const adopted = await adoptServerConfirmedGenerationPatch(confirmed);
            expect(adopted.nodes[0].metadata).toEqual(metadata);
            expect(canvasBackendSubmitPaused("c1")).toBe(true);
        }
        useCanvasStore.getState().updateProject("c1", { nodes: [] });
        expect((await adoptServerConfirmedGenerationPatch(confirmed)).nodes).toEqual([]);
        expect(server.postStarted).toBe(0);
    });

    test("Merge by id when generating back to write draft, without losing local extra nodes", async () => {
        const localOnly = node("n-local", "local node");
        const generated = node("n-gen", "Generate results");
        useCanvasStore.setState({ projects: [canvas("draft", 1, { nodes: [localOnly] })] });
        recordCanvasDocumentBase(canvas("baseline", 1));
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas("baseline", 1),
            inFlight: null,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 4, { nodes: [generated] }));
        expect(adopted.nodes.map((item) => item.id).sort()).toEqual(["n-gen", "n-local"]);
        expect(useCanvasStore.getState().projects[0].title).toBe("draft");
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.confirmedRevision).toBe(4);
        expect(journal.confirmedSnapshot?.nodes.map((item) => item.id)).toEqual(["n-gen"]);
        expect(journal.inFlight).toBeNull();
    });

    test("Locally deleted nodes and connections will not be resurrected by writeback.", async () => {
        const n1 = node("n1", "Shot 1");
        const n2 = node("n2", "Shot 2");
        const generated = node("n-gen", "Generate results", { metadata: { storageKey: "res-gen" } });
        const c1 = connection("c1", "n1", "n2");
        const base = canvas("baseline", 1, { nodes: [n1, n2], connections: [c1] });
        await seedConfirmed(base);
        useCanvasStore.getState().updateProject("c1", { nodes: [n1] as never, connections: [] as never });

        await adoptServerConfirmedGenerationPatch(canvas("generate", 4, { nodes: [n1, n2, generated], connections: [c1] }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes.map((item) => item.id)).toEqual(["n1", "n-gen"]);
        expect(live.connections.map((item) => item.id)).toEqual([]);
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(4);
    });

    test("Locally modified copy will be retained, and unmodified fields will be used to generate media.", async () => {
        const baseNode = node("n1", "Shot 1", { metadata: { prompt: "Baseline prompt" } });
        await seedConfirmed(canvas("baseline", 1, { nodes: [baseNode] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...baseNode, title: "local name change", metadata: { prompt: "local tips" } }] as never,
        });

        await adoptServerConfirmedGenerationPatch(canvas("generate", 4, {
            nodes: [{ ...baseNode, metadata: { prompt: "Baseline prompt", storageKey: "res-gen", content: "https://media/gen" } }],
        }));

        const liveNode = useCanvasStore.getState().projects[0].nodes[0];
        expect(liveNode.title).toBe("local name change");
        expect(liveNode.metadata?.prompt).toBe("local tips");
        expect(liveNode.metadata?.storageKey).toBe("res-gen");
        expect(liveNode.metadata?.content).toBe("https://media/gen");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
    });

    test("Arrays cleared locally will not be filled in by the baseline, and new entities on the server will still be adopted.", async () => {
        const n1 = node("n1", "Shot 1");
        const generated = node("n-gen", "Generate results");
        const c1 = connection("c1", "n1", "n1");
        const cGen = connection("c-gen", "n-gen", "n1");
        await seedConfirmed(canvas("baseline", 1, { nodes: [n1], connections: [c1] }));
        useCanvasStore.getState().updateProject("c1", { nodes: [] as never, connections: [] as never });

        await adoptServerConfirmedGenerationPatch(canvas("generate", 4, {
            nodes: [n1, generated],
            connections: [c1, cGen],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes.map((item) => item.id)).toEqual(["n-gen"]);
        expect(live.connections.map((item) => item.id)).toEqual(["c-gen"]);
    });

    test("Nodes deleted by the server and unchanged locally will be removed with the writeback generated", async () => {
        const n1 = node("n1", "Shot 1");
        const n2 = node("n2", "Shot 2");
        await seedConfirmed(canvas("baseline", 1, { nodes: [n1, n2] }));

        await adoptServerConfirmedGenerationPatch(canvas("generate", 4, { nodes: [n1] }));

        expect(useCanvasStore.getState().projects[0].nodes.map((item) => item.id)).toEqual(["n1"]);
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
    });

    test("The local displacement of the same node is retained together with the results generated by the server.", async () => {
        const baseNode = node("n1", "Shot 1");
        await seedConfirmed(canvas("baseline", 1, { nodes: [baseNode] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...baseNode, position: { x: 40, y: 80 } }] as never,
        });

        await adoptServerConfirmedGenerationPatch(canvas("generate", 4, {
            nodes: [{ ...baseNode, metadata: { storageKey: "res-gen", content: "https://media/gen" } }],
        }));

        const liveNode = useCanvasStore.getState().projects[0].nodes[0];
        expect(liveNode.position).toEqual({ x: 40, y: 80 });
        expect(liveNode.metadata?.storageKey).toBe("res-gen");
        expect(liveNode.title).toBe("Shot 1");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
    });

    test("The task is in progress. After the Agent adds other nodes and loads the latest, the successful result is bound and the new node is retained.", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-1", status: "idle", prompt: "cat" } });
        const camp = node("node-camp", "Autumn travel camping table");
        const lake = node("node-lake", "Autumn travel·Lakeside traverse");
        await seedConfirmed(canvas("Latest loaded", 10, { nodes: [original, camp, lake] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [
                { ...original, metadata: { taskId: "task-1", status: "loading", taskStatus: "running", taskProgress: 42, taskStage: "Pictured", prompt: "cat" } },
                camp,
                lake,
            ] as never,
        });
        pauseCanvasBackendSubmit("c1");

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 14, {
            nodes: [
                { ...original, metadata: { taskId: "task-1", status: "success", taskStatus: "succeeded", taskProgress: 100, content: "https://media/gen", storageKey: "res-gen", prompt: "cat" } },
                camp,
                lake,
            ],
        }));

        expect(adopted.nodes.map((item) => item.id)).toEqual(["image-origin", "node-camp", "node-lake"]);
        const live = useCanvasStore.getState().projects[0];
        const origin = live.nodes.find((item) => item.id === "image-origin");
        expect(origin?.metadata?.status).toBe("success");
        expect(origin?.metadata?.content).toBe("https://media/gen");
        expect(origin?.metadata?.storageKey).toBe("res-gen");
        expect(origin?.title).toBe("Original picture");
        expect(live.nodes.find((item) => item.id === "node-camp")?.title).toBe("Autumn travel camping table");
        expect(live.nodes.find((item) => item.id === "node-lake")?.title).toBe("Autumn travel·Lakeside traverse");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect(canvasExternalRevisionConflict("guest", "c1")).toBeUndefined();
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(14);
    });

    test("When the human on the same node changes the generated content, the local value is retained and the conflict is explained, without pretending to be successful.", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-1", status: "idle", content: "old picture" } });
        await seedConfirmed(canvas("baseline", 10, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "loading", content: "Content modified by humans" } }] as never,
        });

        await adoptServerConfirmedGenerationPatch(canvas("generate", 14, {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes[0].metadata?.content).toBe("Content modified by humans");
        expect(live.nodes[0].metadata?.status).not.toBe("success");
        expect(canvasBackendSubmitPaused("c1")).toBe(true);
        expect(canvasExternalRevisionConflict("guest", "c1")?.candidate.nodes[0].metadata?.content).toBe("https://media/gen");
        expect(canvasExternalRevisionConflict("guest", "c1")?.candidate.nodes[0].metadata?.storageKey).toBe("res-gen");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(14);
    });

    test("After the new task deletes the content, the binding is successful and the store is consistent with adopted.", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-old", status: "success", content: "old picture", storageKey: "old-key" } });
        await seedConfirmed(canvas("There are old pictures", 10, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...original, metadata: { taskId: "task-2", status: "loading", taskStatus: "running", prompt: "cat" } }] as never,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 14, {
            nodes: [{ ...original, metadata: { taskId: "task-2", status: "success", taskStatus: "succeeded", content: "https://media/new", storageKey: "res-new", prompt: "cat" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(adopted.nodes[0].metadata?.status).toBe("success");
        expect(adopted.nodes[0].metadata?.content).toBe("https://media/new");
        expect(live.nodes).toEqual(adopted.nodes);
        expect(live.nodes[0].metadata?.storageKey).toBe("res-new");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(14);
    });

    test("The same task in-flight empty string overlay adopts the remote binding success", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-1", status: "idle", content: "old picture" } });
        await seedConfirmed(canvas("baseline", 10, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "loading", content: "" } }] as never,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 14, {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes).toEqual(adopted.nodes);
        expect(live.nodes[0].metadata?.status).toBe("success");
        expect(live.nodes[0].metadata?.content).toBe("https://media/gen");
        expect(live.nodes[0].metadata?.storageKey).toBe("res-gen");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect(canvasExternalRevisionConflict("guest", "c1")).toBeUndefined();
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(14);
    });

    test("If the remote end has only taskStatus succeeded and no bound media, it shall not be regarded as successful and the local media shall be cleared.", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-1", status: "idle", content: "old picture" } });
        await seedConfirmed(canvas("baseline", 10, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "loading", content: "https://local-kept", storageKey: "local-key", taskStatus: "running" } }] as never,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("incomplete distal end", 21, {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "loading", taskStatus: "succeeded", taskProgress: 100, content: "" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes).toEqual(adopted.nodes);
        expect(live.nodes[0].metadata?.status).not.toBe("success");
        expect(live.nodes[0].metadata?.content).toBe("https://local-kept");
        expect(live.nodes[0].metadata?.storageKey).toBe("local-key");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(21);
    });

    test("The idle node is not overwritten by settle; the unchanged generated fields are still adopted by the three-way merge.", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-1", status: "idle", content: "old picture", prompt: "Original tip" } });
        await seedConfirmed(canvas("baseline", 10, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "idle", content: "old picture", prompt: "Humans changed the prompt" } }] as never,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 14, {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen", prompt: "Original tip" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes).toEqual(adopted.nodes);
        expect(live.nodes[0].metadata?.prompt).toBe("Humans changed the prompt");
        expect(live.nodes[0].metadata?.content).toBe("https://media/gen");
        expect(live.nodes[0].metadata?.status).toBe("success");
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(14);
    });

    test("When humans have changed the node to success, settle is not overwritten and the local media is retained.", async () => {
        const original = node("image-origin", "Original picture", { metadata: { taskId: "task-1", status: "idle", content: "old picture" } });
        await seedConfirmed(canvas("baseline", 10, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "success", content: "Pictures left by humans" } }] as never,
        });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 14, {
            nodes: [{ ...original, metadata: { taskId: "task-1", status: "success", content: "https://media/gen", storageKey: "res-gen" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes).toEqual(adopted.nodes);
        expect(live.nodes[0].metadata?.content).toBe("Pictures left by humans");
        expect(canvasBackendSubmitPaused("c1")).toBe(true);
        expect(canvasExternalRevisionConflict("guest", "c1")?.candidate.nodes[0].metadata?.content).toBe("https://media/gen");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(14);
    });

    test("Pause when local metadata of the same field conflicts with server-side metadata, and the winner will not be guessed.", async () => {
        const baseNode = node("n1", "Shot 1", { metadata: { prompt: "Baseline prompt" } });
        await seedConfirmed(canvas("baseline", 1, { nodes: [baseNode] }));
        useCanvasStore.getState().updateProject("c1", {
            nodes: [{ ...baseNode, metadata: { prompt: "local tips" } }] as never,
        });

        await adoptServerConfirmedGenerationPatch(canvas("generate", 4, {
            nodes: [{ ...baseNode, metadata: { prompt: "Server prompt" } }],
        }));

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes[0].metadata?.prompt).toBe("local tips");
        expect(canvasBackendSubmitPaused("c1")).toBe(true);
        expect(canvasExternalRevisionConflict("guest", "c1")?.remoteRevision).toBe(4);
        expect(canvasExternalRevisionConflict("guest", "c1")?.candidate.nodes[0].metadata?.prompt).toBe("Server prompt");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(4);
    });

    test("When there is no confirmed snapshot, the generated results will not be silently merged into the draft.", async () => {
        resetCanvasOperationJournalMemory();
        clearCanvasDocumentBase("c1");
        const localOnly = node("n-local", "local node");
        useCanvasStore.setState({ projects: [canvas("draft", 1, { nodes: [localOnly] })] });

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("generate", 4, { nodes: [node("n-gen", "Generate results")] }));

        expect(adopted.nodes.map((item) => item.id)).toEqual(["n-local"]);
        expect(useCanvasStore.getState().projects[0].nodes.map((item) => item.id)).toEqual(["n-local"]);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(0);
        expect(canvasDocumentBase("c1")).toBeUndefined();
        expect(canvasBackendSubmitPaused("c1")).toBe(true);
    });

    test("Manual edits during journal write wait persist after writeback is generated", async () => {
        await seedConfirmed(canvas("baseline", 1));
        const hold = await holdJournalWrite();
        const pending = adoptServerConfirmedGenerationPatch(canvas("baseline", 4, { nodes: [node("n-gen", "Generate results")] }));
        await hold.wait();
        useCanvasStore.getState().updateProject("c1", { title: "Modified manually" });
        hold.resume();
        await pending;

        const live = useCanvasStore.getState().projects[0];
        expect(live.title).toBe("Modified manually");
        expect(live.nodes.map((item) => item.id)).toEqual(["n-gen"]);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(4);
        expect(canvasDocumentBase("c1")?.revision).toBe(4);
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
    });

    test("The baseline is not published when the writeback log fails to be generated, and the edits during the waiting period are still", async () => {
        await seedConfirmed(canvas("baseline", 1));
        const hold = await holdJournalWrite();
        failNextSetItem = true;
        const pending = adoptServerConfirmedGenerationPatch(canvas("generate", 4, { nodes: [node("n-gen", "Generate results")] }));
        await hold.wait();
        useCanvasStore.getState().updateProject("c1", { title: "Modified manually" });
        hold.resume();
        await expect(pending).rejects.toMatchObject({
            name: "CanvasProjectionError",
            message: "The server has saved it, but the local canvas has not yet been written. Please retry this writeback without regenerating.",
        });

        expect(useCanvasStore.getState().projects[0].title).toBe("Modified manually");
        expect(useCanvasStore.getState().projects[0].nodes).toEqual([]);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(1);
        expect((await loadCanvasOperationJournal("c1")).pendingProjection).toBeNull();
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("baseline");
        expect(canvasDocumentBase("c1")?.revision).toBe(1);
    });

    test("If the canvas is deleted while waiting for the writeback to be generated, it will no longer be written back to the store.", async () => {
        await seedConfirmed(canvas("baseline", 1));
        const hold = await holdJournalWrite();
        const pending = adoptServerConfirmedGenerationPatch(canvas("generate", 4, { nodes: [node("n-gen", "Generate results")] }));
        await hold.wait();
        useCanvasStore.setState({ projects: [] });
        hold.resume();
        expect(await pending).toBeUndefined();

        expect(useCanvasStore.getState().projects).toEqual([]);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(4);
    });

    test("The expired generated response does not change the confirmation snapshot, and the receipt in transit can still be played back, and the revision is aligned with the snapshot.", async () => {
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 4,
            confirmedSnapshot: canvas("Confirmed", 4),
            inFlight: {
                operationId: "op-keep",
                expectedRevision: 1,
                payload: { canvasId: "c1", expectedRevision: 1, document: canvas("On the way", 1) },
            },
        });
        useCanvasStore.setState({ projects: [canvas("local draft", 4)] });
        recordCanvasDocumentBase(canvas("Confirmed", 4));

        const adopted = await adoptServerConfirmedGenerationPatch(canvas("Expired generation", 2, { nodes: [node("n-stale", "old results")] }));

        expect(adopted.title).toBe("local draft");
        expect(useCanvasStore.getState().projects[0].title).toBe("local draft");
        expect(useCanvasStore.getState().projects[0].nodes).toEqual([]);
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.confirmedRevision).toBe(4);
        expect(journal.confirmedSnapshot?.title).toBe("Confirmed");
        expect(journal.confirmedSnapshot?.revision).toBe(4);
        expect(journal.inFlight?.operationId).toBe("op-keep");
        expect(canvasDocumentBase("c1")?.revision).toBe(4);
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("Confirmed");
    });

    test("Journal writing will align snapshot.revision to confirmedRevision", async () => {
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 3,
            confirmedSnapshot: canvas("baseline", 1),
            inFlight: null,
        });
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.confirmedRevision).toBe(3);
        expect(journal.confirmedSnapshot?.revision).toBe(3);
    });

    test.each([8, 9])("Preserve pending edits without creating conflicts when polling reads confirmed or older version %i", async (remoteRevision) => {
        await seedConfirmed(canvas("Confirmed", 9));
        server.revision = remoteRevision;
        server.document = canvas("Confirmed", remoteRevision);
        useCanvasStore.getState().updateProject("c1", { title: "Edits that haven't been automatically saved yet" });
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);

        await refreshLocalCanvasProjectIfChanged("c1");

        expect(canvasExternalRevisionConflict("guest", "c1")).toBeUndefined();
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
        expect(useCanvasStore.getState().projects[0].title).toBe("Edits that haven't been automatically saved yet");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(9);
    });

    test("Refresh preserves manual edits while waiting for journal writes and adopts non-conflicted remote nodes", async () => {
        await seedConfirmed(canvas("baseline", 1));
        server.document = canvas("baseline", 5, { nodes: [node("n-ext", "external node")] });
        const hold = await holdJournalWrite();
        const pending = refreshLocalCanvasProjectIfChanged("c1");
        await hold.wait();
        useCanvasStore.getState().updateProject("c1", { title: "Modified manually" });
        hold.resume();
        const applied = await pending;

        expect(applied?.title).toBe("Modified manually");
        expect(useCanvasStore.getState().projects[0].title).toBe("Modified manually");
        expect(useCanvasStore.getState().projects[0].nodes.map((item) => item.id)).toEqual(["n-ext"]);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(5);
        expect(canvasDocumentBase("c1")?.revision).toBe(5);
        expect(canvasBackendSubmitPaused("c1")).toBe(false);
    });

    test("Do not publish baseline when refresh journal write fails", async () => {
        await seedConfirmed(canvas("baseline", 1));
        server.document = canvas("Assistant corrected", 5);
        failNextSetItem = true;
        expect(await refreshLocalCanvasProjectIfChanged("c1")).toBeUndefined();
        expect(useCanvasStore.getState().projects[0].title).toBe("baseline");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(1);
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("baseline");
        expect(canvasDocumentBase("c1")?.revision).toBe(1);
    });

    test("When opening a back-end document, manual edits during the waiting period for journal writing will not be lost.", async () => {
        await seedConfirmed(canvas("baseline", 1));
        server.document = canvas("baseline", 5, { nodes: [node("n-ext", "external node")] });
        const hold = await holdJournalWrite();
        const pending = openLocalCanvasProjectFromBackend("c1");
        await hold.wait();
        useCanvasStore.getState().updateProject("c1", { title: "Modified manually" });
        hold.resume();
        await pending;

        const live = useCanvasStore.getState().projects[0];
        expect(live.title).toBe("Modified manually");
        expect(live.nodes.map((item) => item.id)).toEqual(["n-ext"]);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(5);
        expect(canvasDocumentBase("c1")?.revision).toBe(5);
    });

    test("Journal write fails when backend document is opened without publishing baseline", async () => {
        await seedConfirmed(canvas("baseline", 1));
        server.document = canvas("Assistant corrected", 5);
        failNextSetItem = true;
        await openLocalCanvasProjectFromBackend("c1");
        expect(useCanvasStore.getState().projects[0].title).toBe("baseline");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(1);
        expect(canvasDocumentBase("c1")?.snapshot.title).toBe("baseline");
    });

    test("Process memory is lost between diary disk and store flush: after reloading, three-way projection and local drafts are retained, and automatic saving does not overwrite the server results.", async () => {
        const n1 = node("n1", "Shot 1");
        const n2 = node("n2", "Shot 2");
        const generated = node("n-gen", "Generate results", { metadata: { storageKey: "res-gen" } });
        const base = canvas("baseline", 1, { nodes: [n1, n2] });
        const draft = canvas("baseline", 1, { nodes: [{ ...n1, title: "local name change" }] });
        const remote = canvas("baseline", 4, { nodes: [n1, n2, generated] });
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 4,
            confirmedSnapshot: remote,
            inFlight: null,
            pendingProjection: { identity: "proj-1", revision: 4, base, remote },
        });
        resetCanvasOperationJournalMemory();
        resetLocalCanvasBackendSaveState();
        clearCanvasDocumentBase("c1");
        useCanvasStore.setState({ projects: [draft as never] });

        await loadCanvasOperationJournal("c1");
        await syncLocalCanvasProjectToBackend("c1");

        const live = useCanvasStore.getState().projects[0];
        expect(live.title).toBe("baseline");
        expect(live.nodes.map((item) => item.id).sort()).toEqual(["n-gen", "n1"]);
        expect(live.nodes.find((item) => item.id === "n1")?.title).toBe("local name change");
        expect(live.nodes.find((item) => item.id === "n-gen")?.metadata?.storageKey).toBe("res-gen");
        expect((await loadCanvasOperationJournal("c1")).pendingProjection).toBeNull();
        expect(server.commits).toEqual([
            expect.objectContaining({ expectedRevision: 4, title: "baseline", nodeIds: expect.arrayContaining(["n1", "n-gen"]) }),
        ]);
        expect(server.commits[0]?.nodeIds).not.toContain("n2");
    });

    test("The recovery state is retained when the projection flush fails, replay is idempotent and the original receipt can be retried", async () => {
        const generated = node("n-gen", "Generate results", { metadata: { storageKey: "res-gen" } });
        await seedConfirmed(canvas("baseline", 1, { nodes: [node("n1", "Shot 1")] }));
        useCanvasStore.getState().updateProject("c1", { title: "local draft" });
        const remote = canvas("generate", 4, { nodes: [node("n1", "Shot 1"), generated] });
        setCanvasProjectionStoreFlushForTest(async () => { throw new Error("IndexedDB hung"); });

        await expect(adoptServerConfirmedGenerationPatch(remote)).rejects.toBeInstanceOf(CanvasProjectionError);
        const afterFirst = structuredClone(useCanvasStore.getState().projects[0]);
        expect(afterFirst.title).toBe("local draft");
        expect(afterFirst.nodes.map((item) => item.id).sort()).toEqual(["n-gen", "n1"]);
        const pendingFirst = (await loadCanvasOperationJournal("c1")).pendingProjection;
        expect(pendingFirst?.identity).toBeTruthy();
        expect(pendingFirst?.revision).toBe(4);
        expect(pendingFirst?.base.title).toBe("baseline");

        await expect(adoptServerConfirmedGenerationPatch(remote)).rejects.toBeInstanceOf(CanvasProjectionError);
        const afterSecond = useCanvasStore.getState().projects[0];
        expect(afterSecond.title).toBe("local draft");
        expect(afterSecond.nodes.map((item) => item.id).sort()).toEqual(["n-gen", "n1"]);
        expect((await loadCanvasOperationJournal("c1")).pendingProjection?.identity).toBe(pendingFirst?.identity);
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(4);
    });

    test("When the first projection has not been flushed, an updated remote revision comes: the baseline is restored unchanged, and the late clear cannot discard the new projection.", async () => {
        const n1 = node("n1", "Shot 1");
        const gen4 = node("n-gen-4", "fourth edition");
        const gen5 = node("n-gen-5", "fifth edition", { metadata: { storageKey: "res-5" } });
        const base = canvas("baseline", 1, { nodes: [n1] });
        const remote4 = canvas("baseline", 4, { nodes: [n1, gen4] });
        const remote5 = canvas("baseline", 5, { nodes: [n1, gen5] });
        const draft = canvas("baseline", 1, { nodes: [{ ...n1, title: "local name change" }] });
        await saveCanvasOperationJournal({
            userScope: "guest",
            canvasId: "c1",
            confirmedRevision: 4,
            confirmedSnapshot: remote4,
            inFlight: null,
            pendingProjection: { identity: "proj-a", revision: 4, base, remote: remote4 },
        });
        await recordConfirmedCanvasCommit(remote5, "guest", { unflushedProjection: true });
        const replaced = await loadCanvasOperationJournal("c1");
        expect(replaced.confirmedRevision).toBe(5);
        expect(replaced.pendingProjection?.identity).not.toBe("proj-a");
        expect(replaced.pendingProjection?.base.nodes.map((item) => item.id)).toEqual(["n1"]);
        expect(replaced.pendingProjection?.remote.nodes.map((item) => item.id).sort()).toEqual(["n-gen-5", "n1"]);

        await clearCanvasPendingProjection("c1", "guest", "proj-a");
        expect((await loadCanvasOperationJournal("c1")).pendingProjection?.remote.nodes.map((item) => item.id).sort()).toEqual(["n-gen-5", "n1"]);

        resetCanvasOperationJournalMemory();
        resetLocalCanvasBackendSaveState();
        clearCanvasDocumentBase("c1");
        useCanvasStore.setState({ projects: [draft as never] });
        await loadCanvasOperationJournal("c1");
        await syncLocalCanvasProjectToBackend("c1");

        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes.map((item) => item.id).sort()).toEqual(["n-gen-5", "n1"]);
        expect(live.nodes.find((item) => item.id === "n1")?.title).toBe("local name change");
        expect(live.nodes.find((item) => item.id === "n-gen-5")?.metadata?.storageKey).toBe("res-5");
        expect(server.commits[0]?.nodeIds).not.toContain("n-gen-4");
        expect((await loadCanvasOperationJournal("c1")).pendingProjection).toBeNull();
    });
});
