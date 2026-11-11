import { describe, expect, test } from "bun:test";

import { cancelIncompleteImageBatch, failedImageBatchChildren, markImageBatchRetrying, reconcileImageBatchRoot, restoreUnsubmittedImageBatchChild, retireImageBatchChildren } from "../src/lib/canvas/canvas-image-batch-retry";
import { applyBatchPrimaryImage } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeStatus } from "../src/types/canvas";

function imageNode(id: string, status: CanvasNodeStatus, metadata: Partial<NonNullable<CanvasNodeData["metadata"]>> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { status, ...metadata },
    };
}

describe("canvas image batch retry", () => {
    test("Only return failed images belonging to the current root node in batch order", () => {
        const root = imageNode("root", "error", { isBatchRoot: true, batchChildIds: ["failed-2", "success", "failed-1", "loading", "foreign"] });
        const nodes = [
            root,
            imageNode("failed-1", "error", { batchRootId: root.id }),
            imageNode("failed-2", "error", { batchRootId: root.id }),
            imageNode("success", "success", { batchRootId: root.id, content: "image:success" }),
            imageNode("loading", "loading", { batchRootId: root.id }),
            imageNode("foreign", "error", { batchRootId: "another-root" }),
        ];

        expect(failedImageBatchChildren(root, nodes).map((node) => node.id)).toEqual(["failed-2", "failed-1"]);
    });

    test("After any subgraph succeeds, the root node main graph is restored, while other failed subgraphs are retained.", () => {
        const root = imageNode("root", "loading", { isBatchRoot: true, batchChildIds: ["failed", "success"], errorDetails: "old error" });
        const failed = imageNode("failed", "error", { batchRootId: root.id, errorDetails: "Upstream failed" });
        const success = imageNode("success", "success", {
            batchRootId: root.id,
            assetId: "asset-success",
            content: "image:success",
            storageKey: "resource:success",
            mimeType: "image/png",
            naturalWidth: 1024,
            naturalHeight: 1024,
        });

        const next = reconcileImageBatchRoot(root, [root, failed, success]);

        expect(next.metadata).toMatchObject({ status: "success", assetId: "asset-success", content: "image:success", storageKey: "resource:success", primaryImageId: "success", batchFailedCount: 1 });
        expect(next.metadata.errorDetails).toBeUndefined();
        expect(failed.metadata.status).toBe("error");
    });

    test("When all subgraphs fail, synchronize the representative error back to the root node", () => {
        const root = imageNode("root", "loading", { isBatchRoot: true, batchChildIds: ["failed-1", "failed-2"] });
        const failed = imageNode("failed-1", "error", {
            batchRootId: root.id,
            errorDetails: "No available compatible accounts",
            generationErrorCode: "upstream_unavailable",
        });

        const next = reconcileImageBatchRoot(root, [root, failed, imageNode("failed-2", "error", { batchRootId: root.id, errorDetails: "another error" })]);

        expect(next.metadata).toMatchObject({ status: "error", errorDetails: "No available compatible accounts", generationErrorCode: "upstream_unavailable", batchFailedCount: 2 });
        expect(next.metadata.content).toBeUndefined();
        expect(next.metadata.primaryImageId).toBeUndefined();
    });

    test("When starting batch retry, the root node and all failed subgraphs are generated simultaneously.", () => {
        const root = imageNode("root", "error", { isBatchRoot: true, batchChildIds: ["failed-1", "success", "failed-2"], batchFailedCount: 2, errorDetails: "All failed" });
        const failed1 = imageNode("failed-1", "error", { batchRootId: root.id, errorDetails: "failed 1" });
        const success = imageNode("success", "success", { batchRootId: root.id, content: "image:success" });
        const failed2 = imageNode("failed-2", "error", { batchRootId: root.id, errorDetails: "failed 2" });

        const next = markImageBatchRetrying(root.id, [failed1.id, failed2.id], [root, failed1, success, failed2]);

        expect(next.find((node) => node.id === root.id)?.metadata).toMatchObject({ status: "loading", batchFailedCount: 2 });
        expect(next.find((node) => node.id === failed1.id)?.metadata?.status).toBe("loading");
        expect(next.find((node) => node.id === failed2.id)?.metadata?.status).toBe("loading");
        expect(next.find((node) => node.id === success.id)?.metadata).toMatchObject({ status: "success", content: "image:success" });
    });

    test("Failed subgraphs that did not submit requests recover from the original error from the pre-loading state", () => {
        const original = imageNode("failed", "error", { batchRootId: "root", errorDetails: "original failure" });
        const loading = imageNode("failed", "loading", { batchRootId: "root" });

        expect(restoreUnsubmittedImageBatchChild(loading, original).metadata).toMatchObject({ status: "error", errorDetails: "original failure" });
        expect(restoreUnsubmittedImageBatchChild(imageNode("failed", "success", { content: "image:success" }), original).metadata?.status).toBe("success");
    });

    test("When regenerating, clear the unfinished subgraphs and remove the existing results from the folded group.", () => {
        const root = imageNode("root", "loading", { isBatchRoot: true, batchChildIds: ["done", "pending"], imageBatchExpanded: false });
        const done = imageNode("done", "success", { batchRootId: root.id, content: "image:done" });
        const pending = imageNode("pending", "loading", { batchRootId: root.id });
        const retired = retireImageBatchChildren(root, [root, done, pending], [{ id: "c1", fromNodeId: root.id, toNodeId: done.id }, { id: "c2", fromNodeId: root.id, toNodeId: pending.id }]);
        expect(retired.removedIds).toEqual(["pending"]);
        expect(retired.nodes.map((node) => node.id)).toEqual(["root", "done"]);
        expect(retired.nodes.find((node) => node.id === "done")?.metadata?.batchRootId).toBeUndefined();
        expect(retired.nodes.find((node) => node.id === "root")?.metadata).toMatchObject({ imageBatchExpanded: true, status: "idle" });
        expect(retired.connections.map((item) => item.id)).toEqual(["c1"]);
    });

    test("Remove subplots with no results and expand remaining batches when canceling generation", () => {
        const root = imageNode("root", "loading", { isBatchRoot: true, batchChildIds: ["done", "pending"] });
        const done = imageNode("done", "success", { batchRootId: root.id, content: "image:done" });
        const pending = imageNode("pending", "loading", { batchRootId: root.id });
        const cancelled = cancelIncompleteImageBatch(root.id, ["done", "pending"], [root, done, pending], [{ id: "c2", fromNodeId: root.id, toNodeId: pending.id }]);
        expect(cancelled.removedIds).toEqual(["pending"]);
        expect(cancelled.nodes.map((node) => node.id)).toEqual(["root", "done"]);
        expect(cancelled.nodes.find((node) => node.id === "root")?.metadata?.batchChildIds).toBeUndefined();
        expect(cancelled.nodes.find((node) => node.id === "done")?.metadata?.batchRootId).toBeUndefined();
    });

    test("When the main image has not been bound to the assetId, the root node clears the old assetId.", () => {
        const root = imageNode("root", "success", {
            isBatchRoot: true,
            batchChildIds: ["child-1"],
            primaryImageId: "child-1",
            assetId: "stale-asset-id",
            content: "image:old",
            storageKey: "resource:old",
        });
        const child = imageNode("child-1", "success", {
            batchRootId: root.id,
            content: "/api/resources/new/file",
            storageKey: "resource:new",
        });
        const reconciled = reconcileImageBatchRoot(root, [root, child]);
        expect(reconciled.metadata?.assetId).toBeUndefined();
        expect("assetId" in (reconciled.metadata || {})).toBe(false);
        expect(reconciled.metadata?.storageKey).toBe("resource:new");

        const applied = applyBatchPrimaryImage(root, child);
        expect(applied.metadata?.assetId).toBeUndefined();
        expect("assetId" in (applied.metadata || {})).toBe(false);
        expect(applied.metadata?.storageKey).toBe("resource:new");

        const boundChild = imageNode("child-1", "success", {
            batchRootId: root.id,
            assetId: "asset-new",
            content: "/api/resources/new/file",
            storageKey: "resource:new",
        });
        const appliedBound = applyBatchPrimaryImage(root, boundChild);
        expect(appliedBound.metadata?.assetId).toBe("asset-new");

        const dataUrlChild = imageNode("child-data", "success", {
            batchRootId: root.id,
            assetId: "asset-new",
            content: "data:image/png;base64,AAAA",
        });
        const reconciledDataUrl = reconcileImageBatchRoot(
            { ...root, metadata: { ...root.metadata, batchChildIds: ["child-data"], primaryImageId: "child-data" } },
            [root, dataUrlChild],
        );
        expect(reconciledDataUrl.metadata?.assetId).toBeUndefined();
        expect(applyBatchPrimaryImage(root, dataUrlChild).metadata?.assetId).toBeUndefined();
    });
});
