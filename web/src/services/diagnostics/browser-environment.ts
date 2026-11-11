import type { EnvironmentCheck } from "./environment-check";

let storageWritable: boolean | undefined;
let storageTimedOut = false;
let latestStorageProbe = 0;

export type BrowserCapabilities = { secureRandom: boolean; randomUUID: boolean; structuredClone: boolean; indexedDB: boolean; storageWritable?: boolean; storageTimedOut?: boolean; webGL: boolean; h264: boolean; hevc: boolean };

export function browserCapabilities(): BrowserCapabilities {
    // Creating a GPU context can destabilize remote/virtual-display drivers.
    // Presence is only an interface check, never proof of working acceleration.
    const webGL = typeof globalThis.WebGLRenderingContext !== "undefined";
    const video = typeof document === "undefined" ? undefined : document.createElement("video");
    let indexedDBAvailable = false;
    try { indexedDBAvailable = typeof globalThis.indexedDB !== "undefined"; } catch { /* Access can be denied for opaque origins. */ }
    return {
        secureRandom: typeof globalThis.crypto?.getRandomValues === "function",
        randomUUID: typeof globalThis.crypto?.randomUUID === "function",
        structuredClone: typeof globalThis.structuredClone === "function",
        indexedDB: indexedDBAvailable,
        storageWritable,
        storageTimedOut,
        webGL,
        h264: Boolean(video?.canPlayType('video/mp4; codecs="avc1.42E01E"')),
        hevc: Boolean(video?.canPlayType('video/mp4; codecs="hvc1"')),
    };
}

export function browserChecks(capabilities = browserCapabilities()): EnvironmentCheck[] {
    const check = (id: string, title: string, status: EnvironmentCheck["status"], detail: string, cases = ["ENV-0001"]): EnvironmentCheck => ({ id, title, status, detail, cases });
    return [
        check("secure-random", "secure random number", capabilities.secureRandom ? "pass" : "error", capabilities.secureRandom ? "Secure random numbers are available. Creating tasks does not rely on the security context restrictions of randomUUID." : "Lack of secure random number capabilities prevents reliable creation of task identifiers. Please update your browser or WebView2 runtime."),
        check("structured-clone", "Canvas data copy", capabilities.structuredClone ? "pass" : "error", capabilities.structuredClone ? "Canvas data copying capability is available." : "The runtime is missing the data copying capabilities required by the canvas, please update your browser or WebView2 runtime."),
        check("indexed-db", "Browser local cache", !capabilities.indexedDB || capabilities.storageWritable === false ? "error" : capabilities.storageTimedOut ? "warning" : capabilities.storageWritable === true ? "pass" : "unknown", !capabilities.indexedDB || capabilities.storageWritable === false ? "The local cache cannot be written to, please check privacy settings, storage, or update the runtime." : capabilities.storageTimedOut ? "Cache check timed out and has not been confirmed to be writable. Please close the page occupying storage and check again." : capabilities.storageWritable === true ? "Completed writing, reading, and cleaning of independent test records." : "The local cache write check has not completed yet."),
        check("webgl", "graphics acceleration", capabilities.webGL ? "unknown" : "warning", capabilities.webGL ? "The graphical interface is available, and the hardware acceleration status needs to be confirmed in the actual preview." : "The graphical interface is not available and some previews may be slow. Please check the remote desktop, graphics driver or browser hardware acceleration settings.", ["ENV-0051"]),
        check("video-codec", "video playback", capabilities.h264 ? "pass" : "warning", capabilities.h264 ? (capabilities.hevc ? "The browser declares support for H.264 and HEVC; specific material still needs to be actually decoded." : "The browser declares support for H.264, and HEVC footage can be previewed with native video tools to generate compatible previews.") : "The browser does not declare H.264 playback capabilities, please update the runtime and check the system media components.", ["ENV-0014", "ENV-0029"]),
    ];
}

// Use an isolated, uniquely named database. Never open or clear product stores.
// Late success after the deadline still closes and removes the probe database.
type StorageProbeResult = Pick<BrowserCapabilities, "storageWritable" | "storageTimedOut">;
export async function probeBrowserStorage(signal?: AbortSignal): Promise<StorageProbeResult> {
    if (signal?.aborted) return {};
    const probe = ++latestStorageProbe;
    const publish = (result: StorageProbeResult) => {
        if (probe === latestStorageProbe && !signal?.aborted) {
            storageWritable = result.storageWritable;
            storageTimedOut = result.storageTimedOut ?? false;
        }
        return result;
    };
    try { if (typeof indexedDB === "undefined") return publish({ storageWritable: false }); }
    catch { return publish({ storageWritable: false }); }
    return new Promise<StorageProbeResult>((resolve) => {
        const name = `beeftv-environment-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let settled = false;
        let database: IDBDatabase | undefined;
        const removeProbe = () => { try { return indexedDB.deleteDatabase(name); } catch { return undefined; } };
        const finish = (result?: boolean, timedOut = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            database?.close();
            removeProbe();
            const snapshot = { storageWritable: result, storageTimedOut: timedOut };
            resolve(signal?.aborted ? {} : publish(snapshot));
        };
        const timer = setTimeout(() => finish(undefined, true), 2000);
        const abort = () => finish();
        signal?.addEventListener("abort", abort, { once: true });
        try {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = () => { request.result.createObjectStore("probe"); };
            request.onerror = () => { finish(false); removeProbe(); };
            request.onsuccess = () => {
                database = request.result;
                if (settled) { database.close(); removeProbe(); return; }
                try {
                const transaction = database.transaction("probe", "readwrite");
                const store = transaction.objectStore("probe");
                store.put("ok", "test");
                let verified = false;
                store.get("test").onsuccess = (event) => { verified = (event.target as IDBRequest).result === "ok"; };
                transaction.oncomplete = () => {
                    database?.close();
                    const cleanup = removeProbe();
                    if (!cleanup) { finish(); return; }
                    cleanup.onsuccess = () => finish(verified);
                    cleanup.onerror = () => finish();
                };
                transaction.onabort = () => { database?.close(); removeProbe(); finish(false); };
                } catch { database.close(); removeProbe(); finish(false); }
            };
        } catch { finish(false); }
    });
}
