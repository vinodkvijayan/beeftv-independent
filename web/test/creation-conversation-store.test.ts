import { beforeEach, expect, mock, test } from "bun:test";
import { ApiError } from "@/services/api/request";

type Stored = Map<string, string>;
const stored: Stored = new Map();
let activeScope = "guest";
let draftHold: Promise<void> | null = null;
let releaseDraftHold: (() => void) | null = null;
let draftWriteEntered = 0;
let draftWriteError: Error | null = null;
let draftRemoveHold: Promise<void> | null = null;
let draftRemoveEntered = 0;

function switchScope(next: string) {
    activeScope = next;
}

type RecordShape = {
    id: string;
    revision: number;
    updatedAt: string;
    deleted?: boolean;
    document?: { id: string; title?: string; messages: Array<Record<string, unknown>> };
};

const server = {
    conversations: new Map<string, RecordShape>(),
    deleted: new Set<string>(),
    failNext: null as { status: number; reason?: string; message?: string } | null,
    puts: [] as Array<{ id: string; expectedRevision: number; title?: string; messageCount: number }>,
    imports: [] as string[],
    putHold: null as Promise<void> | null,
    releasePut: null as (() => void) | null,
    putEntered: 0,
};

function failIfNeeded() {
    if (!server.failNext) return;
    const failure = server.failNext;
    server.failNext = null;
    throw new ApiError(failure.message || "Save failed", { status: failure.status, reason: failure.reason });
}

function holdPuts() {
    server.putHold = new Promise((resolve) => {
        server.releasePut = resolve;
    });
}

function holdDraftWrites() {
    draftHold = new Promise((resolve) => {
        releaseDraftHold = resolve;
    });
}

mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: (scope?: string) => ({
        getItem: async (name: string) => stored.get(`${scope ?? activeScope}:${name}`) ?? null,
        setItem: async (name: string, value: string) => {
            if (name.startsWith("creation-conversation-drafts-v1:")) {
                if (draftHold) {
                    draftWriteEntered += 1;
                    await draftHold;
                }
                if (draftWriteError) throw draftWriteError;
            }
            stored.set(`${scope ?? activeScope}:${name}`, value);
        },
        removeItem: async (name: string) => {
            if (draftRemoveHold && name.startsWith("creation-conversation-drafts-v1:")) {
                draftRemoveEntered += 1;
                await draftRemoveHold;
            }
            stored.delete(`${scope ?? activeScope}:${name}`);
        },
    }),
    localForageStorage: {
        getItem: async (name: string) => stored.get(`${activeScope}:${name}`) ?? null,
        setItem: async (name: string, value: string) => { stored.set(`${activeScope}:${name}`, value); },
        removeItem: async (name: string) => { stored.delete(`${activeScope}:${name}`); },
    },
}));

