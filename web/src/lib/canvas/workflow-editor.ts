import type { WorkflowDefinition, WorkflowNode, WorkflowOperation } from "@/services/api/canvas-workflows";
import { canvasNodeMentionToken } from "./canvas-resource-references";

export const isWorkflowOperation = (node: WorkflowNode) => ["operation", "generation", "depth"].includes(node.role);
export const workflowOperationId = (node: WorkflowNode) => node.operationId || (node.role === "depth" ? "video.depth" : node.role === "generation" ? `generate.${node.mediaType}` : "");

export function workflowDurationSources(definition: WorkflowDefinition, nodeId: string) {
    const ids = new Set(definition.edges.filter(edge => edge.toNodeId === nodeId && (!edge.toPort || edge.toPort === "referenceVideos")).map(edge => edge.fromNodeId));
    return definition.nodes.filter(node => ids.has(node.id) && node.mediaType === "video");
}
export function genericWorkflowNodeTitle(node: WorkflowNode, operations: WorkflowOperation[] = []) {
    const labels = { image: "pictures", video: "video", audio: "Audio", text: "text" };
    const id = workflowOperationId(node);
    if (isWorkflowOperation(node)) return operations.find(item => item.id === id)?.name || ({ "video.depth": "Deep extraction", "video.trim": "video clip", "video.merge": "Video splicing", "image.crop": "Picture cropping", "image.resize": "Resize image", "video.crop": "Video screen cropping", "video.frame": "Capture video frames", "video.audio": "Extract video audio" } as Record<string, string>)[id] || `${id.startsWith("generate.") || node.role === "generation" ? "generate" : "Process"}${labels[node.mediaType]}`;
    return `${labels[node.mediaType]}${node.role === "input" ? "input" : "Reference"}`;
}

/** Number default names without changing custom names or existing numbered references. */
export function numberWorkflowNodeTitles(definition: WorkflowDefinition, operations: WorkflowOperation[]) {
    const titles = new Set(definition.nodes.map(node => node.title));
    return { ...definition, nodes: definition.nodes.map(node => {
        const base = genericWorkflowNodeTitle(node, operations);
        if (node.title !== base) return node;
        let number = 1;
        while (titles.has(`${base} ${number}`)) number++;
        const title = `${base} ${number}`;
        titles.add(title);
        return { ...node, title };
    }) };
}

export function abstractWorkflowDefinition(definition: WorkflowDefinition, operations: WorkflowOperation[] = []): WorkflowDefinition {
    return { ...definition, presentationVersion: 1, nodes: definition.nodes.map(node => ({ ...node, title: genericWorkflowNodeTitle(node, operations), ...(node.role === "input" && node.mediaType !== "text" ? { useDefault: false } : {}) })) };
}
export const workflowEditableFields = (node: WorkflowNode, operation?: WorkflowOperation) => (operation?.fields || []).filter(field => !operation?.id.startsWith("generate.") || ["prompt", "modelOption", "size"].includes(field.key) || operation.id === "generate.video" && ["vquality", "videoSeconds"].includes(field.key) || Object.hasOwn(node.config || {}, field.key));
export const workflowOperationDefaults = (operation: WorkflowOperation) => Object.fromEntries(operation.fields.filter(f => f.type === "number" || f.type === "select" && f.options?.length).map(f => [f.key, f.type === "select" ? f.options![0].value : f.key === "longEdge" ? 2048 : ["endSeconds", "width", "height"].includes(f.key) ? 1 : f.min || 0]));

export function switchWorkflowOperation(definition: WorkflowDefinition, id: string, operation: WorkflowOperation): WorkflowDefinition {
    if (operation.unavailableReason) throw new Error(operation.unavailableReason);
    if (operation.id.startsWith("generate.")) throw new Error("Please select a successful canvas recipe for the model step");
    const node = definition.nodes.find(n => n.id === id);
    if (!node) return definition;
    const config = workflowOperationDefaults(operation);
    return { ...definition, nodes: definition.nodes.map(n => n.id !== id ? n : { id, title: operation.name, role: "operation", mediaType: operation.outputType, operationId: operation.id, operationVersion: operation.version, config }),
        edges: definition.edges.filter(e => e.toNodeId === id ? operation.inputs.some(p => p.id === e.toPort && p.mediaType === definition.nodes.find(n => n.id === e.fromNodeId)?.mediaType) : e.fromNodeId !== id || node.mediaType === operation.outputType) };
}

