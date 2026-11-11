import { ApiError } from "@/services/api/request";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { projectSyncProgress, useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { getActiveUserScope } from "@/lib/user-scope";

export class CanvasBackendSubmitPausedError extends Error {
    constructor(message = "The canvas has unprocessed external changes and has not been submitted this time.") {
        super(message);
        this.name = "CanvasBackendSubmitPausedError";
    }
}

/** 409 还可能表示节点/任务身份冲突，只有版本冲突才能进入草稿合并和重试。 */
export function isCanvasRevisionConflict(error: unknown) {
    if (!(error instanceof ApiError)) return false;
    return error.reason === "stale_revision" || error.status === 428 || (error.status === 409 && (!error.reason || error.reason === "conflict"));
}

export function isCanvasSubmitControlError(error: unknown) {
    return error instanceof CanvasBackendSubmitPausedError;
}

/**
 * 把本地画布内容另存为草稿。
 *
 * 草稿模块在加载期回到本模块的调用方，因此这里用动态导入打破加载环，
 * 同时保证只有真的发生冲突时才付出这次加载成本。
 * required 用于「替换本地内容之前」：草稿没保存成功就抛错，调用方不得继续替换。
 */
export async function preserveCanvasConflictDraft(id: string, project: CanvasProject, scope = getActiveUserScope(), options: { required?: boolean } = {}) {
    try {
        const { preserveCanvasSyncDraft } = await import("@/services/canvas-sync-drafts");
        await preserveCanvasSyncDraft(project, scope);
    } catch (draftError) {
        console.error("Canvas conflict draft retention failed", { id, error: draftError });
        if (options.required) throw new Error("The current content could not be saved as a draft and the canvas was not replaced. Please download the current content and try again.");
    }
}

/**
 * 后端按 revision 原子拒绝（陈旧提交），且读取最新版本后仍无法安全合并时的收尾：
 * 先把本地内容落成草稿，再把该画布标成冲突并暂停自动提交。不改写本地内容。
 */
export async function handleRejectedCanvasBackendSave(id: string, project: CanvasProject | null | undefined, error: unknown, scope = getActiveUserScope()) {
    if (!isCanvasRevisionConflict(error)) return false;
    if (project) await preserveCanvasConflictDraft(id, project, scope);
    pauseCanvasBackendSubmit(id, scope);
    return true;
}

const SAVE_PROGRESS_MESSAGES = {
    pending: "Saving",
    saving: "Saving",
    done: "Canvas saved",
    error: "The save is not completed and the modifications are still retained on this machine.",
} as const;

export type CanvasBackendSaveProgressPhase = keyof typeof SAVE_PROGRESS_MESSAGES;

/**
 * 发布画布保存的真实进度：排队、提交中、已被服务端接受、失败。
 * 冲突暂停优先：只有被接受的提交或「使用最新版本」能解除它，普通进度不得覆盖。
 */
export function setCanvasBackendSaveProgress(id: string, scope: string, phase: CanvasBackendSaveProgressPhase) {
    if (canvasBackendSubmitPaused(id, scope)) return;
    const message = SAVE_PROGRESS_MESSAGES[phase];
    const current = projectSyncProgress(id, scope);
    if (current?.phase === phase && current.message === message) return;
    useSyncProgressStore.getState().setProjectProgress(id, { phase, message }, scope);
}

/** 画布已删除：不再保留它的保存进度。 */
export function clearCanvasBackendSaveProgress(id: string, scope: string) {
    useSyncProgressStore.getState().setProjectProgress(id, null, scope);
}

export function pauseCanvasBackendSubmit(id: string, scope = getActiveUserScope(), message = "The canvas has been modified by other entries and this change has not been submitted; the existing content has been retained on this machine") {
    useSyncProgressStore.getState().setProjectProgress(id, { phase: "conflict", message }, scope);
}

/** 冲突后暂停自动提交，避免同一份过时 revision 反复提交。 */
export function canvasBackendSubmitPaused(id: string, scope = getActiveUserScope()) {
    return projectSyncProgress(id, scope)?.phase === "conflict";
}

/** 后端已接受这次提交：解除暂停，画布恢复自动保存。 */
export function resumeCanvasBackendSubmit(id: string, scope = getActiveUserScope()) {
    if (!canvasBackendSubmitPaused(id, scope)) return;
    useSyncProgressStore.getState().setProjectProgress(id, { phase: "done", message: "Canvas saved" }, scope);
}
