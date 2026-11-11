import { create } from "zustand";
import { nanoid } from "nanoid";
import { createTransferSampler, type CanvasOperationTarget, type OperationProgress } from "@/lib/operation-progress";

type ProgressStore = { entries: Record<string, OperationProgress>; remove: (id: string) => void };
export const useOperationProgress = create<ProgressStore>((set) => ({
    entries: {},
    remove: (id) => set(state => {
        const entries = { ...state.entries };
        delete entries[id];
        return { entries };
    }),
}));

export function startOperation(title: string, options: { detail?: string; totalBytes?: number; totalFiles?: number; target?: CanvasOperationTarget } = {}) {
    const id = nanoid();
    const startedAt = Date.now();
    const sample = createTransferSampler(startedAt);
    let finished = false;
    let lastReport = 0;
    const update = (patch: Partial<OperationProgress>) => {
        if (finished) return;
        useOperationProgress.setState(state => {
            const previous = state.entries[id];
            if (!previous) return state;
            return { entries: { ...state.entries, [id]: { ...previous, ...patch, updatedAt: patch.updatedAt ?? Date.now() } } };
        });
    };
    useOperationProgress.setState(state => ({ entries: { ...state.entries, [id]: {
        id, title, target: options.target, detail: options.detail || "Preparing files", phase: "preparing", totalBytes: options.totalBytes, totalFiles: options.totalFiles, startedAt, updatedAt: startedAt,
    } } }));
    const settle = (phase: "done" | "error", detail: string) => {
        update({ phase, detail, bytesPerSecond: 0 });
        finished = true;
        if (phase === "done") setTimeout(() => useOperationProgress.getState().remove(id), 4500);
    };
    return {
        update,
        progress: (loaded: number, total?: number) => {
            const next = sample(loaded, total);
            const complete = total !== undefined && total > 0 && loaded >= total;
            if (!complete && Date.now() - lastReport < 150) return;
            lastReport = Date.now();
            update({ ...next, phase: complete ? "processing" : "transferring", detail: complete ? "The file has been transferred and is being confirmed and saved." : "Transferring files" });
        },
        done: (detail = "Processing completed") => settle("done", detail),
        fail: (detail = "Processing not completed, please try again") => settle("error", detail),
        dismiss: () => { finished = true; useOperationProgress.getState().remove(id); },
    };
}
