import { beforeEach, describe, expect, test } from "bun:test";

import { collectCanvasMediaAssetIds, rebindInconsistentCanvasAssets, repairMissingCanvasAssets } from "@/services/canvas-asset-repair";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { TimelineClip } from "@/types/timeline";

function videoAsset(id: string, storageKey?: string, url = ""): Asset {
    return {
        id,
        kind: "video",
        title: `Material${id}`,
        coverUrl: "",
        tags: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        data: { url, ...(storageKey ? { storageKey } : {}), width: 1, height: 1, bytes: 1, mimeType: "video/mp4" },
    } as Asset;
}

function videoNode(id: string, assetId: string | undefined, storageKey: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title: "lens",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { assetId, storageKey, content: "blob:http://localhost/preview" },
    };
}

function project(id: string, nodes: CanvasNodeData[], clips: TimelineClip[] = []): CanvasProject {
    return {
        id,
        title: `canvas${id}`,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        viewport: { x: 0, y: 0, k: 1 },
        ...(clips.length ? { timeline: { clips } } : {}),
    };
}

function timelineClip(assetId: string | undefined, storageKey: string): TimelineClip {
    return { id: "clip-1", kind: "video", directMedia: { id: "media-1", assetId, kind: "video", title: "fragment", storageKey } } as TimelineClip;
}

beforeEach(() => {
    useCanvasStore.setState({ projects: [] });
    useAssetStore.setState({ assets: [] });
});

describe("repairMissingCanvasAssets incremental session", () => {
    test("Node declaration cannot conceal the actual binding of the material library, and incorrect pairing will be re-binded.", () => {
        useAssetStore.setState({ assets: [videoAsset("asset-a", "resource:R1"), videoAsset("asset-c", "resource:R2")] });
        useCanvasStore.setState({ projects: [project("canvas-1", [videoNode("node-1", "asset-a", "resource:R2")])] });

        const result = repairMissingCanvasAssets(new Set(["canvas-1"]), true);

        expect(result.createdAssets).toBe(0);
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).toBe("asset-c");
    });

    test("Materials that are not loaded locally are still accepted according to node declarations, and will not be created for remote material forks.", () => {
        useCanvasStore.setState({ projects: [project("canvas-1", [videoNode("node-1", "remote-only", "resource:R9")])] });

        const result = repairMissingCanvasAssets(new Set(["canvas-1"]), true);

        expect(result.createdAssets).toBe(0);
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).toBe("remote-only");
    });
});

describe("rebindInconsistentCanvasAssets forces alignment", () => {
    test("When the declared material references other resources, it will be re-bound to the material that references the same resource.", () => {
        useCanvasStore.setState({ projects: [project("canvas-1", [videoNode("node-1", "asset-a", "resource:R2")])] });

        const result = rebindInconsistentCanvasAssets([videoAsset("asset-a", "resource:R1"), videoAsset("asset-c", "resource:R2")]);

        expect(result).toMatchObject({ reboundNodes: 1, createdAssets: 0, updatedProjects: 1 });
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).toBe("asset-c");
    });

    test("When there is no material referencing the node resource, create a new material based on the node and rebind it.", () => {
        useCanvasStore.setState({ projects: [project("canvas-1", [videoNode("node-1", "asset-a", "resource:R2")])] });

        const result = rebindInconsistentCanvasAssets([videoAsset("asset-a", "resource:R1")]);

        expect(result.reboundNodes).toBe(1);
        expect(result.createdAssets).toBe(1);
        const reboundId = useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId;
        const created = useAssetStore.getState().assets.find((asset) => asset.id === reboundId);
        expect(created?.kind).toBe("video");
        expect(created && "storageKey" in created.data ? created.data.storageKey : undefined).toBe("resource:R2");
    });

    test("Timeline directMedia and nodes go through the same set of binding verification", () => {
        useCanvasStore.setState({ projects: [project("canvas-1", [], [timelineClip("asset-a", "resource:R2")])] });

        const result = rebindInconsistentCanvasAssets([videoAsset("asset-a", "resource:R1"), videoAsset("asset-c", "resource:R2")]);

        expect(result.reboundNodes).toBe(1);
        expect(useCanvasStore.getState().projects[0].timeline?.clips[0].directMedia?.assetId).toBe("asset-c");
    });

    test("When the material is referenced by a resource file URL, it is matched with the resource: prefix normalization", () => {
        useCanvasStore.setState({ projects: [project("canvas-1", [videoNode("node-1", "asset-a", "resource:R2")])] });

        const result = rebindInconsistentCanvasAssets([videoAsset("asset-a", undefined, "/api/resources/R2/file")]);

        expect(result.reboundNodes).toBe(0);
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).toBe("asset-a");
    });

    test("Even if the bound material record is missing (remotely deleted), it will also be rebuilt by node.", () => {
        useCanvasStore.setState({ projects: [project("canvas-1", [videoNode("node-1", "deleted-asset", "resource:R2")])] });

        const result = rebindInconsistentCanvasAssets([]);

        expect(result.reboundNodes).toBe(1);
        expect(result.createdAssets).toBe(1);
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).not.toBe("deleted-asset");
    });
});

describe("collectCanvasMediaAssetIds", () => {
    test("Only collect media node and timeline segment declarations with resource identities", () => {
        const textNode: CanvasNodeData = { id: "node-text", type: CanvasNodeType.Text, title: "text", position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: "Text", assetId: "text-asset" } };
        const pendingNode = videoNode("node-pending", undefined, "resource:R3");
        const projects = [project("canvas-1", [videoNode("node-1", "asset-a", "resource:R1"), textNode, pendingNode], [timelineClip("asset-b", "resource:R2")])];

        expect(collectCanvasMediaAssetIds(projects)).toEqual(new Set(["asset-a", "asset-b"]));
    });
});
