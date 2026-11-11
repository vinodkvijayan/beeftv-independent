import { hydrateBackendGeneratedOutputs } from "@/services/project-asset-sync";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { nanoid } from "nanoid";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelCompatibilityError } from "@/lib/model-selection";

import { promoteLegacyBatchTableSize } from "@/lib/canvas/canvas-batch-table";
import { persistCanvasDocument } from "@/services/local-workspace-repository";
import { cancelGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { canvasTaskConfirmation } from "./canvas-task-confirmation";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import type { Skill } from "@/services/api/skills";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

import {
    createImageNodeFromTextSource,
    createInsertingHistoryGate,
    rebaseInsertedCanvasNode,
    reconcileImageBatchRootNodes,
    runImageBatchChildRetry,
    runOwnedCanvasHistoryInsert,
    selectRetryableImageBatchChildren,
} from "./canvas-generation-orchestration";
import { readOwnedCanvasNodes, useCanvasOwnerLifetime } from "./canvas-owner-epoch";
import { useCanvasBatchTable } from "./use-canvas-batch-table";
import { useCanvasGeneration } from "./use-canvas-generation";
import { useCanvasGenerationBatches } from "./use-canvas-generation-batches";
import { useCanvasGenerationExecutor } from "./use-canvas-generation-executor";
import { useCanvasGenerationRetry } from "./use-canvas-generation-retry";
import { useCanvasStoryboard } from "./use-canvas-storyboard";
import type { CanvasPageUiStoreHook } from "@/stores/canvas/use-canvas-page-ui-store";

type UseCanvasGenerationOrchestrationOptions = {
    pageUi: CanvasPageUiStoreHook;
    projectId: string;
    /** 生成任务查询与 live 绑定：短剧关闭时为空。 */
    linkedProjectId?: string;
    /** 执行器 / 重试 / 历史插入的素材归属，沿用当前画布项目 id。 */
    domainProjectId?: string;
    projectLoaded: boolean;
    localOnly: boolean;
    addedSkills: Skill[];
    assets: Asset[];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setGenerationHistoryOpen: Dispatch<SetStateAction<boolean>>;
    getCanvasCenter: () => Position;
};

export function useCanvasGenerationOrchestration({
    pageUi,
    projectId,
    linkedProjectId,
    domainProjectId,
    projectLoaded,
    localOnly,
    addedSkills,
    assets,
    nodes,
    connections,
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setGenerationHistoryOpen,
    getCanvasCenter,
}: UseCanvasGenerationOrchestrationOptions) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const effectiveConfig = useEffectiveConfig();
    const insertingHistory = useRef(createInsertingHistoryGate());
    const projectIdRef = useRef(projectId);
    projectIdRef.current = projectId;
    const { lifetime } = useCanvasOwnerLifetime(projectId);

    const {
        applyGenerationTaskResult,
        bindGenerationTask,
        finishGenerationRequest,
        openNodeTaskDetails,
        retrieveTaskResult,
        retrievingTaskId,
        runningNodeId,
        setRunningNodeId,
        setTaskDetail,
        startGenerationRequest,
        taskDetail,
        taskDetailLoading,
        taskDetailError,
        taskDetailLogs,
    } = useCanvasGeneration({
        projectId,
        domainProjectId: linkedProjectId,
        projectLoaded,
        nodes,
        nodesRef,
        setNodes,
    });

    const handleGenerateNode = useCanvasGenerationExecutor({
        pageUi,
        projectId,
        domainProjectId,
        addedSkills,
        assets,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setRunningNodeId,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
        applyGenerationTaskResult,
    });

    const { enqueueGenerationBatch, retryFailedBatchItems, stopRemainingBatchItems } = useCanvasGenerationBatches({
        projectId,
        projectLoaded,
        nodes,
        nodesRef,
        setNodes,
        handleGenerateNode,
    });

    const {
        addReferenceColumn: addBatchReferenceColumn,
        addRow: addBatchRow,
        fillRowsFromConnections,
        generateRows: generateBatchRows,
        moveReferenceCell: moveBatchReferenceCell,
        patchTable: patchBatchTable,
        removeReferenceColumn: removeBatchReferenceColumn,
        removeRow: removeBatchRow,
        reorderReferenceColumns: reorderBatchReferenceColumns,
        syncRowsFromConnections,
        updateRow: updateBatchRow,
    } = useCanvasBatchTable({
        pageUi,
        projectId,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        enqueueGenerationBatch,
    });

    useEffect(() => {
        if (!projectLoaded) return;
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const promoted = promoteLegacyBatchTableSize(node);
                if (promoted !== node) changed = true;
                return promoted;
            });
            return changed ? next : current;
        });
        nodesRef.current.filter((node) => node.type === CanvasNodeType.BatchTable).forEach((node) => {
            syncRowsFromConnections(node.id, true);
        });
    }, [connections, nodesRef, projectLoaded, setNodes, syncRowsFromConnections]);

    const {
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
    } = useCanvasStoryboard({
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
    });

    const handleRetryNode = useCanvasGenerationRetry({
        projectId,
        domainProjectId,
        addedSkills,
        assets,
        nodesRef,
        connectionsRef,
        setNodes,
        setRunningNodeId,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
        applyGenerationTaskResult,
        regenerateImageBatch: async (nodeId, prompt) => { await handleGenerateNode(nodeId, "image", prompt); },
    });

    const cancelCanvasTask = useCallback(
        (task: GenerationTask) => {
            const deliveryOnly = task.status === "succeeded";
            const owner = lifetime.capture(projectId);
            const isCurrent = () => lifetime.matches(owner, projectIdRef.current);
            modal.confirm({
                ...canvasTaskConfirmation,
                title: deliveryOnly ? "Stop retrieving results?" : "Cancel build task?",
                content: deliveryOnly ? "The generated results will be retained and can be retrieved later." : localOnly ? "The task stops local execution immediately." : "The task will immediately stop local execution; if it has been submitted to the upstream, the system will continue to check the cancellation result and points status.",
                okText: deliveryOnly ? "Stop retrieval" : "Cancel task",
                cancelText: "Keep waiting",
                onOk: async () => {
                    if (!isCurrent()) return;
                    try {
                        const next = await cancelGenerationTask(task.id);
                        if (!isCurrent()) return;
                        const node = nodesRef.current.find((item) => item.metadata?.taskId === task.id);
                        if (node) bindGenerationTask(node.id, next);
                        setTaskDetail((current) => (current?.id === task.id ? next : current));
                        await queryClient.invalidateQueries({ queryKey: ["canvas-active-tasks", projectId] });
                        if (!isCurrent()) return;
                        message.success(deliveryOnly ? "Retrieval has stopped" : "Task canceled");
                    } catch (error) {
                        if (!isCurrent()) return;
                        message.error(error instanceof Error ? error.message : "Failed to cancel task");
                    }
                },
            });
        },
        [bindGenerationTask, lifetime, localOnly, message, modal, nodesRef, projectId, queryClient, setTaskDetail],
    );

    const insertGenerationHistoryTask = useCallback(
        async (task: GenerationTask) => {
            if (!insertingHistory.current.tryEnter()) return;
            const owner = lifetime.capture(projectId);
            try {
                await hydrateBackendGeneratedOutputs(task);
                await runOwnedCanvasHistoryInsert({
                    owner,
                    getLiveCanvasId: () => projectIdRef.current,
                    getLiveLifetime: () => lifetime.current(),
                    task,
                    projectId: owner.canvasId,
                    domainProjectId,
                    center: getCanvasCenter(),
                    nodes: nodesRef.current,
                    assets: useAssetStore.getState().assets,
                    readLiveNodes: () => readOwnedCanvasNodes({
                        owner,
                        liveCanvasId: projectIdRef.current,
                        liveLifetime: lifetime.current(),
                        pageNodes: nodesRef.current,
                        storedNodes: useCanvasStore.getState().openProject(owner.canvasId)?.nodes,
                    }),
                    persist: (persisted) => persistCanvasDocument(owner.canvasId, { nodes: persisted }),
                    ensureAsset: (item) => ensureCanvasNodeAsset({ canvasId: owner.canvasId, domainProjectId, node: item, source: "canvas-generation", taskId: task.id }),
                    onCommit: (node, insertedNodes) => {
                        setNodes((current) => insertedNodes.reduce((nodes, inserted) => rebaseInsertedCanvasNode(nodes, inserted), current));
                        pageUi.getState().setSelectedNodeIds(new Set([node.id]));
                        setGenerationHistoryOpen(false);
                        message.success("Inserted into canvas from build history");
                    },
                });
            } catch (error) {
                message.error(error instanceof Error ? error.message : "The generated results cannot be inserted into the canvas");
            } finally {
                insertingHistory.current.exit();
            }
        },
        [pageUi, domainProjectId, getCanvasCenter, lifetime, message, nodesRef, projectId, setGenerationHistoryOpen, setNodes],
    );

    const reconcileImageBatchRootNode = useCallback(
        (rootId: string) => {
            setNodes((current) => reconcileImageBatchRootNodes(rootId, current));
        },
        [setNodes],
    );

    const retryImageBatchChildren = useCallback(
        (rootId: string, children: CanvasNodeData[]) => {
            const { retryable, blocked } = selectRetryableImageBatchChildren(children);
            if (blocked) message.warning("Some pictures need to deal with the failure reasons first, please open the corresponding node to view");
            if (!retryable.length) return;
            const root = nodesRef.current.find((node) => node.id === rootId);
            if (root) {
                const config = buildGenerationConfig(effectiveConfig, root, "image");
                if (modelCapabilityConfigFor(config, config.model).image?.fixedOutputs) {
                    if ((root.metadata?.batchChildIds?.length || 0) > (modelCapabilityConfigFor(config, config.model).image?.fixedOutputs || 0)) {
                        const tasks = new Set<string>();
                        void (async () => {
                            for (const child of retryable) {
                                const taskId = child.metadata?.taskId || child.id;
                                if (tasks.has(taskId)) continue;
                                tasks.add(taskId);
                                await handleRetryNode(child);
                            }
                        })();
                    } else void handleRetryNode(root);
                    return;
                }
            }
            void runImageBatchChildRetry({
                rootId,
                children: retryable,
                retry: handleRetryNode,
                setNodes,
                reconcile: reconcileImageBatchRootNode,
            });
        },
        [effectiveConfig, handleRetryNode, message, nodesRef, reconcileImageBatchRootNode, setNodes],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const created = createImageNodeFromTextSource({
                sourceId: node.id,
                prompt: node.metadata?.content || node.metadata?.prompt || "",
                nodes: nodesRef.current,
                connections: connectionsRef.current,
                config: effectiveConfig,
                connectionId: nanoid(),
            });
            if (!created.ok) {
                if (created.reason === "empty-prompt") message.warning("The text node is empty and the graph cannot be generated.");
                return;
            }
            nodesRef.current = created.nextNodes;
            connectionsRef.current = created.nextConnections;
            setNodes(created.nextNodes);
            setConnections(created.nextConnections);
            pageUi.getState().setSelectedNodeIds(new Set([created.imageNode.id]));
            pageUi.getState().setSelectedConnectionId(null);
            pageUi.getState().setDialogNodeId(created.imageNode.id);
        },
        [pageUi, connectionsRef, effectiveConfig, message, nodesRef, projectId, setConnections, setNodes],
    );

    const generateFinalVideoFromDraftNode = useCallback(
        (node: CanvasNodeData, resolution: "720p" | "1080p") => {
            const draftTaskId = node.metadata?.taskProviderRequestId?.trim();
            if (!draftTaskId) {
                message.warning("This sample lacks the upstream task ID and cannot be directly converted into a high-definition film.");
                return;
            }
            const promptText = node.metadata?.prompt || "";
            const childNode: CanvasNodeData = {
                id: nanoid(),
                type: CanvasNodeType.Video,
                title: `${node.title || "Samples"} (${resolution.toUpperCase()} finished film)`.slice(0, 36),
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: node.width,
                height: node.height,
                metadata: {
                    status: "idle",
                    prompt: promptText,
                    composerContent: promptText,
                    model: node.metadata?.model,
                    size: node.metadata?.size,
                    seconds: node.metadata?.seconds,
                    vquality: resolution,
                    generateAudio: node.metadata?.generateAudio ?? "true",
                    watermark: node.metadata?.watermark ?? "false",
                    draft: "false",
                    videoEditOperation: "draft_to_final",
                    videoDraftTaskId: draftTaskId,
                    generatedFromNodeId: node.id,
                    generationResultPlacement: "replace-node",
                },
            };
            const nextNodes = [...nodesRef.current, childNode];
            const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: node.id, toNodeId: childNode.id }];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            pageUi.getState().setSelectedNodeIds(new Set([childNode.id]));
            pageUi.getState().setSelectedConnectionId(null);
            pageUi.getState().setDialogNodeId(null);
            void handleGenerateNode(childNode.id, "video", promptText, {
                confirmedInputs: {
                    nodes: nextNodes,
                    connections: nextConnections,
                    config: effectiveConfig,
                    assets,
                    skills: addedSkills,
                },
                skipDuplicateConfirmation: true,
            });
        },
        [addedSkills, assets, connectionsRef, effectiveConfig, handleGenerateNode, message, nodesRef, pageUi, setConnections, setNodes],
    );

    const createVideoEditNodeFromVideo = useCallback(
        (node: CanvasNodeData, operation: "extend" | "inpaint") => {
            if (!node.metadata?.content && !node.metadata?.storageKey) {
                message.warning("The video node is empty and video secondary creation cannot be initiated.");
                return;
            }
            const label = operation === "extend" ? "Video continuation" : "Partial modification of video";
            const defaultPrompt = operation === "extend"
                ? `Based on @Video 1, follow-up actions, camera movements and environmental atmosphere are naturally delayed, keeping the characters and painting style consistent.`
                : `Modify the picture based on @Video 1: Keep the original composition and rhythm, and adjust the subject to`;
            const editSeconds = node.metadata?.seconds || effectiveConfig.videoSeconds;
            const editQuality = node.metadata?.vquality || "720p";
            const editRequirements = {
                capability: "video" as const,
                videoOperation: operation,
                videoSeconds: editSeconds,
                options: { vquality: editQuality },
                input: { textCount: 1, imageCount: 0, videoCount: 1, audioCount: 0, characterCount: 0 },
            };
            const candidateModels = [node.metadata?.model, effectiveConfig.videoModel, ...selectableModelsByCapability(effectiveConfig, "video")].filter((item): item is string => Boolean(item));
            const targetModel =
                candidateModels.find((item) => modelCapabilityConfigFor(effectiveConfig, item).video?.operations?.includes(operation) && !modelCompatibilityError(effectiveConfig, item, editRequirements)) ||
                candidateModels.find((item) => !modelCompatibilityError(effectiveConfig, item, editRequirements)) ||
                node.metadata?.model;
            const childNode: CanvasNodeData = {
                id: nanoid(),
                type: CanvasNodeType.Video,
                title: `${node.title || "video"} · ${label}`.slice(0, 36),
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: node.width,
                height: node.height,
                metadata: {
                    status: "idle",
                    prompt: defaultPrompt,
                    composerContent: defaultPrompt,
                    model: targetModel,
                    size: "adaptive",
                    seconds: node.metadata?.seconds,
                    vquality: node.metadata?.vquality || "720p",
                    generateAudio: node.metadata?.generateAudio ?? "true",
                    watermark: node.metadata?.watermark ?? "false",
                    draft: "false",
                    videoEditOperation: operation,
                    generatedFromNodeId: node.id,
                },
            };
            const nextNodes = [...nodesRef.current, childNode];
            const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: node.id, toNodeId: childNode.id }];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            pageUi.getState().setHoveredNodeId(null);
            pageUi.getState().setToolbarNodeId(null);
            pageUi.getState().setSelectedNodeIds(new Set([childNode.id]));
            pageUi.getState().setSelectedConnectionId(null);
            pageUi.getState().setDialogNodeId(childNode.id);
        },
        [connectionsRef, effectiveConfig, message, nodesRef, pageUi, setConnections, setNodes],
    );

    return {
        applyGenerationTaskResult,
        bindGenerationTask,
        finishGenerationRequest,
        openNodeTaskDetails,
        retrieveTaskResult,
        retrievingTaskId,
        runningNodeId,
        setRunningNodeId,
        setTaskDetail,
        startGenerationRequest,
        taskDetail,
        taskDetailLoading,
        taskDetailError,
        taskDetailLogs,
        handleGenerateNode,
        handleRetryNode,
        cancelCanvasTask,
        insertGenerationHistoryTask,
        enqueueGenerationBatch,
        retryFailedBatchItems,
        stopRemainingBatchItems,
        addBatchReferenceColumn,
        addBatchRow,
        fillRowsFromConnections,
        generateBatchRows,
        moveBatchReferenceCell,
        patchBatchTable,
        removeBatchReferenceColumn,
        removeBatchRow,
        reorderBatchReferenceColumns,
        syncRowsFromConnections,
        updateBatchRow,
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
        reconcileImageBatchRootNode,
        retryImageBatchChildren,
        generateImageFromTextNode,
        generateFinalVideoFromDraftNode,
        createVideoEditNodeFromVideo,
    };
}
