import { describe, expect, test } from "bun:test";
import { DIRECTOR_PANORAMA_PROMPT, generateDirectorPanorama, recoverDirectorPanoramaTasks } from "../src/lib/canvas/director/director-panorama-generation";
import { defaultConfig } from "../src/stores/use-config-store";
import type { UploadedImage } from "../src/services/image-storage";
import type { GenerationTask } from "../src/services/api/task-center";
import type { ImageAsset } from "../src/stores/use-asset-store";

const uploaded = (url: string, key: string): UploadedImage => ({ url, storageKey: key, width: 800, height: 400, bytes: 100, mimeType: "image/png" });
const input = () => ({ file: new File(["test"], "Reference picture.png", { type: "image/png" }), config: defaultConfig, sceneId: "scene-1", projectId: "project-1" });
const task = (patch: Partial<GenerationTask> = {}): GenerationTask => ({ id: "task-1", projectId: "project-1", type: "canvas_image", status: "succeeded", prompt: "", attempts: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-1" }], ...patch });
const asset = (): ImageAsset => ({ id: "asset-1", kind: "image", title: "Generate pictures", coverUrl: "blob:output", tags: ["generate"], source: "Generate tasks", createdAt: "2026-01-01", updatedAt: "2026-01-01", metadata: { source: "generation-task" }, data: { dataUrl: "blob:output", storageKey: "image:output", width: 800, height: 400, bytes: 100, mimeType: "image/png" } });

describe("Director’s desk AI panorama", () => {
    test("Paid tasks will no longer be submitted after closing the session during uploading", async () => {
        const controller = new AbortController();
        let submits = 0;
        await expect(generateDirectorPanorama({ ...input(), signal: controller.signal }, {
            selectModel: () => "image-model",
            upload: async () => { controller.abort(); return uploaded("blob:source", "image:source"); },
            submit: async () => { submits++; return task(); }, wait: async () => task(),
            materialize: async (value) => value, findAsset: asset, updateAsset: () => {},
        })).rejects.toThrow("Build session ended");
        expect(submits).toBe(0);
    });

    test("After an accepted task closes the observer, the result will not be materialized and the cancellation signal will be transmitted.", async () => {
        const controller = new AbortController();
        let materializations = 0;
        await expect(generateDirectorPanorama({ ...input(), signal: controller.signal }, {
            selectModel: () => "image-model", upload: async () => uploaded("blob:source", "image:source"),
            submit: async () => task({ status: "running" }),
            wait: async (_id, options) => { controller.abort(); expect(options?.signal?.aborted).toBe(true); return task(); },
            materialize: async (value) => { materializations++; return value; }, findAsset: asset, updateAsset: () => {},
        })).rejects.toThrow("Build session ended");
        expect(materializations).toBe(0);
    });

    test("If there is no image model, it will not be uploaded and paid tasks will not be created.", async () => {
        let uploads = 0;
        await expect(generateDirectorPanorama(input(), {
            selectModel: () => "", upload: async () => { uploads++; return uploaded("blob:source", "image:source"); },
            submit: async () => { throw new Error("should not be submitted"); }, wait: async () => task(), materialize: async () => task(), findAsset: asset, updateAsset: () => {},
        })).rejects.toThrow("Select available image models");
        expect(uploads).toBe(0);
    });

    test("Submit tasks and reuse unique product materials, task updates can be reported", async () => {
        const uploads: Array<string | Blob> = [];
        const updates: string[] = [];
        const patches: unknown[] = [];
        let materializations = 0;
        const result = await generateDirectorPanorama({ ...input(), onTaskUpdate: (value) => updates.push(value.id) }, {
            selectModel: () => "image-model",
            upload: async (value) => { uploads.push(value); return uploaded("blob:source", "image:source"); },
            submit: async (options) => {
                expect(options.projectId).toBe("project-1");
                expect(options.mode).toBe("image");
                expect(options.config.model).toBe("image-model");
                expect(options.config.count).toBe("1");
                expect(options.referenceImages?.[0]?.storageKey).toBe("image:source");
                expect(options.prompt).toBe(DIRECTOR_PANORAMA_PROMPT);
                expect(options.metadata).toEqual({ source: "director-panorama", sceneId: "scene-1" });
                options.onTaskUpdate?.(task({ status: "queued" }));
                return task({ status: "queued" });
            },
            wait: async (_id, options) => { options?.onTaskUpdate?.(task({ status: "running" })); return task(); },
            materialize: async (value) => { materializations++; return value; },
            findAsset: asset,
            updateAsset: (_id, patch) => patches.push(patch),
        });
        expect(uploads).toHaveLength(1);
        expect(updates).toEqual(["task-1", "task-1"]);
        expect(materializations).toBe(1);
        expect(result).toEqual({ id: "asset-1", name: "AI panorama · reference picture.png", url: "blob:output", storageKey: "image:output", width: 800, height: 400 });
        expect(patches).toMatchObject([{ metadata: { source: "director-panorama-ai", sceneId: "scene-1", taskId: "task-1" } }]);
    });

    test("After refreshing, only this scene task will be restored and the idempotent materialization result will be used.", async () => {
        const ids: string[] = [];
        const patches: unknown[] = [];
        const recovered = await recoverDirectorPanoramaTasks("project-1", "scene-1", undefined, {
            list: async () => [task({ clientContext: { source: "director-panorama", sceneId: "scene-1" } }), task({ id: "other", clientContext: { source: "director-panorama", sceneId: "scene-2" } })],
            query: async (id) => { ids.push(id); return task(); },
            wait: async () => { throw new Error("Task completion should not wait"); },
            materialize: async (value) => value,
            findAsset: asset,
            updateAsset: (_id, patch) => patches.push(patch),
        });
        expect(recovered).toBe(1);
        expect(ids).toEqual(["task-1"]);
        expect(patches).toMatchObject([{ title: "AI Panorama" }]);
    });

    test("Tasks in progress can be retaken; materials that lack picture products will not be written", async () => {
        let waits = 0;
        let updates = 0;
        const recovered = await recoverDirectorPanoramaTasks("project-1", "scene-1", undefined, {
            list: async () => [task({ status: "running", clientContext: { source: "director-panorama", sceneId: "scene-1" } })],
            query: async () => task({ status: "running" }),
            wait: async () => { waits++; return task({ outputs: [] }); },
            materialize: async (value) => value,
            findAsset: asset,
            updateAsset: () => { updates++; },
        });
        expect(waits).toBe(1);
        expect(recovered).toBe(0);
        expect(updates).toBe(0);
    });
});
