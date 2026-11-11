import { expect, test } from "bun:test";
import { executeArtCritique } from "../src/services/art-critique-execution";
import { defaultConfig } from "../src/stores/use-config-store";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType } from "../src/types/canvas";
import { runArtCritiquePipeline, type ArtCritiquePipelineOptions } from "../src/lib/art-critique/pipeline";

const source = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "resource:original" });
const options = () => ({ nodeId: "analysis", runId: "run", source, config: defaultConfig, signal: new AbortController().signal, onTaskCreated: (_stage: string, _id: string) => {} });

test("Analysis phase uses resource references, logs background tasks, and rejects duplicate phase submissions", async () => {
    let submitted = 0;
    const created: string[] = [];
    const input = options();
    input.onTaskCreated = (stage, id) => created.push(`${stage}:${id}`);
    await executeArtCritique(input, {
        inspectImage: async () => ({ storageKey: "resource:original", encodedBytes: 30 }),
        runTask: async (request) => {
            submitted++;
            expect(JSON.stringify(request.messages)).toContain("resource:original");
            expect(request.metadata).toMatchObject({ source: "art-critique", runId: "run", nodeId: "analysis" });
            request.onTaskCreated?.({ id: "task-1" } as never);
            return { content: "{}", toolCalls: [] };
        },
        runPipeline: async (config, image, opts: ArtCritiquePipelineOptions = {}) => {
            expect(image.dataUrl).toBe("resource:original");
            const stage = { config, messages: [{ role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: image.dataUrl } }] }], tool: { type: "function" as const, name: "review", description: "review", parameters: {} }, toolName: "review", signal: input.signal };
            await opts.requestStage!(stage);
            await expect(opts.requestStage!(stage)).rejects.toThrow("Repeat");
            return {} as never;
        },
    });
    expect(submitted).toBe(1);
    expect(created).toEqual(["review:task-1"]);
});

test("Canceling during material preparation will not submit the background model task", async () => {
    const controller = new AbortController();
    let submitted = false;
    await expect(executeArtCritique({ ...options(), signal: controller.signal }, {
        inspectImage: async () => { controller.abort(); return { storageKey: "resource:image", encodedBytes: 30 }; },
        runTask: async () => { submitted = true; return { content: "", toolCalls: [] }; },
        runPipeline: async () => { throw new Error("Analysis should not start"); },
    })).rejects.toThrow();
    expect(submitted).toBe(false);
});

test("Approval executor abort cannot be downgraded by pipeline to completed report", async () => {
    await expect(runArtCritiquePipeline({ ...defaultConfig, textModel: "model" }, { dataUrl: "resource:image", title: "image", sourceFingerprint: "image" }, {
        requestStage: async ({ toolName }) => {
            if (toolName === "analyze_art_scene") throw new DOMException("Quotation service is not available", "AbortError");
            return { content: "", toolCalls: [{ id: toolName, type: "function", function: { name: toolName, arguments: JSON.stringify({ candidates: [] }) } }] };
        },
    })).rejects.toThrow("Quotation service is not available");
});
