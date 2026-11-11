import { describe, expect, test } from "bun:test";

import { connectDirectorReferenceNodes } from "@/lib/canvas/director/director-reference-assets";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function image(id: string, title: string): CanvasNodeData {
    return { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }), id, title, metadata: { content: `/assets/${id}.png` } };
}

describe("The director's desk reference picture is connected to the canvas resource picture", () => {
    test("Only connect valid images, remove duplicates, and merge image IDs into director node references.", () => {
        const target = { ...createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 }, { workflowKind: "shot", composerContent: "street at night" }), id: "director", metadata: { workflowKind: "shot", composerContent: "street at night", referenceAssetNodeIds: ["old-image"] } } as CanvasNodeData;
        const first = image("image-1", "Reference Figure 1");
        const second = image("image-2", "Reference Figure 2");
        const nonImage = { ...first, id: "video-1", type: CanvasNodeType.Video };

        const result = connectDirectorReferenceNodes([target, first, second, nonImage], [], ["image-1", "image-1", "image-2", "video-1"], "director", () => "edge");

        expect(result.connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([["image-1", "director"], ["image-2", "director"]]);
        expect(result.linkedSourceIds).toEqual(["image-1", "image-2"]);
        expect(result.nodes[0].metadata?.referenceAssetNodeIds).toEqual(["old-image", "image-1", "image-2"]);
        expect(result.nodes[0].metadata?.composerContent).toBe("street at night");
    });

    test("Repeated operations do not create edges again, and non-director nodes and missing resources do not change data.", () => {
        const target = { ...createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 }, { workflowKind: "shot" }), id: "director" };
        const source = image("image-1", "Reference picture");
        const edge = { id: "existing", fromNodeId: source.id, toNodeId: target.id };
        const input = [target, source];

        const repeated = connectDirectorReferenceNodes(input, [edge], [source.id], target.id, () => "new-edge");
        const orphan = connectDirectorReferenceNodes(input, [], ["missing"], target.id, () => "new-edge");
        const ordinaryNode = { ...target, metadata: { workflowKind: "free" } };
        const rejected = connectDirectorReferenceNodes([ordinaryNode, source], [], [source.id], target.id, () => "new-edge");

        expect(repeated.connections).toEqual([edge]);
        expect(orphan.connections).toEqual([]);
        expect(orphan.nodes).toBe(input);
        expect(rejected.connections).toEqual([]);
    });

    test("Replacing the picture source only unblocks the old pictures connected to the director's desk, and does not delete the materials or other node connections.", () => {
        const target = { ...createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 }, { workflowKind: "shot", referenceAssetNodeIds: ["old-image", "old-video"] }), id: "director" };
        const oldImage = image("old-image", "Old reference picture");
        const nextImage = image("new-image", "New reference image");
        const video = { ...createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 }), id: "old-video" };
        const unrelatedEdge = { id: "video-edge", fromNodeId: video.id, toNodeId: target.id };
        const imageEdge = { id: "image-edge", fromNodeId: oldImage.id, toNodeId: target.id };
        const input = [target, oldImage, nextImage, video];

        const result = connectDirectorReferenceNodes(input, [imageEdge, unrelatedEdge], [nextImage.id], target.id, () => "new-edge", "replace");

        expect(result.connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([["old-video", "director"], ["new-image", "director"]]);
        expect(result.nodes.find((node) => node.id === target.id)?.metadata?.referenceAssetNodeIds).toEqual(["old-video", "new-image"]);
        expect(result.nodes.some((node) => node.id === oldImage.id)).toBe(true);
    });
});
