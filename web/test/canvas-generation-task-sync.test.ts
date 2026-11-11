import { describe, expect, test } from "bun:test";

import { applyGeneratedMediaResultMetadata, applyRecoveredGenerationTaskResultToNodes, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function videoNode(assetId: string, storageKey: string): CanvasNodeData {
    return {
        id: "node-1",
        type: CanvasNodeType.Video,
        title: "lens",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { assetId, storageKey, content: "https://example.test/old.mp4", prompt: "old prompt word" },
    };
}

describe("applyGeneratedMediaResultMetadata", () => {
    test("clears the previous asset binding when a regenerated media result lands", () => {
        const node = videoNode("asset-old", "video:old");
        const next = applyGeneratedMediaResultMetadata(node, videoMetadata({
            url: "https://example.test/new.mp4",
            storageKey: "video:new",
            width: 1280,
            height: 720,
            bytes: 12,
            mimeType: "video/mp4",
            durationMs: 4000,
        }), { prompt: "new prompt word" });

        expect(next.assetId).toBeUndefined();
        expect(next.storageKey).toBe("video:new");
        expect(next.content).toBe("https://example.test/new.mp4");
        expect(next.prompt).toBe("new prompt word");
        expect(next.status).toBe("success");
    });
});

describe("recovered generation task results", () => {
    test("repairs the original text node and stamps the durable attach effect", async () => {
        const node: CanvasNodeData = {
            id: "text-node",
            type: CanvasNodeType.Text,
            title: "Description text",
            position: { x: 10, y: 20 },
            width: 320,
            height: 180,
            metadata: { taskId: "task-1", status: "loading", taskStatus: "running", composerContent: "new prompt word", prompt: "new prompt word" },
        };
        const task = {
            id: "task-1",
            type: "canvas_text",
            status: "succeeded",
            resultJson: JSON.stringify({ text: "Result after recovery" }),
            prompt: "new prompt word",
            clientContext: { nodeId: "text-node" },
        } as never;

        const result = await applyRecoveredGenerationTaskResultToNodes([node], task, node.id);

        expect(result.nodes).toHaveLength(1);
        expect(result.node?.id).toBe(node.id);
        expect(result.node?.metadata?.content).toBe("Result after recovery");
        expect(result.node?.metadata?.composerContent).toBe("new prompt word");
        expect(result.node?.metadata?.status).toBe("success");
        expect(result.node?.metadata?.taskStatus).toBe("succeeded");
        expect(result.node?.metadata?.generationEffectKeys).toContain(result.effectKey);
    });
});
