import { describe, expect, test } from "bun:test";

import { isolateCopiedNodeMetadata, nextCopiedNodeTitle } from "@/lib/canvas/canvas-node-copy";
import { rebaseCanvasDocumentThreeWay, settleInFlightGenerationOverlay } from "@/lib/canvas/canvas-document-rebase";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { canvasGenerationTaskNodes } from "@/pages/canvas/canvas-generation-failure";
import type { GenerationTask } from "@/services/api/task-center";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas node copy title", () => {
    test("The first copy uses copy1, and subsequent copies are incremented by the largest existing sequence number.", () => {
        expect(nextCopiedNodeTitle("Three views of female star characters", ["Three views of female star characters"])).toBe("Three views of female star characters_copy1");
        expect(nextCopiedNodeTitle("Three views of female star characters", ["Three views of female star characters", "Three views of female star characters_copy1"])).toBe("Three views of female star characters_copy2");
        expect(nextCopiedNodeTitle("Three views of female star characters", ["Three views of female star characters_copy1", "Three views of female star characters_copy3"])).toBe("Three views of female star characters_copy4");
    });

    test("When copying an existing copy, the original name is still used to calculate the next sequence number.", () => {
        expect(nextCopiedNodeTitle("Three views of female star characters_copy1", ["Three views of female star characters", "Three views of female star characters_copy1"])).toBe("Three views of female star characters_copy2");
    });

    test("Compatible with legacy space copy suffixes", () => {
        expect(nextCopiedNodeTitle("Three views of female star characters Copy", ["Three views of female star characters", "Three views of female star characters Copy"])).toBe("Three views of female star characters_copy1");
    });

    test("The same batch of pastes can be continuously assigned serial numbers by reserving titles.", () => {
        const titles = new Set(["node", "Node_copy1"]);
        const first = nextCopiedNodeTitle("node", titles);
        titles.add(first);
        const second = nextCopiedNodeTitle("node", titles);
        expect([first, second]).toEqual(["node_copy2", "node_copy3"]);
    });
});

