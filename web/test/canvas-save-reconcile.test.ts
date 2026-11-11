import { beforeEach, describe, expect, mock, test } from "bun:test";

const stored = new Map<string, string>();
const drafts: Array<{ title?: string; chatSessions?: Array<{ id: string }> }> = [];
const notifications: Array<{ id: string; revision: number }> = [];

class ApiError extends Error {
    status?: number;
    code?: number;
    reason?: string;
    retryable: boolean;
    constructor(message: string, options: { status?: number; reason?: string; retryable?: boolean } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = options.status;
        this.reason = options.reason;
        this.retryable = options.retryable ?? false;
    }
}

type Doc = Record<string, unknown> & { revision: number; nodes: Array<{ id: string }>; title: string };

/**
 * A server with real compare-and-set: a commit must name the current revision
 * unless its opId already has a receipt (idempotent replay).
 */
const server = {
    revision: 0,
    document: null as Doc | null,
    attempts: [] as Array<{ opId: string; expectedRevision: number; accepted: boolean }>,
    receipts: new Map<string, number>(),
    gets: 0,
    getHold: null as Promise<void> | null,
    commitHold: null as Promise<void> | null,
    commitStarted: 0,
    beforeCommit: [] as Array<() => void>,
    failNext: null as { status: number } | null,
    failGets: 0,
};
let draftFailure = false;

mock.module("@/lib/localforage-storage", () => {
    const storage = {
        getItem: async (name: string) => stored.get(name) ?? null,
        setItem: async (name: string, value: string) => { stored.set(name, value); },
        removeItem: async (name: string) => { stored.delete(name); },
    };
    return { localForageStorageForScope: () => storage, localForageStorage: storage };
});

const actualRequest = await import("@/services/api/request");
mock.module("@/services/api/request", () => ({
    ...actualRequest,
    ApiError,
    apiBaseURL: "/api",
    compactApiParams: (params: Record<string, unknown>) => params,
    http: {
        get: async () => {
            server.gets += 1;
            if (server.failGets > 0) {
                server.failGets -= 1;
                throw new Error("Read failed");
            }
            // The response reflects the server at the moment the request arrived.
            const snapshot = structuredClone(server.document);
            if (server.getHold) await server.getHold;
            return { project: snapshot };
        },
        put: async (_path: string, body: { project: Record<string, unknown> }) => {
            server.revision += 1;
            server.document = { ...structuredClone(body.project), revision: server.revision } as Doc;
            return { project: { id: String(body.project.id), revision: server.revision, updatedAt: "2026-01-01T00:00:00.000Z" } };
        },
        post: async (_path: string, body: { opId: string; params: { canvasId: string; expectedRevision: number; document: Record<string, unknown> } }) => {
            server.commitStarted += 1;
            server.beforeCommit.shift()?.();
            if (server.commitHold) await server.commitHold;
            if (server.failNext) {
                const failure = server.failNext;
                server.failNext = null;
                throw new ApiError("Save failed", { status: failure.status, retryable: failure.status >= 500 });
            }
            const receipt = server.receipts.get(body.opId);
            const reply = (revision: number, replayed: boolean) => ({
                op: "canvas.document.commit",
                opId: body.opId,
                replayed,
                caller: "manual",
                revision,
                result: { canvasId: "c1", revision, updatedAt: "2026-01-01T00:00:00.000Z" },
            });
            if (receipt !== undefined) return reply(receipt, true);
            const expectedRevision = body.params.expectedRevision;
            if (expectedRevision !== server.revision) {
                server.attempts.push({ opId: body.opId, expectedRevision, accepted: false });
                throw new ApiError("The canvas has been modified by another entry", { status: 409, reason: "stale_revision" });
            }
            server.revision += 1;
            server.document = { ...structuredClone(body.params.document), id: "c1", revision: server.revision } as Doc;
            server.receipts.set(body.opId, server.revision);
            server.attempts.push({ opId: body.opId, expectedRevision, accepted: true });
            return reply(server.revision, false);
        },
    },
}));

mock.module("@/services/local-workspace-sync", () => ({
    notifyCanvasRefresh: (project: { id: string; revision?: number }) => {
        notifications.push({ id: project.id, revision: project.revision ?? 0 });
    },
    isLocalWorkspaceMode: () => true,
}));

