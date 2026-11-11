import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifest, RegisteredPlugin } from "@/lib/plugins/plugin-types";

import { ART_CRITIQUE_NODE_TYPE, ART_CRITIQUE_PLUGIN_ID, artCritiqueSourceFingerprint, createDefaultArtCritiqueState } from "@/lib/art-critique/contracts";
import { prepareAnalysisNodeAction } from "../analysis-node-action";

const manifest: PluginManifest = {
    apiVersion: "beeftv.plugin/v1",
    id: ART_CRITIQUE_PLUGIN_ID,
    name: "AI aesthetic correction",
    version: "0.1.0",
    description: "Analyze the composition, color, light and proportion issues of the picture, and output structured correction reports and visual annotations. prepare-input prepares the node; canvas_start_art_critique prepares and starts analysis; canvas_read_plugin_node reads the results.",
    author: "Built-in tools",
    surfaces: ["node", "fullscreen"],
    permissions: ["canvas.read", "canvas.write", "media.read", "ai.text"],
    trusted: true,
    contributes: {
        canvasNodes: [
            {
                id: ART_CRITIQUE_NODE_TYPE,
                label: "AI aesthetic correction",
                defaultTitle: "AI aesthetic correction",
                defaultSize: { width: 560, height: 420 },
                schema: { type: "object", properties: { artCritique: { type: "object" } } },
                renderer: "declarative",
                acceptsInputKind: "image",
                showOutputConnection: false,
            },
        ],
    },
};

export const artCritiquePlugin: RegisteredPlugin = {
    manifest,
    agentActions: [prepareAnalysisNodeAction(ART_CRITIQUE_NODE_TYPE, "AI aesthetic correction", () => ({ artCritique: createDefaultArtCritiqueState() }))],
    readAgentNode: (node, snapshot) => {
        const state = node.metadata?.artCritique;
        const sources = snapshot.nodes.filter((item) => item.type === "image" && snapshot.connections.some((edge) => edge.fromNodeId === item.id && edge.toNodeId === node.id));
        const currentReport = state?.report && sources.length === 1 && state.report.sourceFingerprint === artCritiqueSourceFingerprint(sources[0]) ? state.report : undefined;
        return { status: state?.report && !currentReport ? "stale" : state?.status || "idle", stage: state?.analysisStage, stageTaskIds: state?.stageTaskIds, sourceNodeId: state?.sourceNodeId, summary: currentReport?.summary, strengths: currentReport?.strengths, issues: currentReport?.issues, options: currentReport?.options, error: state?.errorMessage, execution: "Existing reports are only returned when the input fingerprints are consistent; canvas_start_art_critique prepares for analysis and is executed after user confirmation." };
    },
    setup(host) {
        return host.contribute("canvas.node", {
            type: ART_CRITIQUE_NODE_TYPE,
            label: "AI aesthetic correction",
            defaultTitle: "AI aesthetic correction",
            defaultSize: { width: 560, height: 420 },
            schema: { type: "object", properties: { artCritique: { type: "object" } } },
            acceptsInputKind: "image",
            showOutputConnection: false,
        });
    },
};

registerPlugin(artCritiquePlugin);
