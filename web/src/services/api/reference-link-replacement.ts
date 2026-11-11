import { getDesktopAppBinding } from "@/services/desktop-runtime";
import { startOperation } from "@/stores/use-operation-progress";
import type { CanvasOperationTarget } from "@/lib/operation-progress";

export type ReferenceLinkRequest = { key: string; label: string; name?: string; resourceID?: string; upload?: boolean };
export type ResolveReferenceLinks = (references: ReferenceLinkRequest[], signal?: AbortSignal, target?: CanvasOperationTarget) => Promise<Record<string, string> | null>;

// The native uploader exposes one live status; only its active caller polls it.
let referenceUploadQueue = Promise.resolve();

// Shared by every task submission entry. Only owned resource IDs reach desktop IO.
export async function uploadReferenceLinks(references: ReferenceLinkRequest[], signal?: AbortSignal, target?: CanvasOperationTarget): Promise<Record<string, string>> {
    signal?.throwIfAborted();
    const binding = typeof window === "undefined" ? undefined : getDesktopAppBinding();
    const candidates = references.filter((item) => item.resourceID && item.upload !== false);
    if (!binding?.ReferenceStorageSettings || !binding.UploadReferenceMedia || !candidates.length) return {};
    const config = await binding.ReferenceStorageSettings();
    signal?.throwIfAborted();
    if (!config.enabled) return {};
    const previousUpload = referenceUploadQueue;
    let releaseUpload!: () => void;
    referenceUploadQueue = new Promise<void>(resolve => { releaseUpload = resolve; });
    const progress = startOperation("Upload reference materials", { target, detail: "Waiting for reference material to be uploaded" });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
        try {
            const state = await binding.ReferenceUploadStatus?.();
            if (!stopped && state?.phase) progress.update({ ...state, detail: (state.phase === "transferring" ? "Uploading" : state.phase === "processing" ? "Confirming" : "Preparing") + state.label });
        } catch { /* The upload promise owns errors; progress polling must not repeat it. */ }
        if (!stopped) timer = setTimeout(poll, 500);
    };
    let urls: Record<string, string>;
    try {
        await previousUpload;
        signal?.throwIfAborted();
        progress.update({ detail: "Preparing reference materials" });
        const pending = binding.UploadReferenceMedia([...new Set(candidates.map((item) => item.resourceID!))]);
        void poll();
        urls = await pending;
        if (target) progress.dismiss(); else progress.done("Reference material has been uploaded and confirmed to be available");
    } catch (error) {
        if (target || signal?.aborted) progress.dismiss();
        else progress.fail("The reference material upload is not completed, please check the error and try again.");
        throw error;
    }
    finally { stopped = true; if (timer) clearTimeout(timer); releaseUpload(); }
    signal?.throwIfAborted();
    const links: Record<string, string> = {};
    for (const item of candidates) if (isReferenceHTTPSLink(urls[item.resourceID!] || "")) links[item.key] = urls[item.resourceID!];
    return links;
}

export function isReferenceHTTPSLink(value: string): boolean {
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
        return false;
    }
}
