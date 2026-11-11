import { App, Button, Dropdown, Input, InputNumber, Modal, Segmented, Select, Table } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { CheckboxGroup } from "@/components/ui/base/checkbox";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronDown, ChevronUp, Clapperboard, Copy, Expand, Film, Grid3X3, Image as ImageIcon, ListTree, Merge, MoreHorizontal, Plus, RefreshCw, Send, Square, Trash2, Upload, Video } from "lucide-react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { StoryboardAssetsCell } from "@/components/canvas/storyboard-assets-cell";
import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { extractScriptDocumentText, SCRIPT_DOCUMENT_ACCEPT } from "@/lib/canvas/script-document-import";
import { resolveStoryboardVisibleColumns, storyboardContentColumn, STORYBOARD_CONTENT_COLUMNS, type StoryboardContentColumn } from "@/lib/canvas/canvas-storyboard-columns";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { pipelineStatusLabel, type CanvasStoryboardPipelineProgress, type StoryboardPipelineStage } from "@/lib/canvas/canvas-storyboard-progress";
import { generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import { navigateToSettings } from "@/lib/settings-navigation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { STORYBOARD_COMPOSER_MIN_HEIGHT, STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/lib/canvas/canvas-storyboard-layout";
import type {
    CanvasGenerationBatch,
    CanvasGenerationBatchItem,
    CanvasGenerationBatchItemStatus,
    CanvasNodeData,
    CanvasNodeStatus,
    CanvasWorkspaceMode,
    StoryboardColumn,
    StoryboardRow,
    StoryboardShotCount,
    StoryboardShotDuration,
    StoryboardVideoInputMode,
} from "@/types/canvas";
import type { TaskStatus } from "@/services/api/task-center";
import { workspaceCapabilities } from "@/services/workspace-mode";

const STORYBOARD_PROMPT_MIN_HEIGHT = 40;
const STORYBOARD_PROMPT_MAX_HEIGHT = 116;
const SCRIPT_GRID_TEMPLATE = "64px 76px minmax(300px, 1.55fr) minmax(220px, 1fr) 180px";
const EMPTY_STORYBOARD_ROWS: StoryboardRow[] = [];

const columnOptions: Array<{ label: string; value: StoryboardColumn }> = [
    { label: "serial number", value: "shotNumber" },
    { label: "duration", value: "durationSeconds" },
    { label: "Screen description", value: "plotDescription" },
    { label: "Lines/narration", value: "dialogue" },
    { label: "shot intention", value: "narrativeIntent" },
    { label: "Audience point of view", value: "viewerPOV" },
    { label: "Scheduling", value: "performanceBlocking" },
    { label: "Scenery farewell", value: "shotSize" },
    { label: "emotions", value: "emotion" },
    { label: "light and shadow atmosphere", value: "lightingAndAtmosphere" },
    { label: "Sound effects", value: "audioEffects" },
    { label: "lens design", value: "camera" },
    { label: "Movement of the mirror", value: "motion" },
    { label: "time beat", value: "timeBeats" },
    { label: "Picture prompt words", value: "imageGenerationPrompt" },
    { label: "Video prompt words", value: "videoMotionPrompt" },
    { label: "Related assets", value: "assets" },
    { label: "continuity export", value: "continuityOut" },
    { label: "Negative requirements", value: "negativePrompt" },
];

export function CanvasScriptNodeContent({
    node,
    nodes,
    batch,
    pipeline,
    scale,
    mentionReferences,
    onOpen,
    onCreateImageNodes,
    onCreateVideoNodes,
    onGenerateImages,
    onGenerateVideos,
    onVideoInputModeChange,
    onMergeVideos,
    onCreateActionBoards,
    onRetryBatch,
    onRetryBatchItem,
    onStopBatch,
    onAddRow,
    onRemoveRow,
    onUpdateRow,
    onPromptChange,
    onGenerateScript,
    onModelChange,
    onShotDurationChange,
    onShotCountChange,
    onComposerHeightChange,
    onConnectStart,
    onScrollTopChange,
    workspaceMode = "professional",
}: {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    batch?: CanvasGenerationBatch;
    pipeline: CanvasStoryboardPipelineProgress;
    scale: number;
    mentionReferences: CanvasResourceReference[];
    onOpen: () => void;
    onCreateImageNodes: () => void;
    onCreateVideoNodes: () => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
    onVideoInputModeChange: (mode: StoryboardVideoInputMode) => void;
    onMergeVideos: () => void;
    onCreateActionBoards: () => void;
    onRetryBatch: (batchId: string) => void;
    onRetryBatchItem: (batchId: string, itemId: string) => void;
    onStopBatch: (batchId: string) => void;
    onAddRow: () => void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<StoryboardRow>) => void;
    onPromptChange: (prompt: string) => void;
    onGenerateScript: (prompt: string) => void;
    onModelChange: (model: string) => void;
    onShotDurationChange: (duration: StoryboardShotDuration) => void;
    onShotCountChange: (count: StoryboardShotCount) => void;
    onComposerHeightChange: (height: number) => void;
    onConnectStart: (event: ReactPointerEvent, rowId: string, handleType: "source" | "target") => void;
    onScrollTopChange: (scrollTop: number) => void;
    workspaceMode?: CanvasWorkspaceMode;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const effectiveConfig = useEffectiveConfig();
    const generationConfig = buildGenerationConfig(effectiveConfig, node, "text");
    const simpleMode = workspaceMode === "simple";
    const rows = node.metadata?.storyboard?.rows || [];
    const [selectedContent, setSelectedContent] = useState<{ nodeId: string; column: StoryboardContentColumn } | null>(null);
    const contentColumn = selectedContent?.nodeId === node.id ? selectedContent.column : storyboardContentColumn(rows);
    const [prompt, setPrompt] = useState(node.metadata?.composerContent || "");
    const [scrollTop, setScrollTop] = useState(0);
    const composerHeightChangeRef = useRef(onComposerHeightChange);
    const composerHeight = node.metadata?.storyboardComposerHeight || STORYBOARD_COMPOSER_MIN_HEIGHT;
    // Mounting an unchanged default layout must not save a new canvas revision.
    const reportedComposerHeightRef = useRef(composerHeight);
    const tableHeight = storyboardTableHeight(node.height, composerHeight);
    const totalDuration = rows.reduce((sum, row) => sum + (Number(row.durationSeconds) || 0), 0);
    const shotDuration = node.metadata?.storyboardShotDuration || "auto";
    const shotCount = node.metadata?.storyboardShotCount || "auto";
    const videoInputMode = node.metadata?.storyboardVideoInputMode || "direct";
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const batchSummary = batch ? generationBatchSummary(batch) : null;
    const hasFailedBatchItems = Boolean(batch?.items.some((item) => item.status === "failed"));
    const hasWaitingBatchItems = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting"));
    const hasActiveBatchItems = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting" || item.status === "queued" || item.status === "running"));
    const taskStatus = node.metadata?.taskStatus;
    const displayStatus: TaskStatus = taskStatus === "queued" || taskStatus === "succeeded" || taskStatus === "failed" || taskStatus === "cancelled" ? taskStatus : "running";
    const displayTask = node.metadata?.taskId
        ? {
              provider: node.metadata.taskProvider,
              status: displayStatus,
              stage: node.metadata.taskStage,
              officialStatus: node.metadata.taskOfficialStatus,
              errorCode: node.metadata.taskErrorCode,
          }
        : null;
    const nodeErrorCode = node.metadata?.generationErrorCode || node.metadata?.taskErrorCode;
    const taskFeedback =
        node.metadata?.status === "loading"
            ? displayTask
                ? `${generationTaskStageLabel(displayTask)}${generationTaskShowsProgress(displayTask) && typeof node.metadata.taskProgress === "number" ? ` · ${node.metadata.taskProgress}%` : ""}`
                : "Creating task"
            : node.metadata?.status === "error"
              ? generationErrorMessage(nodeErrorCode ? { code: nodeErrorCode, message: node.metadata.errorDetails } : node.metadata.errorDetails)
              : "";
    const [batchDetailsOpen, setBatchDetailsOpen] = useState(false);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const { message } = App.useApp();
    const scriptFileInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (typeof node.metadata?.composerContent === "string") setPrompt(node.metadata.composerContent);
    }, [node.metadata?.composerContent]);
    const openScriptFilePicker = () => scriptFileInputRef.current?.click();
    const handleScriptFileChange = async (file?: File | null) => {
        if (!file) return;
        try {
            const result = await extractScriptDocumentText(file);
            setPrompt(result.content);
            onPromptChange(result.content);
            message?.success?.(`The script has been imported "${result.title}」`);
        } catch (error) {
            message?.error?.(error instanceof Error ? error.message : "Failed to import script file");
        }
    };
    const pipelineDisabled = !rows.length || node.metadata?.status === "loading" || hasActiveBatchItems;
    const missingImages = Math.max(0, pipeline.images.total - pipeline.images.created);
    const missingVideos = Math.max(0, pipeline.videos.total - pipeline.videos.created);
    const canMerge = pipeline.successfulVideoNodeIds.length >= 2 && pipeline.final.success === 0;
    const allRowIds = pipeline.rows.map((item) => item.row.id);
    const moreMenuItems: MenuProps["items"] = [
        { key: "import-script-doc", icon: <Upload className="size-3.5" />, label: "Import script files (.docx/.txt/.md)", onClick: openScriptFilePicker },
        { type: "divider" },
        { key: "generate-images", icon: <ImageIcon className="size-3.5" />, label: "Generate unfinished storyboards", disabled: pipelineDisabled || pipeline.images.incomplete === 0, onClick: () => onGenerateImages(allRowIds) },
        { key: "generate-videos", icon: <Video className="size-3.5" />, label: "Generate unfinished video", disabled: pipelineDisabled || pipeline.videos.incomplete === 0, onClick: () => onGenerateVideos(allRowIds) },
        {
            key: "merge",
            icon: <Merge className="size-3.5" />,
            label: pipeline.final.success ? "The film is completed" : pipeline.successfulVideoNodeIds.length >= 2 ? `merge${pipeline.successfulVideoNodeIds.length} video` : "Merge into a video (at least 2 videos)",
            disabled: !canMerge,
            onClick: () => onMergeVideos(),
        },
        { type: "divider" },
        {
            key: "video-input",
            icon: <Film className="size-3.5" />,
            label: "Video input mode",
            children: [
                { key: "video-input-direct", label: videoInputMode === "direct" ? "✓ Generate directly" : "Generate directly", onClick: () => onVideoInputModeChange("direct") },
                { key: "video-input-keyframe", label: videoInputMode === "keyframe" ? "✓ Do the first frame first" : "Do the first frame first", onClick: () => onVideoInputModeChange("keyframe") },
            ],
        },
        ...(!simpleMode
            ? [
                  { type: "divider" as const },
                  { key: "create-image-nodes", icon: <Grid3X3 className="size-3.5" />, label: missingImages ? `create${missingImages} image nodes` : "Image node has been created", disabled: pipelineDisabled || missingImages === 0, onClick: () => onCreateImageNodes() },
                  { key: "create-video-nodes", icon: <Film className="size-3.5" />, label: missingVideos ? `create${missingVideos} video nodes` : "Video node has been created", disabled: pipelineDisabled || missingVideos === 0, onClick: () => onCreateVideoNodes() },
                  { key: "action-boards", icon: <Grid3X3 className="size-3.5" />, label: "Generate action split into 12 square grids", disabled: !rows.length || hasActiveBatchItems, onClick: () => onCreateActionBoards() },
              ]
            : []),
        ...(batch
            ? [
                  { type: "divider" as const },
                  { key: "retry", icon: <RefreshCw className="size-3.5" />, label: "Retry failed items", disabled: !hasFailedBatchItems, onClick: () => onRetryBatch(batch.id) },
                  { key: "stop", icon: <Square className="size-3.5" />, label: "Stop remaining tasks", disabled: !hasWaitingBatchItems, onClick: () => onStopBatch(batch.id) },
                  { key: "details", icon: <ListTree className="size-3.5" />, label: "View batch details", onClick: () => setBatchDetailsOpen(true) },
              ]
            : []),
    ];
    const submitPrompt = () => {
        const value = prompt.trim();
        if (value && node.metadata?.status !== "loading") onGenerateScript(value);
    };
    useLayoutEffect(() => {
        composerHeightChangeRef.current = onComposerHeightChange;
    }, [onComposerHeightChange]);
    const resizePrompt = useCallback((contentHeight: number) => {
        const promptHeight = Math.min(STORYBOARD_PROMPT_MAX_HEIGHT, Math.max(STORYBOARD_PROMPT_MIN_HEIGHT, contentHeight));
        const composerHeight = promptHeight + 64;
        if (reportedComposerHeightRef.current === composerHeight) return;
        reportedComposerHeightRef.current = composerHeight;
        composerHeightChangeRef.current(composerHeight);
    }, []);

    return (
        <div className="relative flex h-full w-full flex-col overflow-visible" style={{ color: theme.node.text }} onDoubleClick={(event) => event.stopPropagation()}>
            <div className="relative flex h-10 shrink-0 items-center gap-2 rounded-t-[17px] border-b px-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <Clapperboard className="size-4" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={node.title || "Storyboard"}>
                    {node.title || "Storyboard"}
                </span>
                {batchSummary ? (
                    <span className="min-w-0 max-w-[42%] truncate text-[var(--fs-label)] font-medium" title={batchSummary} style={{ color: batch?.status === "partial_failed" ? theme.accent.danger : theme.node.muted }}>
                        {batchSummary}
                    </span>
                ) : taskFeedback ? (
                    <span className="min-w-0 max-w-[38%] truncate text-[var(--fs-label)] font-medium" title={taskFeedback} style={{ color: node.metadata?.status === "error" ? theme.accent.danger : theme.node.muted }}>
                        {taskFeedback}
                    </span>
                ) : null}
                <span className="text-[var(--fs-caption)] font-semibold tabular-nums" style={{ color: theme.node.muted }}>
                    {rows.length}  mirror ·{totalDuration}s
                </span>
                <input ref={scriptFileInputRef} type="file" accept={SCRIPT_DOCUMENT_ACCEPT} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void handleScriptFileChange(file); }} />
                <Tooltip title="Import script (.docx/.txt/.md)">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                        style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); openScriptFilePicker(); }}
                        aria-label="Import script"
                    >
                        <Upload className="size-3.5" />
                    </button>
                </Tooltip>
                <Tooltip title="Full screen editing">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                        style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen();
                        }}
                        aria-label="Full screen editing"
                    >
                        <Expand className="size-3.5" />
                    </button>
                </Tooltip>
                <Dropdown open={moreMenuOpen} onOpenChange={setMoreMenuOpen} menu={{ items: moreMenuItems, onClick: () => setMoreMenuOpen(false) }} trigger={["click"]} placement="bottomRight">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                        style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            setMoreMenuOpen(true);
                        }}
                        aria-label="More actions"
                    >
                        <MoreHorizontal className="size-3.5" />
                    </button>
                </Dropdown>
            </div>
            {batch ? (
                <Modal title="Batch details" open={batchDetailsOpen} onCancel={() => setBatchDetailsOpen(false)} footer={null} width={560} centered destroyOnHidden>
                    <GenerationBatchDetails batch={batch} rows={rows} onRetryItem={(itemId) => onRetryBatchItem(batch.id, itemId)} />
                </Modal>
            ) : null}
            <StoryboardMiniPipeline pipeline={pipeline} theme={theme} rows={rows} />
            <div className="storyboard-header-gutter grid h-9 shrink-0 items-center border-b text-xs font-semibold" style={{ borderColor: theme.node.stroke, color: theme.node.muted, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                <HeaderCell borderColor={theme.node.stroke} align="center">
                    serial number
                </HeaderCell>
                <HeaderCell borderColor={theme.node.stroke} align="center">duration</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>
                    <select
                        aria-label="Storyboard content column"
                        className="min-w-0 bg-transparent text-xs outline-none focus-visible:ring-1"
                        value={contentColumn}
                        onChange={(event) => setSelectedContent({ nodeId: node.id, column: event.target.value as StoryboardContentColumn })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        {STORYBOARD_CONTENT_COLUMNS.map(column => <option key={column.value} value={column.value}>{column.label}</option>)}
                    </select>
                </HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>Lines/narration</HeaderCell>
                <span className="px-3">Related assets</span>
            </div>
            <div
                data-canvas-wheel-scroll
                tabIndex={0}
                role="region"
                aria-label="Storyboard shot list"
                className="storyboard-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset"
                style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                onScroll={(event) => {
                    const next = event.currentTarget.scrollTop;
                    setScrollTop(next);
                    onScrollTopChange(next);
                }}
                onWheel={(event) => event.stopPropagation()}
            >
                {rows.length ? (
                    rows.map((row) => (
                        <div key={row.id} className="relative grid border-b" style={{ height: STORYBOARD_ROW_HEIGHT, borderColor: theme.node.stroke, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                            <div className="flex flex-col items-center justify-center gap-0.5 border-r tabular-nums" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}>
                                <div className="flex items-center gap-0.5">
                                    <span className="text-sm">{row.shotNumber}</span>
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{ items: [{ key: "delete", label: "delete shot", icon: <Trash2 className="size-3.5" />, danger: true, disabled: rows.length <= 1, onClick: () => onRemoveRow(row.id) }] }}
                                    >
                                        <button
                                            type="button"
                                            className="grid size-5 place-items-center rounded outline-none opacity-45 transition hover:bg-black/5 hover:opacity-100 focus-visible:ring-2 dark:hover:bg-white/10"
                                            aria-label={`lens${row.shotNumber} Operation`}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <MoreHorizontal className="size-3" />
                                        </button>
                                    </Dropdown>
                                </div>
                                {batchItemByRowId.get(row.id) ? (
                                    <span className="max-w-14 truncate text-[var(--fs-micro)] leading-3" title={generationBatchItemLabel(batchItemByRowId.get(row.id)!)}>
                                        {generationBatchItemLabel(batchItemByRowId.get(row.id)!)}
                                    </span>
                                ) : null}
                            </div>
                            <CompactDurationInput value={row.durationSeconds} borderColor={theme.node.stroke} onChange={(durationSeconds) => onUpdateRow(row.id, { durationSeconds })} />
                            <CompactInput value={row[contentColumn]} placeholder={contentColumn === "videoMotionPrompt" ? "Describe video movement, shots, and actions" : contentColumn === "imageGenerationPrompt" ? "Describe the first frame" : "Describe what happened in this shot"} onChange={(value) => onUpdateRow(row.id, { [contentColumn]: value })} borderColor={theme.node.stroke} />
                            <CompactInput value={row.dialogue} placeholder="lines or narration" onChange={(value) => onUpdateRow(row.id, { dialogue: value })} borderColor={theme.node.stroke} />
                            <div className="flex h-full min-w-0 items-center px-3">
                                <StoryboardAssetsCell bindings={row.assetBindings || []} nodes={nodes} />
                            </div>
                        </div>
                    ))
                ) : (
                    <button
                        type="button"
                        className="grid h-full min-h-36 w-full place-items-center"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onAddRow();
                        }}
                    >
                        <span className="flex flex-col items-center gap-2.5">
                            <span className="text-sm font-bold">+ Add first shot</span>
                            <span className="text-[var(--fs-label)] font-medium" style={{ color: theme.node.faint }}>
                                                                You can first connect the "Story Summary/Project Style" node, or enter the prompt below to generate a storyboard with one click.
                            </span>
                            <span
                                role="button"
                                tabIndex={0}
                                className="text-[var(--fs-label)] font-medium underline underline-offset-2 opacity-80 transition hover:opacity-100"
                                style={{ color: theme.accent.primary }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => { event.stopPropagation(); openScriptFilePicker(); }}
                                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openScriptFilePicker(); } }}
                            >
                                                                Or click to import .docx / .txt script file
                            </span>
                        </span>
                    </button>
                )}
            </div>
            <div className="flex h-9 shrink-0 items-center justify-center border-b" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                    style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onAddRow();
                    }}
                >
                    <Plus className="size-3.5" />
                                        Add row
                </button>
            </div>
            <div className="relative grid shrink-0 grid-rows-[minmax(0,1fr)_28px] gap-1.5 rounded-b-[17px] p-2.5" style={{ height: composerHeight, background: theme.node.panel }}>
                <CanvasResourceMentionTextarea
                    rows={1}
                    references={mentionReferences}
                    aria-label="Storyboard plot and project setting"
                    containerClassName="h-full min-h-0 overflow-hidden"
                    className="thin-scrollbar h-full min-h-0 w-full touch-pan-y resize-none overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border bg-transparent px-3 py-2 text-sm leading-5 outline-none transition placeholder:opacity-45 focus:ring-1"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    value={prompt}
                    placeholder="Enter the script or plot, as well as the total duration and other requirements, and it will be automatically split into shots."
                    onContentSizeChange={resizePrompt}
                    onChange={(value) => {
                        setPrompt(value);
                        onPromptChange(value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            submitPrompt();
                        }
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
                <div className="flex min-w-0 items-center justify-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Tooltip title="Script generation requires text understanding and structured output capabilities, and only text models are displayed; video/picture models cannot generate storyboards" placement="topLeft">
                        <div className="mr-auto min-w-36 max-w-56 flex-1">
                            <ModelPicker
                                className="!h-7 !w-full !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                                fullWidth
                                config={generationConfig}
                                value={generationConfig.model}
                                capability="text"
                                placeholder="Select text model"

                                onChange={onModelChange}
                                onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            />
                        </div>
                    </Tooltip>
                    {simpleMode ? (
                        <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                                        Automatic split · automatic duration
                        </span>
                    ) : (
                        <Select<StoryboardShotCount>
                            className="min-w-24"
                            size="small"
                            value={shotCount}
                            disabled={node.metadata?.status === "loading"}
                            options={[{ value: "auto", label: "automatic split" }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1) as StoryboardShotCount, label: `${index + 1} mirror` }))]}
                            popupMatchSelectWidth={false}
                            onChange={onShotCountChange}
                        />
                    )}
                    {simpleMode ? null : (
                        <Select<StoryboardShotDuration>
                            className="min-w-24"
                            size="small"
                            value={shotDuration}
                            disabled={node.metadata?.status === "loading"}
                            options={[
                                { value: "auto", label: "Single lens duration automatic" },
                                { value: "5", label: "5 seconds per shot" },
                                { value: "10", label: "10 seconds per shot" },
                                { value: "15", label: "15 seconds per shot" },
                                { value: "30", label: "30 seconds per shot" },
                            ]}
                            popupMatchSelectWidth={false}
                            onChange={onShotDurationChange}
                        />
                    )}
                    <Button
                        shape="circle"
                        icon={<Send className="size-4" />}
                        disabled={!prompt.trim() || node.metadata?.status === "loading"}
                        loading={node.metadata?.status === "loading"}
                        style={{ background: theme.toolbar.itemHover, borderColor: theme.node.stroke, color: theme.node.text }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={submitPrompt}
                    />
                </div>
                <RowHandle side="left" top={composerHeight / 2} scale={scale} tone="idle" theme={theme} title="Connect text nodes as project settings" onPointerDown={(event) => onConnectStart(event, "context", "target")} />
            </div>
            {rows.map((row, index) => {
                const top = STORYBOARD_HEADER_HEIGHT + index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop;
                if (top < STORYBOARD_HEADER_HEIGHT + 4 || top > STORYBOARD_HEADER_HEIGHT + tableHeight - 4) return null;
                return (
                    <div key={`ports-${row.id}`}>
                        <RowHandle side="left" top={top} scale={scale} tone={batchItemTone(batchItemByRowId.get(row.id)) || row.status} theme={theme} onPointerDown={(event) => onConnectStart(event, row.id, "target")} />
                        <RowHandle side="right" top={top} scale={scale} tone={batchItemTone(batchItemByRowId.get(row.id)) || row.status} theme={theme} onPointerDown={(event) => onConnectStart(event, row.id, "source")} />
                    </div>
                );
            })}
        </div>
    );
}

