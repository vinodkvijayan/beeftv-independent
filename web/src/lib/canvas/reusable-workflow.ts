import { canvasNodeResourceId } from "./canvas-resource-id";
import { canvasProcessingRecipe } from "./canvas-processing-recipe";
import { abstractWorkflowDefinition } from "./workflow-editor";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { WorkflowDefinition, WorkflowMediaType, WorkflowNode, WorkflowRun, WorkflowValue } from "@/services/api/canvas-workflows";

const mediaTypes = new Set(["image", "video", "audio", "text"]);
const executing = (node: WorkflowNode) => node.role === "operation" || node.role === "generation" || node.role === "depth";

export function workflowRunInputs(definition: WorkflowDefinition, run?: WorkflowRun | null): Record<string, WorkflowValue> {
    return Object.fromEntries(definition.nodes.filter(node => node.role === "input").map(node => {
        const value = run?.steps.find(step => step.nodeId === node.id) || node;
        return [node.id, { resourceId: value.resourceId, text: value.text }];
    }));
}

function valueNode(node: CanvasNodeData, role: "input" | "constant"): WorkflowNode {
    if (!mediaTypes.has(node.type)) throw new Error(`「${node.title}"Conversion to workflow is not supported yet; please select only image, video, audio and text nodes`);
    const mediaType = node.type as WorkflowMediaType;
    const resourceId = canvasNodeResourceId(node);
    const text = mediaType === "text" ? node.metadata?.content || node.metadata?.prompt || "" : undefined;
    if (mediaType !== "text" && !resourceId) throw new Error(`「${node.title}"The material has not been persisted yet, please wait for the saving to be completed.`);
    return { id: node.id, title: node.title, role, mediaType, ...(resourceId ? { resourceId } : {}), ...(text !== undefined ? { text } : {}) };
}

function assertAcyclic(definition: WorkflowDefinition) {
    const complete = new Set<string>();
    const active = new Set<string>();
    const predecessors = new Map<string, string[]>();
    definition.edges.forEach(edge => predecessors.set(edge.toNodeId, [...predecessors.get(edge.toNodeId) || [], edge.fromNodeId]));
    const visit = (id: string) => {
        if (active.has(id)) throw new Error("The selected node has a circular dependency. Please disconnect the loop before saving the workflow.");
        if (complete.has(id)) return;
        active.add(id);
        predecessors.get(id)?.forEach(visit);
        active.delete(id);
        complete.add(id);
    };
    definition.nodes.forEach(node => visit(node.id));
}

/** A frozen operation no longer needs its old upstream branch. Only output ancestors are saved. */
export function prepareWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
    const operations = new Set(definition.nodes.filter(executing).map(node => node.id));
    const edges = definition.edges.filter(edge => operations.has(edge.toNodeId));
    const keep = new Set(definition.outputNodeIds);
    const visit = (id: string) => {
        edges.filter(edge => edge.toNodeId === id).forEach(edge => {
            if (!keep.has(edge.fromNodeId)) { keep.add(edge.fromNodeId); visit(edge.fromNodeId); }
        });
    };
    definition.outputNodeIds.forEach(visit);
    const result = { ...definition, nodes: definition.nodes.filter(node => keep.has(node.id)), edges: edges.filter(edge => keep.has(edge.toNodeId) && keep.has(edge.fromNodeId)) };
    assertAcyclic(result);
    if (!result.outputNodeIds.length) throw new Error("Please select at least one output result");
    if (!result.nodes.some(executing)) throw new Error("Workflow requires at least one re-executed processing step");
    return result;
}

