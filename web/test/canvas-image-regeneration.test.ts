import { describe, expect, test } from "bun:test";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import { imageGenerationReferenceConnections } from "../src/lib/canvas/canvas-resource-references";

describe("image generation connections", () => {
    test("When regenerating existing image nodes, connect the source image only when the user explicitly references the source image to avoid mistakenly treating the old result as a reference image.", () => {
        const sourceImageNode: CanvasNodeData = {
            id: "img-1",
            type: CanvasNodeType.Image,
            title: "Generate results for the first time",
            position: { x: 0, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,mock",
                storageKey: "user:img-1:file",
            },
        };

        const rootId = "img-2";
        const workingNodes = [sourceImageNode];
        const workingConnections: CanvasConnection[] = [];

        // Case 1: 用户修改提示词重新生成（未显式 @ 源图）
        const referenceImagesNone: any[] = [];
        const isExistingImageNode = sourceImageNode.type === CanvasNodeType.Image && Boolean(sourceImageNode.metadata?.content);
        const reuseSourceNode = false;

        const connectsSelfNoMention = !isExistingImageNode || referenceImagesNone.some((img) => img.id === sourceImageNode.id);
        expect(connectsSelfNoMention).toBe(false);

        const batchConnectionsNoMention = [
            ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(sourceImageNode.id, rootId, workingNodes, workingConnections, () => "c1")),
            ...(reuseSourceNode || !connectsSelfNoMention ? [] : [{ id: "c-self", fromNodeId: sourceImageNode.id, toNodeId: rootId }]),
        ];

        // 验证：不应存在从 img-1 到 img-2 的连接
        expect(batchConnectionsNoMention.some((c) => c.fromNodeId === sourceImageNode.id && c.toNodeId === rootId)).toBe(false);
        expect(batchConnectionsNoMention.length).toBe(0);

        // Case 2: 用户在提示词中显式 @图片1 进行图生图
        const referenceImagesMention = [{ id: sourceImageNode.id, dataUrl: "mock" }];
        const connectsSelfWithMention = !isExistingImageNode || referenceImagesMention.some((img) => img.id === sourceImageNode.id);
        expect(connectsSelfWithMention).toBe(true);

        const batchConnectionsWithMention = [
            ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(sourceImageNode.id, rootId, workingNodes, workingConnections, () => "c1")),
            ...(reuseSourceNode || !connectsSelfWithMention ? [] : [{ id: "c-self", fromNodeId: sourceImageNode.id, toNodeId: rootId }]),
        ];

        // 验证：显式引用时正确建立从 img-1 到 img-2 的连线
        expect(batchConnectionsWithMention.some((c) => c.fromNodeId === sourceImageNode.id && c.toNodeId === rootId)).toBe(true);
    });

    test("If the source image itself has upstream reference material, the new image node will correctly inherit the upstream material connection without connecting to the source image itself.", () => {
        const upstreamRefNode: CanvasNodeData = {
            id: "ref-source",
            type: CanvasNodeType.Image,
            title: "Original reference picture",
            position: { x: 0, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,ref",
                storageKey: "user:ref-source:file",
            },
        };

        const intermediateImageNode: CanvasNodeData = {
            id: "img-intermediate",
            type: CanvasNodeType.Image,
            title: "intermediate generated graph",
            position: { x: 400, y: 0 },
            width: 300,
            height: 300,
            metadata: {
                content: "data:image/png;base64,mid",
                storageKey: "user:img-intermediate:file",
            },
        };

        const existingConnection: CanvasConnection = {
            id: "c-upstream",
            fromNodeId: upstreamRefNode.id,
            toNodeId: intermediateImageNode.id,
        };

        const rootId = "img-new";
        const workingNodes = [upstreamRefNode, intermediateImageNode];
        const workingConnections = [existingConnection];

        const isExistingImageNode = true;
        const reuseSourceNode = false;
        const referenceImagesNone: any[] = [];
        const connectsSelf = !isExistingImageNode || referenceImagesNone.some((img) => img.id === intermediateImageNode.id);

        const batchConnections = [
            ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(intermediateImageNode.id, rootId, workingNodes, workingConnections, () => "c-inherited")),
            ...(reuseSourceNode || !connectsSelf ? [] : [{ id: "c-self", fromNodeId: intermediateImageNode.id, toNodeId: rootId }]),
        ];

        // 验证：新节点继承了 upstreamRefNode 的连线，但绝不连接 intermediateImageNode 自身
        expect(batchConnections).toHaveLength(1);
        expect(batchConnections[0].fromNodeId).toBe(upstreamRefNode.id);
        expect(batchConnections[0].toNodeId).toBe(rootId);
    });
});
