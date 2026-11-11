import { refreshResource, prepareResourcePlayback, getResourcePlayback, resourceIdFromStorageKey, type ResourcePlayback } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";

export async function resolveResourceVideoPlayback(storageKey: string, fallback: string, signal: AbortSignal, needsCompatible = false): Promise<string | ResourcePlayback> {
    const id = resourceIdFromStorageKey(storageKey);
    if (id) {
        let resource = await refreshResource(id, { signal });
        if (needsCompatible && resource.playbackStatus !== "processing") {
            resource = await prepareResourcePlayback(id, { signal });
        }
        for (let attempt = 0; resource.playbackStatus === "processing"; attempt += 1) {
            if (attempt >= 120) throw new Error("The video preview is still being prepared, please reopen it later");
            await waitForPlaybackPoll(signal);
            resource = await refreshResource(id, { signal });
        }
        if (resource.playbackStatus === "ready") {
            const playback = await getResourcePlayback(storageKey, { signal });
            if (!playback) throw new Error("Video preview is not available, please try again");
            return playback;
        }
        if (needsCompatible && resource.playbackStatus !== "ready") throw new Error("The video has been imported and cannot be previewed at the moment. Please try again. The original file is still available for download.");
    }
    const url = await resolveMediaUrl(storageKey, fallback);
    if (signal.aborted) throw signal.reason;
    return url;
}

function waitForPlaybackPoll(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); reject(signal.reason); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, 2500);
        signal.addEventListener("abort", abort, { once: true });
    });
}
