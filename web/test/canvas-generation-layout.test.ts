import { describe, expect, test } from "bun:test";

import { canGenerateImageInPlace, canGenerateMediaInPlace, canGenerateTextInPlace, findAvailableGenerationGroupPosition, generationFailureNodeStatus, imageGenerationGroupSize, planTextGenerationTargets } from "../src/lib/canvas/canvas-generation-layout";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, x: number, y: number, width = 340, height = 240): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x, y }, width, height };
}

describe("findAvailableGenerationGroupPosition", () => {
    test("Keep the original coordinates when the preferred position is not occupied", () => {
        expect(findAvailableGenerationGroupPosition([node("source", 0, 0)], { x: 436, y: 0 }, { width: 340, height: 240 })).toEqual({ x: 436, y: 0 });
    });

    test("When there is a node on the right, select the lower space with a shorter distance.", () => {
        expect(findAvailableGenerationGroupPosition([node("occupied", 436, 0)], { x: 436, y: 0 }, { width: 340, height: 240 })).toEqual({ x: 436, y: 276 });
    });

    test("When large vertical nodes are blocked, avoid to the right instead.", () => {
        expect(findAvailableGenerationGroupPosition([node("occupied", 436, 0, 340, 900)], { x: 436, y: 0 }, { width: 340, height: 240 })).toEqual({ x: 812, y: 0 });
    });

    test("Detect collisions by complete batch range", () => {
        const groupSize = imageGenerationGroupSize({ width: 340, height: 240 }, { width: 340, height: 240 }, 4);
        expect(groupSize).toEqual({ width: 1176, height: 564 });
        expect(findAvailableGenerationGroupPosition([node("child-area", 900, 0)], { x: 436, y: 0 }, groupSize)).toEqual({ x: 436, y: 276 });
    });
});

describe("canGenerateImageInPlace", () => {
    test("Keep the success status of existing results when regeneration fails", () => {
        expect(generationFailureNodeStatus(true)).toBe("success");
        expect(generationFailureNodeStatus(false)).toBe("error");
    });

    test("The generator reuses the original node for both the first generation and the subsequent generation.", () => {
        expect(canGenerateImageInPlace(node("empty", 0, 0))).toBe(true);
        expect(canGenerateImageInPlace({ ...node("generator", 0, 0), metadata: { nodeRole: "generator" } })).toBe(true);
        expect(canGenerateImageInPlace({ ...node("generator-result", 0, 0), metadata: { nodeRole: "generator", content: "image-url" } })).toBe(true);
        expect(canGenerateImageInPlace({ ...node("generated-result", 0, 0), metadata: { nodeRole: "result", resultOrigin: "generated", generationType: "generation", prompt: "revise", content: "image-url" } })).toBe(true);
        expect(canGenerateImageInPlace({ ...node("result", 0, 0), metadata: { content: "image-url" } })).toBe(false);
        expect(canGenerateImageInPlace({ ...node("derived-result", 0, 0), metadata: { nodeRole: "result", resultOrigin: "derived", prompt: "source", content: "image-url" } })).toBe(false);
        expect(canGenerateImageInPlace({ ...node("copy", 0, 0), metadata: { nodeRole: "result", content: "image-url", generationResultPlacement: "replace-node" } })).toBe(true);
        expect(canGenerateImageInPlace({ ...node("copy", 0, 0), metadata: { content: "image-url", generationResultPlacement: "new-version", copiedFromNodeId: "source" } })).toBe(false);
        expect(canGenerateImageInPlace({ ...node("text", 0, 0), type: CanvasNodeType.Text })).toBe(false);
    });

    test("The text generator reuses the original node whether there is a result or not.", () => {
        const text = { ...node("text", 0, 0), type: CanvasNodeType.Text };
        expect(canGenerateTextInPlace(text)).toBe(true);
        expect(canGenerateTextInPlace({ ...text, metadata: { content: "old text", prompt: "rewrite" } })).toBe(true);
        expect(canGenerateTextInPlace({ ...text, type: CanvasNodeType.Config })).toBe(false);
    });

    test("When rewriting existing text, the success result will still be dropped back to the original text node.", () => {
        const plan = planTextGenerationTargets({
            nodeId: "text-source",
            sourceNode: { ...node("text-source", 0, 0), type: CanvasNodeType.Text, metadata: { content: "old text" } },
            isConfigNode: false,
            count: 1,
            createId: () => "unexpected-child",
        });

        expect(plan).toEqual({ generateInPlace: true, targetIds: ["text-source"], childIds: [] });
    });

    test("Text batch generation replaces the original node with the first result, and uses the new node for the remaining results.", () => {
        const plan = planTextGenerationTargets({ nodeId: "text-source", sourceNode: { ...node("text-source", 0, 0), type: CanvasNodeType.Text }, isConfigNode: false, count: 3, createId: (() => { let id = 0; return () => `child-${++id}`; })() });

        expect(plan).toEqual({ generateInPlace: true, targetIds: ["text-source", "child-1", "child-2"], childIds: ["child-1", "child-2"] });
    });

    test("Video copy nodes use the same result placement rules as images", () => {
        const video = { ...node("video-copy", 0, 0), type: CanvasNodeType.Video, metadata: { content: "video-url", generationResultPlacement: "replace-node" as const } };
        expect(canGenerateMediaInPlace(video, CanvasNodeType.Video)).toBe(true);
        expect(canGenerateMediaInPlace({ ...video, metadata: { ...video.metadata, generationResultPlacement: "new-version" } }, CanvasNodeType.Video)).toBe(false);
    });
});