mock.module("@/lib/user-scope", () => ({
    getActiveUserScope: () => activeScope,
    onStorageNamespaceChange: () => () => undefined,
    setActiveUserScope: (userId?: string | null) => switchScope(userId || "guest"),
    scopedStorageKey: (name: string, scope = activeScope) => `${name}:user:${scope}`,
    scopedLocalStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));

mock.module("@/services/api/creation-conversations", () => ({
    creationConversationsApi: {
        list: async () => {
            failIfNeeded();
            return {
                conversations: Array.from(server.conversations.values()).filter((item) => !item.deleted),
                deletedIds: Array.from(server.deleted),
            };
        },
        get: async (id: string) => {
            failIfNeeded();
            const existing = server.conversations.get(id);
            if (!existing || existing.deleted) throw new ApiError("Creation dialogue does not exist", { status: 404, reason: "not_found" });
            return existing;
        },
        put: async (id: string, input: { expectedRevision: number; document: { id: string; title?: string; messages: Array<Record<string, unknown>> } }) => {
            server.putEntered += 1;
            if (server.putHold) await server.putHold;
            failIfNeeded();
            const title = typeof input.document.title === "string" && input.document.title.trim() ? input.document.title.trim() : "new creation";
            server.puts.push({ id, expectedRevision: input.expectedRevision, title, messageCount: input.document.messages?.length ?? 0 });
            const existing = server.conversations.get(id);
            if (!existing && input.expectedRevision !== 0) throw new ApiError("Conversation updated, current draft does not overwrite saved content", { status: 409, reason: "conflict" });
            if (existing?.deleted) throw new ApiError("The conversation has been deleted and can no longer be written to", { status: 409, reason: "conflict" });
            const normalizedDocument = {
                messages: input.document.messages,
                title,
                id: input.document.id,
            };
            if (existing && existing.revision !== input.expectedRevision) {
                if (existing.revision === input.expectedRevision + 1 && JSON.stringify(existing.document) === JSON.stringify(normalizedDocument)) return existing;
                throw new ApiError("Conversation updated, current draft does not overwrite saved content", { status: 409, reason: "conflict" });
            }
            const record: RecordShape = {
                id,
                revision: (existing?.revision ?? 0) + 1,
                updatedAt: "2026-10-02T00:00:00.000Z",
                document: normalizedDocument,
            };
            server.conversations.set(id, record);
            return record;
        },
        remove: async (id: string) => {
            failIfNeeded();
            const existing = server.conversations.get(id);
            if (!existing) throw new ApiError("Creation dialogue does not exist", { status: 404, reason: "not_found" });
            existing.deleted = true;
            existing.revision += 1;
            server.deleted.add(id);
            return { id, revision: existing.revision, updatedAt: "2026-10-02T00:00:00.000Z", deleted: true };
        },
        importLegacy: async (input: { operationId: string; document: { id: string } }) => {
            failIfNeeded();
            server.imports.push(input.operationId);
            if (server.deleted.has(input.document.id)) {
                return { imported: false, id: input.document.id, deleted: true, conversation: { id: input.document.id, revision: 1, updatedAt: "2026-10-02T00:00:00.000Z", deleted: true } };
            }
            const existing = server.conversations.get(input.document.id);
            if (existing) return { imported: false, id: existing.id, conversation: existing };
            const record: RecordShape = {
                id: input.document.id,
                revision: 1,
                updatedAt: "2026-10-02T00:00:00.000Z",
                document: input.document as RecordShape["document"],
            };
            server.conversations.set(record.id, record);
            return { imported: true, id: record.id, conversation: record };
        },
    },
}));

const {
    CREATION_CONVERSATIONS_KEY,
    loadCreationConversations,
    loadLocalCreationConversationDrafts,
    saveCreationConversations,
    deleteCreationConversation,
    resetCreationConversationStoreForTests,
    acceptSavedCreationConversation,
    restoreParkedCreationConversation,
    hasParkedCreationConversationDraft,
    adoptServerConfirmedConversationDocument,
} = await import("@/services/creation-conversation-store");

beforeEach(() => {
    stored.clear();
    server.conversations.clear();
    server.deleted.clear();
    server.failNext = null;
    server.puts = [];
    server.imports = [];
    server.putHold = null;
    server.releasePut = null;
    server.putEntered = 0;
    activeScope = "guest";
    draftHold = null;
    releaseDraftHold = null;
    draftWriteEntered = 0;
    draftWriteError = null;
    draftRemoveHold = null;
    draftRemoveEntered = 0;
    resetCreationConversationStoreForTests();
});

test("load imports IndexedDB only when backend has no record or tombstone", async () => {
    server.conversations.set("kept", { id: "kept", revision: 4, updatedAt: "2026-10-02T00:00:00.000Z", document: { id: "kept", title: "backend", messages: [] } });
    server.deleted.add("gone");
    stored.set(`guest:${CREATION_CONVERSATIONS_KEY}`, JSON.stringify([
        { id: "kept", title: "local old manuscript", messages: [] },
        { id: "gone", title: "Deleted", messages: [] },
        { id: "fresh", title: "To be imported", messages: [{ id: "m1", role: "user", content: "hi" }] },
    ]));
    const loaded = await loadCreationConversations();
    expect(server.imports).toEqual(["creation-conversations-v1:fresh"]);
    expect(loaded?.map((item) => item.id).sort()).toEqual(["fresh", "kept"]);
    expect(loaded?.find((item) => item.id === "kept")).toMatchObject({ title: "local old manuscript" });
    expect(loaded?.find((item) => item.id === "kept")?.conflictRemote).toMatchObject({ revision: 4, document: { title: "backend" } });
    const leftover = JSON.parse(stored.get(`guest:${CREATION_CONVERSATIONS_KEY}`) || "[]") as Array<{ id: string }>;
    expect(leftover.map((item) => item.id)).toEqual(["gone"]);
});

test("save failure keeps visible draft and does not mark server success", async () => {
    const draft = { id: "draft-1", title: "Not issued", messages: [{ id: "m1", role: "user" as const, content: "lens" }] };
    stored.set(`guest:${CREATION_CONVERSATIONS_KEY}`, JSON.stringify([draft]));
    server.failNext = { status: 500, message: "Conversation saving failed" };
    await expect(saveCreationConversations([draft])).rejects.toThrow("Conversation saving failed");
    expect(server.puts).toHaveLength(0);
    const local = await loadLocalCreationConversationDrafts();
    expect(local?.find((item) => item.id === "draft-1")).toMatchObject({ title: "Not issued" });
    server.failNext = null;
    await saveCreationConversations([draft]);
    expect(server.puts).toEqual([{ id: "draft-1", expectedRevision: 0, title: "Not issued", messageCount: 1 }]);
    expect(server.conversations.get("draft-1")?.revision).toBe(1);
    server.puts = [];
    await saveCreationConversations([draft]);
    expect(server.puts).toHaveLength(0);
});

test("deleted tombstone is not resurrected by later save of local cache", async () => {
    await saveCreationConversations([{ id: "dead", title: "old", messages: [] }]);
    await deleteCreationConversation("dead");
    expect(server.deleted.has("dead")).toBe(true);
    await expect(saveCreationConversations([{ id: "dead", title: "resurrection", messages: [] }])).rejects.toThrow("The conversation has been deleted and can no longer be written to");
    expect(server.conversations.get("dead")?.deleted).toBe(true);
    expect(server.conversations.get("dead")?.document?.title).toBe("old");
});

test("held write then later save still persists the latest document", async () => {
    holdPuts();
    const first = saveCreationConversations([{ id: "shared", title: "A", messages: [] }]);
    while (server.putEntered === 0) await Promise.resolve();
    const second = saveCreationConversations([{ id: "shared", title: "B", messages: [] }]);
    server.releasePut?.();
    await Promise.all([first, second]);
    expect(server.conversations.get("shared")?.document?.title).toBe("B");
    expect(server.puts.map((item) => item.title)).toEqual(["A", "B"]);
});

test("different conversation drafts survive concurrent saves", async () => {
    await Promise.all([
        saveCreationConversations([{ id: "left", title: "left", messages: [] }]),
        saveCreationConversations([{ id: "right", title: "right", messages: [] }]),
    ]);
    expect(server.conversations.get("left")?.document?.title).toBe("left");
    expect(server.conversations.get("right")?.document?.title).toBe("right");
});

test("failed write then reload recovers the latest draft", async () => {
    const latest = { id: "recover", title: "latest draft", messages: [{ id: "m1", role: "user" as const, content: "data: keep this prompt" }] };
    server.failNext = { status: 500, message: "Conversation saving failed" };
    await expect(saveCreationConversations([latest])).rejects.toThrow("Conversation saving failed");
    resetCreationConversationStoreForTests();
    const recovered = await loadLocalCreationConversationDrafts("guest");
    expect(recovered?.find((item) => item.id === "recover")).toMatchObject({ title: "latest draft" });
    expect(recovered?.find((item) => item.id === "recover")?.messages[0]).toMatchObject({ content: "data: keep this prompt" });
});

test("conflicting local draft stays visible and does not overwrite remote", async () => {
    server.conversations.set("live", { id: "live", revision: 5, updatedAt: "2026-10-02T00:00:00.000Z", document: { id: "live", title: "backend", messages: [] } });
    stored.set("guest:creation-conversation-drafts-v1:live", JSON.stringify({
        baseRevision: 4,
        document: { id: "live", title: "local edit", messages: [{ id: "m1", role: "user", content: "Not submitted" }] },
    }));
    stored.set("guest:creation-conversation-drafts-v1:index", JSON.stringify(["live"]));
    const loaded = await loadCreationConversations();
    expect(loaded?.find((item) => item.id === "live")).toMatchObject({ title: "local edit" });
    expect(loaded?.find((item) => item.id === "live")?.conflictRemote).toMatchObject({ revision: 5, document: { title: "backend" } });
    await saveCreationConversations(loaded || []);
    expect(server.puts).toHaveLength(0);
    expect(server.conversations.get("live")?.document?.title).toBe("backend");
    expect(server.conversations.get("live")?.revision).toBe(5);
    await saveCreationConversations(loaded || [], "guest", { resolveConflictIds: ["live"] });
    expect(server.puts).toEqual([{ id: "live", expectedRevision: 5, title: "local edit", messageCount: 1 }]);
    expect(server.conversations.get("live")?.revision).toBe(6);
    expect(server.conversations.get("live")?.document?.title).toBe("local edit");
});

test("fallback after remote reject keeps original scope and skips cached tombstones", async () => {
    server.conversations.set("kept", { id: "kept", revision: 1, updatedAt: "2026-10-02T00:00:00.000Z", document: { id: "kept", title: "backend", messages: [] } });
    server.deleted.add("gone");
    stored.set(`guest:${CREATION_CONVERSATIONS_KEY}`, JSON.stringify([
        { id: "gone", title: "tombstone", messages: [] },
    ]));
    stored.set("guest:creation-conversation-drafts-v1:drafty", JSON.stringify({
        baseRevision: 0,
        document: { id: "drafty", title: "Original workspace draft", messages: [] },
    }));
    stored.set("guest:creation-conversation-drafts-v1:index", JSON.stringify(["drafty"]));
    stored.set("other-workspace:creation-conversation-drafts-v1:other", JSON.stringify({
        baseRevision: 0,
        document: { id: "other", title: "new workspace", messages: [] },
    }));
    stored.set("other-workspace:creation-conversation-drafts-v1:index", JSON.stringify(["other"]));
    await loadCreationConversations("guest");
    server.failNext = { status: 500, message: "Conversation loading failed" };
    await expect(loadCreationConversations("guest")).rejects.toThrow("Conversation loading failed");
    activeScope = "other-workspace";
    const fallback = await loadLocalCreationConversationDrafts("guest");
    expect(fallback?.map((item) => item.id).sort()).toEqual(["drafty"]);
    expect(fallback?.find((item) => item.id === "gone")).toBeUndefined();
});

test("lost ack of the same document is recovered without a permanent 409", async () => {
    const draft = { id: "replay", title: "original manuscript", messages: [{ id: "m1", role: "user" as const, content: "hi" }] };
    await saveCreationConversations([draft]);
    expect(server.conversations.get("replay")?.revision).toBe(1);
    resetCreationConversationStoreForTests();
    await saveCreationConversations([draft]);
    expect(server.conversations.get("replay")?.revision).toBe(1);
    expect(server.conversations.get("replay")?.document?.title).toBe("original manuscript");
});

test("blob-only attachment is a recoverable persist failure", async () => {
    const draft = {
        id: "blob-only",
        title: "Accessories",
        messages: [{ id: "m1", role: "user" as const, content: "hi", attachments: [{ id: "a1", dataUrl: "data:image/png;base64,aaaa" }] }],
    };
    await expect(saveCreationConversations([draft])).rejects.toThrow("Attachment has no recoverable storage reference");
    expect(server.puts).toHaveLength(0);
    const local = await loadLocalCreationConversationDrafts();
    expect(local?.find((item) => item.id === "blob-only")).toMatchObject({ title: "Accessories" });
});

test("caller mutation during delayed PUT cannot change in-flight payload", async () => {
    holdPuts();
    const draft = { id: "mut", title: "original", messages: [{ id: "m1", role: "user" as const, content: "one" }] };
    const pending = saveCreationConversations([draft]);
    while (server.putEntered === 0) await Promise.resolve();
    draft.messages.push({ id: "m2", role: "user" as const, content: "two" });
    draft.title = "changed";
    server.releasePut?.();
    await pending;
    expect(server.puts[0]).toMatchObject({ id: "mut", title: "original", messageCount: 1 });
    expect(server.conversations.get("mut")?.document?.title).toBe("original");
    expect(server.conversations.get("mut")?.document?.messages).toHaveLength(1);
});

test("canonical untitled ack skips a second PUT", async () => {
    await saveCreationConversations([{ id: "untitled", messages: [] }]);
    expect(server.puts).toEqual([{ id: "untitled", expectedRevision: 0, title: "new creation", messageCount: 0 }]);
    expect(server.conversations.get("untitled")?.document?.title).toBe("new creation");
    server.puts = [];
    await saveCreationConversations([{ id: "untitled", messages: [] }]);
    expect(server.puts).toHaveLength(0);
    const loaded = await loadCreationConversations();
    expect(loaded?.find((item) => item.id === "untitled")).toMatchObject({ title: "new creation" });
});

test("accepting saved version parks local draft and restore brings conflict back", async () => {
    server.conversations.set("live", { id: "live", revision: 5, updatedAt: "2026-10-02T00:00:00.000Z", document: { id: "live", title: "backend", messages: [] } });
    stored.set("guest:creation-conversation-drafts-v1:live", JSON.stringify({
        baseRevision: 4,
        document: { id: "live", title: "local edit", messages: [{ id: "m1", role: "user", content: "Not submitted" }] },
    }));
    stored.set("guest:creation-conversation-drafts-v1:index", JSON.stringify(["live"]));
    const loaded = await loadCreationConversations();
    const live = loaded?.find((item) => item.id === "live");
    expect(live?.conflictRemote?.revision).toBe(5);
    await acceptSavedCreationConversation("live", live!, live!.conflictRemote!);
    expect(await hasParkedCreationConversationDraft("live")).toBe(true);
    server.puts = [];
    await saveCreationConversations([{ id: "live", title: "backend", messages: [] }]);
    expect(server.puts).toHaveLength(0);
    resetCreationConversationStoreForTests();
    const afterAccept = await loadCreationConversations();
    expect(afterAccept?.find((item) => item.id === "live")).toMatchObject({ title: "backend" });
    expect(afterAccept?.find((item) => item.id === "live")?.conflictRemote).toBeUndefined();
    const restored = await restoreParkedCreationConversation("live");
    expect(restored).toMatchObject({ title: "local edit" });
    expect(restored?.conflictRemote).toMatchObject({ revision: 5, document: { title: "backend" } });
    resetCreationConversationStoreForTests();
    const afterRestore = await loadCreationConversations();
    expect(afterRestore?.find((item) => item.id === "live")).toMatchObject({ title: "local edit" });
    expect(afterRestore?.find((item) => item.id === "live")?.conflictRemote?.revision).toBe(5);
});

test("matching legacy of an existing server record is cleared without conflict", async () => {
    server.conversations.set("same", { id: "same", revision: 2, updatedAt: "2026-10-02T00:00:00.000Z", document: { id: "same", title: "Same", messages: [] } });
    stored.set(`guest:${CREATION_CONVERSATIONS_KEY}`, JSON.stringify([{ id: "same", title: "Same", messages: [] }]));
    const loaded = await loadCreationConversations();
    expect(loaded?.find((item) => item.id === "same")).toMatchObject({ title: "Same" });
    expect(loaded?.find((item) => item.id === "same")?.conflictRemote).toBeUndefined();
    expect(server.imports).toEqual([]);
    const leftover = JSON.parse(stored.get(`guest:${CREATION_CONVERSATIONS_KEY}`) || "[]") as Array<{ id: string }>;
    expect(leftover).toEqual([]);
});

test("later generation is projected onto the canonical untitled ack", async () => {
    holdPuts();
    const first = saveCreationConversations([{ id: "proj", messages: [{ id: "m1", role: "user" as const, content: "a" }] }]);
    while (server.putEntered === 0) await Promise.resolve();
    const second = saveCreationConversations([{
        id: "proj",
        messages: [
            { id: "m1", role: "user" as const, content: "a" },
            { id: "m2", role: "user" as const, content: "b" },
        ],
    }]);
    server.releasePut?.();
    await Promise.all([first, second]);
    expect(server.puts.map((item) => item.title)).toEqual(["new creation", "new creation"]);
    expect(server.puts.map((item) => item.messageCount)).toEqual([1, 2]);
    expect(server.conversations.get("proj")?.document?.title).toBe("new creation");
    expect(server.conversations.get("proj")?.document?.messages).toHaveLength(2);
});

test("adoptServerConfirmedConversationDocument adopts the server document and does not PUT", async () => {
    const adopted = await adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "Bound",
        messages: [{ id: "msg-1", role: "assistant", content: "Image has been generated" }],
    }, 4);
    expect(adopted.title).toBe("Bound");
    expect(server.puts).toEqual([]);
});

