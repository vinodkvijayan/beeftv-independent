import type { GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import { formatVideoResolutionLabel as videoResolutionLabel, VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import type { CreationAttachment, CreationMode } from "./creation-assets";
import type { CreationReference } from "./creation-references";

export type { CreationMode };

export type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
export type CreationSettings = { ratio: string; seconds: string; quality: string; videoQuality: string; count: string };
export type CreationRetryContext = GenerationRetryContext & { retryContextsByBatchIndex?: GenerationRetryContext[] };

export type CreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: CreationMode;
    content: string;
    reasoning?: string;
    createdAt: string;
    status?: CreationStatus;
    model?: string;
    resultUrls?: string[];
    error?: string;
    generationErrorSummary?: string;
    generationErrorCode?: string;
    generationProviderCode?: string;
    taskFailureDiagnostics?: import("@/lib/generation-error").GenerationFailureDiagnostics;
    generationOperation?: string;
    attachments?: CreationAttachment[];
    references?: CreationReference[];
    settings?: CreationSettings;
    taskIds?: string[];
    clientOperationId?: string;
    retryOf?: string;
    attemptGroupId?: string;
    generationStage?: string;
    generationEffectKeys?: string[];
    taskOutcome?: import("@/lib/task-outcome").TaskOutcome;
};
export type CreationConversationConflict = {
    revision: number;
    document: CreationConversation;
};

export type CreationConversation = {
    id: string;
    title: string;
    updatedAt: string;
    canvasId?: string;
    messages: CreationMessage[];
    conflictRemote?: CreationConversationConflict;
};

export const modeLabels: Record<CreationMode, string> = { text: "text", image: "pictures", video: "video" };
// LibTV 的创作入口以“镜头/视频”作为首次进入的主路径；用户切换后的模式
// 仍由本地偏好记忆，因此这里只影响没有历史偏好的新工作区。
export const defaultCreationMode: CreationMode = "video";
export const shotScriptLabels: Record<CreationMode, string> = { text: "creative ideas", image: "screen command", video: "shot script" };
export const ratioOptions = [
    { value: "1:1", label: "square" },
    { value: "16:9", label: "Horizontal screen" },
    { value: "9:16", label: "Vertical screen" },
    { value: "4:3", label: "Standard landscape screen" },
    { value: "3:4", label: "Standard vertical screen" },
    { value: "21:9", label: "widescreen" },
];
export const qualityOptions = [
    { value: "auto", label: "automatic", description: "Determined by model" },
    { value: "low", label: "Low", description: "Build faster" },
    { value: "medium", label: "Medium", description: "equilibrium mode" },
    { value: "high", label: "High", description: "Prioritize details" },
    { value: "xhigh", label: "super high", description: "More details, slower generation" },
    { value: "max", label: "highest", description: "Highest quality, slower generation" },
    // grok2api / xAI Imagine：quality 映射 resolution
    { value: "1k", label: "1K", description: "standard definition" },
    { value: "2k", label: "2K", description: "higher definition" },
];
export const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
export const countOptions = ["1", "2", "3", "4"];
export const conversationTimeFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const messageTimeFormatter = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

export const historyDayFormatter = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" });

export type CreationShotRailEntry = { key: string; ordinal: number; user: CreationMessage; result?: CreationMessage };
