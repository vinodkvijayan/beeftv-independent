import { beforeEach, describe, expect, mock, test } from "bun:test";

type Stored = Map<string, string>;
const stored: Stored = new Map();

/** 一次性可控的 HTTP 替身：服务端文档、revision 与「挂起的 GET」都在这里。 */
type ServerState = {
    document: Record<string, unknown> | null;
    revision: number;
    gets: number;
    puts: Array<{ id: string; revision: number }>;
    posts: Array<{ path: string; opId?: string; expectedRevision?: number }>;
    releaseGet: (() => void) | null;
    rejectNextWrite: { status: number } | null;
};

const server: ServerState = { document: null, revision: 0, gets: 0, puts: [], posts: [], releaseGet: null, rejectNextWrite: null };
const notifications: Array<{ id: string; revision: number }> = [];
let rejectEditorMerge = false;

class ApiError extends Error {
    status?: number;
    reason?: string;
    constructor(message: string, options: { status?: number; reason?: string } = {}) {
        super(message);
        this.status = options.status;
        this.reason = options.reason;
    }
}

mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: () => ({
        getItem: async (name: string) => stored.get(name) ?? null,
        setItem: async (name: string, value: string) => { stored.set(name, value); },
        removeItem: async (name: string) => { stored.delete(name); },
    }),
    localForageStorage: {
        getItem: async (name: string) => stored.get(name) ?? null,
        setItem: async (name: string, value: string) => { stored.set(name, value); },
        removeItem: async (name: string) => { stored.delete(name); },
    },
}));

const actualRequest = await import("@/services/api/request");
mock.module("@/services/api/request", () => ({
    ...actualRequest,
    ApiError,
    apiBaseURL: "/api",
    compactApiParams: (params: Record<string, unknown>) => params,
    http: {
        get: async () => {
            server.gets += 1;
            if (server.releaseGet) {
                await new Promise<void>((resolve) => { server.pendingResolve = resolve; });
            }
            return { project: server.document };
        },
        put: async (path: string, body: { project: Record<string, unknown> }) => {
            if (server.rejectNextWrite) {
                const status = server.rejectNextWrite.status;
                server.rejectNextWrite = null;
                throw new ApiError("The canvas has been modified by another entry", { status, reason: "canvas_revision_conflict" });
            }
            server.revision += 1;
            const id = String(body.project.id);
            server.puts.push({ id, revision: server.revision });
            server.document = { ...body.project, revision: server.revision };
            return { project: { id, revision: server.revision, updatedAt: "2026-01-01T00:00:00.000Z" } };
        },
        post: async (path: string, body: { opId?: string; params?: { canvasId?: string; expectedRevision?: number; document?: Record<string, unknown> } }) => {
            if (server.rejectNextWrite) {
                const status = server.rejectNextWrite.status;
                server.rejectNextWrite = null;
                throw new ApiError("The canvas has been modified by another entry", { status, reason: "stale_revision" });
            }
            server.revision += 1;
            const document = body.params?.document ?? {};
            const id = String(body.params?.canvasId || document.id || "c1");
            server.posts.push({ path, opId: body.opId, expectedRevision: body.params?.expectedRevision });
            server.document = { ...document, id, revision: server.revision };
            return {
                op: "canvas.document.commit",
                opId: body.opId,
                replayed: false,
                caller: "manual",
                revision: server.revision,
                result: { canvasId: id, revision: server.revision, updatedAt: "2026-01-01T00:00:00.000Z" },
            };
        },
    },
}));

mock.module("@/services/local-workspace-sync", () => ({
    notifyCanvasRefresh: (project: { id: string; revision?: number }, previous: unknown) => {
        if (previous && rejectEditorMerge) throw new Error("live editor conflict");
        notifications.push({ id: project.id, revision: project.revision ?? 0 });
    },
    isLocalWorkspaceMode: () => true,
}));

