import { beforeEach, describe, expect, mock, test } from "bun:test";

type Stored = Map<string, string>;
const stored: Stored = new Map();
let activeScope = "guest";

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
        this.retryable = options.retryable ?? false;
    }
}

const server = {
    revision: 21,
    document: null as Record<string, unknown> | null,
    posts: [] as Array<{ path: string; revision?: number }>,
    gets: [] as string[],
    restore: null as { status?: number; project?: Record<string, unknown> | null; transport?: boolean } | null,
    getAfterRestore: null as Record<string, unknown> | null,
    hold: null as Promise<void> | null,
    postStarted: 0,
};

mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: (scope?: string) => ({
        getItem: async (name: string) => stored.get(`${scope ?? activeScope}:${name}`) ?? null,
        setItem: async (name: string, value: string) => { stored.set(`${scope ?? activeScope}:${name}`, value); },
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
        get: async (path: string) => {
            server.gets.push(path);
            return { project: server.getAfterRestore ?? server.document };
        },
        post: async (path: string, body: { revision?: number }) => {
            server.postStarted += 1;
            if (server.hold) await server.hold;
            server.posts.push({ path, revision: body?.revision });
            if (server.restore?.transport) throw new TypeError("Failed to fetch");
            if (server.restore?.status) {
                throw new ApiError("The cloud canvas has been updated and coverage has stopped; please keep the local draft and load the latest version", {
                    status: server.restore.status,
                    reason: "stale_revision",
                });
            }
            if (server.restore && "project" in server.restore) return { project: server.restore.project };
            return {
                project: {
                    id: "c1",
                    title: "Restored",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    revision: (body?.revision ?? 0) + 1,
                },
            };
        },
        put: async () => ({ project: { id: "c1", revision: server.revision } }),
        delete: async () => undefined,
    },
}));

mock.module("@/services/local-workspace-sync", () => ({ notifyCanvasRefresh: () => {} }));
mock.module("@/services/canvas-sync-drafts", () => ({ preserveCanvasSyncDraft: async () => 1 }));
mock.module("@/stores/use-asset-store", () => ({ useAssetStore: { getState: () => ({ assets: [] }) } }));
mock.module("@/services/workspace-mode", () => ({ isLocalWorkspaceMode: () => true }));
mock.module("@/services/api/resources", () => ({
    resourceIdFromStorageKey: (storageKey?: string) => storageKey?.startsWith("resource:") ? storageKey.slice("resource:".length) : "",
    ownedResourceIdFromMediaRef: () => "",
    resourceFileUrl: () => "",
    resourceStorageKey: () => "",
}));

const { restoreLocalCanvasProjectFromHistory, openLocalCanvasProjectFromBackend, resetLocalCanvasBackendSaveState, setCanvasProjectionStoreFlushForTest } = await import("@/services/local-workspace-repository");
const { useCanvasStore, recordCanvasDocumentBase, canvasDocumentBase, clearCanvasExternalRevisionConflict } = await import("@/stores/canvas/use-canvas-store");
const { loadCanvasOperationJournal, peekCanvasOperationJournal, resetCanvasOperationJournalMemory, saveCanvasOperationJournal, setCanvasJournalStorageDelay } = await import("@/services/canvas-operation-journal");
const { canvasBackendSubmitPaused, pauseCanvasBackendSubmit } = await import("@/services/canvas-revision-conflict");
const { useSyncProgressStore } = await import("@/stores/use-sync-progress-store");

