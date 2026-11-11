import { imageToDataUrl } from "@/services/image-storage";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";

// 预算只作用于视觉分析副本，不修改原素材。
export async function agentImagePreviews(images: Parameters<typeof imageToDataUrl>[0][]): Promise<string[]> {
    if (!images.length) return [];
    const limit = Math.min(256 * 1024, Math.floor(2 * 1024 * 1024 / images.length));
    if (limit < 16 * 1024) throw new Error("There are too many reference pictures this time, please select pictures in batches before continuing.");
    const previews: string[] = [];
    // 顺序解码，避免多张原图同时占用内存。
    for (const source of images) {
        const url = await imageToDataUrl(source);
        if (!url) throw new Error("The reference image cannot be read, please select another image.");
        const image = new Image();
        image.src = url;
        try { await image.decode(); }
        catch { throw new Error("The reference picture cannot be decoded, please select another picture."); }
        const canvas = document.createElement("canvas");
        try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Unable to prepare image preview, please refresh and try again.");
            let edge = Math.min(1600, Math.max(image.naturalWidth, image.naturalHeight));
            let preview = "";
            while (edge > 0) {
                const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                preview = canvas.toDataURL("image/jpeg", 0.82);
                if (preview.length <= limit) break;
                if (edge <= 128) break;
                edge = Math.floor(edge * 0.75);
            }
            if (!preview || preview.length > limit) throw new Error("The size of the reference picture is too large. Please reduce the number of pictures selected this time before continuing.");
            previews.push(preview);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
            image.src = "";
        }
    }
    return previews;
}

type AgentImageCrop = { x: number; y: number; width: number; height: number };

export async function inspectAgentImage(source: Parameters<typeof imageToDataUrl>[0], detail: "preview" | "original" | "crop", crop?: AgentImageCrop) {
    const scope = getActiveUserScope();
    const dataUrl = await encodeAgentImage(source, detail, crop);
    if (scope !== getActiveUserScope()) throw new DOMException("Account has been switched", "AbortError");
    if (detail === "original" && resourceIdFromStorageKey(source.storageKey)) return { storageKey: source.storageKey!, encodedBytes: dataUrl.length };
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("Failed to read picture material");
    const blob = await response.blob();
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (scope !== getActiveUserScope()) throw new DOMException("Account has been switched", "AbortError");
    const resource = await uploadResourceFile(blob, "image", { fileName: `agent-inspect-${hash.slice(0, 12)}.${blob.type === "image/png" ? "png" : "jpg"}`, idempotencyKey: `agent-inspect:${hash}` });
    if (scope !== getActiveUserScope()) throw new DOMException("Account has been switched", "AbortError");
    return { storageKey: resourceStorageKey(resource.id), encodedBytes: dataUrl.length };
}

async function encodeAgentImage(source: Parameters<typeof imageToDataUrl>[0], detail: "preview" | "original" | "crop", crop?: AgentImageCrop) {
    if (detail === "preview") return (await agentImagePreviews([source]))[0];
    const url = await imageToDataUrl(source);
    if (!url) throw new Error("The reference image cannot be read, please select another image.");
    if (detail === "original") {
        if (url.length > 6 * 1024 * 1024) throw new Error("The original image exceeds the budget for this image viewing. Please use crop partition check instead and do not reduce the detail accuracy.");
        return url;
    }
    if (!crop || ![crop.x, crop.y, crop.width, crop.height].every((value) => typeof value === "number" && Number.isFinite(value)) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error("The cropping range must be normalized coordinates from 0 to 1 and completely located within the original image.");
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    try {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * crop.width));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * crop.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to read part of the image, please refresh and try again.");
        context.drawImage(image, image.naturalWidth * crop.x, image.naturalHeight * crop.y, image.naturalWidth * crop.width, image.naturalHeight * crop.height, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/png");
        if (result.length > 6 * 1024 * 1024) throw new Error("This area exceeds the budget for this viewing, please narrow the cropping range and continue checking.");
        return result;
    } finally { canvas.width = 0; canvas.height = 0; image.src = ""; }
}