test("adopt keeps deferred user edits instead of dropping the draft", async () => {
    server.conversations.set("conv-1", {
        id: "conv-1",
        revision: 3,
        updatedAt: "2026-10-02T00:00:00.000Z",
        document: {
            id: "conv-1",
            title: "original manuscript",
            messages: [
                { id: "user-1", role: "user", content: "lens" },
                { id: "msg-1", role: "assistant", status: "pending", content: "", taskIds: ["task-1"] },
            ],
        },
    });
    await loadCreationConversations();
    holdPuts();
    const saveP = saveCreationConversations([{
        id: "conv-1",
        title: "Change name",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "pending", content: "", taskIds: ["task-1"] },
            { id: "user-2", role: "user", content: "supplement" },
        ],
    }]);
    while (server.putEntered === 0) await Promise.resolve();
    const adopted = await adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "original manuscript",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "done", content: "Image has been generated", taskIds: ["task-1"], resultUrls: ["/api/resources/res-1/file"] },
        ],
    }, 5);
    expect(adopted.title).toBe("Change name");
    expect((adopted.messages as Array<{ id: string; content?: string }>).map((item) => item.id)).toEqual(["user-1", "msg-1", "user-2"]);
    expect((adopted.messages as Array<{ id: string; content?: string }>).find((item) => item.id === "msg-1")?.content).toBe("Image has been generated");
    expect((adopted.messages as Array<{ id: string; content?: string }>).find((item) => item.id === "user-2")?.content).toBe("supplement");
    const drafts = await loadLocalCreationConversationDrafts();
    expect(drafts?.find((item) => item.id === "conv-1")).toMatchObject({ title: "Change name" });
    expect(drafts?.find((item) => item.id === "conv-1")?.messages).toHaveLength(3);
    server.releasePut?.();
    await saveP;
    const afterFlush = await loadLocalCreationConversationDrafts();
    expect(afterFlush?.find((item) => item.id === "conv-1")?.messages).toHaveLength(3);
    expect(server.conversations.get("conv-1")?.document?.title).toBe("Change name");
});