function canvas(title: string, revision: number, patch: Record<string, unknown> = {}) {
    return {
        id: "c1",
        revision,
        title,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [{ id: "n1", type: "image", title, position: { x: 0, y: 0 }, width: 320, height: 220, metadata: patch.metadata ?? {} }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...patch,
    };
}

async function seedLive(doc: ReturnType<typeof canvas>, inFlight = false) {
    await saveCanvasOperationJournal({
        userScope: activeScope,
        canvasId: "c1",
        confirmedRevision: doc.revision,
        confirmedSnapshot: doc,
        inFlight: inFlight
            ? {
                operationId: "op-old",
                expectedRevision: 9,
                payload: { canvasId: "c1", expectedRevision: 9, document: canvas("Generating", 9) },
            }
            : null,
    });
    recordCanvasDocumentBase(doc as never, activeScope);
    useCanvasStore.setState({ projects: [doc as never] });
    server.revision = doc.revision;
    server.document = doc;
}

beforeEach(() => {
    stored.clear();
    resetCanvasOperationJournalMemory();
    resetLocalCanvasBackendSaveState();
    setCanvasJournalStorageDelay(null);
    setCanvasProjectionStoreFlushForTest(async () => {});
    activeScope = "guest";
    server.revision = 21;
    server.document = canvas("current draft", 21);
    server.posts = [];
    server.gets = [];
    server.restore = null;
    server.getAfterRestore = null;
    server.hold = null;
    server.postStarted = 0;
    useSyncProgressStore.getState().clearAll();
    clearCanvasExternalRevisionConflict("guest", "c1");
    useCanvasStore.setState({ projects: [canvas("current draft", 21) as never] });
    recordCanvasDocumentBase(canvas("current draft", 21) as never);
});

describe("restoreLocalCanvasProjectFromHistory", () => {
    test("Successful recovery: read new version after POST CAS and write to journal", async () => {
        const current = canvas("current draft", 21, { metadata: { status: "loading" } });
        await seedLive(current, true);
        const restored = canvas("Three nodes", 22, { metadata: { status: "success", content: "/api/resources/r1/file" } });
        restored.nodes = [
            restored.nodes[0],
            { id: "n2", type: "image", title: "camping table", position: { x: 1, y: 0 }, width: 320, height: 220, metadata: {} },
            { id: "n3", type: "video", title: "Lakeside traverse", position: { x: 2, y: 0 }, width: 320, height: 220, metadata: {} },
        ] as never;
        server.getAfterRestore = restored;

        const project = await restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "snap-14", revision: 21 });

        expect(server.posts).toEqual([{ path: "/canvas-projects/c1/history/snap-14/restore", revision: 21 }]);
        expect(server.gets).toEqual(["/canvas-projects/c1"]);
        expect(project.revision).toBe(22);
        expect(project.title).toBe("Three nodes");
        expect(project.nodes).toHaveLength(3);
        expect(useCanvasStore.getState().projects[0].title).toBe("Three nodes");
        expect(useCanvasStore.getState().projects[0].revision).toBe(22);
        const journal = await loadCanvasOperationJournal("c1");
        expect(journal.confirmedRevision).toBe(22);
        expect(journal.confirmedSnapshot?.title).toBe("Three nodes");
        expect(journal.inFlight).toBeNull();
        expect(journal.pendingProjection).toBeNull();
        expect(canvasDocumentBase("c1")?.revision).toBe(22);
    });

    test("409 error, do not open the current draft, keep local editing", async () => {
        const current = canvas("Unsaved title", 21);
        await seedLive(current);
        server.restore = { status: 409 };

        await expect(restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "snap-14", revision: 21 }))
            .rejects.toThrow("The current canvas has been updated and will not be restored this time. Please reopen version records and try again.");

        expect(server.posts).toHaveLength(1);
        expect(server.gets).toEqual([]);
        expect(useCanvasStore.getState().projects[0].title).toBe("Unsaved title");
        expect((await loadCanvasOperationJournal("c1")).confirmedRevision).toBe(21);
    });

    test("No recovery request is sent when snapshotId or revision is missing", async () => {
        await seedLive(canvas("current draft", 21));

        await expect(restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "  ", revision: 21 }))
            .rejects.toThrow("The historical version does not exist or has expired. Please refresh the history list.");
        await expect(restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "snap-14", revision: 1.5 }))
            .rejects.toThrow("Please refresh the canvas version before restoring");

        expect(server.posts).toEqual([]);
        expect(server.gets).toEqual([]);
        expect(useCanvasStore.getState().projects[0].title).toBe("current draft");
    });

    test("Receipt If the revision has not been forwarded, the current revision will not be regarded as a successful recovery.", async () => {
        await seedLive(canvas("current draft", 21));
        server.restore = {
            project: {
                id: "c1",
                title: "current draft",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                revision: 21,
            },
        };

        await expect(restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "snap-14", revision: 21 }))
            .rejects.toThrow("The restore was not completed and the canvas contents were not replaced.");

        expect(server.gets).toEqual([]);
        expect(useCanvasStore.getState().projects[0].title).toBe("current draft");
    });

    test("POST succeeds but fails when the revision read subsequently is inconsistent with the receipt", async () => {
        await seedLive(canvas("current draft", 21));
        server.getAfterRestore = canvas("current draft", 21);

        await expect(restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "snap-14", revision: 21 }))
            .rejects.toThrow("No new version was read after recovery, please try again.");

        expect(server.posts).toHaveLength(1);
        expect(server.gets).toEqual(["/canvas-projects/c1"]);
        expect(useCanvasStore.getState().projects[0].title).toBe("current draft");
        expect(peekCanvasOperationJournal("c1")?.confirmedRevision).toBe(21);
    });

    test("When openLocalCanvasProjectFromBackend fails, it may still return to the current draft; the recovery path must not be taken this way", async () => {
        await seedLive(canvas("current draft", 21));
        server.restore = { transport: true };
        await expect(restoreLocalCanvasProjectFromHistory("c1", { snapshotId: "snap-14", revision: 21 }))
            .rejects.toBeInstanceOf(TypeError);
        const opened = await openLocalCanvasProjectFromBackend("c1");
        expect(opened?.title).toBe("current draft");
        expect(useCanvasStore.getState().projects[0].title).toBe("current draft");
    });
});
