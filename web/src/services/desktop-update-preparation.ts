type PrepareEditor = () => void | Promise<void>;
import { getActiveUserScope } from "@/lib/user-scope";
import { canvasSyncProgressKey, type SyncProjectProgress } from "@/stores/use-sync-progress-store";

export class DesktopUpdateSaveInProgressError extends Error {
    constructor() {
        super("There is still content being written, please wait until the save is completed before updating.");
    }
}

// Progress includes historical read/import errors, deleted projects and other
// accounts. Those records are not evidence of an ongoing write.
export function assertDesktopUpdateProgressSettled(
    records: Record<string, SyncProjectProgress>,
    projectIds: ReadonlySet<string>,
    scope = getActiveUserScope(),
    allowFailed = false,
) {
    const progress = Object.entries(records).filter(([key, item]) => key === canvasSyncProgressKey(item.projectId, scope)).map(([, item]) => item);
    if (progress.some(item => ["pending", "uploading", "saving"].includes(item.phase))) throw new DesktopUpdateSaveInProgressError();
    if (!allowFailed && progress.some(item => projectIds.has(item.projectId) && (item.phase === "error" || item.phase === "conflict"))) {
        throw new Error("There is a canvas that failed to save or there is a content conflict. Please handle it and try again, or choose to update anyway.");
    }
}

// Mounted editors own their pending writes; the updater must await them before
// asking the native host to exit. Unmounting removes the old workspace callback.
const editors = new Set<{ prepare: PrepareEditor; isSaving: () => boolean; mounted: boolean }>();

export function registerDesktopUpdatePreparation(prepare: PrepareEditor, isSaving: () => boolean = () => false) {
    const editor = { prepare, isSaving, mounted: true };
    editors.add(editor);
    return () => {
        editor.mounted = false;
        if (!isSaving()) editors.delete(editor);
    };
}

export async function prepareDesktopEditorsForUpdate() {
    for (const editor of [...editors]) if (editor.mounted) await editor.prepare();
}

export function hasActiveDesktopEditorSaves() {
    let saving = false;
    for (const editor of editors) {
        if (editor.isSaving()) saving = true;
        else if (!editor.mounted) editors.delete(editor);
    }
    return saving;
}
