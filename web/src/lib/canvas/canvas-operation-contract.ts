import { nanoid } from "nanoid";
import { removeCanvasNodes } from "./canvas-project-domain";
import { isFrameNode } from "./canvas-frame";

import { getNodeSpec } from "@/constant/canvas";
import { getNodeDefinition } from "./node-registry";
import { isPluginEffectivelyEnabled } from "@/stores/use-plugin-store";
import { CanvasNodeType, type CanvasNodeTypeId, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ViewportTransform } from "@/types/canvas";

export type CanvasOperation =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string; fromHandleId?: string; toHandleId?: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string; retry?: boolean };

export type CanvasSnapshot = {
    projectId: string;
    domainProjectId?: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
    revision?: number;
    stateHash?: string;
};

export type CanvasOperationImpact = {
    operationCount: number;
    affectedNodeCount: number;
    destructiveCount: number;
    generationCount: number;
    items: string[];
    warning: string;
};

export type CanvasGenerationVerification = {
    nodeId: string;
    taskId?: string;
    taskStatus?: string;
    officialStatus?: string;
    outcome: "not_started" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
    resourceReady: boolean;
    message: string;
};

export type CanvasOperationPostcondition = {
    ok: boolean;
    changed: boolean;
    ranGeneration: boolean;
    createdNodeIds: string[];
    createdConnectionIds: string[];
    connectionCount: number;
    expectedConnectionCount: number;
    removedNodeIds: string[];
    affectedNodeIds: string[];
    missingNodeIds: string[];
    missingConnectionIds: string[];
    generation: CanvasGenerationVerification[];
    warnings: string[];
    overlapWarnings: string[];
    beforeStateHash: string;
    afterStateHash: string;
    hashSource: "browser-local";
};

/**
 * Verify the observable postcondition after a batch has been applied.
 *
 * This is intentionally separate from validation: validation answers whether
 * an operation is safe to attempt, while this function answers whether the
 * browser actually produced the state the Agent asked for. Generation is
 * reported as submitted/running/succeeded rather than being collapsed into
 * a misleading boolean "completed".
 */
