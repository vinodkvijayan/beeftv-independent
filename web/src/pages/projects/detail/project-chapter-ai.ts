import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { storyboardRowsFromTask, storyboardRowsOutputContract } from "@/lib/canvas/canvas-project-domain";
import { parseChapterAssetBreakdown, type ChapterAssetBreakdown } from "@/lib/canvas/chapter-asset-breakdown";
import { parseCharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import { backendProviderConfig, parseBackendGenerationResult } from "@/services/api/generation-task";
import { createGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { Skill } from "@/services/api/skills";
import { skillRuntime } from "@/services/skill-runtime";
import { logicalModelIDForConfig, type AiConfig } from "@/stores/use-config-store";

import type { ChapterStoryboardAsset, ChapterStoryboardCharacter } from "./chapter-storyboard-production";

type ChapterAnalysisInput = {
    projectId: string;
    projectName: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: string;
    config: AiConfig;
};

type ChapterTaskOptions = {
    onTaskUpdate?: (task: GenerationTask) => void;
};

export type ChapterTaskKind = "characters" | "storyboard";

export type ChapterStoryboardApprovalSnapshot = {
    revision: number;
    shotIds: string[];
};

export type ChapterStoryboardRecoveryDecision =
    | { action: "skip" }
    | { action: "review" };

export function chapterTaskIdentity(task: GenerationTask): { chapterId: string; kind: ChapterTaskKind } | null {
    const context = task.clientContext;
    if (context?.chapterId && (context.chapterOperation === "characters" || context.chapterOperation === "storyboard")) {
        return { chapterId: context.chapterId, kind: context.chapterOperation };
    }
    const metadata = generationTaskMetadata(task.inputJson);
    const chapterId = typeof metadata.chapterId === "string" ? metadata.chapterId : "";
    if (!chapterId) return null;
    if (metadata.operation === "chapter_character_breakdown") return { chapterId, kind: "characters" };
    if (metadata.source === "short-drama-chapter-storyboard") return { chapterId, kind: "storyboard" };
    return null;
}

export function chapterAssetsFromGenerationTask(task: GenerationTask) {
    const result = parseBackendGenerationResult(task);
    if (!result.text?.trim()) throw new Error("Model did not return usable chapter asset extraction results");
    // 历史角色任务的输出契约只有角色；仅按明确的模板操作恢复，不能给新任务缺字段兜底。
    if (generationTaskMetadata(task.inputJson).promptTemplateOperation === PromptTemplateOperation.CharacterExtract) {
        return { characters: parseCharacterBreakdown(result.text), scenes: [], props: [] };
    }
    return parseChapterAssetBreakdown(result.text);
}

export function chapterStoryboardFromGenerationTask(task: GenerationTask) {
    return storyboardRowsFromTask(task);
}

export function chapterStoryboardApprovalSnapshot(inputJson?: string): ChapterStoryboardApprovalSnapshot | null {
    const metadata = generationTaskMetadata(inputJson);
    const revision = metadata.approvedRevision;
    const shotIds = metadata.approvedShotIds;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision <= 0) return null;
    if (!Array.isArray(shotIds) || !shotIds.every((id) => typeof id === "string")) return null;
    return { revision, shotIds: shotIds.slice() };
}

export function chapterStoryboardRecoveryDecision(input: { alreadyApplied: boolean }): ChapterStoryboardRecoveryDecision {
    if (input.alreadyApplied) return { action: "skip" };
    return { action: "review" };
}

export async function extractChapterAssets(input: ChapterAnalysisInput, options?: ChapterTaskOptions): Promise<ChapterAssetBreakdown & { taskId: string }> {
    const result = await runProjectTextTask(input, "chapter_character_breakdown", {
        项目名称: input.projectName,
        章节名称: input.chapterTitle,
        项目画风: input.projectStyle || "The project has not yet specified a style, keeping the visual description neutral and executable.",
        章节正文: input.sourceText,
    }, options);
    return { ...parseChapterAssetBreakdown(result.text), taskId: result.taskId };
}

type ChapterStoryboardGenerationInput = {
    projectId: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: { presetId: string; title: string; prompt: string; profileJson?: string };
    characters: ChapterStoryboardCharacter[];
    assets: ChapterStoryboardAsset[];
    config: AiConfig;
    skills: Skill[];
    selectedSkillIds: string[];
    approvedRevision: number;
    approvedShotIds: string[];
};

export async function generateChapterStoryboard(input: ChapterStoryboardGenerationInput, options?: ChapterTaskOptions) {
    if (!Number.isInteger(input.approvedRevision) || input.approvedRevision <= 0) {
        throw new Error("Please refresh and regenerate the components.");
    }
    if (!Array.isArray(input.approvedShotIds) || input.approvedShotIds.some((id) => typeof id !== "string")) {
        throw new Error("Please refresh and regenerate the components.");
    }
    const model = input.config.textModel || input.config.model;
    const config = { ...input.config, model };
    const skillExecution = await skillRuntime.prepare({
        profile: "shortDrama",
        prompt: [
            `Chapter:${input.chapterTitle}`,
            input.sourceText,
            "Please disassemble this chapter into a shot script that can be directly used in the storyboard production of the short drama, keeping the plot cause and effect, character relationships, key actions and lines intact.",
        ].join("\n\n"),
        skills: input.skills,
        selectedSkillIds: input.selectedSkillIds,
    });
    // 技能上下文只描述工作流，不会约束输出结构；必须显式带上输出契约，否则模型返回 Markdown 表格。
    const prompt = [
        skillExecution.prompt,
        storyboardRowsOutputContract("Each shot must be independently used to generate the first frame image and shot video."),
    ].join("\n\n");
    const task = await createGenerationTask({
        projectId: input.projectId,
        type: "canvas_text",
        operation: "storyboard",
        prompt,
        model,
        ...(logicalModelIDForConfig(config) ? { logicalModelId: logicalModelIDForConfig(config) } : {}),
        input: {
            // 后端只在 video_ 前缀的任务上兜底 mode，文本任务必须显式带上。
            mode: "text",
            canvasAssets: input.assets,
            requirements: "The output can be written directly to storyboards and continue to generate storyboards for storyboards, action revises, and shot videos.",
            projectStyle: input.projectStyle,
            characters: input.characters,
            shotDurationSeconds: 0,
            shotCount: 0,
            config: backendProviderConfig(config),
            metadata: {
                domainProjectId: input.projectId,
                chapterId: input.chapterId,
                source: "short-drama-chapter-storyboard",
                ...skillExecution.metadata,
                approvedRevision: input.approvedRevision,
                approvedShotIds: input.approvedShotIds.slice(),
            },
        },
    });
    options?.onTaskUpdate?.(task);
    const completed = await waitForGenerationTask(task.id, { initialTask: task, useTextEvents: true, onTaskUpdate: options?.onTaskUpdate });
    return { ...storyboardRowsFromTask(completed), skillCount: skillExecution.selectedSkills.length, taskId: completed.id };
}

async function runProjectTextTask(input: ChapterAnalysisInput, operation: string, promptTemplateVariables: Record<string, string>, options?: ChapterTaskOptions) {
    const model = input.config.textModel || input.config.model;
    let taskId = "";
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `${operation}:${input.chapterId}`,
        mode: "text",
        prompt: promptTemplateTaskPlaceholder("Extraction of chapter characters, scenes and props"),
        config: { ...input.config, model },
        metadata: { domainProjectId: input.projectId, chapterId: input.chapterId, operation, promptTemplateOperation: PromptTemplateOperation.ChapterAssetsExtract, promptTemplateVariables },
        onTaskCreated: (task) => {
            taskId = task.id;
            options?.onTaskUpdate?.(task);
        },
    });
    if (!result.text?.trim()) throw new Error("Model returned no usable results");
    if (!taskId) throw new Error("Generate task identity missing");
    return { text: result.text, taskId };
}

function generationTaskMetadata(inputJson?: string): Record<string, unknown> {
    if (!inputJson) return {};
    try {
        const input = JSON.parse(inputJson) as { metadata?: unknown };
        return input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : {};
    } catch {
        return {};
    }
}