test("adopt keeps a local title edit without resurrecting a remotely deleted message", async () => {
    server.conversations.set("conv-1", {
        id: "conv-1", revision: 3, updatedAt: "2026-10-02T00:00:00.000Z",
        document: { id: "conv-1", title: "original manuscript", messages: [{ id: "msg-1", role: "user", content: "old news" }] },
    });
    await loadCreationConversations();
    holdPuts();
    const saving = saveCreationConversations([{ id: "conv-1", title: "local title", messages: [{ id: "msg-1", role: "user", content: "old news" }] }]);
    while (!server.putEntered) await Promise.resolve();
    const adopted = await adoptServerConfirmedConversationDocument("conv-1", { id: "conv-1", title: "original manuscript", messages: [] }, 5);
    expect(adopted.title).toBe("local title");
    expect(adopted.messages).toEqual([]);
    server.releasePut?.();
    await saving;
});

test("adopt refuses an older receipt instead of rolling back committed truth", async () => {
    const newer = await adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "New confirmation",
        messages: [{ id: "msg-1", role: "assistant", content: "Image has been generated" }],
    }, 5);
    expect(newer.title).toBe("New confirmation");
    const older = await adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "old receipt",
        messages: [{ id: "msg-1", role: "assistant", content: "old content" }],
    }, 3);
    expect(older.title).toBe("New confirmation");
    expect((older.messages as Array<{ content?: string }>)[0]?.content).toBe("Image has been generated");
    const drafts = await loadLocalCreationConversationDrafts();
    expect(drafts?.find((item) => item.id === "conv-1")).toBeUndefined();
});

