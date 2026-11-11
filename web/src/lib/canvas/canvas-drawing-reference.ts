import { loadCanvasDrawingRender, saveCanvasDrawingRenderPublication } from "@/lib/canvas/canvas-drawing-storage";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

export async function resolveCanvasDrawingReference(projectId: string, image: ReferenceImage): Promise<ReferenceImage> {
    const source = image.source;
    if (!source || source.kind !== "drawing") return image;
    if (!source.shapeCount) throw new Error(`drawing"${image.name}" is empty, please complete the drawing before generating`);

    const render = await loadCanvasDrawingRender(projectId, source.drawingId);
    if (!render || render.revision !== source.revision) {
        throw new Error(`drawing"${image.name}"The current version of the generated diagram is missing. Please open the drawing and save it before trying again.`);
    }

    if (resourceIdFromStorageKey(render.storageKey)) {
        return {
            ...image,
            dataUrl: "",
            url: render.url,
            storageKey: render.storageKey,
            type: render.mimeType,
        };
    }

    try {
        const resource = await uploadResourceFile(render.blob, "image", {
            width: render.width,
            height: render.height,
            fileName: `drawing-${source.drawingId}-r${source.revision}.png`,
        });
        const storageKey = resourceStorageKey(resource.id);
        const url = resource.publicUrl || resourceFileUrl(resource.id);
        const saved = await saveCanvasDrawingRenderPublication(projectId, source.drawingId, source.revision, { storageKey, url });
        if (!saved) throw new Error("The drawing was modified during upload, please regenerate it.");
        return { ...image, dataUrl: "", url, storageKey, type: resource.mimeType || render.mimeType };
    } catch (error) {
        if (error instanceof Error && error.message === "The drawing was modified during upload, please regenerate it.") throw error;
        throw new Error(error instanceof Error ? `Drawing reference image upload failed:${error.message}` : "Drawing reference image upload failed");
    }
}
