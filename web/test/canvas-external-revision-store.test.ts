import { beforeEach, describe, expect, mock, test } from "bun:test";

type Stored = Map<string, string>;
const stored: Stored = new Map();

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

const {
    acceptCanvasExternalRevisionCandidate,
    applyExternalCanvasRevision,
    canvasExternalRevisionConflict,
    flushCanvasStorePersistence,
    useCanvasStore,
    CANVAS_STORE_KEY,
} = await import("@/stores/canvas/use-canvas-store");
const { serializeCanvasStorageDocument } = await import("@/lib/canvas/canvas-storage-revision");
const { getActiveUserScope } = await import("@/lib/user-scope");

const scope = getActiveUserScope();

function project(id: string, revision: number, patch: Record<string, unknown> = {}) {
    return {
        id,
        revision,
        title: "canvas",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: `2026-01-01T00:00:0${revision}.000Z`,
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

/** 建立「服务端已确认」的本地起点：先写存储，再让 store 与它一致。 */
async function seedConfirmedProject(canvas: unknown, revision: number) {
    stored.set(CANVAS_STORE_KEY, serializeCanvasStorageDocument({
        state: { projects: [canvas] },
        version: 0,
        storageRevision: revision,
        tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} },
    } as never));
    await useCanvasStore.persist.rehydrate();
    await flushCanvasStorePersistence();
}

beforeEach(() => {
    stored.clear();
    useCanvasStore.setState({ projects: [] });
});

describe("Canvas refresh seams", () => {
    test("When the server confirms that the baseline is consistent, it applies an external new revision and retains the local perspective.", async () => {
        await seedConfirmedProject(project("c1", 3, { viewport: { x: 420, y: -80, k: 1.5 } }), 7);

        const decision = applyExternalCanvasRevision(project("c1", 4, { title: "external name change" }) as never, { hasUnsyncedEdits: false });

        expect(decision.kind).toBe("apply");
        const live = useCanvasStore.getState().projects[0];
        expect(live.title).toBe("external name change");
        expect(live.revision).toBe(4);
        expect(live.viewport).toEqual({ x: 420, y: -80, k: 1.5 });
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
    });

    test("Do not overwrite user values when there are unconfirmed edits, and keep the remote end as a candidate", async () => {
        await seedConfirmedProject(project("c1", 3), 7);
        const remote = project("c1", 9, {
            title: "external name change",
            nodes: [{ id: "n1", type: "image", title: "Shot 1", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: { prompt: "external cues" } }],
        });

        const decision = applyExternalCanvasRevision(remote as never, { hasUnsyncedEdits: true });

        expect(decision.kind).toBe("keep-local");
        const live = useCanvasStore.getState().projects[0];
        expect(live.nodes[0].metadata?.prompt).toBe("Server prompt");
        expect(live.title).toBe("canvas");
        expect(live.revision).toBe(3);
        const conflict = canvasExternalRevisionConflict(scope, "c1");
        expect(conflict?.localRevision).toBe(3);
        expect(conflict?.remoteRevision).toBe(9);
        expect(conflict?.candidate.nodes[0].metadata?.prompt).toBe("external cues");
    });

    test("The user explicitly chooses to replace the document with the latest version and clear conflicts.", async () => {
        await seedConfirmedProject(project("c1", 3), 7);
        applyExternalCanvasRevision(project("c1", 9, { title: "external name change" }) as never, { hasUnsyncedEdits: true });
        expect(canvasExternalRevisionConflict(scope, "c1")?.remoteRevision).toBe(9);

        const decision = acceptCanvasExternalRevisionCandidate("c1");

        expect(decision?.kind).toBe("apply");
        const live = useCanvasStore.getState().projects[0];
        expect(live.title).toBe("external name change");
        expect(live.revision).toBe(9);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
    });

    test("Conflicts are automatically resolved as the local revision progresses, and no additional cleanup actions are required.", async () => {
        await seedConfirmedProject(project("c1", 3), 7);
        applyExternalCanvasRevision(project("c1", 9) as never, { hasUnsyncedEdits: true });
        expect(canvasExternalRevisionConflict(scope, "c1")?.remoteRevision).toBe(9);

        useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === "c1" ? { ...item, revision: 10 } : item) }));

        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
    });
});
