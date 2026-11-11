import { describe, expect, test } from "bun:test";

import { buildImageGenerationNodeTitle, promptNodeTitle } from "@/lib/canvas/canvas-generation-title";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(title: string, type: CanvasNodeData["type"] = CanvasNodeType.Text): CanvasNodeData {
    return { id: "node-1", type, title, position: { x: 0, y: 0 }, width: 320, height: 180 };
}

describe("canvas generation node title", () => {
    test("keeps a title the user gave the node (Feishu #66)", () => {
        expect(promptNodeTitle(node("Storyboard 1 - Early morning street corner"), "A cat is rolling on the grass and the sun is shining")).toBe("Storyboard 1 - Early morning street corner");
    });

    test("names an unnamed node after the prompt", () => {
        expect(promptNodeTitle(node("text node"), "A cat rolling on the grass")).toBe("A cat rolling on the grass");
        expect(promptNodeTitle(node("  "), "A cat rolling on the grass")).toBe("A cat rolling on the grass");
    });

    test("keeps generation result nodes named after the prompt", () => {
        expect(buildImageGenerationNodeTitle("a cat", undefined)).toBe("a cat");
    });
});
