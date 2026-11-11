import type { CanvasNodeData } from "@/types/canvas";

export type StoryboardGenerationContext = {
    projectStyle: {
        presetId: string;
        title: string;
        prompt: string;
        profileJson?: string;
    };
    characters: Array<{
        assetId: string;
        versionId: string;
        name: string;
        definition: Record<string, unknown>;
    }>;
};

// 分镜的两条入口共用同一强校验，避免画风或角色版本在某条旁路里被遗漏。
export function resolveStoryboardGenerationContext(nodes: CanvasNodeData[]): StoryboardGenerationContext {
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    const stylePrompt = String(styleNode?.metadata?.content || styleNode?.metadata?.prompt || "").trim();
    const stylePresetId = String(styleNode?.metadata?.stylePresetId || "").trim();
    if (!styleNode || !stylePrompt || !stylePresetId) throw new Error("Please set the project style first and then use the composition");

    // `workflowKind=character` is also used by standalone character-design
    // image workflows. Only nodes linked to a project character asset are
    // storyboard character cards and therefore participate in this check.
    const characterNodes = nodes.filter((node) => node.metadata?.workflowKind === "character" && node.metadata?.characterAssetId?.trim());
    const invalidCharacter = characterNodes.find((node) => !node.metadata?.characterAssetId?.trim() || !node.metadata?.characterVersionId?.trim() || !(node.metadata?.characterName || node.title).trim());
    if (invalidCharacter) throw new Error(`character card"${invalidCharacter.metadata?.characterName || invalidCharacter.title || "unnamed role"}"The version is not synchronized. Please refresh the character assets and regenerate the components."`);

    return {
        projectStyle: {
            presetId: stylePresetId,
            title: styleNode.title.replace(/^(?:项目)?画风\s*[·：:]?\s*/, "").trim() || styleNode.title,
            prompt: stylePrompt,
            profileJson: styleNode.metadata?.styleProfileJson,
        },
        characters: characterNodes.map((node) => ({
            assetId: node.metadata!.characterAssetId!.trim(),
            versionId: node.metadata!.characterVersionId!.trim(),
            name: (node.metadata?.characterName || node.title).trim(),
            definition: node.metadata?.characterDefinition || { prompt: node.metadata?.characterPrompt || "" },
        })),
    };
}

// Expose the same generation prerequisites to the Agent before it starts a workflow.
export function inspectStoryboardReadiness(nodes: CanvasNodeData[]) {
    let generationContext: StoryboardGenerationContext | undefined;
    let blockingReason: string | undefined;
    try { generationContext = resolveStoryboardGenerationContext(nodes); }
    catch (error) { blockingReason = error instanceof Error ? error.message : "Storyboard context not ready"; }
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    const styleReady = Boolean(styleNode?.metadata?.stylePresetId?.trim() && String(styleNode.metadata.content || styleNode.metadata.prompt || "").trim());
    const storyboards = nodes.filter((node) => node.type === "script").map((node) => {
        const rows = node.metadata?.storyboard?.rows || [];
        const incompleteRowIds = rows.filter((row) => !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0 || !row.videoMotionPrompt?.trim()).map((row) => row.id);
        return { nodeId: node.id, title: node.title, rowCount: rows.length, populated: rows.length > 0 && incompleteRowIds.length === 0, incompleteRowIds, totalDurationSeconds: rows.reduce((total, row) => total + (Number.isFinite(row.durationSeconds) && row.durationSeconds > 0 ? row.durationSeconds : 0), 0) };
    });
    return {
        canGenerateStoryboard: Boolean(generationContext), blockingReason,
        style: { ready: styleReady, nodeId: styleNode?.id, presetId: styleNode?.metadata?.stylePresetId, title: styleNode?.title },
        storyboards,
        nextActions: [
            ...(!styleReady ? ["First, canvas_list_styles reads the real style, and then calls canvas_apply_style based on the confirmed style; this tool will reuse or create style nodes. Only ask users when key style trade-offs are missing."] : []),
            ...(storyboards.some((item) => !item.populated) ? ["First, canvas_read_storyboard reads the real row ID, then canvas_edit_storyboard updates the empty row and adds new shots as needed; the text or title does not mean that the storyboard has been filled in."] : []),
        ],
    };
}