export function verifyCanvasOperations(before: CanvasSnapshot, after: CanvasSnapshot, ops: CanvasOperation[]): CanvasOperationPostcondition {
    const beforeNodeIds = new Set(before.nodes.map((node) => node.id));
    const afterNodeIds = new Set(after.nodes.map((node) => node.id));
    const beforeConnectionIds = new Set(before.connections.map((connection) => connection.id));
    const afterConnectionIds = new Set(after.connections.map((connection) => connection.id));
    const createdNodeIds = after.nodes.filter((node) => !beforeNodeIds.has(node.id)).map((node) => node.id);
    const createdConnectionIds = after.connections.filter((connection) => !beforeConnectionIds.has(connection.id)).map((connection) => connection.id);
    const expectedConnectionCount = ops.filter((op) => op.type === "connect_nodes").length;
    const removedNodeIds = before.nodes.filter((node) => !afterNodeIds.has(node.id)).map((node) => node.id);
    const affectedNodeIds = new Set<string>();
    const missingNodeIds = new Set<string>();
    const missingConnectionIds = new Set<string>();
    const failedPostconditions = new Set<string>();
    const warnings: string[] = [];
    const overlapWarnings = findCanvasNodeOverlaps(after.nodes, createdNodeIds);
    if (overlapWarnings.length) warnings.push(...overlapWarnings);
    const generation: CanvasGenerationVerification[] = [];
    const addNodeCount = ops.filter((op) => op.type === "add_node").length;
    if (createdNodeIds.length < addNodeCount) {
        failedPostconditions.add("add_node:count");
        warnings.push(`Expected new additions${addNodeCount} nodes, and ultimately only observed${createdNodeIds.length} a`);
    }

    const requireAfterNode = (nodeId: string) => {
        affectedNodeIds.add(nodeId);
        if (!afterNodeIds.has(nodeId)) missingNodeIds.add(nodeId);
    };
    const connectionExists = (op: Extract<CanvasOperation, { type: "connect_nodes" }>) => after.connections.some((connection) => connection.fromNodeId === op.fromNodeId
        && connection.toNodeId === op.toNodeId
        && connection.fromHandleId === op.fromHandleId
        && connection.toHandleId === op.toHandleId);

    for (const op of ops) {
        if (op.type === "add_node") {
            if (op.id && !afterNodeIds.has(op.id)) missingNodeIds.add(op.id);
            continue;
        }
        if (op.type === "update_node") {
            requireAfterNode(op.id);
            const beforeNode = before.nodes.find((node) => node.id === op.id);
            const afterNode = after.nodes.find((node) => node.id === op.id);
            if (beforeNode && afterNode && op.patch) {
                const patch = op.patch as Record<string, unknown>;
                for (const key of ["title", "x", "y", "width", "height", "position", "parentId"]) {
                    if (!(key in patch) || JSON.stringify(afterNode[key as keyof typeof afterNode]) === JSON.stringify(patch[key])) continue;
                    failedPostconditions.add(`${op.id}:${key}`);
                    warnings.push(`Node "${afterNode.title || op.id}" of${key} did not meet expectations`);
                }
                if ((patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata)) || op.metadata) {
                    const expectedMetadata = { ...beforeNode.metadata, ...(patch.metadata as Record<string, unknown> || {}), ...(op.metadata || {}) };
                    if (JSON.stringify(afterNode.metadata || {}) !== JSON.stringify(expectedMetadata)) {
                        failedPostconditions.add(`${op.id}:metadata`);
                        warnings.push(`Node "${afterNode.title || op.id}” metadata does not meet expectations`);
                    }
                }
            }
            continue;
        }
        if (op.type === "delete_node") {
            const ids = op.ids || (op.id ? [op.id] : op.nodeType ? before.nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
            ids.forEach((id) => {
                affectedNodeIds.add(id);
                if (afterNodeIds.has(id)) missingNodeIds.add(id);
            });
            continue;
        }
        if (op.type === "delete_connections") {
            const ids = op.all ? before.connections.map((connection) => connection.id) : op.ids || (op.id ? [op.id] : []);
            ids.forEach((id) => {
                if (afterConnectionIds.has(id)) missingConnectionIds.add(id);
            });
            continue;
        }
        if (op.type === "connect_nodes") {
            affectedNodeIds.add(op.fromNodeId);
            affectedNodeIds.add(op.toNodeId);
            if (!connectionExists(op)) missingConnectionIds.add(op.id || `${op.fromNodeId}->${op.toNodeId}`);
            continue;
        }
        if (op.type === "select_nodes") {
            op.ids.forEach((id) => {
                affectedNodeIds.add(id);
                if (afterNodeIds.has(id) && !after.selectedNodeIds.includes(id)) warnings.push(`Node "${id}” did not appear in the final selection`);
            });
            continue;
        }
        if (op.type === "run_generation") {
            requireAfterNode(op.nodeId);
            const node = after.nodes.find((item) => item.id === op.nodeId);
            const metadata = node?.metadata || {};
            const taskId = typeof metadata.taskId === "string" && metadata.taskId ? metadata.taskId : undefined;
            const taskStatus = typeof metadata.taskStatus === "string" ? metadata.taskStatus : undefined;
            const officialStatus = typeof metadata.taskOfficialStatus === "string" ? metadata.taskOfficialStatus : undefined;
            const resourceReady = metadata.status === "success" && Boolean(metadata.storageKey || metadata.primaryImageId || (metadata as Record<string, unknown>).resourceId);
            const outcome = generationOutcome(taskStatus, officialStatus, taskId);
            const message = generationVerificationMessage(outcome, resourceReady);
            generation.push({ nodeId: op.nodeId, ...(taskId ? { taskId } : {}), ...(taskStatus ? { taskStatus } : {}), ...(officialStatus ? { officialStatus } : {}), outcome, resourceReady, message });
            if (outcome === "not_started") warnings.push(`Node "${node?.title || op.nodeId}"There is no binding to generate the task, and the tool does not confirm that the task has been submitted.`);
            else if (outcome === "failed" || outcome === "cancelled") warnings.push(`Node "${node?.title || op.nodeId}The build task for " was not successful:${message}`);
            else if (outcome === "succeeded" && !resourceReady) warnings.push(`Node "${node?.title || op.nodeId}"The provider task has been successful, but the resource has not yet been materialized.`);
            continue;
        }
    }

    const ranGeneration = generation.length > 0;
    const changed = hashCanvasSnapshot(before) !== hashCanvasSnapshot(after) || ranGeneration;
    const generationFailed = generation.some((item) => item.outcome === "not_started" || item.outcome === "failed" || item.outcome === "cancelled");
    return {
        ok: missingNodeIds.size === 0 && missingConnectionIds.size === 0 && failedPostconditions.size === 0 && !generationFailed && overlapWarnings.length === 0,
        changed,
        ranGeneration,
        createdNodeIds,
        createdConnectionIds,
        connectionCount: after.connections.length,
        expectedConnectionCount,
        removedNodeIds,
        affectedNodeIds: [...affectedNodeIds],
        missingNodeIds: [...missingNodeIds],
        missingConnectionIds: [...missingConnectionIds],
        generation,
        warnings: [...new Set(warnings)],
        overlapWarnings,
        beforeStateHash: hashCanvasSnapshot(before),
        afterStateHash: hashCanvasSnapshot(after),
        hashSource: "browser-local",
    };
}

