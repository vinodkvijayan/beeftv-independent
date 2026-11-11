import { bindCanvasNodeResourceAsset, canvasNodeResourceId, canvasNodesMissingResourceAssetBinding } from "@/lib/canvas/canvas-node-asset";
import type { CanvasNodeAssetResult } from "@/services/project-asset-sync";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export class CanvasMediaPersistUnconfirmedError extends Error {
    constructor() {
        super("The material has not been saved and cannot be written to the canvas. Please try again later.");
        this.name = "CanvasMediaPersistUnconfirmedError";
    }
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isPersistStop(error: unknown) {
    return (error instanceof Error && error.name === "AbortError") || error instanceof CanvasMediaPersistUnconfirmedError;
}

export type PersistOwnedCanvasMediaNodesInput = {
    canvasId: string;
    domainProjectId?: string;
    mediaNodes: CanvasNodeData[];
    mediaConnections?: CanvasConnection[];
    signal?: AbortSignal;
};

export type PersistOwnedCanvasMediaNodesStore = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type PersistOwnedCanvasMediaNodesDeps = {
    ensureCanvasNodeAsset: (options: {
        canvasId: string;
        domainProjectId?: string;
        node: CanvasNodeData;
        source: "canvas-manual";
        signal?: AbortSignal;
    }) => Promise<CanvasNodeAssetResult>;
    getStoredProject: (canvasId: string) => PersistOwnedCanvasMediaNodesStore | undefined;
    hasProject: (canvasId: string) => boolean;
    openProject?: (canvasId: string) => Promise<unknown>;
    updateProject: (canvasId: string, patch: PersistOwnedCanvasMediaNodesStore) => void;
    flushPersistence: () => Promise<void>;
    syncSnapshot?: (canvasId: string, patch: PersistOwnedCanvasMediaNodesStore) => Promise<unknown>;
    readSavedProject?: (canvasId: string) => Promise<{ nodes: CanvasNodeData[] } | undefined>;
    setNodes: (updater: (current: CanvasNodeData[]) => CanvasNodeData[]) => void;
    getLiveProjectId: () => string;
    getLiveNodes: () => CanvasNodeData[];
    getLiveConnections: () => CanvasConnection[];
    isLocalWorkspace: () => boolean;
    warn?: (message: string) => void;
    error?: (message: string) => void;
};

export async function persistOwnedCanvasMediaNodes(
    input: PersistOwnedCanvasMediaNodesInput,
    deps: PersistOwnedCanvasMediaNodesDeps,
): Promise<Map<string, string>> {
    const originalProjectId = input.canvasId;
    const mediaConnections = input.mediaConnections ?? [];
    const assetIds = new Map<string, string>();

    const assertPersistOwnership = () => {
        throwIfAborted(input.signal);
        if (deps.getLiveProjectId() !== originalProjectId) {
            throw new DOMException("Aborted", "AbortError");
        }
    };

    const persistAsset = async (node: CanvasNodeData, required: boolean) => {
        assertPersistOwnership();
        try {
            const result = await deps.ensureCanvasNodeAsset({
                canvasId: originalProjectId,
                domainProjectId: input.domainProjectId,
                node,
                source: "canvas-manual",
                signal: input.signal,
            });
            assertPersistOwnership();
            if (!result.confirmed) throw new CanvasMediaPersistUnconfirmedError();
            assetIds.set(node.id, result.assetId);
            return result.assetId;
        } catch (error) {
            if (isPersistStop(error)) throw error;
            assertPersistOwnership();
            const details = error instanceof Error ? error.message : "unknown error";
            if (required) {
                deps.warn?.(`The existing media nodes have not been bound to the material library and the results cannot be saved:${details}`);
                throw error;
            }
            deps.warn?.(`The media node has been created, but writing to the material library failed:${details}`);
            return undefined;
        }
    };

    for (const mediaNode of input.mediaNodes) {
        await persistAsset(mediaNode, false);
    }

    assertPersistOwnership();
    const latestNodes = new Map(deps.getLiveNodes().map((node) => [node.id, node]));
    const storedProject = deps.getStoredProject(originalProjectId);
    for (const node of storedProject?.nodes || []) {
        if (!latestNodes.has(node.id)) latestNodes.set(node.id, node);
    }
    for (const mediaNode of input.mediaNodes) {
        const assetId = assetIds.get(mediaNode.id);
        latestNodes.set(mediaNode.id, assetId ? { ...mediaNode, metadata: { ...mediaNode.metadata, assetId } } : mediaNode);
    }
    for (const [id, node] of latestNodes.entries()) {
        if (node.metadata?.assetId) continue;
        const primaryId = node.metadata?.isBatchRoot ? node.metadata.primaryImageId : undefined;
        const primaryNode = primaryId ? latestNodes.get(primaryId) : undefined;
        const primaryAssetId = primaryId ? (assetIds.get(primaryId) || primaryNode?.metadata?.assetId) : undefined;
        const rootResourceId = canvasNodeResourceId(node);
        const primaryResourceId = primaryNode ? canvasNodeResourceId(primaryNode) : "";
        if (primaryAssetId && rootResourceId && primaryResourceId && rootResourceId === primaryResourceId) {
            assetIds.set(id, primaryAssetId);
            latestNodes.set(id, { ...node, metadata: { ...node.metadata, assetId: primaryAssetId } });
        }
    }
    const siblingCandidates = [...latestNodes.values()];
    for (const [id, node] of latestNodes.entries()) {
        if (node.metadata?.assetId) continue;
        const bound = bindCanvasNodeResourceAsset(node, siblingCandidates, []);
        if (bound.metadata?.assetId) {
            assetIds.set(id, bound.metadata.assetId);
            latestNodes.set(id, bound);
        }
    }

    for (const node of canvasNodesMissingResourceAssetBinding([...latestNodes.values()])) {
        const assetId = await persistAsset(node, true);
        if (assetId) latestNodes.set(node.id, { ...node, metadata: { ...node.metadata, assetId } });
    }

    assertPersistOwnership();
    if (assetIds.size > 0) {
        deps.setNodes((current) => current.map((item) => {
            const assetId = assetIds.get(item.id);
            return assetId ? { ...item, metadata: { ...item.metadata, assetId } } : item;
        }));
    }

    assertPersistOwnership();
    if (!deps.hasProject(originalProjectId) && deps.isLocalWorkspace()) {
        await deps.openProject?.(originalProjectId);
        assertPersistOwnership();
    }
    if (!deps.hasProject(originalProjectId)) {
        throw new Error("The current canvas is not loaded into the local project library and the media results cannot be saved.");
    }

    assertPersistOwnership();
    const storedAfterOpen = deps.getStoredProject(originalProjectId);
    const latestConnections = new Map((storedAfterOpen?.connections || []).map((connection) => [connection.id, connection]));
    for (const connection of deps.getLiveConnections()) latestConnections.set(connection.id, connection);
    for (const connection of mediaConnections) latestConnections.set(connection.id, connection);
    const snapshot = { nodes: [...latestNodes.values()], connections: [...latestConnections.values()] };
    deps.updateProject(originalProjectId, snapshot);
    try {
        assertPersistOwnership();
        await deps.flushPersistence();
        assertPersistOwnership();
        if (deps.isLocalWorkspace()) {
            await deps.syncSnapshot?.(originalProjectId, snapshot);
            assertPersistOwnership();
            const saved = await deps.readSavedProject?.(originalProjectId);
            assertPersistOwnership();
            if (!saved || input.mediaNodes.some((node) => !saved.nodes.some((savedNode) => savedNode.id === node.id))) {
                throw new Error("The local project library readback verification does not contain the newly generated media node");
            }
        }
    } catch (error) {
        if (isPersistStop(error)) throw error;
        assertPersistOwnership();
        deps.error?.(`Media results are generated, but local canvas save fails:${error instanceof Error ? error.message : "unknown error"}`);
        throw error;
    }
    return assetIds;
}
