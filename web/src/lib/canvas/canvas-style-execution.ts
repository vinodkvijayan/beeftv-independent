import { applyStyleExecutionPlan, createStyleProfileSnapshot, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile, type StyleExecutionPlan, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasStyleExecutionRuntime = {
    profile: StyleProfileSnapshot;
    profileJson: string;
    plan: StyleExecutionPlan;
    prompt: string;
};

export function resolveCanvasStyleExecution(nodes: CanvasNodeData[], sourceNode: CanvasNodeData | undefined, prompt: string, config: AiConfig, mode: "image" | "video"): CanvasStyleExecutionRuntime | null {
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    if (!styleNode || sourceNode?.metadata?.workflowKind === "styleboard") return null;
    const profile = parseStyleProfile(styleNode.metadata?.styleProfileJson) || legacyStyleNodeProfile(styleNode);
    if (!profile) return null;
    const requestConfig = resolveModelRequestConfig(config, config.model);
    const plan = resolveStyleExecutionPlan(profile, { mode, model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat });
    // 平台模型的真实供应模型由后端入队时路由，前端只能预览，最终兼容性由后端重算。
    if (plan.status === "blocked" && !logicalModelIDForConfig(config)) throw new Error(`The current model cannot fully execute the project style:${plan.warnings.join("；")}. Please switch the model or disable the corresponding style assets in the project settings`);
    return { profile, profileJson: serializeStyleProfile(profile), plan, prompt: applyStyleExecutionPlan(prompt, plan) };
}

function legacyStyleNodeProfile(node: CanvasNodeData) {
    const prompt = String(node.metadata?.content || node.metadata?.prompt || "").trim();
    const presetId = String(node.metadata?.stylePresetId || "").trim();
    if (!prompt || !presetId) return null;
    return createStyleProfileSnapshot({
        presetId,
        title: node.title.replace(/^(?:项目)?画风\s*[·：:]?\s*/, "").trim() || node.title,
        description: node.metadata?.workflowDescription || "Historical project painting style specifications",
        tags: [],
        prompt,
        assets: [],
        source: "user",
        revision: 1,
    });
}