function storyboardStepState(stage: StoryboardPipelineStage): "done" | "current" | "error" | "idle" {
    if (stage.failed > 0 && stage.success === 0) return "error";
    if (stage.success > 0) return "done";
    if (stage.loading > 0 || stage.incomplete > 0) return "current";
    return "idle";
}

function StoryboardMiniPipeline({ pipeline, theme, rows }: { pipeline: CanvasStoryboardPipelineProgress; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; rows: StoryboardRow[] }) {
    const steps: Array<{ key: string; label: string; state: "done" | "current" | "error" | "idle"; hint: string }> = [
        { key: "script", label: "Storyboard", state: rows.length > 0 ? "done" : "idle", hint: rows.length > 0 ? `${rows.length} shot` : "Shots to be added" },
        { key: "images", label: "Storyboard (optional)", state: storyboardStepState(pipeline.images), hint: pipelineStatusLabel(pipeline.images) },
        { key: "videos", label: "video", state: storyboardStepState(pipeline.videos), hint: pipelineStatusLabel(pipeline.videos) },
        {
            key: "final",
            label: "Merge into pieces",
            state: pipeline.final.success > 0 ? "done" : pipeline.final.failed > 0 ? "error" : pipeline.final.loading > 0 || pipeline.successfulVideoNodeIds.length >= 2 ? "current" : "idle",
            hint: pipelineStatusLabel(pipeline.final),
        },
    ];
    return (
        <div
            className="flex h-9 shrink-0 items-center justify-center overflow-hidden border-b px-4"
            style={{ borderColor: theme.node.stroke, background: theme.node.fill }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {steps.map((step, index) => (
                <Fragment key={step.key}>
                    {index > 0 ? <span className="mx-2.5 h-px min-w-3.5 flex-1 max-w-20" style={{ background: theme.node.stroke }} /> : null}
                    <span
                        className="flex items-center gap-1.5 whitespace-nowrap text-[var(--fs-tiny)]"
                        title={step.hint}
                        style={{
                            color: step.state === "done" ? theme.node.muted : step.state === "current" ? theme.accent.primary : step.state === "error" ? theme.accent.danger : theme.node.faint,
                            fontWeight: step.state === "current" || step.state === "error" ? 700 : 500,
                        }}
                    >
                        <span
                            className="size-2 shrink-0 rounded-full"
                            style={{
                                background: step.state === "done" ? theme.node.activeStroke : step.state === "current" ? theme.accent.primary : step.state === "error" ? theme.accent.danger : theme.node.stroke,
                                boxShadow: step.state === "current" ? `0 0 0 3px ${theme.accent.primarySoft}` : undefined,
                            }}
                        />
                        {step.label}
                    </span>
                </Fragment>
            ))}
        </div>
    );
}

function GenerationBatchDetails({ batch, rows, onRetryItem }: { batch: CanvasGenerationBatch; rows: StoryboardRow[]; onRetryItem: (itemId: string) => void }) {
    const shotByRowId = new Map(rows.map((row) => [row.id, row.shotNumber]));
    return (
        <div className="w-80" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{generationBatchModeLabel(batch)}Details</span>
                <span className="text-xs text-foreground/50">{batch.items.length}  item</span>
            </div>
            <div className="thin-scrollbar max-h-72 overflow-y-auto">
                {batch.items.map((item) => {
                    const itemErrorInput = item.errorCode ? { code: item.errorCode, message: item.errorDetails } : item.errorDetails;
                    const requiresPromptChange = isContentModerationError(itemErrorInput);
                    return (
                        <div key={item.id} className="flex min-h-9 items-center gap-2 border-t border-foreground/10 py-1.5 first:border-t-0">
                            <span className="w-14 shrink-0 text-xs font-medium">lens{shotByRowId.get(item.rowId) || "--"}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground/60" title={item.errorDetails ? generationErrorMessage(itemErrorInput) : undefined}>
                                {generationBatchItemLabel(item)}
                                {item.retryCount ? ` · Try again${item.retryCount}` : ""}
                            </span>
                            {item.status === "failed" ? (
                                <Tooltip title={requiresPromptChange ? "Please modify the prompt word first and then try this shot again." : "Retry this shot only"}>
                                    <button
                                        type="button"
                                        className="grid size-7 shrink-0 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                                        onClick={() => onRetryItem(item.id)}
                                        aria-label={`Retry shot${shotByRowId.get(item.rowId) || ""}`}
                                    >
                                        <RefreshCw className="size-3.5" />
                                    </button>
                                </Tooltip>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function generationBatchModeLabel(batch: CanvasGenerationBatch) {
    return batch.mode === "storyboard_video" ? "video generation" : batch.mode === "storyboard_image" ? "Storyboard generation" : "Action board generation";
}

function generationBatchSummary(batch: CanvasGenerationBatch) {
    const count = (status: CanvasGenerationBatchItemStatus) => batch.items.filter((item) => item.status === status).length;
    const generating = count("submitting") + count("queued") + count("running");
    const stopped = count("cancelled");
    return `${generationBatchModeLabel(batch)}${batch.status === "completed" ? "Done" : batch.status === "cancelled" ? "Stopped" : "Medium"} · Completed${count("succeeded")}/${batch.items.length} /fail${count("failed")} / Generating${generating} /wait${count("waiting")}${stopped ? ` / stopped${stopped}` : ""}`;
}

function generationBatchItemLabel(item: CanvasGenerationBatchItem) {
    if (item.submissionUncertain) return "Status awaiting confirmation";
    if (isContentModerationError(item.errorCode ? { code: item.errorCode, message: item.errorDetails } : item.errorDetails)) return "The review failed and the prompt word needs to be modified.";
    const labels: Record<CanvasGenerationBatchItemStatus, string> = { waiting: "wait", submitting: "Submitting", queued: "queue", running: "Generating", succeeded: "success", failed: "failed", cancelled: "Stopped" };
    return labels[item.status];
}

function batchItemTone(item?: CanvasGenerationBatchItem): CanvasNodeStatus | undefined {
    if (!item) return undefined;
    if (item.status === "succeeded") return "success";
    if (item.status === "failed" || item.status === "cancelled") return "error";
    if (item.status === "waiting") return "idle";
    return "loading";
}

export function CanvasScriptEditor({
    node,
    nodes,
    open,
    onClose,
    onUpdateRows,
    onVisibleColumnsChange,
    onGenerateImages,
    onGenerateVideos,
    onVideoInputModeChange,
}: {
    node: CanvasNodeData | null;
    nodes: CanvasNodeData[];
    open: boolean;
    onClose: () => void;
    onUpdateRows: (rows: StoryboardRow[]) => void;
    onVisibleColumnsChange: (columns: StoryboardColumn[]) => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
    onVideoInputModeChange: (mode: StoryboardVideoInputMode) => void;
}) {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const rows = node?.metadata?.storyboard?.rows || EMPTY_STORYBOARD_ROWS;
    const visibleColumns = resolveStoryboardVisibleColumns(node?.metadata?.storyboard?.visibleColumns, rows, node?.metadata?.storyboardVisibleColumnsCustomized);
    const videoInputMode = node?.metadata?.storyboardVideoInputMode || "direct";
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const filteredRows = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return keyword
            ? rows.filter((row) =>
                  [row.plotDescription, row.dialogue, row.camera, row.motion, row.timeBeats, row.imageGenerationPrompt, row.videoMotionPrompt, row.negativePrompt, ...(row.assetBindings || []).map((binding) => nodeById.get(binding.nodeId)?.title || "")].some((value) =>
                      String(value || "")
                          .toLowerCase()
                          .includes(keyword),
                  ),
              )
            : rows;
    }, [nodeById, query, rows]);
    useEffect(() => {
        setSelectedIds((current) => {
            const next = current.filter((id) => rows.some((row) => row.id === id));
            return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
        });
    }, [rows]);
    const updateRow = (rowId: string, patch: Partial<StoryboardRow>) => onUpdateRows(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
    const moveRow = (rowId: string, direction: -1 | 1) => {
        const index = rows.findIndex((row) => row.id === rowId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return;
        const next = [...rows];
        [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
        onUpdateRows(next.map((row, rowIndex) => ({ ...row, shotNumber: rowIndex + 1 })));
    };
    const duplicateRow = (row: StoryboardRow) => {
        const index = rows.findIndex((item) => item.id === row.id);
        const next = [...rows];
        next.splice(index + 1, 0, { ...row, id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, imageNodeId: undefined, videoNodeId: undefined, status: "idle" });
        onUpdateRows(next.map((item, rowIndex) => ({ ...item, shotNumber: rowIndex + 1 })));
    };
    const removeRow = (rowId: string) => onUpdateRows(rows.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, shotNumber: index + 1 })));

    const columns: ColumnsType<StoryboardRow> = columnOptions
        .filter((option) => visibleColumns.includes(option.value))
        .map((option) => ({
            title: option.label,
            dataIndex: option.value,
            key: option.value,
            width: option.value === "shotNumber" ? 72 : option.value === "durationSeconds" ? 100 : option.value === "assets" ? 220 : option.value === "plotDescription" || option.value === "dialogue" || option.value === "timeBeats" || option.value.endsWith("Prompt") ? 260 : 170,
            fixed: option.value === "shotNumber" ? ("left" as const) : undefined,
            render: (_: unknown, row: StoryboardRow) =>
                option.value === "shotNumber" ? (
                    <span className="font-semibold">{row.shotNumber}</span>
                ) : option.value === "durationSeconds" ? (
                    <InputNumber className="w-full" min={1} max={60} value={row.durationSeconds} suffix="s" onChange={(value) => updateRow(row.id, { durationSeconds: Number(value) || 1 })} />
                ) : option.value === "assets" ? (
                    <StoryboardAssetsCell bindings={row.assetBindings || []} nodes={nodes} />
                ) : option.value === "shotSize" ? (
                    <Select
                        className="w-full"
                        value={row.shotSize || undefined}
                        placeholder="Select scene"
                        options={["Close-up", "close shot", "medium shot", "Panorama", "Vision"].map((value) => ({ value, label: value }))}
                        onChange={(shotSize) => updateRow(row.id, { shotSize })}
                    />
                ) : (
                    <Input.TextArea
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={String(row[option.value] || "")}
                        placeholder={`fill in${option.label}`}
                        onChange={(event) => updateRow(row.id, { [option.value]: event.target.value } as Partial<StoryboardRow>)}
                    />
                ),
        }));
    columns.push({
        title: "Operation",
        key: "actions",
        dataIndex: "shotNumber",
        width: 150,
        fixed: "right" as const,
        render: (_: unknown, row: StoryboardRow) => (
            <div className="flex gap-1">
                <SmallButton title="move up" onClick={() => moveRow(row.id, -1)}>
                    <ChevronUp className="size-3.5" />
                </SmallButton>
                <SmallButton title="move down" onClick={() => moveRow(row.id, 1)}>
                    <ChevronDown className="size-3.5" />
                </SmallButton>
                <SmallButton title="Copy" onClick={() => duplicateRow(row)}>
                    <Copy className="size-3.5" />
                </SmallButton>
                <SmallButton title="Delete" onClick={() => removeRow(row.id)}>
                    <Trash2 className="size-3.5" />
                </SmallButton>
            </div>
        ),
    });

    return (
        <Modal title={node?.title || "Storyboard"} open={open} onCancel={onClose} footer={null} width="min(1480px, calc(100vw - 40px))" centered destroyOnHidden>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input.Search className="w-72" allowClear placeholder="Filter images, lines or prompt words" value={query} onChange={(event) => setQuery(event.target.value)} />
                    <CheckboxGroup className="script-column-picker" options={columnOptions} value={visibleColumns} onChange={(values) => onVisibleColumnsChange(values)} />
                <span className="min-w-0 flex-1" />
                <Button icon={<Plus className="size-4" />} onClick={() => onUpdateRows([...rows, editorRow(rows.length + 1)])}>
                                        Add new lens
                </Button>
                <Button icon={<ImageIcon className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateImages(selectedIds)}>
                                        generate{videoInputMode === "keyframe" ? "first frame" : "Storyboards"}
                </Button>
                <Segmented<StoryboardVideoInputMode>
                    value={videoInputMode}
                    options={[
                        { value: "direct", label: "Generate directly" },
                        { value: "keyframe", label: "Do the first frame first" },
                    ]}
                    onChange={onVideoInputModeChange}
                />
                <Button type="primary" icon={<Film className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateVideos(selectedIds)}>
                    {videoInputMode === "keyframe" ? "Confirm the first frame and generate" : "Generate video"}
                </Button>
            </div>
            <Table<StoryboardRow>
                rowKey="id"
                size="small"
                bordered
                sticky
                pagination={false}
                scroll={{ x: Math.max(900, columns.length * 180), y: "calc(78vh - 170px)" }}
                dataSource={filteredRows}
                columns={columns}
                rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }}
            />
        </Modal>
    );
}

function CompactInput({ value, placeholder, borderColor, onChange }: { value: string; placeholder: string; borderColor: string; onChange: (value: string) => void }) {
    return (
        <textarea
            className="thin-scrollbar h-full w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-r bg-transparent px-4 py-2.5 text-xs leading-5 outline-none transition placeholder:opacity-35 focus:bg-black/[0.02] dark:focus:bg-white/[0.025]"
            style={{ borderColor }}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        />
    );
}

function CompactDurationInput({ value, borderColor, onChange }: { value: number; borderColor: string; onChange: (value: number) => void }) {
    return (
        <label className="flex h-full items-center justify-center gap-1 border-r text-xs tabular-nums text-foreground/60" style={{ borderColor }}>
            <input
                type="number"
                min={1}
                max={60}
                value={value}
                className="w-9 bg-transparent text-right outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                aria-label="Shot duration (seconds)"
                onChange={(event) => onChange(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            />
                        seconds
        </label>
    );
}

function HeaderCell({ children, borderColor, align = "left" }: { children: ReactNode; borderColor: string; align?: "left" | "center" }) {
    return (
        <span className={`flex h-full items-center border-r px-4 ${align === "center" ? "justify-center text-center" : "justify-start"}`} style={{ borderColor }}>
            {children}
        </span>
    );
}

function SmallButton({ title, children, onClick, disabled }: { title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="grid size-7 shrink-0 place-items-center rounded opacity-65 transition enabled:hover:bg-black/5 enabled:hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25 dark:enabled:hover:bg-white/10"
            title={title}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
        >
            {children}
        </button>
    );
}

function editorRow(shotNumber: number): StoryboardRow {
    return {
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        shotNumber,
        durationSeconds: 6,
        plotDescription: "",
        dialogue: "",
        characters: [],
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        assetBindings: [],
        status: "idle",
    };
}

function RowHandle({
    side,
    top,
    scale,
    tone,
    theme,
    title,
    onPointerDown,
}: {
    side: "left" | "right";
    top: number;
    scale: number;
    tone?: StoryboardRow["status"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    title?: string;
    onPointerDown: (event: ReactPointerEvent) => void;
}) {
    const color = tone === "loading" ? theme.accent.primary : tone === "error" ? theme.accent.danger : tone === "success" ? theme.node.activeStroke : theme.node.muted;
    const inverseHitScale = 1 / Math.max(scale, 0.05);
    return (
        <button
            type="button"
            aria-label={title || `${side === "left" ? "input" : "output"}connection point`}
            title={title || `${side === "left" ? "Introduce reference" : "Connect to an image, video, or build node"}`}
            className={`canvas-connection-handle absolute z-[var(--node-z-handle)] flex -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 ${side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
            style={{ top, width: 32 * inverseHitScale, height: 32 * inverseHitScale, "--tw-ring-color": theme.accent.primary } as CSSProperties}
            onPointerDown={onPointerDown}
        >
            <span className="block size-2.5 rounded-full border-2 shadow-sm transition-transform hover:scale-110" style={{ boxSizing: "border-box", borderColor: theme.node.panel, background: color }} />
        </button>
    );
}
