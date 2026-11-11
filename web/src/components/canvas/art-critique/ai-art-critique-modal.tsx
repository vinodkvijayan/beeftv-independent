import { canvasThemes } from "@/lib/canvas-theme";
import { Button, Tag } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles, Target, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
    ART_CRITIQUE_SCHEMA_VERSION,
    ART_CRITIQUE_PLUGIN_ID,
    artCritiqueCategoryLabel,
    artCritiqueSeverityLabel,
    artCritiqueStageLabel,
    artCritiqueSourceFingerprint,
    createDefaultArtCritiqueState,
    isArtCritiqueImageInput,
    type ArtCritiqueCategory,
    type ArtCritiqueIssue,
    type ArtCritiqueNodeState,
    type ArtCritiqueOption,
    type ArtCritiquePipelineStage,
    type ArtCritiqueReport,
} from "@/lib/art-critique/contracts";
import { ART_CRITIQUE_CATEGORY_COLORS, ART_CRITIQUE_SEVERITY_COLORS, layoutArtCritiqueLabels, repairIssueTarget, targetBounds } from "@/lib/art-critique/annotation";
import { executeArtCritique } from "@/services/art-critique-execution";
import { ApprovedToolExecution } from "@/services/approved-tool-execution";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCopyText } from "@/hooks/use-copy-text";
import { resolveImageUrl } from "@/services/image-storage";
import { modelOptionLabel, useEffectiveConfig } from "@/stores/use-config-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import { IconButton } from "@/components/ui/base/buttons";
import { Callout } from "@/components/ui/product/callout";

type AiArtCritiqueModalProps = {
    startRequestId?: string;
    restartRequested?: boolean;
    onRunningChange?: (running: boolean) => void;
    node: CanvasNodeData | null;
    upstreamNodes: CanvasNodeData[];
    open: boolean;
    onClose: () => void;
    onUpdateState: (nodeId: string, state: ArtCritiqueNodeState) => void;
};

const CATEGORIES: ArtCritiqueCategory[] = ["composition", "color", "lighting", "proportion", "other"];
const ART_CRITIQUE_STAGE_PROGRESS: Record<ArtCritiquePipelineStage, number> = {
    preparing: 8,
    scene: 22,
    reviewing: 52,
    aggregating: 66,
    grounding: 78,
    verifying: 90,
    annotating: 97,
    completed: 100,
    failed: 100,
};
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type AiArtCritiqueView = "overview" | "detail";
type ArtCritiquePromptStatus = "ready" | "pending" | "unavailable";