mock.module("@/services/canvas-sync-drafts", () => ({
    preserveCanvasSyncDraft: async (project: { title?: string; chatSessions?: Array<{ id: string }> }) => {
        if (draftFailure) throw new Error("Not enough storage space");
        drafts.push(structuredClone(project));
        return drafts.length;
    },
    readCanvasSyncDrafts: async () => [],
    readAllCanvasSyncDrafts: async () => [],
}));

mock.module("@/stores/use-asset-store", () => ({
    useAssetStore: { getState: () => ({ assets: [] }) },
    flushAssetStorePersistence: async () => {},
}));

mock.module("@/services/workspace-mode", () => ({ isLocalWorkspaceMode: () => true }));

mock.module("@/services/api/resources", () => ({
    resourceIdFromStorageKey: () => "",
    resourceFileUrl: () => "",
}));

const {
    acceptExternalCanvasRevision,
    CanvasBackendSubmitPausedError,
    hasUnconfirmedCanvasEdits,
    openLocalCanvasProjectFromBackend,
    refreshLocalCanvasProjectIfChanged,
    resetLocalCanvasBackendSaveState,
    scheduleLocalCanvasBackendSync,
    syncLocalCanvasProjectToBackend,
} = await import("@/services/local-workspace-repository");
const { canvasExternalRevisionConflict, clearCanvasDocumentBase, clearCanvasExternalRevisionConflict, recordCanvasDocumentBase, useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
const { canvasBackendSubmitPaused } = await import("@/services/canvas-revision-conflict");
const { getActiveUserScope } = await import("@/lib/user-scope");
const { projectSyncProgress, useSyncProgressStore } = await import("@/stores/use-sync-progress-store");
const { loadCanvasOperationJournal, resetCanvasOperationJournalMemory, saveCanvasOperationJournal } = await import("@/services/canvas-operation-journal");

const scope = getActiveUserScope();

function shot(id: string, title: string) {
    return { id, type: "text", title, position: { x: 0, y: 0 }, width: 240, height: 120, metadata: { content: title } };
}

function chat(id: string, text: string) {
    return { id, title: "dialogue", messages: [{ id: `${id}-m`, role: "user", content: text }] };
}

function canvas(revision: number, patch: Record<string, unknown> = {}): Doc {
    return {
        id: "c1",
        revision,
        title: "canvas",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [shot("n1", "Shot 1")],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...patch,
    } as Doc;
}

/** A server-side writer (assistant turn, task bind) that bumps the revision. */
function externalWrite(change: (doc: Doc) => Doc) {
    server.revision += 1;
    server.document = { ...change(structuredClone(server.document!)), revision: server.revision };
}

const addNode = (id: string, title: string) => (doc: Doc) => ({ ...doc, nodes: [...doc.nodes, shot(id, title)] });

async function seedConfirmed(doc: Doc) {
    server.revision = doc.revision;
    server.document = structuredClone(doc);
    await saveCanvasOperationJournal({ userScope: scope, canvasId: "c1", confirmedRevision: doc.revision, confirmedSnapshot: structuredClone(doc) as never, inFlight: null, pendingProjection: null });
    recordCanvasDocumentBase(structuredClone(doc) as never, scope);
    useCanvasStore.setState({ projects: [structuredClone(doc) as never] });
}

/** Simulate an app reload: process memory is gone, IndexedDB keeps the journal and the cached canvas. */
function reloadWith(live: Doc) {
    resetCanvasOperationJournalMemory();
    resetLocalCanvasBackendSaveState();
    clearCanvasDocumentBase("c1", scope);
    clearCanvasExternalRevisionConflict(scope, "c1");
    useSyncProgressStore.getState().clearAll();
    useCanvasStore.setState({ projects: [structuredClone(live) as never] });
}

const live = () => useCanvasStore.getState().openProject("c1")!;
const ids = (items: Array<{ id: string }> | undefined) => (items ?? []).map((item) => item.id);
const attempts = () => server.attempts.map((attempt) => [attempt.expectedRevision, attempt.accepted]);

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

beforeEach(() => {
    stored.clear();
    drafts.length = 0;
    notifications.length = 0;
    resetCanvasOperationJournalMemory();
    resetLocalCanvasBackendSaveState();
    server.revision = 0;
    server.document = null;
    server.attempts = [];
    server.receipts.clear();
    server.gets = 0;
    server.getHold = null;
    server.commitHold = null;
    server.commitStarted = 0;
    server.beforeCommit = [];
    server.failNext = null;
    server.failGets = 0;
    draftFailure = false;
    useSyncProgressStore.getState().clearAll();
    clearCanvasExternalRevisionConflict(scope, "c1");
    useCanvasStore.setState({ projects: [] });
});

describe("Server-side writing interleaved with local auto-save", () => {
    test("The chat is being automatically saved locally when the assistant writes to the node: both sides are retained after refreshing and submitted according to the latest revision", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { chatSessions: [chat("s1", "Help me add a lens")] as never, activeChatId: "s1" });
        scheduleLocalCanvasBackendSync("c1");
        externalWrite(addNode("n2", "Lenses added by the assistant"));

        await refreshLocalCanvasProjectIfChanged("c1");

        expect(ids(live().nodes)).toEqual(["n1", "n2"]);
        expect(ids(live().chatSessions)).toEqual(["s1"]);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);

        await waitFor(() => !hasUnconfirmedCanvasEdits("c1"));
        expect(attempts()).toEqual([[2, true]]);
        expect(ids(server.document!.nodes)).toEqual(["n1", "n2"]);
        expect(ids(server.document!.chatSessions as never)).toEqual(["s1"]);
        expect(projectSyncProgress("c1", scope)?.phase).toBe("done");
    });

    test("Autosave hits assistant write rejected with 409: read back latest version merge, only retry once and save successfully", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { chatSessions: [chat("s1", "Help me add a lens")] as never });
        server.beforeCommit.push(() => externalWrite(addNode("n2", "Lenses added by the assistant")));

        await syncLocalCanvasProjectToBackend("c1");

        expect(attempts()).toEqual([[1, false], [2, true]]);
        expect(server.gets).toBe(1);
        expect(ids(server.document!.nodes)).toEqual(["n1", "n2"]);
        expect(ids(server.document!.chatSessions as never)).toEqual(["s1"]);
        expect(ids(live().nodes)).toEqual(["n1", "n2"]);
        expect(ids(live().chatSessions)).toEqual(["s1"]);
        expect(notifications.some((item) => item.revision === 2)).toBe(true);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
        expect(projectSyncProgress("c1", scope)?.phase).toBe("done");
    });

    test("After 409, both sides of the same field have been changed: keep local content and server candidates, pause submission, and save the draft before \"using the latest version\"", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { title: "local title" });
        server.beforeCommit.push(() => externalWrite((doc) => ({ ...doc, title: "Assistant title" })));

        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();

        expect(attempts()).toEqual([[1, false]]);
        expect(live().title).toBe("local title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);
        expect(canvasExternalRevisionConflict(scope, "c1")?.remoteRevision).toBe(2);
        expect(canvasExternalRevisionConflict(scope, "c1")?.candidate.title).toBe("Assistant title");
        expect((await loadCanvasOperationJournal("c1", scope)).confirmedRevision).toBe(1);
        expect(drafts.map((draft) => draft.title)).toContain("local title");
        expect(projectSyncProgress("c1", scope)?.phase).toBe("conflict");

        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(CanvasBackendSubmitPausedError);
        expect(attempts()).toEqual([[1, false]]);

        drafts.length = 0;
        await acceptExternalCanvasRevision("c1");
        expect(drafts.map((draft) => draft.title)).toEqual(["local title"]);
        expect(live().title).toBe("Assistant title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
        expect(server.document!.title).toBe("Assistant title");
    });

    test("409 Failed to read back: paused but no candidates yet; \"Use the latest version\" to read the latest content first, save the draft and then replace it", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { title: "local title" });
        server.beforeCommit.push(() => externalWrite((doc) => ({ ...doc, title: "Assistant title" })));
        server.failGets = 1;

        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        expect(attempts()).toEqual([[1, false]]);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(live().title).toBe("local title");

        drafts.length = 0;
        const accepted = await acceptExternalCanvasRevision("c1");
        expect(accepted?.title).toBe("Assistant title");
        expect(drafts.map((draft) => draft.title)).toEqual(["local title"]);
        expect(live().title).toBe("Assistant title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
        expect(attempts()).toEqual([[1, false]]);
    });

    test("The draft is not saved when \"Use the latest version\": local content is not replaced, and conflicts and candidates are retained.", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { title: "local title" });
        externalWrite((doc) => ({ ...doc, title: "Assistant title" }));
        await refreshLocalCanvasProjectIfChanged("c1");
        expect(canvasExternalRevisionConflict(scope, "c1")?.candidate.title).toBe("Assistant title");

        draftFailure = true;
        await expect(acceptExternalCanvasRevision("c1")).rejects.toThrow("draft");
        expect(live().title).toBe("local title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);
        expect(canvasExternalRevisionConflict(scope, "c1")?.candidate.title).toBe("Assistant title");
        expect((await loadCanvasOperationJournal("c1", scope)).confirmedRevision).toBe(1);
    });

    test("Retry after merging is still rejected: no more retries, paused and waiting for processing; subsequent polling will keep the latest server version as a candidate", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { chatSessions: [chat("s1", "Help me add a lens")] as never });
        server.beforeCommit.push(() => externalWrite(addNode("n2", "Lenses added by the assistant")), () => externalWrite(addNode("n3", "Add one more")));

        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();

        expect(attempts()).toEqual([[1, false], [2, false]]);
        expect(server.gets).toBe(1);
        expect(ids(live().chatSessions)).toEqual(["s1"]);
        expect(ids(server.document!.chatSessions as never)).toEqual([]);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);

        await refreshLocalCanvasProjectIfChanged("c1");
        expect(canvasExternalRevisionConflict(scope, "c1")?.remoteRevision).toBe(3);
        expect(ids(live().chatSessions)).toEqual(["s1"]);
        expect(attempts()).toHaveLength(2);
    });

    test("The server is modified when the result of an in-transit submission in the session is unknown: the refresh is not paused, the original operation is replayed first, and then merged and submitted again after rejection.", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { chatSessions: [chat("s1", "Help me add a lens")] as never });
        server.failNext = { status: 503 };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        const lostOp = (await loadCanvasOperationJournal("c1", scope)).inFlight?.operationId;
        expect(lostOp).toBeTruthy();
        externalWrite(addNode("n2", "Lenses added by the assistant"));

        await refreshLocalCanvasProjectIfChanged("c1");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();

        await waitFor(() => !hasUnconfirmedCanvasEdits("c1"));
        expect(server.attempts.map((attempt) => [attempt.opId === lostOp, attempt.expectedRevision, attempt.accepted])).toEqual([[true, 1, false], [false, 2, true]]);
        expect(ids(server.document!.nodes)).toEqual(["n1", "n2"]);
        expect(ids(server.document!.chatSessions as never)).toEqual(["s1"]);
        expect((await loadCanvasOperationJournal("c1", scope)).inFlight).toBeNull();
    });

    test("After the unknown submission is rejected, a new confirmation snapshot is used, and the old successful media cannot be written back to the remote loading node.", async () => {
        const original = { ...shot("n1", "Original picture"), type: "image", metadata: { taskId: "task-1", status: "success", content: "media-a", storageKey: "resource:old" } };
        await seedConfirmed(canvas(1, { nodes: [original] }));
        useCanvasStore.getState().updateProject("c1", { title: "local title" });
        server.failNext = { status: 503 };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        const originalOperation = (await loadCanvasOperationJournal("c1", scope)).inFlight?.operationId;
        externalWrite((doc) => ({ ...doc, nodes: [{ ...original, metadata: { taskId: "task-1", status: "loading", taskStatus: "running", content: "" } }] }));

        await syncLocalCanvasProjectToBackend("c1");

        expect(server.attempts.map((attempt) => [attempt.opId === originalOperation, attempt.expectedRevision, attempt.accepted])).toEqual([[true, 1, false], [false, 2, true]]);
        expect(server.document?.title).toBe("local title");
        const saved = server.document!.nodes[0] as typeof original;
        expect(saved.metadata.status).toBe("loading");
        expect(saved.metadata.content).toBe("");
        expect(saved.metadata.storageKey).toBeUndefined();
        expect(live().nodes[0].metadata?.status).toBe("loading");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
    });

    test("Old GETs returned after the receipt has been submitted will not fall back to the confirmed version and will not create conflicts", async () => {
        await seedConfirmed(canvas(1));
        let releaseGet = () => {};
        server.getHold = new Promise<void>((resolve) => { releaseGet = resolve; });
        const refreshing = refreshLocalCanvasProjectIfChanged("c1");
        await waitFor(() => server.gets === 1);

        useCanvasStore.getState().updateProject("c1", { title: "local title" });
        await syncLocalCanvasProjectToBackend("c1");
        releaseGet();

        expect(await refreshing).toBeUndefined();
        const journal = await loadCanvasOperationJournal("c1", scope);
        expect(journal.confirmedRevision).toBe(2);
        expect(journal.confirmedSnapshot?.title).toBe("local title");
        expect(live().title).toBe("local title");
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
    });
});