test("adopt IDB failure keeps the user draft and retry merges after restart", async () => {
    server.conversations.set("conv-1", {
        id: "conv-1",
        revision: 3,
        updatedAt: "2026-10-02T00:00:00.000Z",
        document: {
            id: "conv-1",
            title: "original manuscript",
            messages: [
                { id: "user-1", role: "user", content: "lens" },
                { id: "msg-1", role: "assistant", status: "pending", content: "", taskIds: ["task-1"] },
            ],
        },
    });
    await loadCreationConversations();
    holdPuts();
    const saveP = saveCreationConversations([{
        id: "conv-1",
        title: "Change name",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "pending", content: "", taskIds: ["task-1"] },
            { id: "user-2", role: "user", content: "supplement" },
        ],
    }]);
    while (server.putEntered === 0) await Promise.resolve();
    draftWriteError = new Error("IndexedDB unavailable");
    await expect(adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "original manuscript",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "done", content: "Image has been generated", taskIds: ["task-1"] },
        ],
    }, 5)).rejects.toThrow("IndexedDB unavailable");
    const kept = JSON.parse(stored.get("guest:creation-conversation-drafts-v1:conv-1") || "null") as { document?: { title?: string; messages?: unknown[] } };
    expect(kept.document?.title).toBe("Change name");
    expect(kept.document?.messages).toHaveLength(3);
    draftWriteError = null;
    resetCreationConversationStoreForTests();
    const afterRestart = await loadLocalCreationConversationDrafts();
    expect(afterRestart?.find((item) => item.id === "conv-1")).toMatchObject({ title: "Change name" });
    expect(afterRestart?.find((item) => item.id === "conv-1")?.messages).toHaveLength(3);
    await loadCreationConversations();
    const retried = await adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "original manuscript",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "done", content: "Image has been generated", taskIds: ["task-1"] },
        ],
    }, 5);
    expect(retried.title).toBe("Change name");
    expect((retried.messages as Array<{ id: string; content?: string }>).find((item) => item.id === "msg-1")?.content).toBe("Image has been generated");
    expect((retried.messages as Array<{ id: string }>).find((item) => item.id === "user-2")).toBeDefined();
    server.releasePut?.();
    await saveP.catch(() => undefined);
});