mock.module("@/services/canvas-sync-drafts", () => ({
    preserveCanvasSyncDraft: async () => 1,
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
    hasUnconfirmedCanvasEdits,
    refreshLocalCanvasProjectIfChanged,
    resetLocalCanvasBackendSaveState,
    syncLocalCanvasProjectToBackend,
} = await import("@/services/local-workspace-repository");
const { canvasExternalRevisionConflict, clearCanvasExternalRevisionConflict, useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
const { getActiveUserScope } = await import("@/lib/user-scope");
const { projectSyncProgress, useSyncProgressStore } = await import("@/stores/use-sync-progress-store");
const { resetCanvasOperationJournalMemory } = await import("@/services/canvas-operation-journal");

const scope = getActiveUserScope();

function canvas(revision: number, patch: Record<string, unknown> = {}) {
    return {
        id: "c1",
        revision,
        title: "canvas",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [{ id: "n1", type: "image", title: "Shot 1", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: { prompt: "Server prompt" } }],
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

function replaceServerDocument(document: unknown) {
    server.document = document as Record<string, unknown>;
}

/** 用真实保存链建立服务端确认基线：store 内容 == 服务端已接受的内容。 */
async function establishConfirmedBaseline() {
    server.document = canvas(0);
    server.revision = 0;
    useCanvasStore.setState({ projects: [canvas(0)] });
    await syncLocalCanvasProjectToBackend("c1");
}

beforeEach(() => {
    stored.clear();
    resetCanvasOperationJournalMemory();
    resetLocalCanvasBackendSaveState();
    notifications.length = 0;
    rejectEditorMerge = false;
    server.gets = 0;
    server.puts = [];
    server.posts = [];
    server.releaseGet = null;
    server.rejectNextWrite = null;
    useSyncProgressStore.getState().clearAll();
    clearCanvasExternalRevisionConflict(scope, "c1");
    useCanvasStore.setState({ projects: [] });
});

describe("Canvas refresh seam (server baseline)", () => {
    test("Even if the refresh notification throws an error, the projection is still completed, and the baseline is consistent with live.", async () => {
        await establishConfirmedBaseline();
        replaceServerDocument(canvas(4, { title: "External new content" }));
        rejectEditorMerge = true;
        const applied = await refreshLocalCanvasProjectIfChanged("c1");
        expect(applied?.title).toBe("External new content");
        expect(useCanvasStore.getState().projects[0].title).toBe("External new content");
        expect(useCanvasStore.getState().projects[0].revision).toBe(4);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
        expect(server.puts.length).toBe(1);
    });
    test("When the local content is consistent with the content confirmed by the server, the new external revision is immediately visible", async () => {
        await establishConfirmedBaseline();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);

        replaceServerDocument(canvas(2, { title: "external name change", nodes: [{ id: "n1", type: "image", title: "Shot 1", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: { prompt: "external cues" } }] }));
        const applied = await refreshLocalCanvasProjectIfChanged("c1");

        expect(applied?.title).toBe("external name change");
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.prompt).toBe("external cues");
        expect(notifications.map((item) => item.id)).toContain("c1");
    });

    test("After external refresh is implemented, subsequent manual submissions will use the new expectedRevision.", async () => {
        await establishConfirmedBaseline();
        replaceServerDocument(canvas(2, { title: "Assistant corrected" }));
        await refreshLocalCanvasProjectIfChanged("c1");
        useCanvasStore.getState().updateProject("c1", { title: "Modify again by hand" });
        await syncLocalCanvasProjectToBackend("c1");
        expect(server.posts).toEqual([expect.objectContaining({ path: "/ops/canvas.document.commit", expectedRevision: 2 })]);
        expect(useCanvasStore.getState().projects[0].title).toBe("Modify again by hand");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
    });

    test("The user edits after GET returns: check again, retain the user value and leave the remote end as a candidate", async () => {
        await establishConfirmedBaseline();
        // 挂起这次 GET，模拟「请求在途时用户继续编辑」。
        server.releaseGet = () => {};
        const pending = refreshLocalCanvasProjectIfChanged("c1");
        await new Promise((resolve) => setTimeout(resolve, 0));

        replaceServerDocument(canvas(3, { title: "external name change" }));
        useCanvasStore.getState().updateProject("c1", { title: "The title just changed by the user" });
        (server as unknown as { pendingResolve: () => void }).pendingResolve();
        server.releaseGet = null;
        const applied = await pending;

        expect(applied).toBeUndefined();
        const live = useCanvasStore.getState().projects[0];
        expect(live.title).toBe("The title just changed by the user");
        expect(canvasExternalRevisionConflict(scope, "c1")?.remoteRevision).toBe(3);
        expect(canvasExternalRevisionConflict(scope, "c1")?.candidate.title).toBe("external name change");
    });

    test("HTTP submissions will not be judged as safe to refresh before they have landed.", async () => {
        await establishConfirmedBaseline();
        useCanvasStore.getState().updateProject("c1", { title: "local new title" });

        // 服务端还没确认这次编辑：即使本地内容已经写进浏览器存储也必须算未确认。
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
    });

    test("The user explicitly uses the latest one: adopt the candidate, return to the confirmed state locally and do not write back repeatedly.", async () => {
        await establishConfirmedBaseline();
        useCanvasStore.getState().updateProject("c1", { title: "local new title" });
        replaceServerDocument(canvas(4, { title: "external name change" }));
        useSyncProgressStore.getState().setProjectProgress("c1", { phase: "conflict", message: "Old commits are paused" });
        await refreshLocalCanvasProjectIfChanged("c1");
        expect(canvasExternalRevisionConflict(scope, "c1")?.candidate.title).toBe("external name change");

        const accepted = await acceptExternalCanvasRevision("c1");

        expect(accepted?.title).toBe("external name change");
        expect(useCanvasStore.getState().projects[0].title).toBe("external name change");
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(false);
        expect(server.puts.length).toBe(1);
    });

    test("When a field outside the old whitelist is edited locally, external refresh must not silently overwrite it either.", async () => {
        await establishConfirmedBaseline();
        // folderId 不在旧的七字段白名单里：编辑它曾会被判成「本地干净」而直接被外部内容覆盖。
        useCanvasStore.getState().updateProject("c1", { folderId: "folder-keep-me" });
        replaceServerDocument(canvas(5, { title: "external name change", folderId: "folder-from-external" }));

        const applied = await refreshLocalCanvasProjectIfChanged("c1");

        expect(applied).toBeUndefined();
        const live = useCanvasStore.getState().projects[0];
        expect(live.folderId).toBe("folder-keep-me");
        expect(live.title).toBe("canvas");
        expect(canvasExternalRevisionConflict(scope, "c1")?.remoteRevision).toBe(5);
    });

    test("The submission was rejected by the server by revision: automatic submission is suspended and local content is not rewritten.", async () => {
        await establishConfirmedBaseline();
        useCanvasStore.getState().updateProject("c1", { title: "local new title" });
        server.rejectNextWrite = { status: 409 };

        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();

        expect(projectSyncProgress("c1")?.phase).toBe("conflict");
        expect(useCanvasStore.getState().projects[0].title).toBe("local new title");
        expect(hasUnconfirmedCanvasEdits("c1")).toBe(true);
    });
});