export function AiArtCritiqueModal({ node, upstreamNodes, open, onClose, onUpdateState, startRequestId, restartRequested, onRunningChange }: AiArtCritiqueModalProps) {
    const theme = canvasThemes[useActiveTheme()];
    const effectiveConfig = useEffectiveConfig();
    const selectedCritiqueModel = effectiveConfig.textModel.trim();
    const configuredCritiqueModelLabel = selectedCritiqueModel ? modelOptionLabel(effectiveConfig, selectedCritiqueModel) : "Text/visual understanding model not configured";
    const enabled = usePluginStore((state) => state.pluginStates[ART_CRITIQUE_PLUGIN_ID]?.effectiveEnabled ?? (ART_CRITIQUE_PLUGIN_ID in state.runtimeStatuses ? state.runtimeStatuses[ART_CRITIQUE_PLUGIN_ID] === "enabled" : Boolean(state.installations.find((item) => item.manifest.id === ART_CRITIQUE_PLUGIN_ID)?.enabled)));
    const input = useMemo(() => { const images = upstreamNodes.filter(isArtCritiqueImageInput); return images.length === 1 ? images[0] : undefined; }, [upstreamNodes]);
    const state = node?.metadata?.artCritique || createDefaultArtCritiqueState();
    const currentFingerprint = input ? artCritiqueSourceFingerprint(input) : "";
    const stale = Boolean(state.report && currentFingerprint && state.report.sourceFingerprint !== currentFingerprint);
    const visibleState: ArtCritiqueNodeState = stale && state.status !== "running" ? { ...state, status: "stale" } : state;
    const [previewUrl, setPreviewUrl] = useState("");
    const [running, setRunning] = useState(false);
    const [activeStage, setActiveStage] = useState<ArtCritiquePipelineStage>();
    const [localError, setLocalError] = useState("");
    const [filter, setFilter] = useState<ArtCritiqueCategory | "all">("all");
    const [view, setView] = useState<AiArtCritiqueView>("overview");
    const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
    const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null);
    const [draftReportVisible, setDraftReportVisible] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const startedRequestRef = useRef<string | undefined>(undefined);
    const currentRunTargetRef = useRef("");
    currentRunTargetRef.current = `${getActiveUserScope()}:${node?.id || ""}:${currentFingerprint}`;

    useEffect(() => {
        if (!open || !input) {
            setPreviewUrl("");
            return;
        }
        let cancelled = false;
        const source = input.metadata?.content || input.metadata?.previewContent || "";
        void resolveImageUrl(input.metadata?.storageKey, source, { cacheMiss: true })
            .then((url) => {
                if (!cancelled) setPreviewUrl(url);
            })
            .catch(() => {
                if (!cancelled) setPreviewUrl(source);
            });
        return () => {
            cancelled = true;
        };
    }, [input, open]);

    useEffect(() => {
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setView("overview");
        setFilter("all");
        setActiveStage(undefined);
        setLocalError("");
        setDraftReportVisible(false);
    }, [node?.id, currentFingerprint, open]);

    useEffect(() => () => abortRef.current?.abort(), []);
    useEffect(() => () => abortRef.current?.abort(), [node?.id, currentFingerprint]);
    useEffect(() => { if (!enabled) abortRef.current?.abort(); }, [enabled]);

    const issues = visibleState.report?.issues || [];
    const reportOptions = visibleState.report?.options || [];
    const repairedIssues = useMemo(() => issues.map(repairIssueTarget), [issues]);
    const visibleIssues = useMemo(() => (filter === "all" ? repairedIssues : repairedIssues.filter((issue) => issue.category === filter)), [filter, repairedIssues]);
    const detailIssue = repairedIssues.find((issue) => issue.id === selectedIssueId) || null;
    const detailIndex = detailIssue ? repairedIssues.findIndex((issue) => issue.id === detailIssue.id) : -1;
    const hoveredIssue = repairedIssues.find((issue) => issue.id === hoveredIssueId) || null;
    const overlayIssues = useMemo(() => {
        if (visibleState.status === "running") return [];
        const issue = view === "detail" ? detailIssue : hoveredIssue;
        return issue ? [issue] : [];
    }, [detailIssue, hoveredIssue, view, visibleState.status]);
    const labelPlacements = useMemo(() => layoutArtCritiqueLabels(overlayIssues), [overlayIssues]);
    const issueNumberById = useMemo(() => new Map(repairedIssues.map((issue, index) => [issue.id, index + 1])), [repairedIssues]);

    const close = () => {
        abortRef.current?.abort();
        onClose();
    };

    const openIssue = (issueId: string) => {
        setSelectedIssueId(issueId);
        setHoveredIssueId(null);
        setView("detail");
    };

    const backToOverview = () => {
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setView("overview");
    };

    const runReview = async (resume = false) => {
        if (abortRef.current) return;
        if (!node || !input) {
            setLocalError("Please connect and only connect an existing picture");
            return;
        }
        if (!enabled) {
            setLocalError("The plug-in has not been enabled yet. Please go to the plug-in management to enable AI aesthetic correction first.");
            return;
        }
        if (resume && (!state.executionRunId || state.sourceFingerprint !== artCritiqueSourceFingerprint(input) || state.lastRunModel !== selectedCritiqueModel)) {
            setLocalError("The picture or model of the original analysis has changed, please start a new analysis.");
            return;
        }
        setView("overview");
        setSelectedIssueId(null);
        setHoveredIssueId(null);
        setDraftReportVisible(false);
        const sourceFingerprint = artCritiqueSourceFingerprint(input);
        const runId = resume && state.lastRunId ? state.lastRunId : `art-critique-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        let executionRunId = resume ? state.executionRunId : undefined;
        const controller = new AbortController();
        abortRef.current = controller;
        onRunningChange?.(true);
        const runTarget = currentRunTargetRef.current;
        const runScope = getActiveUserScope();
        const publishState = (next: ArtCritiqueNodeState) => {
            if (getActiveUserScope() === runScope && currentRunTargetRef.current === runTarget && abortRef.current === controller) onUpdateState(node.id, { ...next, executionRunId, lastRunModel: selectedCritiqueModel });
        };
        const baseState: ArtCritiqueNodeState = {
            ...state,
            schemaVersion: ART_CRITIQUE_SCHEMA_VERSION,
            status: "running",
            analysisStage: "preparing",
            sourceNodeId: input.id,
            sourceFingerprint,
            lastRunId: runId,
            stageTaskIds: resume ? state.stageTaskIds : {},
            errorCode: undefined,
            errorMessage: undefined,
            updatedAt: new Date().toISOString(),
        };
        publishState(baseState);
        setRunning(true);
        setActiveStage("preparing");
        setLocalError("");
        let latestStage: ArtCritiquePipelineStage = "preparing";
        let runningReport: ArtCritiqueReport | undefined = state.report;
        const stageTaskIds: Record<string, string> = resume ? { ...state.stageTaskIds } : {};
        const approval = new ApprovedToolExecution({
            clientKey: `art-critique:${runId}`, runId: executionRunId,
            identity: { kind: "art-critique", nodeId: node.id, sourceFingerprint, model: selectedCritiqueModel }, signal: controller.signal,
            onRun: (id) => { executionRunId = id; publishState({ ...baseState, stageTaskIds: { ...stageTaskIds } }); },
        });
        try {
            const report = await executeArtCritique({
                    nodeId: node.id, runId, source: input, config: effectiveConfig,
                    signal: controller.signal,
                    submitStage: approval.execute,
                    onTaskCreated: (stage, taskId) => {
                        stageTaskIds[stage] = taskId;
                        publishState({ ...baseState, stageTaskIds: { ...stageTaskIds }, analysisStage: latestStage, updatedAt: new Date().toISOString() });
                    },
                    onStage: (analysisStage) => {
                        latestStage = analysisStage;
                        setActiveStage(analysisStage);
                        publishState({
                            ...baseState,
                            stageTaskIds: { ...stageTaskIds },
                            ...(runningReport ? { report: { ...runningReport, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) } } : {}),
                            analysisStage,
                            updatedAt: new Date().toISOString(),
                        });
                    },
                    onDraftReport: (draftReport) => {
                        if (controller.signal.aborted || abortRef.current !== controller) return;
                        runningReport = draftReport;
                        setDraftReportVisible(true);
                        publishState({
                            ...baseState,
                            stageTaskIds: { ...stageTaskIds },
                            status: "running",
                            analysisStage: latestStage,
                            report: { ...draftReport, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) },
                            updatedAt: new Date().toISOString(),
                        });
                    },
            });
            setDraftReportVisible(false);
            publishState({
                ...baseState,
                stageTaskIds: { ...stageTaskIds },
                status: "completed",
                analysisStage: "completed",
                report: { ...report, modelLabel: modelOptionLabel(effectiveConfig, selectedCritiqueModel) },
                updatedAt: new Date().toISOString(),
            });
            setActiveStage("completed");
        } catch (error) {
            if (controller.signal.aborted) {
                setActiveStage(undefined);
                setDraftReportVisible(false);
                publishState({ ...baseState, stageTaskIds: { ...stageTaskIds }, status: "failed", analysisStage: "failed", errorCode: "analysis_interrupted", errorMessage: "Analysis observation has been stopped; submitted stages remain in the task center and will not be automatically resubmitted.", updatedAt: new Date().toISOString() });
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "AI correction failed, please try again later";
            setActiveStage("failed");
            setDraftReportVisible(false);
            setLocalError(errorMessage);
            publishState({ ...baseState, stageTaskIds: { ...stageTaskIds }, status: "failed", analysisStage: "failed", errorCode: error instanceof Error ? error.message : "art_critique_failed", errorMessage, updatedAt: new Date().toISOString() });
        } finally {
            approval.dispose();
            if (abortRef.current === controller) abortRef.current = null;
            setRunning(false);
            onRunningChange?.(false);
        }
    };

    const progressStage = activeStage || visibleState.analysisStage || "preparing";
    const displayedModelLabel = visibleState.report?.modelLabel || configuredCritiqueModelLabel;
    useEffect(() => {
        if (!open || !node || !startRequestId || running || startedRequestRef.current === startRequestId) return;
        startedRequestRef.current = startRequestId;
        void runReview(Boolean(!restartRequested && state.executionRunId && state.status !== "completed" && state.sourceFingerprint === currentFingerprint && state.lastRunModel === selectedCritiqueModel));
    }, [open, node?.id, startRequestId, running]);

    const modelStatusLabel = running ? "in use" : visibleState.report?.modelLabel ? "Report usage" : selectedCritiqueModel ? "To be used" : "Requires configuration";
    const modelStatusColor = selectedCritiqueModel || visibleState.report?.modelLabel ? theme.node.muted : "var(--status-warning)";
    const modelInlineLabel = selectedCritiqueModel || visibleState.report?.modelLabel ? `${modelStatusLabel} · ${displayedModelLabel}` : "Please go to settings to select a text model that supports image understanding";

    return (
        <AppModal
            open={open}
            title={null}
            closable={false}
            width="min(1240px, calc(100vw - 32px))"
            centered
            destroyOnClose={false}
            onCancel={close}
            footer={null}
            className="art-critique-modal"
            flush
        >
            <div className="flex h-[min(820px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] min-h-0 flex-col overflow-hidden rounded-[var(--r-lg)]" style={{ background: theme.canvas.background, color: theme.node.text }}>
                <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3.5" style={{ borderColor: theme.node.edge }}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                        <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <h2 className="truncate text-base font-semibold">AI aesthetic correction</h2>
                            {visibleState.report ? (
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[var(--fs-micro)] font-semibold" style={{ background: "color-mix(in oklch, var(--status-success) 12%, transparent)", color: "var(--status-success)" }}>
                                    {visibleState.report.issues.length ? `${visibleState.report.issues.length} questions` : reportOptions.length ? `${reportOptions.length} optional directions` : "No key issues were found in this round"}
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                            {input?.title || "Waiting for image input"}  · Input pictures and output correction reports without modifying the original pictures.
                        </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {running
                                ? artCritiqueStageLabel(visibleState.analysisStage)
                                : visibleState.status === "completed" && !stale
                                  ? "Analysis completed"
                                  : visibleState.status === "stale"
                                    ? "Need to update"
                                    : visibleState.status === "failed"
                                      ? "Analysis failed"
                                      : "Not analyzed yet"}
                        </span>
                    </div>
                    <IconButton variant="ghost" size="sm" icon={X} onClick={close} aria-label="Close correction report" />
                </header>

                <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,.85fr)]">
                    <section className="flex h-[min(48dvh,520px)] min-h-[300px] min-w-0 flex-col gap-3 border-b p-4 lg:h-auto lg:min-h-0 lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.edge }}>
                        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--r-lg)] border p-2" style={{ borderColor: theme.node.edge, background: "rgba(0,0,0,.18)" }}>
                            {previewUrl ? (
                                <img src={previewUrl} alt={input?.title || "Enter image"} className="max-h-full max-w-full rounded-[var(--r-md)] object-contain shadow-[var(--shadow-md)]" draggable={false} />
                            ) : (
                                <EmptyState size="compact" icon={ImageIcon} title={input ? "Loading images" : "No image input yet"} />
                            )}
                            {overlayIssues.length && previewUrl ? <CritiqueOverlay issues={overlayIssues} issueNumberById={issueNumberById} selectedIssueId={overlayIssues[0]?.id || null} labelPlacements={labelPlacements} onSelect={openIssue} /> : null}
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{input?.title || "Waiting for image input"}</div>
                                <div className="mt-1 truncate text-xs" style={{ color: theme.node.muted }}>
                                    {draftReportVisible && visibleState.status === "running"
                                        ? "The first draft of the report has been released, and the rectangular annotation will be displayed after the positioning review is completed."
                                        : view === "detail" && detailIssue
                                          ? "Currently only the location box for this question is displayed"
                                          : input
                                            ? "Hover to view the location of the problem, click on the problem to enter details"
                                            : "Please connect an input from the image node"}
                                </div>
                            </div>
                            {visibleState.report?.issues.length ? (
                                <span className="shrink-0 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ background: "color-mix(in oklch, var(--workspace-accent) 12%, transparent)", color: "var(--workspace-accent)" }}>
                                    {view === "detail" && detailIssue && detailIndex >= 0 ? `problem${detailIndex + 1} / ${repairedIssues.length}` : `${visibleState.report.issues.length} questions`}
                                </span>
                            ) : null}
                        </div>
                    </section>

                    <aside className="min-h-0 flex-1 overflow-y-auto" data-canvas-wheel-scroll>
                        <div className="flex min-h-full flex-col gap-4 p-4">
                            {running || visibleState.status === "running" ? <ArtCritiqueProgress stage={progressStage} theme={theme} /> : null}
                            {draftReportVisible && visibleState.status === "running" && visibleState.report ? (
                                <Callout tone="info" title="The first draft of the report has been generated">
                                                                        The questions and suggestions have been displayed first, and the rectangular annotation is being precisely positioned and reviewed.
                                </Callout>
                            ) : null}
                            {!enabled && !visibleState.report ? (
                                <Callout tone="warning" title="Plugin not enabled yet">
                                                                        Please go to the plug-in management to enable AI aesthetic correction before running the analysis.
                                </Callout>
                            ) : null}
                            {visibleState.status === "stale" ? (
                                <Callout tone="warning" title="The input image has changed">
                                                                        The current report is generated based on old images, please revise again.</Callout>
                            ) : null}
                            {localError || visibleState.errorMessage ? (
                                <Callout tone="error" title="Correction failed">
                                    {localError || visibleState.errorMessage}
                                </Callout>
                            ) : null}

                            {view === "detail" && detailIssue ? (
                                <IssueDetailView
                                    issue={detailIssue}
                                    issueIndex={detailIndex}
                                    total={repairedIssues.length}
                                    isDraft={draftReportVisible && visibleState.status === "running"}
                                    promptStatus={draftReportVisible && visibleState.status === "running" ? "pending" : detailIssue.editPrompt?.trim() ? "ready" : "unavailable"}
                                    theme={theme}
                                    onBack={backToOverview}
                                    onPrevious={() => detailIndex > 0 && setSelectedIssueId(repairedIssues[detailIndex - 1].id)}
                                    onNext={() => detailIndex >= 0 && detailIndex < repairedIssues.length - 1 && setSelectedIssueId(repairedIssues[detailIndex + 1].id)}
                                />
                            ) : (
                                <>
                                    {visibleState.report ? (
                                        <ReportSummary report={visibleState.report} theme={theme} isDraft={draftReportVisible && visibleState.status === "running"} />
                                    ) : (
                                        <EmptyState className="my-auto" size="compact" icon={FileText} title="No correction report yet" />
                                    )}

                                    {visibleState.report && !visibleState.report.issues.length ? (
                                        <div
                                            className="flex items-start gap-3 rounded-[var(--r-lg)] border px-3 py-3 text-sm"
                                            style={{ borderColor: "color-mix(in oklch, var(--status-success) 35%, transparent)", background: "color-mix(in oklch, var(--status-success) 8%, transparent)" }}
                                        >
                                            <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                                            <div>
                                                <div className="font-semibold">No issues that need priority modification were found in this round</div>
                                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                                    {reportOptions.length ? `Yes${reportOptions.length} optional directions, but they are not deterministic errors.` : "This means that the current inspection has not found any key issues with sufficient evidence that actually affect the expression of the picture."}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {reportOptions.length ? (
                                        <section className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <h3 className="m-0 text-sm font-semibold">Optional directions</h3>
                                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                                                                                        It doesn’t mean the picture is wrong
                                                </span>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                {reportOptions.map((option) => (
                                                    <OptionCard key={option.id} option={option} theme={theme} />
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}

                                    {visibleState.report?.issues.length ? (
                                        <section className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <h3 className="m-0 text-sm font-semibold">Key issues</h3>
                                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                                    {visibleIssues.length} / {visibleState.report.issues.length}  item
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 overflow-x-auto pb-1" role="group" aria-label="Problem classification filtering">
                                                <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
                                                {CATEGORIES.map((category) => (
                                                    <FilterChip key={category} label={artCritiqueCategoryLabel(category)} active={filter === category} color={ART_CRITIQUE_CATEGORY_COLORS[category]} onClick={() => setFilter(category)} />
                                                ))}
                                            </div>
                                            {visibleIssues.length ? (
                                                <div className="overflow-hidden rounded-[var(--r-lg)] border" style={{ borderColor: theme.node.edge, background: theme.node.panel }}>
                                                    {visibleIssues.map((issue, index) => (
                                                        <IssueCard key={issue.id} issue={issue} index={issueNumberById.get(issue.id) || index + 1} selected={false} theme={theme} onClick={() => openIssue(issue.id)} onHover={setHoveredIssueId} />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="rounded-[var(--r-lg)] border border-dashed px-3 py-6 text-center text-xs" style={{ borderColor: theme.node.edge, color: theme.node.muted }}>
                                                                                                        There is no problem with the current classification
                                                </div>
                                            )}
                                        </section>
                                    ) : null}
                                </>
                            )}

                            <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: theme.node.edge, background: theme.canvas.background }}>
                                <div className="min-w-0 flex-1 basis-full truncate text-[var(--fs-micro)] sm:basis-auto" title={modelInlineLabel} style={{ color: modelStatusColor }}>
                                    {modelInlineLabel}
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                    {running ? (
                                        <Button type="text" size="small" onClick={() => abortRef.current?.abort()}>
                                                                                        Cancel analysis
                                        </Button>
                                    ) : null}
                                    {!running && state.executionRunId && state.status !== "completed" && !stale && state.lastRunModel === selectedCritiqueModel ? <Button size="small" disabled={!input || !enabled} onClick={() => void runReview(true)}>Continue the last analysis</Button> : null}
                                    <Button
                                        type="primary"
                                        size="small"
                                        className="shrink-0"
                                        icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                                        loading={running}
                                        disabled={running || !input || !enabled || !selectedCritiqueModel}
                                        onClick={() => void runReview()}
                                    >
                                        {visibleState.report ? "re-correct" : "Start correcting"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </AppModal>
    );
}

function ArtCritiqueProgress({ stage, theme }: { stage: ArtCritiquePipelineStage; theme: CanvasTheme }) {
    const percent = ART_CRITIQUE_STAGE_PROGRESS[stage];
    const detail = stage === "reviewing" ? "Scene routing and multiple Reviewers are checking the screen in parallel" : stage === "verifying" ? "Issues are being reviewed in parallel and AI modification prompts are generated." : "The correction report is being generated by stage";
    return (
        <section className="flex flex-col gap-2 rounded-[var(--r-lg)] border px-3 py-3" style={{ borderColor: theme.node.edge, background: theme.node.panel }} aria-label="AI aesthetic correction progress">
            <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    <span className="truncate">{artCritiqueStageLabel(stage)}</span>
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: theme.node.muted }}>
                    {percent}%
                </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklch, var(--workspace-accent) 14%, transparent)" }}>
                <div
                    className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                    role="progressbar"
                    aria-label="AI aesthetic correction stage progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={`${artCritiqueStageLabel(stage)}, about${percent}%`}
                    style={{ width: `${percent}%`, background: theme.accent.primary }}
                />
            </div>
            <div className="text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                {detail}
            </div>
        </section>
    );
}

function ReportSummary({ report, theme, isDraft }: { report: NonNullable<ArtCritiqueNodeState["report"]>; theme: CanvasTheme; isDraft?: boolean }) {
    const summary = report.summary || "There is no overall summary of this picture yet.";
    const hasLongSummary = summary.length > 120;
    return (
        <section className="flex flex-col gap-2 border-b pb-4" style={{ borderColor: theme.node.edge }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                {isDraft ? (
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" style={{ color: "var(--workspace-accent)" }} aria-hidden="true" />
                ) : (
                    <CheckCircle2 className="size-4" style={{ color: "var(--status-success)" }} aria-hidden="true" />
                )}
                <span>{isDraft ? "Overall judgment (first draft)" : "overall judgment"}</span>
                {report.rubricVersion ? (
                    <span className="ml-auto text-[11px] font-normal" style={{ color: theme.node.muted }}>
                                                Standard{report.rubricVersion}
                    </span>
                ) : null}
            </div>
            <p className={`m-0 text-sm leading-6${hasLongSummary ? " line-clamp-3" : ""}`}>{summary}</p>
            {hasLongSummary ? (
                <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden" style={{ color: "var(--workspace-accent)" }}>
                                                View full judgment
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <p className="mt-2 mb-0 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {summary}
                    </p>
                </details>
            ) : null}
            {report.pipelineWarnings?.length ? (
                <details className="group rounded-[var(--r-md)] px-2.5 py-2 text-xs" style={{ background: "color-mix(in oklch, var(--status-warning) 8%, transparent)", color: "var(--status-warning)" }}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
                                                Some steps in this analysis were downgraded
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 leading-5">
                        {report.pipelineWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </details>
            ) : null}
            {report.strengths.length ? (
                <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold outline-none focus-visible:underline [&::-webkit-details-marker]:hidden" style={{ color: theme.node.muted }}>
                                                The existing advantages of the screen
                        <span className="inline-flex items-center gap-1 font-medium">
                            {report.strengths.length}  item
                            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                        </span>
                    </summary>
                    <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 text-xs leading-5">
                        {report.strengths.slice(0, 3).map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                    {report.strengths.length > 3 ? (
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                                        Also{report.strengths.length - 3}  Advantages
                        </div>
                    ) : null}
                </details>
            ) : null}
        </section>
    );
}

function IssueCard({ issue, index, selected, theme, onClick, onHover }: { issue: ArtCritiqueIssue; index: number; selected: boolean; theme: CanvasTheme; onClick: () => void; onHover: (issueId: string | null) => void }) {
    const color = ART_CRITIQUE_SEVERITY_COLORS[issue.severity];
    return (
        <button
            type="button"
            className="group flex w-full items-start gap-3 border-b px-3.5 py-3.5 text-left outline-none transition last:border-b-0 hover:bg-black/[.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] dark:hover:bg-white/[.04]"
            style={{ borderColor: theme.node.edge, background: selected ? `color-mix(in oklch, ${color} 8%, ${theme.node.panel})` : "transparent", outlineColor: color }}
            onClick={onClick}
            onMouseEnter={() => onHover(issue.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(issue.id)}
            onBlur={() => onHover(null)}
        >
            <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] text-xs font-bold" style={{ background: color, color: "#fff" }}>
                {index}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 text-sm font-semibold leading-5">{issue.title}</span>
                <span className="mt-1.5 flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }}>{artCritiqueCategoryLabel(issue.category)}</span>
                    <span className="size-1 shrink-0 rounded-full bg-current opacity-40" aria-hidden="true" />
                    <span style={{ color }}>{artCritiqueSeverityLabel(issue.severity)}</span>
                    {issue.verification && issue.verification.verdict !== "confirmed" ? (
                        <>
                            <span className="size-1 shrink-0 rounded-full bg-current opacity-40" aria-hidden="true" />
                            <span>To be reviewed</span>
                        </>
                    ) : null}
                    <span className="ml-auto shrink-0 tabular-nums">{Math.round(issue.confidence * 100)}%</span>
                </span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 opacity-35 transition-transform group-hover:translate-x-0.5 group-hover:opacity-70" aria-hidden="true" />
        </button>
    );
}

function IssueDetailView({
    issue,
    issueIndex,
    total,
    isDraft,
    promptStatus,
    theme,
    onBack,
    onPrevious,
    onNext,
}: {
    issue: ArtCritiqueIssue;
    issueIndex: number;
    total: number;
    isDraft?: boolean;
    promptStatus: ArtCritiquePromptStatus;
    theme: CanvasTheme;
    onBack: () => void;
    onPrevious: () => void;
    onNext: () => void;
}) {
    const targetSourceLabel = isDraft ? "Positioning" : issue.targetSource === "reference" ? "reference area" : issue.targetSource === "model" ? "Model positioning" : issue.target.type === "global" ? "global scope" : "local area";
    const severityColor = ART_CRITIQUE_SEVERITY_COLORS[issue.severity];
    const copyText = useCopyText();
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
                                        Question list
                </Button>
                <span className="text-xs tabular-nums" style={{ color: theme.node.muted }}>
                                        problem{issueIndex + 1} / {total}
                </span>
            </div>

            <section className="flex flex-col gap-3 border-b pb-5" style={{ borderColor: theme.node.edge }}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="size-2 rounded-full" style={{ background: severityColor }} aria-hidden="true" />
                    <span>specific questions</span>
                    <Tag bordered={false} className="ml-auto text-[11px]" style={{ color: severityColor }}>
                        {artCritiqueSeverityLabel(issue.severity)}
                    </Tag>
                </div>
                <h3 className="m-0 text-lg font-semibold leading-7">{issue.title}</h3>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: theme.node.muted }}>
                    <span style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }}>{artCritiqueCategoryLabel(issue.category)}</span>
                    <span className="size-1 rounded-full bg-current opacity-40" aria-hidden="true" />
                    <span>{Math.round(issue.confidence * 100)}% sure</span>
                    {issue.verification && issue.verification.verdict !== "confirmed" ? (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: "color-mix(in oklch, var(--status-warning) 12%, transparent)", color: "var(--status-warning)" }}>
                                                        To be reviewed
                        </span>
                    ) : null}
                </div>
                <div className="rounded-[var(--r-md)] px-3 py-3" style={{ background: theme.node.panel }}>
                    <div className="mb-1 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                                AI judgment
                    </div>
                    <p className="m-0 text-sm leading-6">{issue.explanation}</p>
                </div>
                {issue.targetDescription ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        <span className="font-semibold">Positioning reference:</span>
                        {issue.targetDescription}
                        <span className="ml-1 rounded-full px-1.5 py-0.5" style={{ background: "color-mix(in oklch, var(--workspace-accent) 8%, transparent)" }}>
                            {targetSourceLabel}
                        </span>
                    </div>
                ) : null}
            </section>

            <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Target className="size-4" style={{ color: ART_CRITIQUE_CATEGORY_COLORS[issue.category] }} aria-hidden="true" />
                        <span>Improve</span>
                    </div>
                    {promptStatus === "ready" ? (
                        <Button type="default" size="small" className="shrink-0" icon={<Copy className="size-3.5" />} aria-label="Copy the AI-generated modification prompt word" onClick={() => copyText(issue.editPrompt || "", "AI modification prompt word has been copied")}>
                                                        copy prompt word
                        </Button>
                    ) : (
                        <Button type="default" size="small" className="shrink-0" disabled icon={promptStatus === "pending" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Copy className="size-3.5" />}>
                            {promptStatus === "pending" ? "AI is generating" : "Prompt word not generated"}
                        </Button>
                    )}
                </div>
                {promptStatus === "pending" ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                                After the positioning is completed, AI will combine the problem area to generate prompt words that can be directly used for local editing.
                    </div>
                ) : null}
                {promptStatus === "unavailable" ? (
                    <div className="text-xs leading-5" style={{ color: "var(--status-warning)" }}>
                                                The AI modification prompt word was not generated, please correct it again and try again.
                    </div>
                ) : null}
                <div className="text-sm leading-6">
                    <span className="font-semibold">Goal:</span>
                    {issue.suggestion.goal}
                </div>
                {issue.suggestion.actions.length ? (
                    <div>
                        <div className="mb-1.5 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                                        Recommended action
                        </div>
                        <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-6">
                            {issue.suggestion.actions.map((item, index) => (
                                <li key={item} className="flex items-start gap-2">
                                    <span
                                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[var(--fs-micro)] font-bold"
                                        style={{ background: "color-mix(in oklch, var(--workspace-accent) 10%, transparent)", color: "var(--workspace-accent)" }}
                                    >
                                        {index + 1}
                                    </span>
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                ) : null}
                {issue.suggestion.preserve.length ? (
                    <div className="rounded-[var(--r-md)] px-3 py-2.5" style={{ background: "color-mix(in oklch, var(--status-success) 6%, transparent)" }}>
                        <div className="mb-1 text-xs font-semibold" style={{ color: "var(--status-success)" }}>
                                                        need to retain</div>
                        <ul className="m-0 list-disc space-y-1 pl-4 text-xs leading-5">
                            {issue.suggestion.preserve.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
                <div className="rounded-[var(--r-md)] border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.edge, background: theme.node.panel }}>
                    <span className="font-semibold">Expected results:</span>
                    {issue.suggestion.expectedEffect}
                </div>
            </section>

            <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: theme.node.edge }}>
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} disabled={issueIndex <= 0} onClick={onPrevious}>
                                        Previous item
                </Button>
                <Button type="text" size="small" icon={<ArrowRight className="size-4" />} disabled={issueIndex < 0 || issueIndex >= total - 1} onClick={onNext}>
                                        Next item
                </Button>
            </div>
        </div>
    );
}

function OptionCard({ option, theme }: { option: ArtCritiqueOption; theme: CanvasTheme }) {
    return (
        <article className="rounded-[var(--r-lg)] border px-3 py-3" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4" style={{ color: ART_CRITIQUE_CATEGORY_COLORS[option.category] }} aria-hidden="true" />
                <span className="min-w-0 flex-1">{option.title}</span>
                <span className="shrink-0 text-[11px] font-normal" style={{ color: theme.node.muted }}>
                    {Math.round(option.confidence * 100)}% reference grasp
                </span>
            </div>
            <p className="mt-2 mb-0 text-xs leading-5" style={{ color: theme.node.muted }}>
                {option.explanation}
            </p>
            {option.suggestion.actions.length ? (
                <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 text-xs leading-5">
                    {option.suggestion.actions.slice(0, 3).map((action) => (
                        <li key={action}>{action}</li>
                    ))}
                </ul>
            ) : null}
        </article>
    );
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-[background-color,border-color,box-shadow,color] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
                borderColor: active ? color || "var(--workspace-accent)" : "var(--border-subtle)",
                background: active ? `color-mix(in oklch, ${color || "var(--workspace-accent)"} 12%, transparent)` : "transparent",
                color: active ? color || "var(--workspace-accent)" : "var(--foreground-muted)",
                outlineColor: color || "var(--workspace-accent)",
            }}
            aria-pressed={active}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function CritiqueOverlay({
    issues,
    issueNumberById,
    selectedIssueId,
    labelPlacements,
    onSelect,
}: {
    issues: ArtCritiqueIssue[];
    issueNumberById: ReadonlyMap<string, number>;
    selectedIssueId: string | null;
    labelPlacements: Array<{ x: number; y: number }>;
    onSelect: (id: string) => void;
}) {
    return (
        <svg className="pointer-events-none absolute inset-3 size-[calc(100%-1.5rem)]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="AI marking and marking">
            <title>AI marking and marking</title>
            {issues.map((issue, index) => {
                const renderIssue = repairIssueTarget(issue);
                const issueNumber = issueNumberById.get(renderIssue.id) || index + 1;
                const color = ART_CRITIQUE_SEVERITY_COLORS[renderIssue.severity];
                const selected = renderIssue.id === selectedIssueId;
                const dimmed = Boolean(selectedIssueId) && !selected;
                const approximate = renderIssue.target.type !== "box";
                const uncertain = renderIssue.targetSource === "reference" || renderIssue.verification?.verdict === "uncertain";
                const label = labelPlacements[index] || { x: 0.04, y: 0.06 };
                const bounds = targetBounds(renderIssue.target);
                const labelX = label.x * 100;
                const labelY = label.y * 100;
                return (
                    <g
                        key={renderIssue.id}
                        className="pointer-events-auto cursor-pointer outline-none"
                        opacity={dimmed ? 0.28 : 1}
                        role="button"
                        tabIndex={0}
                        aria-label={`${issueNumber}：${renderIssue.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onSelect(renderIssue.id)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelect(renderIssue.id);
                            }
                        }}
                    >
                        <rect
                            x={bounds.x * 100}
                            y={bounds.y * 100}
                            width={bounds.width * 100}
                            height={bounds.height * 100}
                            rx="1.4"
                            fill={color}
                            fillOpacity={selected ? ".08" : ".015"}
                            stroke={color}
                            strokeWidth={selected ? 0.95 : 0.42}
                            strokeDasharray={renderIssue.target.type === "global" || approximate || uncertain ? "2.2 1.6" : undefined}
                            vectorEffect="non-scaling-stroke"
                        />
                        <rect
                            x={labelX - 3.2}
                            y={labelY - 2.55}
                            width="6.4"
                            height="5.1"
                            rx="1.7"
                            fill={color}
                            fillOpacity={selected ? ".96" : ".7"}
                            stroke="#fff"
                            strokeOpacity={selected ? ".9" : ".62"}
                            strokeWidth=".55"
                            vectorEffect="non-scaling-stroke"
                        />
                        <text x={labelX} y={labelY + 1.05} textAnchor="middle" fill="#fff" fontSize="3.05" fontWeight="700">
                            {issueNumber}
                        </text>
                        <title>{`${issueNumber}：${renderIssue.title}`}</title>
                    </g>
                );
            })}
        </svg>
    );
}
