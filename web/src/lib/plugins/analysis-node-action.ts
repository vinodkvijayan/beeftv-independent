import { nanoid } from "nanoid";
import type { CanvasNodeMetadata } from "@/types/canvas";
import type { PluginAgentAction } from "./plugin-types";

export function prepareAnalysisNodeAction(nodeType: string, title: string, metadata: () => CanvasNodeMetadata): PluginAgentAction {
    return {
        id: "prepare-input",
        description: `Prepare for existing images${title}Nodes and connections, reuse existing nodes with the same input; only prepare input, do not start analysis or charge.`,
        inputSchema: { type: "object", properties: { sourceNodeId: { type: "string" } }, required: ["sourceNodeId"], additionalProperties: false },
        buildOperations(input, snapshot) {
            if (Object.keys(input).some((key) => key !== "sourceNodeId")) throw new Error("Only accept sourceNodeId");
            const source = snapshot.nodes.find((node) => node.id === input.sourceNodeId && node.type === "image");
            if (!source || !(source.metadata?.storageKey || source.metadata?.content || source.metadata?.previewContent)) throw new Error("Please provide the real ID of the existing image node in the current canvas");
            const existing = snapshot.nodes.find((node) => node.type === nodeType && snapshot.connections.some((edge) => edge.fromNodeId === source.id && edge.toNodeId === node.id));
            if (existing) return [{ type: "select_nodes", ids: [existing.id] }];
            const id = `${nodeType}-${nanoid()}`;
            return [
                { type: "add_node", id, nodeType, title, position: { x: Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 120, y: source.position.y }, metadata: metadata() },
                { type: "connect_nodes", fromNodeId: source.id, toNodeId: id },
                { type: "select_nodes", ids: [id] },
            ];
        },
    };
}
