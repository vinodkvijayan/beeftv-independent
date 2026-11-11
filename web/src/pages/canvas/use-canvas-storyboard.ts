import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import {
    backendProviderConfig,
    buildGenerationConfig,
    generationTaskMetadata,
    resetGenerationTaskMetadata,
    logicalModelIDForConfig,
} from "@/lib/canvas/canvas-project-generation";
import {
    cinematicStoryboardColumns,
    createCanvasNode,
    createStoryboardRow,
    expandStoryboardTextMentions,
    storyboardRowsFromTask,
    storyboardPromptTemplateMetadata,
} from "@/lib/canvas/canvas-project-domain";
import { buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { buildStoryboardAssetCatalog } from "@/lib/canvas/canvas-storyboard-assets";
import { resolveStoryboardGenerationContext } from "@/lib/canvas/canvas-storyboard-context";
import { storyboardCostTargets } from "@/lib/canvas/canvas-storyboard-cost";
import { reconcileStoryboardTargetConnections, storyboardComposerContent, storyboardRowReferenceNodeIds, syncBoundStoryboardNodesForRows } from "@/lib/canvas/canvas-storyboard-materializer";
import { generationErrorMessage } from "@/lib/generation-error";
import { navigateToSettings } from "@/lib/settings-navigation";
import { estimateGenerationCost, type CostEstimateTarget } from "@/services/api/cost-estimate";
import type { Skill } from "@/services/api/skills";
import { createGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { skillRuntime } from "@/services/skill-runtime";
import { submitStoryboardTask } from "@/services/storyboard-submission";
import { getActiveUserScope } from "@/lib/user-scope";
import { modelDisplayName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { workspaceCapabilities } from "@/services/workspace-mode";
import type { CanvasPageUiStoreHook } from "@/stores/canvas/use-canvas-page-ui-store";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasGenerationBatchMode,
    type CanvasNodeData,
    type StoryboardRow,
} from "@/types/canvas";

type UseCanvasStoryboardOptions = {
    pageUi: CanvasPageUiStoreHook;
    projectId: string;
    addedSkills: Skill[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    enqueueGenerationBatch: (sourceNodeId: string, mode: CanvasGenerationBatchMode, targets: Array<{ rowId: string; nodeId: string }>) => string | undefined;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

export function useCanvasStoryboard({
    pageUi,
    projectId,
    addedSkills,
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    enqueueGenerationBatch,
    startGenerationRequest,
    finishGenerationRequest,
}: UseCanvasStoryboardOptions) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const localMode = workspaceCapabilities().local;
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const storyboardRequests = useRef(new Set<string>());
    const storyboardLifetime = useRef(new AbortController());
    useEffect(() => {
        const controller = new AbortController();
        storyboardLifetime.current = controller;
        return () => controller.abort();
    }, [projectId]);

    const confirmGenerationSubmission = useCallback(async (count: number, model: string, taskLabel: string, costTargets: CostEstimateTarget[] = []) => {
        if (!count) return false;
        const cost = costTargets.length
            ? await estimateGenerationCost(costTargets, storyboardLifetime.current.signal).then((estimate) => estimate.summary.text, () => "Estimated cost: Unable to calculate at the moment, actual billing will be based on the selected channel")
            : "";
        return new Promise<boolean>((resolve) => {
            modal.confirm({
                title: `Confirm submission${count} a${taskLabel}Task`,
                content: [`Number of tasks:${count};Model:${modelDisplayName(effectiveConfig, model)}`, cost, localMode ? "After confirmation, it will be submitted to the local task queue." : `will submit${count} external model tasks`].filter(Boolean).join("。") + "。",
                okText: "Confirm generation",
                cancelText: "Cancel",
                centered: true,
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
    }, [effectiveConfig, localMode, modal]);

    const updateScriptRows = useCallback((nodeId: string, updater: (rows: StoryboardRow[]) => StoryboardRow[]) => {
        setNodes((current) => {
            const scriptNode = current.find((node) => node.id === nodeId);
            if (!scriptNode) return current;
            const previousRows = scriptNode.metadata?.storyboard?.rows || [];
            const nextRows = updater(previousRows);
            return syncBoundStoryboardNodesForRows(scriptNode, previousRows, nextRows, current, connectionsRef.current);
        });
    }, [connectionsRef, setNodes]);

    const replaceScriptRows = useCallback((nodeId: string, rows: StoryboardRow[]) => {
        const rowIds = new Set(rows.map((row) => `row:${row.id}`));
        const storyboardRowIds = new Set(rows.map((row) => row.id));
        const previousRows = new Map((nodesRef.current.find((node) => node.id === nodeId)?.metadata?.storyboard?.rows || []).map((row) => [row.id, row]));
        const nextRows = rows.map((row) => invalidateEditedPromptVariables(previousRows.get(row.id), row));
        setConnections((current) => current
            .filter((connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId || !connection.storyboardRowId || storyboardRowIds.has(connection.storyboardRowId))
            .filter((connection) => connection.fromNodeId !== nodeId || !connection.fromHandleId?.startsWith("row:") || rowIds.has(connection.fromHandleId))
            .filter((connection) => connection.toNodeId !== nodeId || !connection.toHandleId?.startsWith("row:") || rowIds.has(connection.toHandleId)));
        updateScriptRows(nodeId, () => nextRows);
    }, [nodesRef, setConnections, updateScriptRows]);

    const addScriptRow = useCallback((nodeId: string) => {
        updateScriptRows(nodeId, (rows) => [...rows, createStoryboardRow(rows.length + 1)]);
    }, [updateScriptRows]);

    const updateScriptRow = useCallback((nodeId: string, rowId: string, patch: Partial<StoryboardRow>) => {
        updateScriptRows(nodeId, (rows) => rows.map((row) => row.id === rowId ? invalidateEditedPromptVariables(row, { ...row, ...patch }) : row));
    }, [updateScriptRows]);

    const removeScriptRow = useCallback((nodeId: string, rowId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const rows = (node?.metadata?.storyboard?.rows || []).filter((row) => row.id !== rowId).map((row, index) => ({ ...row, shotNumber: index + 1 }));
        replaceScriptRows(nodeId, rows);
    }, [nodesRef, replaceScriptRows]);

    const generateScriptRows = useCallback(async (nodeId: string, prompt: string, callerSignal?: AbortSignal) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        if (!scriptNode || !prompt.trim()) return;
        if (storyboardRequests.current.has(nodeId) || scriptNode.metadata?.status === NODE_STATUS_LOADING) { message.warning("The storyboard is currently being processed, please wait for the original task to be completed."); return false; }
        const lifetimeSignal = storyboardLifetime.current.signal;
        // 拆镜登记为画布上的进行中请求：切换画布、同一节点上发起新请求时随之取消。
        const requestController = new AbortController();
        const signal = AbortSignal.any([lifetimeSignal, requestController.signal, ...(callerSignal ? [callerSignal] : [])]);
        const scope = getActiveUserScope();
        const originalRows = JSON.stringify(scriptNode.metadata?.storyboard?.rows || []);
        const assertCurrent = () => {
            signal.throwIfAborted();
            const current = nodesRef.current.find((node) => node.id === nodeId);
            if (getActiveUserScope() !== scope || !current || JSON.stringify(current.metadata?.storyboard?.rows || []) !== originalRows) throw new Error("The canvas, account or storyboard content has changed and the existing shots are not covered. Please re-read and process");
        };
        let storyboardContext: ReturnType<typeof resolveStoryboardGenerationContext>;
        try {
            storyboardContext = resolveStoryboardGenerationContext(nodesRef.current);
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "Storyboard context is incomplete");
            return;
        }
        const shotDuration = scriptNode.metadata?.storyboardShotDuration || "auto";
        const shotDurationSeconds = shotDuration === "auto" ? 0 : Number(shotDuration);
        const shotCount = scriptNode.metadata?.storyboardShotCount || "auto";
        const requestedShotCount = shotCount === "auto" ? 0 : Number(shotCount);
        const expandedPrompt = expandStoryboardTextMentions(prompt, buildNodeMentionReferences(scriptNode, nodesRef.current, connectionsRef.current));
        const generationConfig = buildGenerationConfig(effectiveConfig, scriptNode, "text");
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        storyboardRequests.current.add(nodeId);
        startGenerationRequest(nodeId, nodeId, nodeId, requestController);
        try {
            const skillExecution = await skillRuntime.prepare({
                profile: "shortDrama",
                prompt: expandedPrompt,
                skills: addedSkills,
            });
            assertCurrent();
            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, composerContent: prompt, status: NODE_STATUS_LOADING, taskStage: "Creating task", taskProgress: 0, errorDetails: undefined, ...skillExecution.metadata } } : node));
            assertCurrent();
            const request = {
                projectId,
                type: "canvas_text",
                operation: "storyboard",
                prompt: skillExecution.prompt,
                model: generationConfig.model,
                ...(logicalModelIDForConfig(generationConfig) ? { logicalModelId: logicalModelIDForConfig(generationConfig) } : {}),
                input: {
                    mode: "text",
                    prompt: skillExecution.prompt,
                    canvasAssets: buildStoryboardAssetCatalog(nodesRef.current),
                    requirements: "The output can be directly edited and used to batch generate storyboards for pictures and videos.",
                    projectStyle: storyboardContext.projectStyle,
                    characters: storyboardContext.characters,
                    shotDurationSeconds,
                    shotCount: requestedShotCount,
                    config: backendProviderConfig(generationConfig),
                    metadata: { nodeId, ...skillExecution.metadata },
                },
            };
            const managed = Boolean(logicalModelIDForConfig(generationConfig) || resolveModelRequestConfig(generationConfig, generationConfig.model).channelId);
            const task = managed ? await submitStoryboardTask(request, { signal, assertCurrent, confirm: (submission) => localMode ? Promise.resolve(true) : new Promise<boolean>((resolve) => {
                const execution = submission.execution;
                const dialog = modal.confirm({
                    title: "Confirm to generate storyboard",
                    content: `Use${modelDisplayName(effectiveConfig, execution.model)} Split shot.${(scriptNode.metadata?.storyboard?.rows || []).length ? "This time, the existing storyboard lines will be replaced, the original pictures and videos will be retained, and the shot correlation needs to be rechecked." : "After confirmation, an editable storyboard will be generated."}`,
                    okText: "Confirm generation", cancelText: "Cancel", centered: true,
                    onOk: () => resolve(true), onCancel: () => resolve(false),
                    afterClose: () => signal.removeEventListener("abort", cancel),
                });
                const cancel = () => { dialog.destroy(); resolve(false); };
                signal.addEventListener("abort", cancel, { once: true });
                if (signal.aborted) cancel();
            }) }) : await (async () => {
                const confirmed = await confirmGenerationSubmission(1, generationConfig.model, `Professional mirror removal${(scriptNode.metadata?.storyboard?.rows || []).length ? "(replaces existing footage, retaining original media)" : ""}`);
                if (!confirmed) return undefined;
                assertCurrent();
                return createGenerationTask(request);
            })();
            if (!task) {
                if (!signal.aborted && scope === getActiveUserScope()) setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: scriptNode.metadata?.status || NODE_STATUS_IDLE, taskStage: undefined } } : node));
                return false;
            }
            assertCurrent();
            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...generationTaskMetadata(task), status: NODE_STATUS_LOADING } } : node));
            const completed = await waitForGenerationTask(task.id, {
                initialTask: task,
                signal,
                useTextEvents: true,
                onTaskUpdate: (next) => { if (!signal.aborted && scope === getActiveUserScope()) setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...generationTaskMetadata(next), status: NODE_STATUS_LOADING } } : node)); },
            });
            const result = storyboardRowsFromTask(completed);
            assertCurrent();
            replaceScriptRows(nodeId, result.rows);
            setNodes((current) => current.map((node) => node.id === nodeId ? {
                ...node,
                title: result.title || node.title,
                metadata: {
                    ...node.metadata,
                    status: NODE_STATUS_SUCCESS,
                    errorDetails: undefined,
                    ...generationTaskMetadata(completed),
                    storyboard: {
                        rows: result.rows,
                        visibleColumns: cinematicStoryboardColumns(node.metadata?.storyboard?.visibleColumns),
                        referenceNodeIds: node.metadata?.storyboard?.referenceNodeIds || [],
                    },
                },
            } : node));
            message.success(`Generated${result.rows.length} shot`);
            return true;
        } catch (error) {
            if (signal.aborted || scope !== getActiveUserScope()) return false;
            const details = generationErrorMessage(error);
            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : node));
            message.error(details);
            return false;
        } finally {
            // 被同一节点上的新请求接替时，节点归新请求，这里不再改它的状态。
            if (signal.aborted && !lifetimeSignal.aborted && !requestController.signal.aborted && scope === getActiveUserScope()) setNodes((current) => current.map((node) => {
                if (node.id !== nodeId) return node;
                const active = node.metadata?.taskStatus === "queued" || node.metadata?.taskStatus === "running";
                return { ...node, metadata: { ...node.metadata, status: active ? NODE_STATUS_LOADING : NODE_STATUS_IDLE, taskStage: active ? "Submitted background task, waiting for results" : undefined } };
            }));
            storyboardRequests.current.delete(nodeId);
            finishGenerationRequest(nodeId, requestController);
        }
    }, [addedSkills, confirmGenerationSubmission, connectionsRef, effectiveConfig, finishGenerationRequest, isAiConfigReady, localMode, message, modal, nodesRef, projectId, replaceScriptRows, setNodes, startGenerationRequest]);

    const ensureScriptImageNodes = useCallback((nodeId: string, rowIds: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = (scriptNode?.metadata?.storyboard?.rows || []).filter((row) => rowIds.includes(row.id));
        if (!scriptNode || !rows.length) return [];
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const startX = scriptNode.position.x + scriptNode.width + 120;
        const nextNodes = [...nodesRef.current];
        let nextConnections = [...connectionsRef.current];
        const targets: Array<{ row: StoryboardRow; node: CanvasNodeData; prompt: string }> = [];
        rows.forEach((row, index) => {
            const prompt = (row.imageGenerationPrompt || row.plotDescription).trim();
            const existing = row.imageNodeId ? nextNodes.find((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image) : undefined;
            const existingMetadata = existing?.metadata?.content ? existing.metadata : resetGenerationTaskMetadata(existing?.metadata);
            const referenceIds = storyboardRowReferenceNodeIds(scriptNode, row, nextNodes, nextConnections, false, existing?.id);
            const composerContent = storyboardComposerContent(prompt, referenceIds, nextNodes);
            const imageNode = existing
                ? { ...existing, metadata: { ...existingMetadata, prompt, composerContent, ...storyboardPromptTemplateMetadata(row, "image"), workflowKind: "shot" as const, workflowTitle: `lens${row.shotNumber} Storyboards`, shotIndex: row.shotNumber } }
                : createCanvasNode(CanvasNodeType.Image, { x: startX + imageSpec.width / 2, y: scriptNode.position.y + index * (imageSpec.height + 36) + imageSpec.height / 2 }, { prompt, composerContent, ...storyboardPromptTemplateMetadata(row, "image"), workflowKind: "shot", workflowTitle: `lens${row.shotNumber} Storyboards`, shotIndex: row.shotNumber, status: NODE_STATUS_IDLE });
            if (!existing) {
                imageNode.title = `lens${row.shotNumber} · Storyboards`;
                nextNodes.push(imageNode);
            } else {
                const existingIndex = nextNodes.findIndex((node) => node.id === existing.id);
                nextNodes[existingIndex] = imageNode;
            }
            nextConnections = reconcileStoryboardTargetConnections(nextConnections, scriptNode, row, imageNode.id, referenceIds);
            targets.push({ row, node: imageNode, prompt });
        });
        const imageNodeByRowId = new Map(targets.map((target) => [target.row.id, target.node.id]));
        const scriptIndex = nextNodes.findIndex((node) => node.id === scriptNode.id);
        nextNodes[scriptIndex] = {
            ...scriptNode,
            metadata: {
                ...scriptNode.metadata,
                storyboard: {
                    rows: (scriptNode.metadata?.storyboard?.rows || []).map((row) => ({ ...row, imageNodeId: imageNodeByRowId.get(row.id) || row.imageNodeId })),
                    visibleColumns: scriptNode.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
                    referenceNodeIds: scriptNode.metadata?.storyboard?.referenceNodeIds || [],
                },
            },
        };
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        return targets;
    }, [connectionsRef, nodesRef, setConnections, setNodes]);

    const createScriptImageNodes = useCallback((nodeId: string, rowIds?: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = scriptNode?.metadata?.storyboard?.rows || [];
        const selectedRows = rowIds?.length ? rows.filter((row) => rowIds.includes(row.id)) : rows;
        if (!scriptNode || !selectedRows.length) return;
        const missing = selectedRows.filter((row) => !(row.imageGenerationPrompt || row.plotDescription).trim());
        if (missing.length) return message.warning(`Yes${missing.length} Shots are missing descriptions or picture prompts`);
        const createdCount = selectedRows.filter((row) => !row.imageNodeId || !nodesRef.current.some((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image)).length;
        ensureScriptImageNodes(nodeId, selectedRows.map((row) => row.id));
        message.success(createdCount ? `Created${createdCount} image nodes` : "Prompt words for synchronized existing image nodes");
    }, [ensureScriptImageNodes, message, nodesRef]);

    const generateScriptImages = useCallback(async (nodeId: string, rowIds: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = (scriptNode?.metadata?.storyboard?.rows || []).filter((row) => rowIds.includes(row.id));
        if (!scriptNode || !rows.length) return;
        const missing = rows.filter((row) => !(row.imageGenerationPrompt || row.plotDescription).trim());
        if (missing.length) return message.warning(`Yes${missing.length} Shots are missing descriptions or picture prompts`);
        const imageModel = buildGenerationConfig(effectiveConfig, undefined, "image").model;
        if (!isAiConfigReady(effectiveConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const activeNodeIds = activeGenerationBatchNodeIds(scriptNode, "storyboard_image");
        const targetRows = rows.filter((row) => {
            const imageNode = row.imageNodeId ? nodesRef.current.find((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image) : undefined;
            return !imageNode?.metadata?.content && (!imageNode || !activeNodeIds.has(imageNode.id));
        });
        if (!targetRows.length) return message.info("The selected storyboard has been generated or is being generated");
        if (!await confirmGenerationSubmission(targetRows.length, imageModel, "Image generation", storyboardCostTargets(effectiveConfig, "image", scriptNode, targetRows, nodesRef.current, connectionsRef.current))) return;
        const targets = ensureScriptImageNodes(nodeId, targetRows.map((row) => row.id));
        if (enqueueGenerationBatch(nodeId, "storyboard_image", targets.map((target) => ({ rowId: target.row.id, nodeId: target.node.id })))) message.success("Storyboards have been added to the generation queue");
    }, [connectionsRef, effectiveConfig, enqueueGenerationBatch, ensureScriptImageNodes, confirmGenerationSubmission, isAiConfigReady, message, nodesRef]);

    const createScriptVideoNodes = useCallback((nodeId: string, silent = false, rowIds?: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const allRows = scriptNode?.metadata?.storyboard?.rows || [];
        const rows = rowIds?.length ? allRows.filter((row) => rowIds.includes(row.id)) : allRows;
        if (!scriptNode || !rows.length) return;
        const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        const startLeft = scriptNode.position.x + scriptNode.width + 120;
        const videoModel = buildGenerationConfig(effectiveConfig, undefined, "video").model;
        const nextNodes = [...nodesRef.current];
        let nextConnections = [...connectionsRef.current];
        const videoNodeByRowId = new Map<string, string>();
        let createdCount = 0;
        rows.forEach((row, index) => {
            const prompt = (row.videoMotionPrompt || row.plotDescription).trim();
            const existingIndex = row.videoNodeId ? nextNodes.findIndex((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : -1;
            const existing = existingIndex >= 0 ? nextNodes[existingIndex] : undefined;
            const referenceIds = storyboardRowReferenceNodeIds(scriptNode, row, nextNodes, nextConnections, false, existing?.id);
            const composerContent = storyboardComposerContent(prompt, referenceIds, nextNodes);
            if (existingIndex >= 0) {
                const existing = nextNodes[existingIndex];
                const existingMetadata = existing.metadata?.content ? existing.metadata : resetGenerationTaskMetadata(existing.metadata);
                nextNodes[existingIndex] = { ...existing, metadata: { ...existingMetadata, prompt, composerContent, model: videoModel, ...storyboardPromptTemplateMetadata(row, "video"), seconds: String(row.durationSeconds), shotIndex: row.shotNumber, workflowKind: "shot", workflowTitle: `lens${row.shotNumber} video`, generationMode: "video", videoEditOperation: existing.metadata?.videoEditOperation || "text_to_video" } };
                nextConnections = reconcileStoryboardTargetConnections(nextConnections, scriptNode, row, existing.id, referenceIds);
                videoNodeByRowId.set(row.id, existing.id);
                return;
            }
            const videoNode = createCanvasNode(CanvasNodeType.Video, { x: startLeft + videoSpec.width / 2, y: scriptNode.position.y + index * (videoSpec.height + 36) + videoSpec.height / 2 }, { prompt, composerContent, model: videoModel, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot", workflowTitle: `lens${row.shotNumber} video`, shotIndex: row.shotNumber, generationMode: "video", videoEditOperation: "text_to_video", status: NODE_STATUS_IDLE, seconds: String(row.durationSeconds) });
            videoNode.title = `lens${row.shotNumber} · Video`;
            nextNodes.push(videoNode);
            nextConnections = reconcileStoryboardTargetConnections(nextConnections, scriptNode, row, videoNode.id, referenceIds);
            videoNodeByRowId.set(row.id, videoNode.id);
            createdCount += 1;
        });
        const scriptIndex = nextNodes.findIndex((node) => node.id === scriptNode.id);
        nextNodes[scriptIndex] = {
            ...scriptNode,
            metadata: {
                ...scriptNode.metadata,
                storyboard: {
                    rows: allRows.map((row) => ({ ...row, videoNodeId: videoNodeByRowId.get(row.id) || row.videoNodeId })),
                    visibleColumns: scriptNode.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
                    referenceNodeIds: scriptNode.metadata?.storyboard?.referenceNodeIds || [],
                },
            },
        };
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        if (!silent) message.success(createdCount ? `Created${createdCount} video nodes` : "Prompt words for synchronized existing video nodes");
    }, [connectionsRef, effectiveConfig, message, nodesRef, setConnections, setNodes]);

    const createAndGenerateScriptVideos = useCallback(async (nodeId: string, rowIds?: string[]) => {
        const videoModel = buildGenerationConfig(effectiveConfig, undefined, "video").model;
        if (!isAiConfigReady(effectiveConfig, videoModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        let scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const allRows = scriptNode?.metadata?.storyboard?.rows || [];
        const rows = rowIds?.length ? allRows.filter((row) => rowIds.includes(row.id)) : allRows;
        const describedRows = rows.filter((row) => Boolean((row.videoMotionPrompt || row.plotDescription).trim()));
        const activeNodeIds = scriptNode ? activeGenerationBatchNodeIds(scriptNode, "storyboard_video") : new Set<string>();
        const targetRows = describedRows.filter((row) => {
            const videoNode = row.videoNodeId ? nodesRef.current.find((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            return !videoNode?.metadata?.content && (!videoNode || !activeNodeIds.has(videoNode.id));
        });
        if (!targetRows.length) {
            if (describedRows.some((row) => row.videoNodeId && nodesRef.current.some((node) => node.id === row.videoNodeId && Boolean(node.metadata?.content)))) message.info("Lens video already exists");
            else message.warning("Please add a description of the lens first");
            return;
        }
        const costTargets = scriptNode ? storyboardCostTargets(effectiveConfig, "text_to_video", scriptNode, targetRows, nodesRef.current, connectionsRef.current, videoModel) : [];
        if (!await confirmGenerationSubmission(targetRows.length, videoModel, "video generation", costTargets)) return;
        createScriptVideoNodes(nodeId, true, targetRows.map((row) => row.id));
        scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const targetRowIds = new Set(targetRows.map((row) => row.id));
        const targets = rows.flatMap((row) => {
            if (!targetRowIds.has(row.id)) return [];
            const currentRow = scriptNode?.metadata?.storyboard?.rows.find((item) => item.id === row.id) || row;
            const videoNode = currentRow.videoNodeId ? nodesRef.current.find((node) => node.id === currentRow.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            if (!videoNode || videoNode.metadata?.content) return [];
            const prompt = (currentRow.videoMotionPrompt || currentRow.plotDescription).trim();
            if (!prompt) return [];
            return [{ row: currentRow, videoNode, prompt }];
        });
        const targetById = new Map(targets.map((target) => [target.videoNode.id, target]));
        const nextNodes = nodesRef.current.map((node) => {
            const target = targetById.get(node.id);
            return target ? { ...node, metadata: { ...node.metadata, prompt: target.prompt, composerContent: target.videoNode.metadata?.composerContent || target.prompt, model: videoModel, ...storyboardPromptTemplateMetadata(target.row, "video"), generationMode: "video" as const, videoEditOperation: "text_to_video" as const, videoStartFrameNodeId: undefined } } : node;
        });
        const nextConnections = connectionsRef.current;
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        pageUi.getState().setSelectedNodeIds(new Set(targets.map((target) => target.videoNode.id)));
        if (enqueueGenerationBatch(nodeId, "storyboard_video", targets.map((target) => ({ rowId: target.row.id, nodeId: target.videoNode.id })))) message.success("Lens video has been added to the generation queue");
    }, [pageUi, projectId, connectionsRef, confirmGenerationSubmission, createScriptVideoNodes, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes]);

    const createScriptActionBoards = useCallback(async (nodeId: string) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = scriptNode?.metadata?.storyboard?.rows || [];
        if (!scriptNode || !rows.length) return;
        const imageModel = buildGenerationConfig(effectiveConfig, undefined, "image").model;
        if (!isAiConfigReady(effectiveConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const actionBoardRows = rows.filter((row) => !nodesRef.current.some((node) => node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "action_board" && node.metadata.shotIndex === row.shotNumber && Boolean(node.metadata.content)));
        if (!actionBoardRows.length) {
            message.info("Action splitboard already exists");
            return;
        }
        if (!await confirmGenerationSubmission(actionBoardRows.length, imageModel, "Action board generation", storyboardCostTargets(effectiveConfig, "action_board", scriptNode, actionBoardRows, nodesRef.current, connectionsRef.current))) return;
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const startX = scriptNode.position.x + scriptNode.width + 120;
        const nextNodes = [...nodesRef.current];
        const nextConnections = [...connectionsRef.current];
        const targets: Array<{ row: StoryboardRow; node: CanvasNodeData; prompt: string }> = [];
        actionBoardRows.forEach((row, index) => {
            const prompt = [
                "Generate a 12-grid reference picture split into movie actions, strictly 3 columns and 4 rows, with 12 grids clearly separated, keeping the same characters, costumes, scenes and lighting continuous.",
                `lens${row.shotNumber}：${row.plotDescription || row.videoMotionPrompt || "Complete actions according to the scene’s plot"}`,
                row.characters.length ? `Role:${row.characters.map((item) => item.characterName).join("、")}` : "",
                "Show the starting point, progression, turning point, landing point, and ending posture of the action in chronological order. Do not add text, border titles, or additional images.",
            ].filter(Boolean).join("\n");
            const existingIndex = nextNodes.findIndex((node) => node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "action_board" && node.metadata.shotIndex === row.shotNumber);
            if (existingIndex >= 0 && nextNodes[existingIndex].metadata?.content) return;
            const imageNode = existingIndex >= 0
                ? { ...nextNodes[existingIndex], metadata: { ...resetGenerationTaskMetadata(nextNodes[existingIndex].metadata), prompt } }
                : createCanvasNode(CanvasNodeType.Image, { x: startX + imageSpec.width / 2, y: scriptNode.position.y + index * (imageSpec.height + 36) + imageSpec.height / 2 }, { prompt, workflowKind: "action_board", workflowTitle: `lens${row.shotNumber} action board`, shotIndex: row.shotNumber, actionBoardRows: 4, actionBoardColumns: 3, status: NODE_STATUS_IDLE });
            imageNode.title = `lens${row.shotNumber} · Action board`;
            if (existingIndex >= 0) nextNodes[existingIndex] = imageNode;
            else {
                nextNodes.push(imageNode);
                nextConnections.push({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: imageNode.id, fromHandleId: `row:${row.id}` });
            }
            targets.push({ row, node: imageNode, prompt });
        });
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        if (enqueueGenerationBatch(nodeId, "action_board", targets.map((target) => ({ rowId: target.row.id, nodeId: target.node.id })))) message.success("Action splitboard has been added to the build queue");
    }, [connectionsRef, confirmGenerationSubmission, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes]);

    const generateScriptVideos = useCallback(async (nodeId: string, rowIds: string[]) => {
        let scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = (scriptNode?.metadata?.storyboard?.rows || []).filter((row) => rowIds.includes(row.id));
        if (!scriptNode || !rows.length) return;
        const readyRows = rows.filter((row) => row.imageNodeId && nodesRef.current.some((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image && node.metadata?.content));
        if (!readyRows.length) return message.warning("Please generate and check the first frame of the selected shot first");
        if (readyRows.length !== rows.length) return message.warning(`${rows.length - readyRows.length} There is no first frame available for the selected shots. Please generate and check them all before confirming.`);
        const videoModel = buildGenerationConfig(effectiveConfig, undefined, "video").model;
        if (!isAiConfigReady(effectiveConfig, videoModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const activeNodeIds = activeGenerationBatchNodeIds(scriptNode, "storyboard_video");
        const targetRows = readyRows.filter((row) => {
            const videoNode = row.videoNodeId ? nodesRef.current.find((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            return !videoNode?.metadata?.content && (!videoNode || !activeNodeIds.has(videoNode.id));
        });
        if (!targetRows.length) return message.info("The selected footage video has been generated or is being generated");
        if (!await confirmGenerationSubmission(targetRows.length, videoModel, "video generation", storyboardCostTargets(effectiveConfig, "image_to_video", scriptNode, targetRows, nodesRef.current, connectionsRef.current, videoModel))) return;
        createScriptVideoNodes(nodeId, true, targetRows.map((row) => row.id));
        scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        if (!scriptNode) return;
        const currentScriptNode = scriptNode;
        const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        const currentRows = targetRows.map((row) => currentScriptNode.metadata?.storyboard?.rows.find((item) => item.id === row.id) || row);
        const startX = Math.max(...currentRows.map((row) => nodesRef.current.find((node) => node.id === row.imageNodeId)?.position.x || currentScriptNode.position.x + currentScriptNode.width)) + videoSpec.width + 120;
        const nextNodes = [...nodesRef.current];
        let nextConnections = [...connectionsRef.current];
        const targets: Array<{ row: StoryboardRow; node: CanvasNodeData; prompt: string }> = [];
        currentRows.forEach((row, index) => {
            const prompt = (row.videoMotionPrompt || row.plotDescription).trim();
            const existing = row.videoNodeId ? nextNodes.find((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            const referenceIds = storyboardRowReferenceNodeIds(currentScriptNode, row, nextNodes, nextConnections, true, existing?.id);
            const composerContent = storyboardComposerContent(prompt, referenceIds, nextNodes);
            const existingMetadata = existing?.metadata?.content ? existing.metadata : resetGenerationTaskMetadata(existing?.metadata);
            const videoNode = existing
                ? { ...existing, metadata: { ...existingMetadata, prompt, composerContent, model: videoModel, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot" as const, workflowTitle: `lens${row.shotNumber} video`, shotIndex: row.shotNumber, generationMode: "video" as const, videoEditOperation: "image_to_video" as const, videoStartFrameNodeId: row.imageNodeId, seconds: String(row.durationSeconds) } }
                : createCanvasNode(CanvasNodeType.Video, { x: startX, y: currentScriptNode.position.y + index * (videoSpec.height + 36) + videoSpec.height / 2 }, { prompt, composerContent, model: videoModel, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot", workflowTitle: `lens${row.shotNumber} video`, shotIndex: row.shotNumber, generationMode: "video", videoEditOperation: "image_to_video", videoStartFrameNodeId: row.imageNodeId, status: NODE_STATUS_IDLE, seconds: String(row.durationSeconds) });
            if (!existing) {
                videoNode.title = `lens${row.shotNumber} · Video`;
                nextNodes.push(videoNode);
            } else {
                const existingIndex = nextNodes.findIndex((node) => node.id === existing.id);
                nextNodes[existingIndex] = videoNode;
            }
            nextConnections = reconcileStoryboardTargetConnections(nextConnections, currentScriptNode, row, videoNode.id, referenceIds);
            targets.push({ row, node: videoNode, prompt });
        });
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        if (enqueueGenerationBatch(nodeId, "storyboard_video", targets.map((target) => ({ rowId: target.row.id, nodeId: target.node.id })))) message.success("Lens video has been added to the generation queue");
    }, [connectionsRef, confirmGenerationSubmission, createScriptVideoNodes, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes]);

    return {
        addScriptRow,
        createAndGenerateScriptVideos,
        createScriptActionBoards,
        createScriptImageNodes,
        createScriptVideoNodes,
        generateScriptImages,
        generateScriptRows,
        generateScriptVideos,
        removeScriptRow,
        replaceScriptRows,
        updateScriptRow,
        updateScriptRows,
    };
}

function invalidateEditedPromptVariables(previous: StoryboardRow | undefined, next: StoryboardRow) {
    if (!previous) return next;
    return {
        ...next,
        imagePromptTemplateVariables: next.imageGenerationPrompt === previous.imageGenerationPrompt ? next.imagePromptTemplateVariables : undefined,
        videoPromptTemplateVariables: next.videoMotionPrompt === previous.videoMotionPrompt ? next.videoPromptTemplateVariables : undefined,
    };
}

function activeGenerationBatchNodeIds(node: CanvasNodeData, mode: CanvasGenerationBatchMode) {
    return new Set((node.metadata?.generationBatches || [])
        .filter((batch) => batch.mode === mode)
        .flatMap((batch) => batch.items
            .filter((item) => item.status === "waiting" || item.status === "submitting" || item.status === "queued" || item.status === "running")
            .map((item) => item.nodeId)));
}
