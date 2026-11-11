import { AudioLines, Captions, Clapperboard, Download, FolderPlus, Images, Image as ImageIcon, Info, LoaderCircle, Lock, Maximize2, MessageSquare, Minus, Music2, Plus, RefreshCw, Scissors, Settings2, Trash2, Unlock, Upload, UserRound, Video, WandSparkles } from "lucide-react";

import { canRecoverOrRetryDepthCapture } from "@/lib/canvas/canvas-depth-capture";
import { canvasNodeFailureView } from "@/lib/canvas/canvas-node-failure-view";
import { registerToolbarTools, type ToolContext, type ToolDefinition } from "@/lib/canvas/tool-registry";
import { CanvasNodeType } from "@/types/canvas";
import { canOpenCanvasNodePromptPanel } from "@/lib/canvas/canvas-node-semantics";

// 节点状态判定辅助函数——从 ToolContext 派生
function isImage(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Image; }
function isVideo(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Video; }
function isAudio(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Audio; }
function isText(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Text; }
function isConfig(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Config; }
function hasMediaPayload(ctx: ToolContext) {
    return Boolean(ctx.nodeMetadata?.content || ctx.nodeMetadata?.storageKey || ctx.nodeMetadata?.previewContent);
}
function hasImage(ctx: ToolContext) { return isImage(ctx) && hasMediaPayload(ctx); }
function hasVideo(ctx: ToolContext) { return isVideo(ctx) && hasMediaPayload(ctx); }
function hasAudio(ctx: ToolContext) { return isAudio(ctx) && Boolean(ctx.nodeMetadata?.content || ctx.nodeMetadata?.storageKey); }
function isCharacterReference(ctx: ToolContext) { return isText(ctx) && ctx.nodeMetadata?.workflowKind === "character" && Boolean(ctx.nodeMetadata?.characterAssetId); }
function isEditableText(ctx: ToolContext) { return isText(ctx) && !isCharacterReference(ctx); }
function canOpenDialog(ctx: ToolContext) { return isEditableText(ctx) || ((isImage(ctx) || isVideo(ctx) || isAudio(ctx)) && canOpenCanvasNodePromptPanel(ctx.node)); }
function simpleMode(ctx: ToolContext) { return ctx.workspaceMode === "simple"; }
function isImageBatchRoot(ctx: ToolContext) { return isImage(ctx) && Boolean(ctx.nodeMetadata?.isBatchRoot && ctx.nodeMetadata.batchChildIds?.length); }
function opensSavedHistory(ctx: ToolContext) { return Boolean(ctx.node && canvasNodeFailureView(ctx.node).explanation.category === "result_target_unavailable"); }
function canRetry(ctx: ToolContext) {
    if (ctx.nodeMetadata?.fileUpload) return false;
    if (opensSavedHistory(ctx)) return ctx.nodeMetadata?.status === "error";
    if (ctx.node && canRecoverOrRetryDepthCapture(ctx.node)) return ctx.nodeMetadata?.status === "error";
    const blocked = Boolean(ctx.node && canvasNodeFailureView(ctx.node).regenerateBlocked);
    const batchHasFailures = isImageBatchRoot(ctx) && (ctx.nodeMetadata?.batchFailedCount || (ctx.nodeMetadata?.status === "error" ? 1 : 0)) > 0;
    return (ctx.nodeMetadata?.status === "error" || (batchHasFailures && ctx.nodeMetadata?.status !== "loading")) && !blocked;
}