test("adopt keeps an edit arriving during the final draft removal", async () => {
    server.conversations.set("conv-1", { id: "conv-1", revision: 3, updatedAt: "2026-10-02T00:00:00.000Z", document: { id: "conv-1", title: "original manuscript", messages: [] } });
    await loadCreationConversations();
    let release!: () => void;
    draftRemoveHold = new Promise<void>((resolve) => { release = resolve; });
    holdPuts();
    const adoptP = adoptServerConfirmedConversationDocument("conv-1", { id: "conv-1", title: "original manuscript", messages: [] }, 5);
    while (!draftRemoveEntered) await Promise.resolve();
    const saveP = saveCreationConversations([{ id: "conv-1", title: "New edit for last step", messages: [{ id: "new", role: "user", content: "Reserve" }] }]);
    release();
    const adopted = await adoptP;
    server.releasePut?.();
    await saveP.catch(() => undefined);
    expect(adopted.title).toBe("New edit for last step");
    expect(adopted.messages).toHaveLength(1);
});

test("adopt keeps a newer draft that arrives while receipt persistence is in flight", async () => {
    server.conversations.set("conv-1", {
        id: "conv-1",
        revision: 3,
        updatedAt: "2026-10-02T00:00:00.000Z",
        document: {
            id: "conv-1",
            title: "original manuscript",
            messages: [
                { id: "user-1", role: "user", content: "lens" },
                { id: "msg-1", role: "assistant", status: "pending", content: "", taskIds: ["task-1"] },
            ],
        },
    });
    await loadCreationConversations();
    holdDraftWrites();
    const adoptP = adoptServerConfirmedConversationDocument("conv-1", {
        id: "conv-1",
        title: "original manuscript",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "done", content: "Image has been generated", taskIds: ["task-1"] },
        ],
    }, 5);
    while (draftWriteEntered === 0) await Promise.resolve();
    const saveP = saveCreationConversations([{
        id: "conv-1",
        title: "Changed name on the way",
        messages: [
            { id: "user-1", role: "user", content: "lens" },
            { id: "msg-1", role: "assistant", status: "pending", content: "", taskIds: ["task-1"] },
            { id: "user-2", role: "user", content: "Supplement on the way" },
        ],
    }]);
    await Promise.resolve();
    releaseDraftHold?.();
    const adopted = await adoptP;
    expect(adopted.title).toBe("Changed name on the way");
    expect((adopted.messages as Array<{ id: string; content?: string }>).find((item) => item.id === "msg-1")?.content).toBe("Image has been generated");
    expect((adopted.messages as Array<{ id: string; content?: string }>).find((item) => item.id === "user-2")?.content).toBe("Supplement on the way");
    await saveP.catch(() => undefined);
    const drafts = await loadLocalCreationConversationDrafts();
    expect(drafts?.find((item) => item.id === "conv-1")).toMatchObject({ title: "Changed name on the way" });
    expect((drafts?.find((item) => item.id === "conv-1")?.messages as Array<{ id: string }> | undefined)?.some((item) => item.id === "user-2")).toBe(true);
});
