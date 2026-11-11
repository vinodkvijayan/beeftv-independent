import { describe, expect, it } from "bun:test";

import { buildCanvasWorkflowOps, looksLikeWorkflowRequest } from "@/lib/canvas/canvas-workflow-builder";
import { applyCanvasOperations, canvasOperationPostconditionMessage, verifyCanvasOperations, type CanvasSnapshot } from "@/lib/canvas/canvas-operation-contract";
import { CanvasNodeType } from "@/types/canvas";

const config = { imageModel: "image-model", videoModel: "video-model", audioModel: "audio-model" } as never;
const snapshot: CanvasSnapshot = { projectId: "p", title: "empty canvas", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };

describe("canvas workflow builder", () => {
    it("creates semantic media nodes, non-overlapping layout and real edges", () => {
        const ops = buildCanvasWorkflowOps({
            title: "Funny immortality novel assembly line",
            nodes: [
                { ref: "characters", kind: "character_cards", title: "Character split picture card", prompt: "Split the main characters in the funny immortality novel and generate character picture cards" },
                { ref: "views", kind: "character_three_view", title: "Three views of the character", prompt: "Generate front, side and back views based on character cards", referenceRefs: ["characters"] },
                { ref: "video", kind: "storyboard_video", title: "Storyboard story video", prompt: "Create a storyboard video based on three views of the character", referenceRefs: ["views"] },
            ],
        }, snapshot, config);
        const after = applyCanvasOperations(snapshot, ops);
        const added = after.nodes.filter((node) => node.id.startsWith("agent-workflow-"));
        expect(added.map((node) => node.type)).toEqual([CanvasNodeType.Image, CanvasNodeType.Image, CanvasNodeType.Video]);
        expect(after.connections).toHaveLength(2);
        expect(added[1].position.x).toBeGreaterThan(added[0].position.x + added[0].width);
        expect(added[2].position.x).toBeGreaterThan(added[1].position.x + added[1].width);
        const result = verifyCanvasOperations(snapshot, after, ops);
        expect(result.ok).toBe(true);
        expect(result.connectionCount).toBe(2);
        expect(result.expectedConnectionCount).toBe(2);
        expect(result.overlapWarnings).toEqual([]);
        expect(canvasOperationPostconditionMessage(result)).toContain("Actually 2 new items were added");
    });

    it("rejects workflow-shaped text batches", () => {
        expect(looksLikeWorkflowRequest("Create a workflow and wire it up")).toBe(true);
        expect(looksLikeWorkflowRequest("Write a character introduction")).toBe(false);
    });

    it("infers useful prompts for semantic media stages when the model omits them", () => {
        const ops = buildCanvasWorkflowOps({
            title: "Funny immortality novel assembly line",
            nodes: [{ ref: "cards", kind: "character_cards", title: "Character split picture card" }],
        }, snapshot, config);
        const node = ops.find((op) => op.type === "add_node");
        expect(node?.metadata?.prompt).toContain("Split the main characters");
    });

    it("supports per-node generation without running every media node", () => {
        const ops = buildCanvasWorkflowOps({
            nodes: [
                { ref: "cards", kind: "character_cards", title: "character card", prompt: "Generate character cards" },
                { ref: "views", kind: "character_three_view", title: "Three views of the character", prompt: "Generate three views", runGeneration: true },
                { ref: "video", kind: "storyboard_video", title: "Storyboard video", prompt: "Generate storyboard video" },
            ],
        }, snapshot, config);
        expect(ops.filter((op) => op.type === "run_generation")).toHaveLength(1);
        expect(ops.find((op) => op.type === "run_generation")?.nodeId).toBe(ops[1].id);
    });

    it("can connect a new workflow node to an existing canvas resource", () => {
        const existing: CanvasSnapshot = {
            ...snapshot,
            nodes: [{ id: "asset-1", type: CanvasNodeType.Image, title: "Character original painting", position: { x: 0, y: 0 }, width: 560, height: 380, metadata: { status: "success", storageKey: "resource:character-1" } }],
        };
        const ops = buildCanvasWorkflowOps({
            nodes: [{ ref: "views", kind: "character_three_view", title: "Three views of the character", prompt: "Generate three views of the front, side and back based on the original character painting", referenceNodeIds: ["asset-1"] }],
        }, existing, config);
        const after = applyCanvasOperations(existing, ops);
        expect(after.connections).toHaveLength(1);
        expect(after.connections[0]).toMatchObject({ fromNodeId: "asset-1", toNodeId: ops[0].id });
        expect(after.nodes[1]?.metadata?.referenceNodeIds).toEqual(["asset-1"]);
    });
});
