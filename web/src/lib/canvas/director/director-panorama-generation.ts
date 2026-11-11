import { nanoid } from "nanoid";
import { beginGenerationConsumer } from "@/services/generation-consumer-lifecycle";
import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { listGenerationTasks, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { uploadImage, type UploadedImage } from "@/services/image-storage";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export const DIRECTOR_PANORAMA_PROMPT = "Using the subjects, materials, and lighting from the reference image as a basis, expand the environment into a complete 360-degree isometric panorama. Output a continuous single picture with a 2:1 ratio, with the left and right edges connected naturally and seamlessly, maintaining the true spatial scale; no collage, borders, text, watermarks or shooting equipment.";

type DirectorPanoramaGenerationInput = { file: File; config: AiConfig; sceneId: string; projectId?: string; signal?: AbortSignal; onTaskUpdate?: (task: GenerationTask) => void };
type DirectorPanoramaGenerationDependencies = {
    upload: (input: string | Blob) => Promise<UploadedImage>;
    submit: typeof submitBackendGenerationTask;
    wait: typeof waitForGenerationTask;
    materialize: typeof materializeGenerationTaskAssets;
    findAsset: (id: string) => ImageAsset | undefined;
    updateAsset: (id: string, patch: { title: string; tags: string[]; source: string; metadata: Record<string, unknown> }) => void;
    selectModel: (config: AiConfig) => string;
};
type DirectorPanoramaRecoveryDependencies = Pick<DirectorPanoramaGenerationDependencies, "wait" | "materialize" | "findAsset" | "updateAsset"> & { list: typeof listGenerationTasks; query: typeof queryGenerationTask };

export function selectDirectorPanoramaModel(config: AiConfig): string {
    return resolveCanvasGenerationModel(config, config.imageModel, "image") || resolveCanvasGenerationModel(config, config.model, "image");
}

function directorPanoramaSize(config: AiConfig, model: string): string {
    const image = modelCapabilityConfigFor(config, model).image;
    if (image?.size.allowCustom || image?.size.values.includes("2:1")) return "2:1";
    return image?.size.default && image.size.default !== "*" ? image.size.default : config.size;
}

const defaultDependencies: DirectorPanoramaGenerationDependencies = {
    upload: uploadImage, submit: submitBackendGenerationTask, wait: waitForGenerationTask, materialize: materializeGenerationTaskAssets,
    findAsset: (id) => useAssetStore.getState().assets.find((asset): asset is ImageAsset => asset.id === id && asset.kind === "image"),
    updateAsset: (id, patch) => useAssetStore.getState().updateAsset(id, patch),
    selectModel: selectDirectorPanoramaModel,
};
const defaultRecoveryDependencies: DirectorPanoramaRecoveryDependencies = { ...defaultDependencies, list: listGenerationTasks, query: queryGenerationTask };

function panoramaSessionGuard(signal?: AbortSignal) {
    return () => {
        if (signal?.aborted) throw new DOMException("Build session ended", "AbortError");
    };
}

async function panoramaFromTask(task: GenerationTask, sceneId: string, dependencies: Pick<DirectorPanoramaGenerationDependencies, "materialize" | "findAsset" | "updateAsset">, assertCurrent: () => void, name?: string, signal?: AbortSignal) {
    assertCurrent();
    const materialized = await dependencies.materialize(task, signal);
    assertCurrent();
    const assetId = materialized.outputs?.find((output) => output.mediaType === "image")?.materializedAssetId;
    if (!assetId) throw new Error("Image task completed, but panorama not returned");
    const asset = dependencies.findAsset(assetId);
    if (!asset) throw new Error("The panorama result cannot be read. Please go to the task center to check the output resources.");
    if (asset.metadata?.source !== "director-panorama-ai") {
        dependencies.updateAsset(assetId, { title: name || "AI Panorama", tags: ["Panorama", "AI generated"], source: "Director's desk", metadata: { ...asset.metadata, source: "director-panorama-ai", sceneId, taskId: task.id } });
    }
    return { id: assetId, name: name || asset.title, url: asset.data.dataUrl, storageKey: asset.data.storageKey || "", width: asset.data.width, height: asset.data.height };
}

/** The task outlives its modal; only the observer is stopped by a reload. */
export async function generateDirectorPanorama(input: DirectorPanoramaGenerationInput, dependencies: DirectorPanoramaGenerationDependencies = defaultDependencies): Promise<{ id: string; name: string; url: string; storageKey: string; width: number; height: number }> {
    const consumer = beginGenerationConsumer(input.signal);
    try {
        const { file, config, sceneId, projectId, onTaskUpdate } = input;
        const signal = consumer.signal;
        const assertCurrent = panoramaSessionGuard(signal);
        assertCurrent();
        if (!file.type.startsWith("image/")) throw new Error("Please select image file");
        const model = dependencies.selectModel(config);
        if (!model) throw new Error("Please select an available image model in the model settings first");
        if (modelCapabilityConfigFor(config, model).image?.references.maxImages === 0) throw new Error("The current image model does not support reference images. Please select a model that supports reference images.");
        const source = await dependencies.upload(file);
        assertCurrent();
        const reference: ReferenceImage = { id: nanoid(), name: file.name, type: source.mimeType, dataUrl: source.url, storageKey: source.storageKey, width: source.width, height: source.height, bytes: source.bytes };
        const task = await dependencies.submit({ projectId, mode: "image", prompt: DIRECTOR_PANORAMA_PROMPT, config: { ...config, model, size: directorPanoramaSize(config, model), count: "1" }, referenceImages: [reference], metadata: { source: "director-panorama", sceneId }, signal, onTaskUpdate });
        assertCurrent();
        const completed = await dependencies.wait(task.id, { initialTask: task, signal, onTaskUpdate });
        return await panoramaFromTask(completed, sceneId, dependencies, assertCurrent, `AI Panorama ·${file.name}`, signal);
    } finally {
        consumer.release();
    }
}

/** Rejoin tasks after a reload. Abort stops only this observer, never the server task. */
export async function recoverDirectorPanoramaTasks(projectId: string, sceneId: string, signal?: AbortSignal, dependencies: DirectorPanoramaRecoveryDependencies = defaultRecoveryDependencies): Promise<number> {
    const consumer = beginGenerationConsumer(signal);
    signal = consumer.signal;
    try {
        const assertCurrent = panoramaSessionGuard(signal);
        assertCurrent();
        const summaries = await dependencies.list(1000, { projectId }, undefined, signal);
        assertCurrent();
        const candidates = summaries.filter((task) => task.type === "canvas_image" && task.clientContext?.source === "director-panorama" && task.clientContext.sceneId === sceneId && (task.status === "succeeded" || task.status === "running" || task.status === "queued"));
        // A pending task can take minutes; it must not hold back already completed history items.
        const results = await Promise.all(candidates.map(async (summary) => {
            if (signal?.aborted) return false;
            try {
                const task = await dependencies.query(summary.id, { signal });
                assertCurrent();
                const completed = task.status === "succeeded" ? task : await dependencies.wait(task.id, { initialTask: task, signal });
                await panoramaFromTask(completed, sceneId, dependencies, assertCurrent, undefined, signal);
                return true;
            } catch (error) {
                if (!signal?.aborted) console.warn("Director's desk panorama task recovery failed", summary.id, error);
                return false;
            }
        }));
        return results.filter(Boolean).length;
    } finally {
        consumer.release();
    }
}
