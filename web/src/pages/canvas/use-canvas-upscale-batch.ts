import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { App } from "antd";
import { channelHasGenerationCredential, isBuiltinBeefTVChannel, useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import { createDefaultUpscaleSettings, deriveUpscaleBatchState, getUpscaleInputNodes, getUpscaleOutputPosition, upscaleParamsForNode, type CanvasUpscaleBatchItem } from "@/lib/canvas/canvas-upscale";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { mediaResultMetadata } from "@/lib/canvas/canvas-node-semantics";
import { createUpscaleTask, estimateUpscale } from "@/services/api/media-upscale";
import { findGenerationTaskByOperation, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { syncLocalCanvasSnapshot } from "@/services/local-workspace-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasPageUiStoreHook } from "@/stores/canvas/use-canvas-page-ui-store";

type Dependencies = {
    pageUi: CanvasPageUiStoreHook;
    projectId: string; nodesRef: { current: CanvasNodeData[] }; connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>; setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    prepareResource: (node: CanvasNodeData) => Promise<string>;
    observeTask: (task: GenerationTask, nodeId: string) => void;
    bindTask?: (task: GenerationTask, nodeId: string) => void;
};

export function useCanvasUpscaleBatch({pageUi,  projectId, nodesRef, connectionsRef, setNodes, setConnections, prepareResource, observeTask, bindTask }: Dependencies) {
    const { modal } = App.useApp();
    const locks = useRef(new Set<string>());
    const mounted = useRef(true);
    const lifetime = useRef(0);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; lifetime.current += 1; };
    }, []);
    const liveProject = useRef(projectId); liveProject.current = projectId;
    const startUpscaleBatch = useCallback(async (processor: CanvasNodeData) => {
        if (locks.current.has(processor.id)) return;
        locks.current.add(processor.id);
        const capturedLifetime = lifetime.current;
        let expectedBatchId = nodesRef.current.find(n => n.id === processor.id)?.metadata?.upscaleBatch?.id;
        const assertCurrent = () => {
            if (!mounted.current || lifetime.current !== capturedLifetime) throw new Error("The canvas has been closed and submission of over-score tasks has been stopped.");
            if (liveProject.current !== projectId) throw new Error("The canvas has been switched and submission of over-score tasks has been stopped.");
            const live = nodesRef.current.find(n => n.id === processor.id);
            if (!live) throw new Error("The super-score node has been deleted and task submission has stopped.");
            if (live.metadata?.upscaleBatch?.id !== expectedBatchId) throw new Error("The super batch has been replaced. Stop submitting old batches.");
        };
        const patch = (transform: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
            assertCurrent();
            nodesRef.current = transform(nodesRef.current); setNodes(nodesRef.current);
            useCanvasStore.getState().updateProject(projectId, { nodes: nodesRef.current, connections: connectionsRef.current });
        };
        // Store persistence emits ordinary canvas deltas; never race task.bind with a full snapshot sync.
        const save = async () => { assertCurrent(); await flushCanvasStorePersistence(); assertCurrent(); };
        const confirm = async (items: CanvasUpscaleBatchItem[]) => {
            const waiting = items.filter(item => item.status === "waiting");
            if (!waiting.length) throw new Error(items.find(item => item.error)?.error || "No material to submit");
            const reservation = waiting.reduce((sum, item) => sum + (item.reservation || 0), 0);
            if (!waiting.every(item => Number.isFinite(item.reservation) && item.reservation! > 0)) throw new Error("The over-score fee has not yet been confirmed, please obtain it again.");
            const accepted = await new Promise<boolean>(resolve => modal.confirm({
                title: "Are you sure you want to start overscoring?", content: `total${waiting.length} materials, first deduct ¥${reservation.toFixed(2)}. After the bill verification is completed, the actual expenses will be settled, and any excess deductions will be refunded.`,
                okText: "Confirm over score", cancelText: "Cancel", onOk: () => resolve(true), onCancel: () => resolve(false),
            }));
            assertCurrent();
            return accepted;
        };
        try {
            const current = nodesRef.current.find(n => n.id === processor.id);
            if (!current) throw new Error("Super score node has been deleted");
            let batch = current.metadata?.upscaleBatch;
            let rejectedRetryBlocked = false;
            // Only retry proven pre-admission failures once every paid sibling
            // is terminal and delivered. This checkpoint cannot race an active bind.
            if (batch?.items.some(i => i.status === "rejected") && batch.items.every(i => {
                if (i.status === "rejected") return !i.taskId;
                const output = nodesRef.current.find(n => n.id === i.outputNodeId)?.metadata;
                return (output?.taskStatus === "succeeded" && Boolean(output.content || output.storageKey)) || output?.taskStatus === "failed" || output?.taskStatus === "cancelled";
            })) {
                const defaults = createDefaultUpscaleSettings();
                const settings = structuredClone({ ...defaults, ...current.metadata?.upscale, ...processor.metadata?.upscale,
                    image: { ...defaults.image, ...current.metadata?.upscale?.image, ...processor.metadata?.upscale?.image },
                    video: { ...defaults.video, ...current.metadata?.upscale?.video, ...processor.metadata?.upscale?.video },
                });
                const retried = structuredClone(batch);
                let foundReceipt = false;
                for (const item of retried.items.filter(i => i.status === "rejected")) {
                    const task = await findGenerationTaskByOperation(item.clientOperationId, projectId);
                    assertCurrent();
                    if (task) {
                        item.status = "accepted"; item.taskId = task.id; foundReceipt = true;
                        bindTask?.(task, item.outputNodeId); observeTask(task, item.outputNodeId);
                        continue;
                    }
                    const source = nodesRef.current.find(n => n.id === item.sourceNodeId);
                    if (!source || !settings.channelId) continue;
                    try {
                        const params = upscaleParamsForNode(settings, structuredClone(source), await prepareResource(source));
                        assertCurrent(); const quote = await estimateUpscale(params); assertCurrent();
                        item.params = params; item.status = "waiting"; item.error = undefined; item.reservation = quote.reservation; item.quotedAt = Date.now();
                    } catch (cause) { assertCurrent(); item.error = cause instanceof Error ? cause.message : "Material preflight failed"; }
                }
                // An unexpected receipt restores observation first; defer retries
                // until the next explicit click so no checkpoint races its bind.
                if (!foundReceipt) {
                    if (!await confirm(retried.items)) return;
                    batch = retried;
                    patch(nodes => nodes.map(n => {
                        if (n.id === current.id) return { ...n, metadata: { ...n.metadata, upscaleBatch: retried } };
                        const item = retried.items.find(i => i.outputNodeId === n.id && i.status === "waiting");
                        return item ? { ...n, metadata: { ...n.metadata, status: "loading", taskType: `canvas_${item.mediaType}`, generationSubmissionState: undefined, errorDetails: undefined, processingLabel: "Waiting for super score submission", workflowOperation: { id: `${item.mediaType}.ai-upscale`, version: 1, config: { ...item.params }, inputs: [{ nodeId: item.sourceNodeId, port: item.mediaType }, { nodeId: current.id, port: "processor" }] } } } : n;
                    }));
                    await save();
                    await syncLocalCanvasSnapshot(projectId, { nodes: nodesRef.current, connections: connectionsRef.current });
                    assertCurrent();
                } else {
                    const reconciled = { ...batch, items: batch.items.map(i => {
                        const restored = retried.items.find(r => r.outputNodeId === i.outputNodeId && r.status === "accepted" && r.taskId);
                        return restored ?? i;
                    }) };
                    patch(nodes => nodes.map(n => n.id === current.id ? { ...n, metadata: { ...n.metadata, upscaleBatch: reconciled } } : n));
                    await save();
                    return;
                }
            } else if (batch?.items.some(i => i.status === "rejected")) {
                rejectedRetryBlocked = true;
            }
            if (!batch || (batch.items.length > 0 && deriveUpscaleBatchState(batch, nodesRef.current).succeeded === batch.items.length)) {
                if (!useConfigStore.getState().config.channels.some(channel => channel.enabled !== false && isBuiltinBeefTVChannel(channel) && channelHasGenerationCredential(channel))) throw new Error("There is currently no super-resolution model available. Please connect to the official computing power built into BeefTV.");
                const inputs = structuredClone(getUpscaleInputNodes(processor.id, nodesRef.current, connectionsRef.current));
                if (!inputs.length) throw new Error("Please connect a readable picture or video");
                const defaults = createDefaultUpscaleSettings();
                const stored = current.metadata?.upscale;
                const passed = processor.metadata?.upscale;
                const settings = structuredClone({ ...defaults, ...stored, ...passed,
                    image: { ...defaults.image, ...stored?.image, ...passed?.image },
                    video: { ...defaults.video, ...stored?.video, ...passed?.video },
                });
                if (!settings.channelId) throw new Error("Please select a super score channel");
                const items: CanvasUpscaleBatchItem[] = [];
                // Complete all resource and estimate checks before any paid request.
                for (const source of inputs) {
                    const item: CanvasUpscaleBatchItem = { sourceNodeId: source.id, sourceTitle: source.title || "Material", mediaType: source.type === CanvasNodeType.Video ? "video" : "image", outputNodeId: nanoid(), clientOperationId: nanoid(), status: "waiting" };
                    try {
                        item.params = upscaleParamsForNode(settings, source, await prepareResource(source));
                        assertCurrent(); const quote = await estimateUpscale(item.params); assertCurrent();
                        item.reservation = quote.reservation; item.quotedAt = Date.now();
                    } catch (cause) {
                        assertCurrent(); item.status = "rejected"; item.error = cause instanceof Error ? cause.message : "Material preflight failed";
                    }
                    items.push(item);
                }
                if (!await confirm(items)) return;
                batch = { id: nanoid(), createdAt: Date.now(), items };
                const outputs: CanvasNodeData[] = [];
                const downstreamIds = new Set(connectionsRef.current.filter(c => c.fromNodeId === current.id).map(c => c.toNodeId));
                const reusable = nodesRef.current.filter(n => downstreamIds.has(n.id) && (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video) && !n.metadata?.content && !n.metadata?.storageKey && !n.metadata?.taskId && !n.metadata?.taskClientOperationId && !n.metadata?.generationSubmissionState);
                for (const item of items) {
                    const source = inputs.find(n => n.id === item.sourceNodeId)!;
                    const emptyIndex = reusable.findIndex(n => n.type === source.type);
                    const empty = emptyIndex >= 0 ? reusable.splice(emptyIndex, 1)[0] : undefined;
                    if (empty) item.outputNodeId = empty.id;
                    const size = empty?.metadata?.manualSize ? { width: empty.width, height: empty.height } : fitNodeSize(source.metadata?.naturalWidth || source.width, source.metadata?.naturalHeight || source.height);
                    outputs.push({ ...empty, id: item.outputNodeId, type: source.type, title: `${item.sourceTitle} · AI super score`, position: empty?.position ?? getUpscaleOutputPosition(current, 0, [...nodesRef.current, ...outputs], size), ...size,
                        metadata: { ...empty?.metadata, ...mediaResultMetadata("derived", { status: item.status === "rejected" ? "error" : "loading", taskType: `canvas_${item.mediaType}`, generationSubmissionState: item.status === "rejected" ? "rejected" : undefined, errorDetails: item.error, processingLabel: "Waiting for super score submission", generatedFromNodeId: source.id, generatedFromProcessingNodeId: current.id, generationMode: item.mediaType, taskClientOperationId: item.clientOperationId,
                            workflowOperation: { id: `${item.mediaType}.ai-upscale`, version: 1, config: { ...item.params }, inputs: [{ nodeId: source.id, port: item.mediaType }, { nodeId: current.id, port: "processor" }] } }) } });
                }
                const frozen = batch;
                connectionsRef.current = [...connectionsRef.current, ...items.filter(i => !downstreamIds.has(i.outputNodeId)).map(i => ({ id: nanoid(), fromNodeId: current.id, toNodeId: i.outputNodeId }))];
                setConnections(connectionsRef.current);
                patch(nodes => [...nodes.filter(n => !outputs.some(o => o.id === n.id)).map(n => n.id === current.id ? { ...n, metadata: { ...n.metadata, upscaleBatch: frozen } } : n), ...outputs]);
                expectedBatchId = frozen.id;
                await save();
                pageUi.getState().setSelectedNodeIds(new Set(items.map(i => i.outputNodeId)));
            }
            // Retry a failed initial save only after verifying that no operation
            // has been admitted. Once any receipt exists, task.bind owns results.
            if (batch.items.every(i => i.status === "waiting" || i.status === "rejected")) {
                const receipts = await Promise.all(batch.items.filter(i => i.status === "waiting").map(i => findGenerationTaskByOperation(i.clientOperationId, projectId)));
                assertCurrent();
                if (receipts.every(task => !task)) {
                    await syncLocalCanvasSnapshot(projectId, { nodes: nodesRef.current, connections: connectionsRef.current });
                    assertCurrent();
                }
            }
            const batchId = batch.id;
            const update = (item: CanvasUpscaleBatchItem, values: Partial<CanvasUpscaleBatchItem>) => {
                Object.assign(item, values);
                patch(nodes => nodes.map(n => n.id === processor.id && n.metadata?.upscaleBatch?.id === batchId ? { ...n, metadata: { ...n.metadata, upscaleBatch: { ...n.metadata.upscaleBatch, items: n.metadata.upscaleBatch.items.map(i => i.outputNodeId === item.outputNodeId ? { ...i, ...values } : i) } } } : n));
            };
            for (const original of batch.items) {
                const item = { ...original };
                assertCurrent();
                if (!nodesRef.current.some(n => n.id === item.outputNodeId)) continue;
                if (item.status === "rejected") continue;
                if (item.status !== "waiting") {
                    try {
                        const task = item.taskId ? await queryGenerationTask(item.taskId) : await findGenerationTaskByOperation(item.clientOperationId, projectId);
                        assertCurrent();
                        if (task) { update(item, { status: "accepted", taskId: task.id, error: undefined }); bindTask?.(task, item.outputNodeId); observeTask(task, item.outputNodeId); }
                    } catch { /* Unknown receipts remain blocked; never infer permission to resubmit. */ }
                    assertCurrent();
                    continue;
                }
                // A durable backend batch can still say waiting after a lost receipt. Always
                // reconcile the same operation before dispatching a waiting item.
                let existing: GenerationTask | undefined;
                try {
                    existing = await findGenerationTaskByOperation(item.clientOperationId, projectId);
                    assertCurrent();
                } catch (cause) {
                    assertCurrent();
                    update(item, { status: "waiting", error: cause instanceof Error ? cause.message : "The original task query failed and has not yet been submitted. You can continue to query the original operation." });
                    continue;
                }
                if (existing) {
                    update(item, { status: "accepted", taskId: existing.id, error: undefined });
                    bindTask?.(existing, item.outputNodeId); observeTask(existing, item.outputNodeId);
                    continue;
                }
                if (!item.params) { update(item, { status: "rejected", error: "Missing frozen submission parameters, please reconfigure new batch" }); continue; }
                if (!item.quotedAt || Date.now() - item.quotedAt > 60_000) {
                    update(item, { status: "rejected", error: "The cost estimate has expired, please reconfirm the cost" });
                    await save();
                    continue;
                }
                if (!useConfigStore.getState().config.channels.some(channel => channel.enabled !== false && isBuiltinBeefTVChannel(channel) && channelHasGenerationCredential(channel))) {
                    update(item, { status: "rejected", error: "There is currently no super-resolution model available. Please connect to the official computing power built into BeefTV." });
                    await save();
                    continue;
                }
                update(item, { status: "submitting" });
                patch(nodes => nodes.map(n => n.id === item.outputNodeId ? { ...n, metadata: { ...n.metadata, generationSubmissionState: "submitting" } } : n));
                // Persist the intent before POST. A crash from this point is uncertain, never waiting.
                await save();
                if (!nodesRef.current.some(n => n.id === item.outputNodeId)) continue;
                try {
                    const task = await createUpscaleTask({ ...item.params, clientOperationId: item.clientOperationId, projectId, nodeId: item.outputNodeId });
                    assertCurrent(); update(item, { status: "accepted", taskId: task.id, error: undefined });
                    patch(nodes => nodes.map(n => n.id === item.outputNodeId ? { ...n, metadata: { ...n.metadata, taskId: task.id, taskStatus: task.status, generationSubmissionState: "accepted" } } : n));
                    bindTask?.(task, item.outputNodeId); observeTask(task, item.outputNodeId);
                } catch (cause) {
                    assertCurrent(); update(item, { status: "unknown", error: cause instanceof Error ? cause.message : "Submit receipt pending confirmation" });
                    patch(nodes => nodes.map(n => n.id === item.outputNodeId ? { ...n, metadata: { ...n.metadata, taskOutcome: { phase: "retrievable", regenerate: "blocked", reason: "submission_unknown" }, errorDetails: "The submission status needs to be confirmed. Please check the original task and do not submit again." } } : n));
                }
                await save();
            }
            if (rejectedRetryBlocked) throw new Error("Wait for other items to complete before retrying uncommitted items");
        } finally { locks.current.delete(processor.id); }
    }, [pageUi, projectId, nodesRef, connectionsRef, setNodes, setConnections, prepareResource, observeTask, bindTask, modal]);
    return { startUpscaleBatch, resumeUpscaleBatch: startUpscaleBatch };
}