describe("Recover after reloading", () => {
    test("The submission in transit did not reach the server, and the server was modified by the assistant: it was opened without pausing, and the replay was rejected and then merged and saved.", async () => {
        await seedConfirmed(canvas(1));
        const draft = canvas(1, { chatSessions: [chat("s1", "Help me add a lens")] });
        await saveCanvasOperationJournal({
            userScope: scope,
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas(1) as never,
            inFlight: { operationId: "op-lost", expectedRevision: 1, payload: { canvasId: "c1", expectedRevision: 1, document: draft as never } },
            pendingProjection: null,
        });
        externalWrite(addNode("n2", "Lenses added by the assistant"));
        reloadWith(draft);

        const opened = await openLocalCanvasProjectFromBackend("c1");
        expect(ids(opened?.chatSessions)).toEqual(["s1"]);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();

        await syncLocalCanvasProjectToBackend("c1");
        expect(server.attempts.map((attempt) => [attempt.opId, attempt.expectedRevision, attempt.accepted])).toEqual([["op-lost", 1, false], [expect.any(String), 2, true]]);
        expect(ids(server.document!.nodes)).toEqual(["n1", "n2"]);
        expect(ids(server.document!.chatSessions as never)).toEqual(["s1"]);
        expect(ids(live().nodes)).toEqual(["n1", "n2"]);
        expect((await loadCanvasOperationJournal("c1", scope)).inFlight).toBeNull();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
    });

    test("Submit in transit has actually fallen to the server: replay will get the original receipt and no new revision will be opened.", async () => {
        await seedConfirmed(canvas(1));
        const draft = canvas(1, { title: "Submitted title" });
        await saveCanvasOperationJournal({
            userScope: scope,
            canvasId: "c1",
            confirmedRevision: 1,
            confirmedSnapshot: canvas(1) as never,
            inFlight: { operationId: "op-applied", expectedRevision: 1, payload: { canvasId: "c1", expectedRevision: 1, document: draft as never } },
            pendingProjection: null,
        });
        server.revision = 2;
        server.document = { ...draft, revision: 2 };
        server.receipts.set("op-applied", 2);
        reloadWith(draft);

        await openLocalCanvasProjectFromBackend("c1");
        await syncLocalCanvasProjectToBackend("c1");

        expect(server.attempts).toEqual([]);
        expect(server.revision).toBe(2);
        const journal = await loadCanvasOperationJournal("c1", scope);
        expect(journal.inFlight).toBeNull();
        expect(journal.confirmedRevision).toBe(2);
        expect(live().title).toBe("Submitted title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
    });

    test("Unsaved chat modifications are not related to new nodes on the server side: they are merged when opened, without pausing, and both sides are included in the next save.", async () => {
        await seedConfirmed(canvas(1));
        externalWrite(addNode("n2", "Lenses added by the assistant"));
        reloadWith(canvas(1, { chatSessions: [chat("s1", "Help me add a lens")] }));

        const opened = await openLocalCanvasProjectFromBackend("c1");
        expect(ids(opened?.nodes)).toEqual(["n1", "n2"]);
        expect(ids(opened?.chatSessions)).toEqual(["s1"]);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);

        await syncLocalCanvasProjectToBackend("c1");
        expect(attempts()).toEqual([[2, true]]);
        expect(ids(server.document!.chatSessions as never)).toEqual(["s1"]);
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
    });

    test("The local cache changed the node title, the journal stopped at the old version, and the server added a new connection: merged when opening, saving does not overwrite the server connection.", async () => {
        const nodes = [shot("n0", "shot zero"), shot("n1", "Shot 1")];
        await seedConfirmed(canvas(105, { nodes }));
        server.revision = 111;
        server.document = canvas(111, { nodes, connections: [{ id: "e0", fromNodeId: "n0", toNodeId: "n1" }] });
        reloadWith(canvas(105, { nodes: [{ ...nodes[0], title: "Unsaved title" }, nodes[1]] }));
        // The journal survives reload: only process memory was lost.
        await saveCanvasOperationJournal({ userScope: scope, canvasId: "c1", confirmedRevision: 105, confirmedSnapshot: canvas(105, { nodes }) as never, inFlight: null, pendingProjection: null });

        const opened = await openLocalCanvasProjectFromBackend("c1");
        expect(ids(opened?.connections as never)).toEqual(["e0"]);
        expect((opened?.nodes as Array<{ title: string }>)[0].title).toBe("Unsaved title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);

        await syncLocalCanvasProjectToBackend("c1");
        expect(attempts()).toEqual([[111, true]]);
        expect(ids(server.document!.connections as never)).toEqual(["e0"]);
        expect((server.document!.nodes as Array<{ title: string }>)[0].title).toBe("Unsaved title");
    });

    test("The same field has been changed on the local and server side: the local content is retained when opening, the server version is left as a candidate and paused, and neither side is covered.", async () => {
        await seedConfirmed(canvas(1));
        externalWrite((doc) => ({ ...doc, title: "Assistant title" }));
        reloadWith(canvas(1, { title: "local title" }));

        const opened = await openLocalCanvasProjectFromBackend("c1");
        expect(opened?.title).toBe("local title");
        expect(live().title).toBe("local title");
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);
        expect(canvasExternalRevisionConflict(scope, "c1")?.candidate.title).toBe("Assistant title");

        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(CanvasBackendSubmitPausedError);
        expect(server.attempts).toEqual([]);
        expect(server.document!.title).toBe("Assistant title");
    });
});