export function findCanvasNodeOverlaps(nodes: CanvasNodeData[], onlyIds?: string[]) {
    const filter = onlyIds ? new Set(onlyIds) : null;
    const candidates = nodes.filter((node) => !filter || filter.has(node.id));
    const overlaps: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
        for (let next = index + 1; next < candidates.length; next += 1) {
            const left = candidates[index];
            const right = candidates[next];
            if (left.position.x >= right.position.x + right.width || right.position.x >= left.position.x + left.width || left.position.y >= right.position.y + right.height || right.position.y >= left.position.y + left.height) continue;
            overlaps.push(`Node "${left.title || left.id}” and “${right.title || right.id}"Overlap occurs`);
        }
    }
    return overlaps;
}

export function canvasOperationPostconditionMessage(result: CanvasOperationPostcondition) {
    const nodeSummary = result.createdNodeIds.length ? `Created${result.createdNodeIds.length} nodes` : result.changed ? "Canvas updated" : "The canvas state has not changed";
    const connectionSummary = result.expectedConnectionCount
        ? `expected${result.expectedConnectionCount} lines, actually added${result.createdConnectionIds.length} Articles (currently total${result.connectionCount} Article)`
        : `Current total${result.connectionCount} lines`;
    if (!result.ok) {
        if (result.generation.some((item) => item.outcome === "failed" || item.outcome === "cancelled")) return result.generation.map((item) => item.message).join("；");
        if (result.generation.some((item) => item.outcome === "not_started")) return "Canvas writing completed, but the build task was not submitted successfully, please check the current build executor.";
        const details = [...result.overlapWarnings, ...result.warnings].filter(Boolean).slice(0, 2).join("；");
        return `${nodeSummary}, but the fact check fails:${details || "The target node or link is not in the expected state"}。${result.expectedConnectionCount ? ` ${connectionSummary}。` : ""}`;
    }
    if (result.generation.some((item) => item.outcome === "queued" || item.outcome === "running")) return `${nodeSummary}，${connectionSummary};The generation task has been submitted and is still${result.generation.map((item) => item.message).join("、")}, not yet completed.`;
    if (result.generation.some((item) => item.outcome === "succeeded" && !item.resourceReady)) return `${nodeSummary}，${connectionSummary};The generation task has been successful, but the resource has not yet been materialized to the canvas, and it cannot be used as reusable material at this time.`;
    if (result.generation.some((item) => item.outcome === "succeeded" && item.resourceReady)) return `${nodeSummary}，${connectionSummary};The build is complete and the resources are ready on the canvas node.`;
    return `${nodeSummary}，${connectionSummary}, the layout has no overlap, and the final state has been reviewed.`;
}

