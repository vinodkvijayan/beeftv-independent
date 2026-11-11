import type { CanvasFaceBox } from "./canvas-emotion";
import { resolveEmbeddedAssetUrl } from "@/lib/embedded-runtime";

type DetectFaceResponse = {
    id: number;
    faces?: CanvasFaceBox[];
    imageWidth?: number;
    imageHeight?: number;
    error?: string;
};

type PendingRequest = {
    resolve: (result: CanvasFaceDetectionResult) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
};

export type CanvasFaceDetectionResult = {
    faces: CanvasFaceBox[];
    imageWidth: number;
    imageHeight: number;
};

let detectorWorker: Worker | null = null;
let requestSequence = 0;
const pendingRequests = new Map<number, PendingRequest>();

export async function detectCanvasFaces(dataUrl: string, signal?: AbortSignal): Promise<CanvasFaceDetectionResult> {
    if (!__BEEFTV_HEAVY_MEDIA_ENABLED__) {
        throw new Error("The lite version does not include automatic face recognition, please use manual selection instead, or install the full media package");
    }
    if (signal?.aborted) throw new DOMException("Face recognition has been canceled", "AbortError");
    const response = await fetch(dataUrl, { signal });
    if (!response.ok) throw new Error("Unable to read the source image, please re-upload and try again");
    const image = await createImageBitmap(await response.blob());
    const worker = getDetectorWorker();
    const id = ++requestSequence;
    return new Promise((resolve, reject) => {
        const abort = () => {
            const request = pendingRequests.get(id);
            if (!request) return;
            pendingRequests.delete(id);
            request.cleanup();
            reject(new DOMException("Face recognition has been canceled", "AbortError"));
        };
        const cleanup = () => signal?.removeEventListener("abort", abort);
        pendingRequests.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", abort, { once: true });
        worker.postMessage({ id, image, assetBase: resolveEmbeddedAssetUrl("/").replace(/\/$/u, "") }, [image]);
    });
}

function getDetectorWorker() {
    if (detectorWorker) return detectorWorker;
    const worker = new Worker(new URL("./canvas-face-detector.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<DetectFaceResponse>) => {
        const request = pendingRequests.get(event.data.id);
        if (!request) return;
        pendingRequests.delete(event.data.id);
        request.cleanup();
        if (event.data.error) {
            request.reject(new Error(event.data.error));
            return;
        }
        request.resolve({
            faces: event.data.faces || [],
            imageWidth: event.data.imageWidth || 0,
            imageHeight: event.data.imageHeight || 0,
        });
    };
    worker.onerror = (event) => {
        const error = new Error(event.message || "Face recognition service initialization failed");
        pendingRequests.forEach((request) => {
            request.cleanup();
            request.reject(error);
        });
        pendingRequests.clear();
        worker.terminate();
        detectorWorker = null;
    };
    detectorWorker = worker;
    return worker;
}