describe("Save state locally", () => {
    test("Waiting, saving, saved, and failed are all written into the progress truthfully.", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { title: "first time" });
        let release = () => {};
        server.commitHold = new Promise<void>((resolve) => { release = resolve; });

        scheduleLocalCanvasBackendSync("c1");
        expect(projectSyncProgress("c1", scope)?.phase).toBe("pending");
        await waitFor(() => server.commitStarted === 1);
        expect(projectSyncProgress("c1", scope)?.phase).toBe("saving");
        release();
        await waitFor(() => !hasUnconfirmedCanvasEdits("c1"));
        expect(projectSyncProgress("c1", scope)?.phase).toBe("done");

        server.commitHold = null;
        useCanvasStore.getState().updateProject("c1", { title: "second time" });
        server.failNext = { status: 503 };
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        expect(projectSyncProgress("c1", scope)?.phase).toBe("error");

        await syncLocalCanvasProjectToBackend("c1");
        expect(projectSyncProgress("c1", scope)?.phase).toBe("done");
        expect(server.document!.title).toBe("second time");
    });

    test("Save attempts during conflict pause do not change status back to Saving or Saved", async () => {
        await seedConfirmed(canvas(1));
        useCanvasStore.getState().updateProject("c1", { title: "local title" });
        externalWrite((doc) => ({ ...doc, title: "Assistant title" }));
        await refreshLocalCanvasProjectIfChanged("c1");
        expect(projectSyncProgress("c1", scope)?.phase).toBe("conflict");

        scheduleLocalCanvasBackendSync("c1");
        expect(projectSyncProgress("c1", scope)?.phase).toBe("conflict");
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toBeInstanceOf(CanvasBackendSubmitPausedError);
        expect(projectSyncProgress("c1", scope)?.phase).toBe("conflict");
    });
});