export function summarizeCanvasOperations(ops?: CanvasOperation[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function previewCanvasOperations(ops?: CanvasOperation[], snapshot?: CanvasSnapshot): CanvasOperationImpact {
    const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
    const nodeById = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
    const affectedNodeIds = new Set<string>();
    let addedNodeCount = 0;
    let destructiveCount = 0;
    let generationCount = 0;
    const items: string[] = [];

    safeOps.forEach((op) => {
        if (op.type === "add_node") {
            addedNodeCount += 1;
            items.push(`New${canvasNodeTypeLabel(op.nodeType)}${op.title ? `「${op.title}」` : ""}`);
            return;
        }
        if (op.type === "update_node") {
            affectedNodeIds.add(op.id);
            items.push(`Modify "${nodeById.get(op.id)?.title || op.id}」`);
            return;
        }
        if (op.type === "delete_node") {
            const ids = op.ids || (op.id ? [op.id] : op.nodeType ? (snapshot?.nodes || []).filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
            const removedIds = removeCanvasNodes(snapshot?.nodes || [], new Set(ids)).removedIds;
            removedIds.forEach((id) => affectedNodeIds.add(id));
            destructiveCount += Math.max(1, removedIds.size);
            const names = ids.slice(0, 3).map((id) => nodeById.get(id)?.title || id);
            items.push(ids.length ? `Delete${ids.length} nodes${names.length ? `：${names.join("、")}${ids.length > names.length ? "etc." : ""}` : ""}` : `Delete all${canvasNodeTypeLabel(op.nodeType)}`);
            return;
        }
        if (op.type === "connect_nodes") {
            affectedNodeIds.add(op.fromNodeId);
            affectedNodeIds.add(op.toNodeId);
            items.push(`Connect "${nodeById.get(op.fromNodeId)?.title || op.fromNodeId}"to"${nodeById.get(op.toNodeId)?.title || op.toNodeId}」`);
            return;
        }
        if (op.type === "delete_connections") {
            const count = op.all ? snapshot?.connections.length || 0 : op.ids?.length || (op.id ? 1 : 0);
            destructiveCount += Math.max(1, count);
            items.push(op.all ? `Delete all${count} lines` : `Delete${count || 1} lines`);
            return;
        }
        if (op.type === "run_generation") {
            affectedNodeIds.add(op.nodeId);
            generationCount += 1;
            items.push(`for "${nodeById.get(op.nodeId)?.title || op.nodeId}"Trigger${generationModeLabel(op.mode)}generate`);
            return;
        }
        if (op.type === "select_nodes") {
            op.ids.forEach((id) => affectedNodeIds.add(id));
            items.push(`Select${op.ids.length} nodes`);
            return;
        }
        if (op.type === "set_viewport") items.push("Adjust the current canvas view");
    });

    const warnings = [];
    if (destructiveCount) warnings.push("Contains deletion operations, which can be gradually revoked from the most recent Agent batch after approval.");
    if (generationCount) warnings.push("Generating tasks may incur model fees, and canvas revocation will not cancel submitted tasks.");
    return {
        operationCount: safeOps.length,
        affectedNodeCount: affectedNodeIds.size + addedNodeCount,
        destructiveCount,
        generationCount,
        items: items.slice(0, 8),
        warning: warnings.join(" "),
    };
}

export function applyCanvasOperations(snapshot: CanvasSnapshot, ops?: CanvasOperation[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;

    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = op.nodeType || CanvasNodeType.Text;
            const definition = getNodeDefinition(nodeType);
            if (!definition || (definition.plugin && !isPluginEffectivelyEnabled(definition.plugin.pluginId))) throw new Error(`The node type is not registered or the plugin is not available:${nodeType}`);
            const spec = getNodeSpec(nodeType as CanvasNodeType) || { title: definition.defaultTitle, ...definition.defaultSize, metadata: definition.defaultMetadata };
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata, ...(definition.plugin ? { pluginId: definition.plugin.pluginId, pluginNodeId: nodeType } : {}) },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            const current = nodes.find((node) => node.id === op.id);
            const nextPosition = op.patch?.position;
            const dx = current && isFrameNode(current) && nextPosition ? nextPosition.x - current.position.x : 0;
            const dy = current && isFrameNode(current) && nextPosition ? nextPosition.y - current.position.y : 0;
            nodes = nodes.map((node) => {
                if (node.id === op.id) return { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } };
                if (node.parentId === op.id && (dx || dy)) return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
                return node;
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            const removal = removeCanvasNodes(nodes, ids);
            nodes = removal.nodes;
            connections = connections.filter((conn) => !removal.removedIds.has(conn.fromNodeId) && !removal.removedIds.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !removal.removedIds.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const exists = connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId && conn.fromHandleId === op.fromHandleId && conn.toHandleId === op.toHandleId);
            const from = nodes.find((node) => node.id === op.fromNodeId);
            const to = nodes.find((node) => node.id === op.toNodeId);
            const hasNodes = Boolean(from && to && !isFrameNode(from) && !isFrameNode(to));
            if (!exists && hasNodes) connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId, fromHandleId: op.fromHandleId, toHandleId: op.toHandleId }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

export function hashCanvasSnapshot(snapshot: CanvasSnapshot) {
    let hash = 2166136261;
    const text = JSON.stringify({ projectId: snapshot.projectId, domainProjectId: snapshot.domainProjectId, title: snapshot.title, nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selectedNodeIds, viewport: snapshot.viewport });
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function opLabel(type: string) {
    if (type === "add_node") return "Add new node";
    if (type === "update_node") return "Update node";
    if (type === "delete_node") return "Delete node";
    if (type === "delete_connections") return "Delete connection";
    if (type === "connect_nodes") return "connect";
    if (type === "set_viewport") return "Adjust view";
    if (type === "select_nodes") return "Select node";
    if (type === "run_generation") return "trigger generation";
    return type;
}

function canvasNodeTypeLabel(type?: CanvasNodeTypeId) {
    if (type === CanvasNodeType.Image) return "Picture node";
    if (type === CanvasNodeType.Video) return "video node";
    if (type === CanvasNodeType.Audio) return "audio node";
    if (type === CanvasNodeType.Config) return "Generate configuration";
    if (type === CanvasNodeType.Script) return "Storyboard";
    if (type === CanvasNodeType.Frame) return "backplane";
    if (type === CanvasNodeType.Drawing) return "drawing node";
    if (type === CanvasNodeType.Skill) return "Skill node";
    return type ? `${getNodeDefinition(type)?.label || type}node` : "text node";
}

function generationModeLabel(mode?: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "text";
    if (mode === "video") return "video";
    if (mode === "audio") return "Audio";
    return "pictures";
}

function generationOutcome(taskStatus?: string, officialStatus?: string, taskId?: string): CanvasGenerationVerification["outcome"] {
    if (!taskId) return "not_started";
    const status = taskStatus || officialStatus;
    if (status === "queued" || status === "pending" || officialStatus === "pending") return "queued";
    if (status === "running" || status === "processing" || officialStatus === "processing") return "running";
    if (status === "succeeded" || status === "completed" || officialStatus === "completed") return "succeeded";
    if (status === "failed" || officialStatus === "failed") return "failed";
    if (status === "cancelled" || status === "canceled" || officialStatus === "cancelled") return "cancelled";
    return "unknown";
}

function generationVerificationMessage(outcome: CanvasGenerationVerification["outcome"], resourceReady: boolean) {
    if (outcome === "not_started") return "The task was not successfully submitted";
    if (outcome === "queued") return "Queuing";
    if (outcome === "running") return "Generating";
    if (outcome === "failed") return "Build failed";
    if (outcome === "cancelled") return "Canceled";
    if (outcome === "succeeded" && resourceReady) return "Completed and resources ready";
    if (outcome === "succeeded") return "The task was successful but the resource is not ready";
    return "Status unknown";
}