export function removeWorkflowDraftNode(definition: WorkflowDefinition, id: string): WorkflowDefinition {
    const positions = { ...definition.positions };
    delete positions[id];
    return { ...definition, nodes: definition.nodes.filter(node => node.id !== id).map(node => ({ ...node,
        ...(node.videoDurationSourceNodeId === id ? { videoDurationSourceNodeId: undefined } : {}),
        ...(typeof node.config?.prompt === "string" && node.config.prompt.includes(canvasNodeMentionToken(id))
            ? { config: { ...node.config, prompt: node.config.prompt.split(canvasNodeMentionToken(id)).join("") } } : {}),
    })),
        edges: definition.edges.filter(edge => edge.fromNodeId !== id && edge.toNodeId !== id),
        outputNodeIds: definition.outputNodeIds.filter(value => value !== id), positions };
}

export function workflowEditorPositions(definition: WorkflowDefinition) {
    const positions: Record<string, { x: number; y: number }> = {};
    const levels = new Map<string, number>();
    const level = (id: string, path = new Set<string>()): number => {
        if (levels.has(id)) return levels.get(id)!;
        if (path.has(id)) return 0;
        const parents = definition.edges.filter(edge => edge.toNodeId === id);
        const value = parents.length ? 1 + Math.max(...parents.map(edge => level(edge.fromNodeId, new Set([...path, id])))) : 0;
        levels.set(id, value);
        return value;
    };
    const rows = new Map<number, number>();
    for (const node of definition.nodes) {
        const column = level(node.id), row = rows.get(column) || 0;
        rows.set(column, row + 1);
        positions[node.id] = definition.positions?.[node.id] || { x: 48 + column * 400, y: 64 + row * 430 };
    }
    return positions;
}

export function connectWorkflowDraft(definition: WorkflowDefinition, from: string, to: string, toPort: string, operations: WorkflowOperation[]): WorkflowDefinition {
    const source = definition.nodes.find(node => node.id === from), target = definition.nodes.find(node => node.id === to);
    if (!source || !target || from === to) throw new Error("Please select two different valid nodes");
    const candidates = operations.find(operation => operation.id === workflowOperationId(target))?.inputs.filter(input => input.mediaType === source.mediaType) || [];
    if (!candidates.length) throw new Error(`「${target.title}"Does not support receiving this type of material`);
    const available = (id: string, multiple: boolean) => multiple || !definition.edges.some(edge => edge.toNodeId === to && edge.toPort === id);
    const port = candidates.find(input => input.id === toPort && available(input.id, input.multiple))
        || candidates.find(input => definition.edges.some(edge => edge.fromNodeId === from && edge.toNodeId === to && edge.toPort === input.id))
        || candidates.find(input => available(input.id, input.multiple));
    if (!port) throw new Error(`「${target.title}"The same type of input has been connected, please remove the old connection first`);
    toPort = port.id;
    if (definition.edges.some(edge => edge.fromNodeId === from && edge.toNodeId === to && edge.toPort === toPort)) return definition;
    const visit = (id: string, seen = new Set<string>()): boolean => {
        if (id === from) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return definition.edges.filter(edge => edge.fromNodeId === id).some(edge => visit(edge.toNodeId, seen));
    };
    if (visit(to)) throw new Error("This connection will form a loop");
    const used = new Set(definition.edges.filter(edge => edge.toNodeId === to && edge.toPort === toPort).map(edge => edge.order || 0));
    let order = 0;
    while (used.has(order)) order++;
    return { ...definition, edges: [...definition.edges, { fromNodeId: from, toNodeId: to, fromPort: "output", toPort, order }] };
}