/** Canvas provenance is compiled into a small execution graph; UI state and credentials never enter it. */
export function compileCanvasWorkflow(nodes: CanvasNodeData[], connections: CanvasConnection[], selection: Set<string>) {
    const selected = new Set(selection);
    let expanded = true;
    while (expanded) {
        expanded = false;
        nodes.forEach(node => { if (node.parentId && selected.has(node.parentId) && !selected.has(node.id)) { selected.add(node.id); expanded = true; } });
    }
    const chosen = nodes.filter(node => selected.has(node.id) && node.type !== "frame");
    if (!chosen.length) throw new Error("Please select the node to save first");
    const byId = new Map(nodes.map(node => [node.id, node]));
    const aliases = new Map<string, string>();
    const representatives = new Map<string, CanvasNodeData>();
    const sourceIds = new Map<string, string>();

    for (const node of chosen) {
        if (!mediaTypes.has(node.type)) throw new Error(`「${node.title}"Currently does not support conversion to workflow`);
        const metadata = node.metadata;
        if (metadata?.status === "loading" || ["queued", "running"].includes(metadata?.taskStatus || "")) throw new Error(`Please wait "${node.title}"Execution completed`);
        const candidates = nodes.filter(child => child.id !== node.id && child.metadata?.generatedFromNodeId === node.id && child.metadata?.taskId && (child.type === "text" ? typeof child.metadata?.content === "string" : Boolean(canvasNodeResourceId(child))));
        if (metadata?.nodeRole === "generator" || (!canvasNodeResourceId(node) && node.type !== "text") || (node.type === "text" && !metadata?.taskId && candidates.length > 0)) {
            const selectedResults = candidates.filter(child => selected.has(child.id));
            const result = selectedResults.length === 1 ? selectedResults[0] : candidates.length === 1 ? candidates[0] : undefined;
            if (!result && candidates.length > 1) throw new Error(`「${node.title}"There are multiple generated results. Please select only one of the results and save it.`);
            const recipe = result || node;
            if (!recipe.metadata?.taskId) throw new Error(`Please run it manually first${node.title}”, and then save it as a workflow after success.`);
            if (selectedResults.length > 1) throw new Error(`「${node.title}"Multiple results are selected, please keep only one result`);
            representatives.set(node.id, recipe);
            sourceIds.set(node.id, node.id);
            if (result) aliases.set(result.id, node.id);
        }
    }
    const definitionNodes: WorkflowNode[] = [];
    for (const node of chosen) {
        if (aliases.has(node.id)) continue;
        const recipe = representatives.get(node.id) || node;
        const metadata = recipe.metadata;
        const value = valueNode(recipe, node.type === "text" ? "constant" : "input");
        const isDepth = Boolean(metadata?.depthSourceNodeId || metadata?.taskType === "depth_capture");
        const sourceId = isDepth ? metadata?.depthSourceNodeId : metadata?.generatedFromNodeId;
        const processing = canvasProcessingRecipe(recipe);
        if (processing) {
            value.role = "operation";
            value.operationId = processing.id;
            value.operationVersion = processing.version;
            value.config = { ...processing.config };
        } else if (metadata?.taskId) {
            if (metadata.taskStatus && metadata.taskStatus !== "succeeded") throw new Error(`「${node.title}"The original task has not been successful, please complete a manual run first`);
            value.role = isDepth ? "depth" : "generation";
            value.sourceTaskId = metadata.taskId;
            // Selecting only a result also captures the generator's incoming references.
            if (!representatives.has(node.id) && sourceId && !isDepth) {
                sourceIds.set(node.id, sourceId);
            }
        }
        definitionNodes.push({ ...value, id: node.id, title: node.title });
    }
    const included = new Map(definitionNodes.map(node => [node.id, node]));
    const edges: WorkflowDefinition["edges"] = [];
    let externalCount = 0;
    const addEdge = (fromId: string, toId: string, toPort?: string, order?: number) => {
        const fromNodeId = aliases.get(fromId) || fromId;
        const toNodeId = aliases.get(toId) || toId;
        if (fromNodeId === toNodeId || !included.has(toNodeId)) return;
        if (!included.has(fromNodeId)) {
            const external = byId.get(fromId);
            if (!external) throw new Error("Some input nodes have been lost, please check the connections.");
            included.set(fromNodeId, { ...valueNode(external, external.type === "text" ? "constant" : "input"), id: fromNodeId });
            externalCount++;
        }
        if (!edges.some(edge => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId && edge.toPort === toPort)) edges.push({ fromNodeId, toNodeId, ...(toPort ? { fromPort: "output", toPort, order: order || 0 } : {}) });
    };
    for (const node of definitionNodes) {
        if (!executing(node)) continue;
        const sourceNode = representatives.get(node.id) || byId.get(node.id);
        const processing = sourceNode && canvasProcessingRecipe(sourceNode);
        if (processing) { processing.inputs.forEach(input => addEdge(input.nodeId, node.id, input.port, input.order)); continue; }
        const originalId = sourceIds.get(node.id) || node.id;
        connections.filter(edge => edge.toNodeId === originalId || edge.toNodeId === node.id).forEach(edge => {
            const source = byId.get(edge.fromNodeId);
            // A pure generator -> result edge expresses provenance. A source
            // with actual media/text can also be an input to regeneration.
            if (edge.fromNodeId === originalId && originalId !== node.id && source && !canvasNodeResourceId(source) && source.type !== "text") return;
            addEdge(edge.fromNodeId, node.id);
        });
        const depthSource = representatives.get(node.id)?.metadata?.depthSourceNodeId || byId.get(node.id)?.metadata?.depthSourceNodeId;
        if (node.role === "depth" && depthSource) addEdge(depthSource, node.id);
    }
    const hasDownstream = new Set(edges.map(edge => edge.fromNodeId));
    const outputNodeIds = definitionNodes.filter(node => executing(node) && !hasDownstream.has(node.id)).map(node => node.id);
    const definition = abstractWorkflowDefinition({ version: 1, nodes: Array.from(included.values()), edges, outputNodeIds });
    assertAcyclic(definition);
    if (!definitionNodes.some(executing)) throw new Error("Please include at least one build or depth processing step that ran successfully");
    return { definition, externalCount };
}
