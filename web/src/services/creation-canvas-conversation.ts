import type { CanvasAssistantMessage, CanvasAssistantSession } from "@/types/canvas";
import { getActiveUserScope } from "@/lib/user-scope";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { hasRemoteUserDataSyncSession, loadCanvasProjectForEditing, saveRemoteUserDataNow } from "@/services/local-workspace-sync";
import { createWorkspaceCanvasProject } from "@/services/workspace-project-repository";

type SourceMessage = {
    id: string; role: "user" | "assistant"; content: string; createdAt: string;
    mode?: string; status?: string; taskIds?: string[]; error?: string; model?: string;
    settings?: unknown; attachments?: Array<{ name: string; storageKey?: string }>;
    references?: Array<{ id: string; label: string; kind: string }>;
};
type SourceConversation = { id: string; title: string; updatedAt: string; canvasId?: string; messages: SourceMessage[] };

// Same source IDs merge into the same canvas conversation, without replaying tasks
// or replacing messages produced by the canvas Agent after the handoff.
export async function continueCreationConversationOnCanvas(source: SourceConversation) {
    const scope = getActiveUserScope();
    const assertScope = () => { if (scope !== getActiveUserScope()) throw new DOMException("The account has been switched, please reopen creation", "AbortError"); };
    if (!source.id || !source.messages.length) throw new Error("Please start a creative conversation first");
    if (source.messages.some((item) => item.status === "pending" || item.status === "streaming")) throw new Error("The current creation is still being generated, please finish or stop before switching to the canvas.");
    if (!useCanvasStore.getState().hydrated) throw new Error("Canvas data is loading, please continue later.");
    const sessionId = `creation:${source.id}`;
    const messages: CanvasAssistantMessage[] = source.messages.map((item) => ({
        id: `creation:${source.id}:${item.id}`, role: item.role,
        text: item.content || (item.status === "done" ? "The homepage work has been generated and you can continue to create it in the canvas." : item.status === "error" ? "Home page generation is not completed." : item.status === "cancelled" ? "Home page generation has stopped." : "Creative records from the home page"),
        meta: "From home page",
        detail: { kind: "creation-handoff", sourceConversationId: source.id, sourceMessageId: item.id, createdAt: item.createdAt,
            status: item.status, mode: item.mode, model: item.model, taskIds: item.taskIds, error: item.error, settings: item.settings,
            references: item.references?.map(({ id, label, kind }) => ({ id, label, kind })),
            attachments: item.attachments?.map(({ name, storageKey }) => ({ name, storageKey })),
        },
    }));
    const local = useCanvasStore.getState().projects.find((item) => item.chatSessions?.some((session) => session.id === sessionId));
    const existingId = source.canvasId || local?.id;
    let id: string;
    let syncError: unknown;
    if (existingId) {
        const project = await loadCanvasProjectForEditing(existingId);
        assertScope();
        if (!project) throw new Error("The associated canvas no longer exists, please restore the canvas before continuing.");
        const sessions = project.chatSessions || [];
        const previous = sessions.find((item) => item.id === sessionId);
        const incoming = new Map(messages.map((item) => [item.id, item]));
        const merged = (previous?.messages || []).map((item) => {
            const replacement = incoming.get(item.id);
            incoming.delete(item.id);
            return replacement || item;
        });
        const session: CanvasAssistantSession = { ...previous, id: sessionId, title: source.title, createdAt: previous?.createdAt || source.messages[0].createdAt, updatedAt: new Date().toISOString(), messages: [...merged, ...incoming.values()] };
        useCanvasStore.getState().updateProject(project.id, { chatSessions: [...sessions.filter((item) => item.id !== sessionId), session], activeChatId: sessionId });
        id = project.id;
        await flushCanvasStorePersistence();
        assertScope();
        if (hasRemoteUserDataSyncSession()) {
            try { await saveRemoteUserDataNow(); }
            catch (cause) { syncError = cause; }
        }
    } else {
        const session: CanvasAssistantSession = { id: sessionId, title: source.title, createdAt: source.messages[0].createdAt, updatedAt: source.updatedAt, messages };
        const created = await createWorkspaceCanvasProject(source.title || "creative canvas", undefined, { chatSessions: [session], activeChatId: sessionId });
        id = created.id;
        syncError = created.syncError;
        await flushCanvasStorePersistence();
    }
    assertScope();
    return { id, sessionId, syncError };
}