export const nodeHoverToolbarTools: ToolDefinition[] = [
    // 基础工具组
    {
        id: "info",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => isCharacterReference(ctx) ? "View role details" : "View node information",
        displayLabel: (ctx) => isCharacterReference(ctx) ? "Role details" : "Node information",
        icon: (ctx) => isCharacterReference(ctx) ? <UserRound className="size-3.5" /> : <Info className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 10,
        nodeToolbar: {
            group: (ctx) => isCharacterReference(ctx) || (!isImage(ctx) && !isVideo(ctx) && !isAudio(ctx) && !isEditableText(ctx) && !isConfig(ctx)) ? "primary" : "more",
            order: 10,
            section: "Node management",
        },
        run: (ctx) => ctx.handlers.onNodeInfo(ctx.node!),
    },
    {
        id: "delete",
        toolbar: "node-hover",
        category: "node-state",
        label: "Remove node",
        displayLabel: "Remove node",
        icon: <Trash2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 20,
        nodeToolbar: { group: "more", order: 1000, section: "Dangerous operation" },
        danger: true,
        run: (ctx) => ctx.handlers.onNodeDelete(ctx.node!),
    },
    // 节点操作工具组——通过 applicable 谓词实现上下文感知
    {
        id: "retry",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => opensSavedHistory(ctx) ? "Retrieve original results from build history" : ctx.node && canRecoverOrRetryDepthCapture(ctx.node) && ctx.nodeMetadata?.taskStatus === "succeeded" ? "Restore the depth video of the original task" : isImageBatchRoot(ctx) ? "Retry failed images in batch" : "Regenerate",
        displayLabel: (ctx) => opensSavedHistory(ctx) ? "Build history" : ctx.node && canRecoverOrRetryDepthCapture(ctx.node) && ctx.nodeMetadata?.taskStatus === "succeeded" ? "Recovery results" : isImageBatchRoot(ctx) ? "Retry failed items" : "Try again",
        icon: <RefreshCw className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 30,
        nodeToolbar: { group: "primary", order: 5 },
        applicable: canRetry,
        run: (ctx) => ctx.handlers.onNodeRetry(ctx.node!),
    },
    {
        id: "extractFrames",
        workflow: { operationId: "video.frame", outputType: "image" },
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => ctx.extractingVideoFrames ? "Capturing keyframes" : "Capture the current frame, first frame or last frame",
        displayLabel: (ctx) => ctx.extractingVideoFrames ? "Processing" : "Key frame interception",
        icon: (ctx) => ctx.extractingVideoFrames ? <LoaderCircle className="size-3.5 animate-spin" /> : <Images className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 40,
        nodeToolbar: { group: "process", order: 10, section: "Extract material", description: "Select the picture and save it as a picture node" },
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingVideoFrames,
        run: (ctx) => ctx.handlers.onNodeExtractVideoFrames(ctx.node!),
    },
    {
        id: "extractAudio",
        workflow: { operationId: "video.audio", outputType: "audio" },
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => ctx.extractingAudio ? "Separating audio and video" : "Separate audio from video and generate independent audio nodes",
        displayLabel: (ctx) => ctx.extractingAudio ? "Processing" : "Audio and video separation",
        icon: (ctx) => ctx.extractingAudio ? <LoaderCircle className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 42,
        nodeToolbar: { group: "process", order: 20, section: "Extract material", description: "Generate audio nodes and retain the original video sound" },
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingAudio || ctx.trimmingVideo,
        run: (ctx) => ctx.handlers.onNodeExtractAudioFromVideo(ctx.node!),
    },
    {
        id: "trimRegenerate",
        workflow: { operationId: "video.trim", outputType: "video" },
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => ctx.trimmingVideo ? "Editing video" : "Trim one or more video clips",
        displayLabel: (ctx) => ctx.trimmingVideo ? "Processing" : "video clip",
        icon: (ctx) => ctx.trimmingVideo ? <LoaderCircle className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 44,
        nodeToolbar: { group: "primary", order: 10, description: "Intercept one or more segments and generate independent video nodes" },
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingAudio || ctx.trimmingVideo,
        run: (ctx) => ctx.handlers.onNodeTrimVideoSegments(ctx.node!),
    },
    {
        id: "cropVideo",
        workflow: { operationId: "video.crop", outputType: "video" },
        toolbar: "node-hover",
        category: "node-state",
        label: "Crop video screen",
        displayLabel: "Screen cropping",
        icon: <Scissors className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 46,
        // Keep the compact primary row focused on the two high-frequency
        // actions; crop remains available from the secondary menu.
        nodeToolbar: { group: "more", order: 30, section: "video processing", description: "Crop video footage proportionally" },
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.trimmingVideo,
        run: (ctx) => ctx.handlers.onNodeCropVideo(ctx.node!),
    },
    {
        id: "depthCapture",
        workflow: { operationId: "video.depth", outputType: "video" },
        toolbar: "node-hover",
        category: "node-state",
        label: "Generate depth motion reference video with near white and far black",
        displayLabel: "Deep motion capture",
        icon: <WandSparkles className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 47,
        nodeToolbar: { group: "more", order: 40, section: "video processing", description: "Locally generated depth reference video; components need to be downloaded for the first time, CPU processing may be slow" },
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.trimmingVideo,
        run: (ctx) => ctx.handlers.onNodeDepthCapture(ctx.node!),
    },
    {
        id: "saveAsset",
        toolbar: "node-hover",
        category: "node-state",
        label: "Add my material",
        displayLabel: "Save to library",
        icon: <FolderPlus className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 50,
        nodeToolbar: { group: "more", order: 40, section: "Material" },
        applicable: (ctx) => hasImage(ctx) || hasVideo(ctx) || isEditableText(ctx),
        run: (ctx) => ctx.handlers.onNodeSaveAsset(ctx.node!),
    },
    {
        id: "download",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => hasAudio(ctx) ? "Download audio" : hasVideo(ctx) ? "Download video" : "Download pictures",
        displayLabel: "Download",
        icon: <Download className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 60,
        nodeToolbar: { group: "utility", order: 20 },
        applicable: (ctx) => hasImage(ctx) || hasVideo(ctx) || hasAudio(ctx),
        run: (ctx) => ctx.handlers.onNodeDownload(ctx.node!),
    },
    {
        id: "edit",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => isEditableText(ctx) ? "Call text model to generate content" : "Edit",
        displayLabel: (ctx) => isEditableText(ctx) ? "text generation" : "Build settings",
        icon: <MessageSquare className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 70,
        nodeToolbar: { group: (ctx) => isEditableText(ctx) ? "primary" : "more", order: 20, section: "Generate information" },
        applicable: canOpenDialog,
        run: (ctx) => ctx.handlers.onNodeToggleDialog(ctx.node!),
    },
    {
        id: "editText",
        toolbar: "node-hover",
        category: "node-state",
        label: "Enlarge edit text",
        displayLabel: "EnlargeEdit",
        icon: <Maximize2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 80,
        nodeToolbar: { group: "primary", order: 30 },
        applicable: isEditableText,
        run: (ctx) => ctx.handlers.onNodeEditText(ctx.node!),
    },
    {
        id: "generateImage",
        toolbar: "node-hover",
        category: "node-state",
        label: "Use text to create pictures",
        displayLabel: "raw picture",
        icon: <ImageIcon className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 90,
        nodeToolbar: { group: "primary", order: 40 },
        applicable: isEditableText,
        run: (ctx) => ctx.handlers.onNodeGenerateImage(ctx.node!),
    },
    {
        id: "config",
        toolbar: "node-hover",
        category: "node-state",
        label: "Generate configuration",
        displayLabel: "Generate configuration",
        icon: <Settings2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 100,
        nodeToolbar: { group: "primary", order: 10 },
        applicable: (ctx) => isConfig(ctx) && !simpleMode(ctx),
        run: (ctx) => ctx.handlers.onNodeToggleDialog(ctx.node!),
    },
    {
        id: "decreaseFont",
        toolbar: "node-hover",
        category: "node-state",
        label: "Reduce font size",
        displayLabel: "zoom out",
        icon: <Minus className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 110,
        nodeToolbar: { group: "process", order: 10 },
        applicable: (ctx) => isEditableText(ctx) && !simpleMode(ctx),
        run: (ctx) => ctx.handlers.onNodeDecreaseFont(ctx.node!),
    },
    {
        id: "increaseFont",
        toolbar: "node-hover",
        category: "node-state",
        label: "Increase font size",
        displayLabel: "Zoom in",
        icon: <Plus className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 120,
        nodeToolbar: { group: "process", order: 20 },
        applicable: (ctx) => isEditableText(ctx) && !simpleMode(ctx),
        run: (ctx) => ctx.handlers.onNodeIncreaseFont(ctx.node!),
    },
    {
        id: "uploadImage",
        toolbar: "node-hover",
        category: "node-state",
        label: "Upload pictures",
        displayLabel: "Upload pictures",
        icon: <Upload className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 130,
        nodeToolbar: { group: "primary", order: 10 },
        applicable: (ctx) => isImage(ctx) && !hasImage(ctx),
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    {
        id: "uploadVideo",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => hasVideo(ctx) ? "Replace video" : "Upload video",
        displayLabel: (ctx) => hasVideo(ctx) ? "Replace video" : "Upload video",
        icon: <Video className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 140,
        nodeToolbar: { group: (ctx) => hasVideo(ctx) ? "more" : "primary", order: 45, section: "Material" },
        // Empty video nodes are generation composers, not upload targets. Keep
        // the upload affordance only for an existing video where it is a
        // deliberate "replace" action; the empty node should expose its
        // prompt composer below the node instead of an upload action above it.
        applicable: hasVideo,
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    {
        id: "subtitles",
        workflow: { mode: "manual", reason: "Subtitle editing requires manual confirmation and can be input as fixed material after completion." },
        toolbar: "node-hover",
        category: "node-state",
        label: "Edit subtitles",
        displayLabel: "subtitles",
        icon: <Captions className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 145,
        nodeToolbar: { group: "primary", order: 20 },
        applicable: (ctx) => hasVideo(ctx) || hasAudio(ctx),
        run: (ctx) => ctx.handlers.onNodeSubtitles(ctx.node!),
    },
    {
        id: "timeline",
        workflow: { mode: "manual", reason: "The timeline is an interactive editor that takes export results as input and automatically splices them using video merging." },
        toolbar: "node-hover",
        category: "node-state",
        label: "Timeline editing",
        displayLabel: "Go to clip",
        icon: <Clapperboard className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 148,
        nodeToolbar: { group: "workspace", order: 30, section: "Project clip", description: "Open the project timeline and locate the current material" },
        applicable: (ctx) => hasVideo(ctx) || hasAudio(ctx),
        run: (ctx) => ctx.handlers.onNodeTimeline(ctx.node!),
    },
    {
        id: "uploadAudio",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => hasAudio(ctx) ? "Replace audio" : "Upload audio",
        displayLabel: (ctx) => hasAudio(ctx) ? "Replace audio" : "Upload audio",
        icon: <Music2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 150,
        nodeToolbar: { group: (ctx) => hasAudio(ctx) ? "more" : "primary", order: 45, section: "Material" },
        applicable: isAudio,
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    // 节点锁定——独立分类，自动插入前置分隔符
    {
        id: "node-lock",
        toolbar: "node-hover",
        category: "navigation",
        label: (ctx) => ctx.nodeMetadata?.locked ? "Unlock node" : "Lock position and size",
        displayLabel: "Lock position and size",
        icon: (ctx) => ctx.nodeMetadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 160,
        nodeToolbar: { group: "more", order: 900, section: "Node management" },
        active: (ctx) => Boolean(ctx.nodeMetadata?.locked),
        run: (ctx) => ctx.handlers.onNodeToggleLocked(ctx.node!),
    },
];

registerToolbarTools(nodeHoverToolbarTools);