describe("canvas generation copy metadata", () => {
    test.each(["submitting", "unknown", "accepted", "rejected"] as const)("When copying the %s node, isolate the task identity and submission status at the same time", (state) => {
        const source: CanvasNodeData = {
            id: "source", type: CanvasNodeType.Video, title: "lens", position: { x: 0, y: 0 }, width: 340, height: 240,
            metadata: { status: "loading", taskClientOperationId: "canvas:original", generationSubmissionState: state, composerContent: "Keep prompt word", generationPreflightError: "The original mission has not yet been confirmed" },
        };
        const metadata = isolateCopiedNodeMetadata(source, new Map([[source.id, "copy"]]));
        expect(metadata.taskClientOperationId).toBeUndefined();
        expect(metadata.generationSubmissionState).toBeUndefined();
        expect(metadata.generationPreflightError).toBeUndefined();
        expect(metadata.status).toBe("idle");
        expect(metadata.composerContent).toBe("Keep prompt word");
        expect(source.metadata?.generationSubmissionState).toBe(state);
        expect(source.metadata?.taskClientOperationId).toBe("canvas:original");
    });

    test.each([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio])("%s The copy does not inherit the generation commit mark of the original node.", (type) => {
        const source: CanvasNodeData = {
            id: "source", type, title: "result", position: { x: 0, y: 0 }, width: 340, height: 240,
            metadata: { content: "saved-media", assetId: "saved-asset", taskId: "old-task", generationEffectKeys: ["attach-node:old-task:source:0"] },
        };
        const metadata = isolateCopiedNodeMetadata(source, new Map([[source.id, "copy"]]));
        expect(metadata.generationEffectKeys).toBeUndefined();
        expect(metadata.taskId).toBeUndefined();
        expect(metadata.content).toBe("saved-media");
        expect(metadata.assetId).toBe("saved-asset");
        expect(source.metadata?.generationEffectKeys).toEqual(["attach-node:old-task:source:0"]);
    });

    test("The media copy retains the prompt words and reference fields, and clearly backfills the generated results in place.", () => {
        const source: CanvasNodeData = {
            id: "source",
            type: CanvasNodeType.Video,
            title: "lens",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "video-url",
                prompt: "Same prompt word",
                videoStartFrameNodeId: "reference-start",
                videoEndFrameNodeId: "reference-end",
                generationResultPlacement: "new-version",
            },
        };

        const metadata = isolateCopiedNodeMetadata(source, new Map([[source.id, "copy"]]));

        expect(metadata.prompt).toBe("Same prompt word");
        expect(metadata.videoStartFrameNodeId).toBe("reference-start");
        expect(metadata.videoEndFrameNodeId).toBe("reference-end");
        expect(metadata.copiedFromNodeId).toBe("source");
        expect(metadata.generationResultPlacement).toBe("replace-node");
    });

    test("The incoming edge copied to the copy continues to be parsed into the same reference image.", () => {
        const reference: CanvasNodeData = {
            id: "reference",
            type: CanvasNodeType.Image,
            title: "Character reference",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: { content: "reference-url", mimeType: "image/png" },
        };
        const copy: CanvasNodeData = {
            id: "copy",
            type: CanvasNodeType.Image,
            title: "result_copy1",
            position: { x: 400, y: 0 },
            width: 340,
            height: 240,
            metadata: { content: "old-result", prompt: "Keep roles consistent", copiedFromNodeId: "source", generationResultPlacement: "replace-node" },
        };

        const context = buildNodeGenerationContext(copy.id, [reference, copy], [{ id: "copy-reference", fromNodeId: reference.id, toNodeId: copy.id }], copy.metadata!.prompt!, []);

        expect(context.prompt).toBe("Keep roles consistent");
        expect(context.referenceImages.map((image) => image.id)).toEqual([reference.id]);
    });

    test("Copy the video and keep the old media waiting for new results. The new video will still be used after the new task is bound.", () => {
        const source: CanvasNodeData = {
            id: "video-source",
            type: CanvasNodeType.Video,
            title: "Original video",
            position: { x: 0, y: 0 },
            width: 360,
            height: 640,
            metadata: {
                content: "/api/v1/resources/old-video/file",
                storageKey: "resource:old-video",
                assetId: "asset-old",
                videoPreview: { content: "/api/v1/resources/old-preview/file", storageKey: "resource:old-preview" },
                durationMs: 5000,
                hasAudio: true,
                naturalWidth: 720,
                naturalHeight: 1280,
                bytes: 102400,
                mimeType: "video/mp4",
                prompt: "Original prompt word",
                videoStartFrameNodeId: "ref-start",
                status: "success",
                taskId: "task-old",
            },
        };
        const copiedMetadata = isolateCopiedNodeMetadata(source, new Map([[source.id, "video-copy"]]));
        const copiedNode: CanvasNodeData = {
            ...source,
            id: "video-copy",
            title: "Original video_copy1",
            metadata: copiedMetadata,
        };

        const inPlaceLoadingMetadata = resetGenerationTaskMetadata(copiedNode.metadata, "loading");
        expect(inPlaceLoadingMetadata.content).toBe(source.metadata!.content);
        expect(inPlaceLoadingMetadata.storageKey).toBe(source.metadata!.storageKey);
        expect(inPlaceLoadingMetadata.assetId).toBe(source.metadata!.assetId);
        expect(inPlaceLoadingMetadata.videoPreview).toEqual(source.metadata!.videoPreview);
        expect(inPlaceLoadingMetadata.taskId).toBeUndefined();
        expect(inPlaceLoadingMetadata.copiedFromNodeId).toBe("video-source");
        expect(inPlaceLoadingMetadata.generationResultPlacement).toBe("replace-node");
        expect(inPlaceLoadingMetadata.videoStartFrameNodeId).toBe("ref-start");
        expect(inPlaceLoadingMetadata.status).toBe("loading");

        const loadingNode: CanvasNodeData = {
            ...copiedNode,
            metadata: {
                ...inPlaceLoadingMetadata,
                prompt: "new prompt word",
            },
        };
        const succeededTask: GenerationTask = {
            id: "task-new",
            type: "canvas_video",
            status: "succeeded",
            prompt: "new prompt word",
            attempts: 1,
            createdAt: "2026-10-14T09:02:00.000Z",
            updatedAt: "2026-10-14T09:04:37.000Z",
            outputs: [{ outputIndex: 0, mediaType: "video", materializedAssetId: "asset-new", resourceId: "new-video" }],
        };

        // 任务刚到 succeeded、尚未消费产物前，bindGenerationTask 必须保持 loading overlay，不能把旧视频误判成已完成产物。
        const [boundLoadingNode] = canvasGenerationTaskNodes([loadingNode], loadingNode.id, succeededTask);
        expect(boundLoadingNode.metadata?.status).toBe("loading");
        expect(boundLoadingNode.metadata?.taskId).toBe("task-new");

        const makeProject = (nodes: CanvasNodeData[], revision: number): CanvasProject => ({
            id: "canvas-1",
            revision,
            title: "test canvas",
            createdAt: "2026-10-14T09:00:00.000Z",
            updatedAt: "2026-10-14T09:04:37.000Z",
            nodes,
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "grid",
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        });

        const base = makeProject([copiedNode], 150);
        const local = makeProject([boundLoadingNode], 150);
        const remote = makeProject([
            {
                ...boundLoadingNode,
                metadata: {
                    ...boundLoadingNode.metadata,
                    status: "success",
                    taskStatus: "succeeded",
                    taskProgress: 100,
                    content: "/api/v1/resources/new-video/file",
                    storageKey: "resource:new-video",
                    assetId: "asset-new",
                    mimeType: "video/mp4",
                    bytes: 204800,
                    naturalWidth: 720,
                    naturalHeight: 1280,
                    durationMs: 5000,
                    videoPreview: undefined,
                },
            },
        ], 152);

        const settled = settleInFlightGenerationOverlay({ base, local, remote });
        const rebased = rebaseCanvasDocumentThreeWay({ base, local: settled, remote });
        expect(rebased.conflict).toBe(false);
        expect(rebased.project.nodes[0]?.metadata?.status).toBe("success");
        expect(rebased.project.nodes[0]?.metadata?.content).toBe("/api/v1/resources/new-video/file");
        expect(rebased.project.nodes[0]?.metadata?.storageKey).toBe("resource:new-video");
        expect(rebased.project.nodes[0]?.metadata?.assetId).toBe("asset-new");
        expect(rebased.project.nodes[0]?.metadata?.videoPreview).toBeUndefined();
    });
});
