import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import { uploadResourceFile } from "@/services/api/resources";

export type OwnedMediaSaveResult = "saved" | "cancelled";

export const MAX_OWNED_ARTIFACT_BYTES = 32 * 1024 * 1024;

export function isWailsNativeShell() {
    if (typeof window === "undefined") return false;
    return window.location?.protocol === "wails:" || typeof window.go?.main?.DesktopApp?.SaveOwnedMedia === "function" || typeof window.go?.main?.DesktopApp?.SaveOwnedArtifact === "function";
}

export async function downloadOwnedOrBrowserMedia(options: { fileName: string; resourceId?: string; browserUrl?: string }): Promise<OwnedMediaSaveResult> {
    const fileName = sanitizeDownloadFileName(options.fileName);
    if (isWailsNativeShell()) {
        const resourceId = options.resourceId?.trim();
        if (!resourceId) throw new Error("No native files to export");
        const save = window.go?.main?.DesktopApp?.SaveOwnedMedia;
        if (!save) throw new Error("The current application cannot save the file to the selected location yet");
        const saved = await save(fileName, resourceId);
        return saved ? "saved" : "cancelled";
    }
    const browserUrl = options.browserUrl?.trim();
    if (!browserUrl) throw new Error("No files to export");
    saveAs(browserUrl, fileName);
    return "saved";
}

export async function saveOwnedOrBrowserBlob(fileName: string, blob: Blob): Promise<OwnedMediaSaveResult> {
    const name = sanitizeDownloadFileName(fileName, "Unnamed export");
    if (isWailsNativeShell()) {
        if (blob.size > MAX_OWNED_ARTIFACT_BYTES) throw new Error("The export package is too large. Please reduce the selected content before exporting.");
        const save = window.go?.main?.DesktopApp?.SaveOwnedArtifact;
        if (!save) throw new Error("The current application cannot save the file to the selected location yet");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const saved = await save(name, bytesToBase64(bytes));
        return saved ? "saved" : "cancelled";
    }
    saveAs(blob, name);
    return "saved";
}

/** Video exports use the resource upload path so large files never cross Wails as base64. */
export async function saveOwnedOrBrowserVideoBlob(fileName: string, blob: Blob): Promise<OwnedMediaSaveResult> {
    if (!isWailsNativeShell()) return saveOwnedOrBrowserBlob(fileName, blob);
    if (!window.go?.main?.DesktopApp?.SaveOwnedMedia) throw new Error("The current application cannot save the file to the selected location yet");
    const name = sanitizeDownloadFileName(fileName, "Unnamed export .mp4");
    const resource = await uploadResourceFile(blob, "video", {
        fileName: name,
        idempotencyKey: `video-export:${nanoid()}`,
    });
    return downloadOwnedOrBrowserMedia({ fileName: name, resourceId: resource.id });
}

export async function saveOwnedNativeArchiveFiles(
    fileName: string,
    files: Array<{ name: string; data: BlobPart; resourceId?: string }>,
    options: { signal?: AbortSignal; onSaving?: () => void } = {},
): Promise<OwnedMediaSaveResult | undefined> {
    const save = typeof window === "undefined" ? undefined : window.go?.main?.DesktopApp?.SaveOwnedArchive;
    if (!save) return undefined;
    const entries: Array<{ name: string; resourceId?: string; data?: string }> = [];
    let inlineBytes = 0;
    for (const file of files) {
        options.signal?.throwIfAborted();
        if (file.resourceId) {
            entries.push({ name: file.name, resourceId: file.resourceId });
        } else {
            const blob = new Blob([file.data]);
            inlineBytes += blob.size;
            if (inlineBytes > MAX_OWNED_ARTIFACT_BYTES) throw new Error("The local attached file is too large, please save the material first and then export it.");
            entries.push({ name: file.name, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
        }
    }
    options.signal?.throwIfAborted();
    options.onSaving?.();
    return await save(sanitizeDownloadFileName(fileName, "canvas.zip"), entries) ? "saved" : "cancelled";
}

function bytesToBase64(bytes: Uint8Array) {
    const toBase64 = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
    if (typeof toBase64 === "function") return toBase64.call(bytes);
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

export function reportOwnedMediaSave(message: { success: (text: string) => void; error: (text: string) => void }, result: Promise<OwnedMediaSaveResult>) {
    return result
        .then((status) => {
            if (status === "saved" && isWailsNativeShell()) message.success("Saved to selected location");
        })
        .catch((error) => {
            message.error(error instanceof Error && error.message.trim() ? error.message : "Save not completed, please try again");
        });
}