export function validateWorkflowDraft(definition: WorkflowDefinition, operations: WorkflowOperation[]) {
    if (!definition.nodes.length) throw new Error("Please add node");
    if (!definition.outputNodeIds.length) throw new Error("Please select at least one workflow output");
    if (!definition.nodes.some(isWorkflowOperation)) throw new Error("Please add at least one processing step");
    const ids = new Set(definition.nodes.map(node => node.id));
    if (ids.size !== definition.nodes.length) throw new Error("Duplicate node ID");
    for (const node of definition.nodes) {
        if (!node.title.trim()) throw new Error("Please fill in the node name");
        if (node.videoDurationSourceNodeId && (workflowOperationId(node) !== "generate.video" || !workflowDurationSources(definition, node.id).some(source => source.id === node.videoDurationSourceNodeId))) throw new Error(`「${node.title}The duration reference video of " has been disconnected, please select again.`);
        if (node.role === "constant" && (node.mediaType === "text" ? !node.text?.trim() : !node.resourceId)) throw new Error(`「${node.title}"Lack of fixed content`);
        if (isWorkflowOperation(node)) {
            const operation = operations.find(item => item.id === workflowOperationId(node));
            if (!operation) throw new Error(`「${node.title}” processing power is not available`);
            if (operation.unavailableReason) throw new Error(`「${node.title}」：${operation.unavailableReason}`);
            for (const input of operation.inputs) if (input.required && !definition.edges.some(edge => edge.toNodeId === node.id && edge.toPort === input.id)) throw new Error(`「${node.title}"Missing"${input.label}"Input`);
        }
    }
    if (definition.outputNodeIds.some(id => !ids.has(id))) throw new Error("The output node no longer exists");
    if (definition.edges.some(edge => !ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId))) throw new Error("The wire references a deleted node");
    const active = new Set<string>(), complete = new Set<string>();
    const visit = (id: string) => {
        if (active.has(id)) throw new Error("Workflow contains looping wires");
        if (complete.has(id)) return;
        active.add(id);
        for (const edge of definition.edges.filter(edge => edge.fromNodeId === id)) visit(edge.toNodeId);
        active.delete(id); complete.add(id);
    };
    definition.nodes.forEach(node => visit(node.id));
    for (const edge of definition.edges) {
        const source = definition.nodes.find(node => node.id === edge.fromNodeId)!;
        const target = definition.nodes.find(node => node.id === edge.toNodeId)!;
        const port = operations.find(operation => operation.id === workflowOperationId(target))?.inputs.find(input => input.id === edge.toPort);
        if (!port || port.mediaType !== source.mediaType) throw new Error(`「${target.title}'' does not match the input type or port`);
    }
}
/** Freeze existing coordinates and place appended nodes beside the current graph. */
export function workflowAppendPositions(definition: WorkflowDefinition, appended: WorkflowNode[]) {
    const positions = workflowEditorPositions(definition);
    const x = definition.nodes.length ? Math.max(...Object.values(positions).map(p => p.x)) + 400 : 48;
    const y = definition.nodes.length ? Math.min(...Object.values(positions).map(p => p.y)) : 64;
    appended.forEach((node, index) => { positions[node.id] = { x: x + index * 400, y }; });
    return positions;
}

export function workflowFitViewport(bounds: { left: number; top: number; right: number; bottom: number }, width: number, height: number, libraryOpen: boolean) {
    const inset = libraryOpen ? Math.min(284, width - 64) : 0;
    const graphWidth = Math.max(1, bounds.right - bounds.left), graphHeight = Math.max(1, bounds.bottom - bounds.top);
    const k = Math.max(.001, Math.min(1, Math.max(1, width - inset - 64) / graphWidth, Math.max(1, height - 96) / graphHeight));
    return { x: inset + (width - inset - graphWidth * k) / 2 - bounds.left * k, y: (height - graphHeight * k) / 2 - bounds.top * k - 16, k };
}
