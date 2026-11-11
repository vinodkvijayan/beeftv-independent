import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { resolveStyleExecutionPlan, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type ProjectStylePrompt = { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };

export async function generateCharacterTurnaround(input: { projectId: string; assetId: string; versionId: string; name: string; definition: Record<string, unknown>; projectStyle?: ProjectStylePrompt; config: AiConfig }) {
    const promptTemplateVariables = characterTurnaroundVariables(input.name, input.definition, input.projectStyle);
    const generationConfig = { ...input.config, model: input.config.imageModel || input.config.model, count: "1" };
    const requestConfig = resolveModelRequestConfig(generationConfig, generationConfig.model);
    const styleExecutionPlan = input.projectStyle?.profile ? resolveStyleExecutionPlan(input.projectStyle.profile, { mode: "image", model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(generationConfig)) throw new Error(`The current picture model cannot fully implement the project style:${styleExecutionPlan.warnings.join("；")}. Please switch the image model, or disable the corresponding style assets in the project settings`);
    await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `character-turnaround:${input.assetId}`,
        mode: "image",
        prompt: promptTemplateTaskPlaceholder("Three views of the character"),
        config: generationConfig,
        metadata: { operation: PromptTemplateOperation.CharacterTurnaround, promptTemplateOperation: PromptTemplateOperation.CharacterTurnaround, promptTemplateVariables, characterAssetId: input.assetId, stylePresetId: input.projectStyle?.id, styleProfileJson: input.projectStyle?.profile ? serializeStyleProfile(input.projectStyle.profile) : undefined, styleExecutionPlan, resolvedCharacterVersions: [{ assetId: input.assetId, versionId: input.versionId }] },
    });
}

function characterTurnaroundVariables(name: string, definition: Record<string, unknown>, projectStyle?: ProjectStylePrompt) {
    const visual = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt, definition.multiViewPrompt]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("；");
    if (!visual) throw new Error("Please fill in the plot positioning, character appearance, body shape or clothing first, and then initialize the three views");
    return { 角色名称: name, 项目画风: characterStyleConstraint(projectStyle) || "The project has not yet specified an art style, keeping the character medium neutral.", 角色设定: visual };
}

function characterStyleConstraint(projectStyle?: ProjectStylePrompt) {
    if (!projectStyle) return "";
    // 三视图只继承角色资产相关规范，避免把建筑、运镜等项目规则错误塞进静态设定表。
    const characterSections = new Set(["style combination", "Project positioning", "Theme worldview", "visual media", "character design system", "Project color and light shadow", "Costumes, materials and scenes", "Asset consistency", "Disable globally"]);
    const rules = projectStyle.prompt.split("\n").filter((line) => {
        const title = line.match(/^【([^】]+)】/)?.[1];
        return title ? characterSections.has(title) : false;
    });
    return [
        `Project style:${projectStyle.title}. Character modeling, color matching, clothing materials and final rendering media must comply with the following specifications:`,
        ...rules,
    ].join("\n");
}
