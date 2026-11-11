import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { App } from "antd";
import { canvasNodeResourceId } from "@/lib/canvas/canvas-resource-id";
import { isWorkflowMaterialSource, canExportWorkflowResult, createWorkflowResultNode, upgradeWorkflowInstance, workflowAtPoint, createWorkflowInstance, normalizeWorkflowContainers, workflowDropSlot, workflowInstanceInputs, workflowInstanceLocked, type WorkflowInstanceAction } from "@/lib/canvas/reusable-workflow-instance";
import { cancelWorkflowRun, getWorkflowEditor, getWorkflowRun, selectWorkflowImage, retryWorkflowRun, startWorkflowRun, type CanvasWorkflow, type WorkflowRun, type WorkflowValue } from "@/services/api/canvas-workflows";
import { getResource, resourceFileUrl } from "@/services/api/resources";
import { submissionAcceptanceUnknown } from "@/services/api/generation-submission";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

export function useCanvasWorkflowInstances({ canvasId, domainProjectId, readOnly, nodes, nodesRef, setNodes, connectionsRef, setConnections, getCanvasCenter, focusNode, persist, onError }: {
    canvasId: string; domainProjectId?: string; readOnly: boolean; nodes: CanvasNodeData[];
    nodesRef: MutableRefObject<CanvasNodeData[]>; setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    connectionsRef: MutableRefObject<CanvasConnection[]>; setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    getCanvasCenter(): Position; focusNode(node: CanvasNodeData): void; persist(): Promise<boolean>; onError(message: string): void;
}) {
    const { modal, message } = App.useApp();
    const alive = useRef(true);
    const identity = useRef(canvasId);
    identity.current = canvasId;
    const currentReadOnly = useRef(readOnly);
    currentReadOnly.current = readOnly;
    const locks = useRef(new Set<string>());
    const uploads = useRef(new Set<string>());
    const syncing = useRef(new Set<string>());
    const config = {};
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [canvasId]);
    useEffect(() => {
        if (readOnly) return;
        const normalized = normalizeWorkflowContainers(nodesRef.current);
        if (normalized !== nodesRef.current) { nodesRef.current = normalized; setNodes(normalized); }
    }, [nodes, nodesRef, readOnly, setNodes]);
    const assertCurrent = () => {
        if (!alive.current || identity.current !== canvasId) throw new Error("The canvas has been switched, please return to the original canvas to view the workflow");
        if (currentReadOnly.current) throw new Error("Read-only canvas cannot modify workflow");
    };
    const commit = (update: (current: CanvasNodeData[]) => CanvasNodeData[]) => {
        assertCurrent();
        nodesRef.current = update(nodesRef.current);
        setNodes(nodesRef.current);
    };
    const valueNode = async (node: CanvasNodeData, value: WorkflowValue): Promise<CanvasNodeData> => {
        const resource = value.resourceId ? await getResource(value.resourceId, config) : undefined;
        assertCurrent();
        if (resource && (resource.status !== "ready" || resource.kind !== node.type)) throw new Error(`「${node.title}'s asset type does not match or is not ready yet`);
        const next: CanvasNodeData = { ...node, metadata: { ...node.metadata, assetId: undefined,
            storageKey: resource ? `resource:${resource.id}` : undefined, content: resource ? resourceFileUrl(resource.id) : value.text || "",
            mimeType: resource?.mimeType, bytes: resource?.size, naturalWidth: resource?.width, naturalHeight: resource?.height, durationMs: resource?.durationMs,
        } };
        if (resource || node.type === "text" && value.text) {
            const asset = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node: next, source: "canvas-upload" });
            assertCurrent();
            next.metadata!.assetId = asset.assetId;
        }
        return next;
    };
    const add = async (workflow: CanvasWorkflow) => {
        assertCurrent();
        const origin = getCanvasCenter();
        // Add beside existing content; never cover the successful source graph.
        if (nodesRef.current.length) origin.x = Math.max(...nodesRef.current.map(node => node.position.x + node.width)) + 160;
        const instance = createWorkflowInstance(workflow, origin);
        const materialized = await Promise.all(instance.nodes.map(node => canvasNodeResourceId(node)
            ? valueNode(node, { resourceId: canvasNodeResourceId(node) }) : Promise.resolve(node)));
        commit(current => [...current, ...materialized]);
        connectionsRef.current = [...connectionsRef.current, ...instance.connections];
        setConnections(connectionsRef.current);
        focusNode(instance.frame);
    };
    const setValue = async (nodeId: string, value: WorkflowValue) => {
        if (locks.current.has(nodeId)) return;
        locks.current.add(nodeId);
        try {
            const node = nodesRef.current.find(item => item.id === nodeId);
            const slot = node?.metadata?.workflowSlot;
            const control = nodesRef.current.find(item => item.id === slot?.instanceId);
            const state = control?.metadata?.reusableWorkflow;
            const operation = state?.definition.nodes.find(item => item.id === slot?.nodeId);
            if (node && control && state?.run && operation?.operationId === "image.select" && value.resourceId) {
                assertCurrent();
                const run = await selectWorkflowImage(state.run.id, { nodeId:operation.id, resourceId:value.resourceId }, config);
                assertCurrent();
                await syncRun(control.id, run);
                return;
            }
            if (!node || slot?.role !== "input" || !control) throw new Error("Input slot does not exist");
            if (workflowInstanceLocked(control) || locks.current.has(control.id)) throw new Error("The workflow is being submitted or running, please finish it before replacing the material.");
            const next = node.type === "text" ? { ...node, metadata: { ...node.metadata, content: value.text || "" } } : await valueNode(node, value);
            // The user may have removed the instance while an upload was being bound.
            if (workflowInstanceLocked(nodesRef.current.find(item => item.id === control.id))) throw new Error("The workflow has started running, please finish it before replacing the materials.");
            commit(current => current.map(item => item.id === node.id ? { ...item, metadata: { ...next.metadata, workflowSlot: item.metadata?.workflowSlot } }
                : item.id === control.id ? { ...item, metadata: { ...item.metadata, reusableWorkflow: { ...item.metadata!.reusableWorkflow!, error: undefined, inputsChanged: true } } } : item));
        } finally { locks.current.delete(nodeId); }
    };
    const syncRun = async (instanceId: string, run: WorkflowRun) => {
        const control = nodesRef.current.find(node => node.id === instanceId);
        if (!control?.metadata?.reusableWorkflow) return;
        const replacements = new Map<string, CanvasNodeData>();
        for (const step of run.steps) {
            const node = nodesRef.current.find(item => item.metadata?.workflowSlot?.instanceId === instanceId && item.metadata.workflowSlot.nodeId === step.nodeId);
            if (!node || node.metadata?.workflowSlot?.role === "input" || node.metadata?.workflowSlot?.role === "constant") continue;
            if (step.status === "succeeded" && (step.resourceId || step.text != null) && (step.resourceId !== canvasNodeResourceId(node) || node.type === "text" && step.text !== node.metadata?.content)) {
                replacements.set(node.id, await valueNode(node, step));
            }
        }
        commit(current => {
            const previous = current.find(node => node.id === instanceId)?.metadata?.reusableWorkflow?.run;
            if (previous?.id !== run.id || Date.parse(previous.updatedAt) > Date.parse(run.updatedAt)) return current;
            if (!["queued", "running"].includes(previous.status) && ["queued", "running"].includes(run.status)) return current;
            return current.map(node => {
                if (node.id === instanceId) return { ...node, metadata: { ...node.metadata, reusableWorkflow: { ...node.metadata!.reusableWorkflow!, run, runApplied: true, error: undefined } } };
                if (node.metadata?.workflowSlot?.instanceId !== instanceId) return node;
                const step = run.steps.find(item => item.nodeId === node.metadata!.workflowSlot!.nodeId);
                if (!step) return node;
                const value = replacements.get(node.id);
                return { ...node, metadata: { ...(value?.metadata || node.metadata), workflowSlot: { ...node.metadata.workflowSlot, status: step.status, error: step.error } } };
            });
        });
    };
    const action = async (instanceId: string, kind: WorkflowInstanceAction) => {
        if (locks.current.has(instanceId)) return;
        locks.current.add(instanceId);
        try {
            assertCurrent();
            const control = nodesRef.current.find(node => node.id === instanceId);
            const state = control?.metadata?.reusableWorkflow;
            if (!control || !state) throw new Error("Workflow instance does not exist");
            if (nodesRef.current.some(node => node.metadata?.workflowSlot?.instanceId === instanceId && (locks.current.has(node.id) || uploads.current.has(node.id)))) throw new Error("The material is being saved, please run it later");
            let run: WorkflowRun;
            if (kind === "start") {
                if (state.run?.status === "queued" || state.run?.status === "running") return;
                for (const source of state.definition.nodes) {
                    if (nodesRef.current.filter(node => node.metadata?.workflowSlot?.instanceId === instanceId && node.metadata.workflowSlot.nodeId === source.id).length !== 1) throw new Error("The workflow node is duplicated or missing, please add it again from the template library.");
                }
                const intent = state.intent || { clientOperationId: `workflow:${nanoid()}`, inputs: workflowInstanceInputs(control, nodesRef.current) };
                // Persist the receipt before submitting so a reload can safely confirm the same request.
                commit(current => current.map(node => node.id === instanceId ? { ...node, metadata: { ...node.metadata, reusableWorkflow: { ...state, intent, error: undefined } } } : node));
                if (!await persist()) throw new Error("The run logo could not be saved, please save the canvas and try again.");
                assertCurrent();
                if (!nodesRef.current.some(node => node.id === instanceId)) throw new Error("The workflow instance has been removed and the build has not been submitted.");
                try { run = await startWorkflowRun(state.templateId, { ...intent, templateRevision: state.templateRevision || 1 }, config); }
                catch (cause) {
                    if (!submissionAcceptanceUnknown(cause)) commit(current => current.map(node => node.id === instanceId ? { ...node, metadata: { ...node.metadata, reusableWorkflow: { ...node.metadata!.reusableWorkflow!, intent: undefined } } } : node));
                    throw cause;
                }
            } else {
                if (!state.run) return;
                if (kind === "retry" && state.inputsChanged) throw new Error("The input has been changed, please start a new run.");
                run = kind === "retry" ? await retryWorkflowRun(state.run.id, config) : await cancelWorkflowRun(state.run.id, config);
            }
            commit(current => current.map(node => {
                if (node.id === instanceId) return { ...node, metadata: { ...node.metadata, reusableWorkflow: { ...node.metadata!.reusableWorkflow!, intent: undefined, run, runApplied: false, inputsChanged: false, error: undefined } } };
                const slot = node.metadata?.workflowSlot;
                if (kind !== "start" || slot?.instanceId !== instanceId || slot.role === "input" || slot.role === "constant") return node;
                return { ...node, metadata: { ...node.metadata, content: "", storageKey: undefined, assetId: undefined, workflowSlot: { ...slot, status: "pending", error: undefined } } };
            }));
            await syncRun(instanceId, run);
        } catch (cause) {
            const error = cause instanceof Error ? cause.message : "Workflow operation failed";
            if (alive.current && identity.current === canvasId) {
                try { commit(current => current.map(node => node.id === instanceId ? { ...node, metadata: { ...node.metadata, reusableWorkflow: { ...node.metadata!.reusableWorkflow!, error } } } : node)); } catch { /* Canvas changed; no writes to the new canvas. */ }
                onError(error);
            }
        } finally { locks.current.delete(instanceId); }
    };
    const runningKey = nodes.filter(node => node.metadata?.reusableWorkflow?.run && (!node.metadata.reusableWorkflow.runApplied || ["queued", "running"].includes(node.metadata.reusableWorkflow.run.status))).map(node => `${node.id}:${node.metadata!.reusableWorkflow!.run!.id}`).join("|");
    useEffect(() => {
        if (readOnly || !runningKey) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            for (const token of runningKey.split("|")) {
                const [instanceId, runId] = token.split(":");
                if (cancelled) return;
                if (locks.current.has(instanceId) || syncing.current.has(instanceId)) continue;
                syncing.current.add(instanceId);
                try {
                    const run = await getWorkflowRun(runId, config);
                    if (cancelled) return;
                    await syncRun(instanceId, run);
                } catch (cause) {
                    if (!cancelled) {
                        try { commit(current => current.map(node => node.id === instanceId ? { ...node, metadata: { ...node.metadata, reusableWorkflow: { ...node.metadata!.reusableWorkflow!, error: `${cause instanceof Error ? cause.message : "Sync failed"};The background will continue to run` } } } : node)); } catch { /* Canvas changed. */ }
                    }
                } finally { syncing.current.delete(instanceId); }
            }
            if (!cancelled) timer = setTimeout(() => void poll(), 2000);
        };
        void poll();
        return () => { cancelled = true; clearTimeout(timer); };
        // Poll instances, not the selected or currently visible node.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runningKey, canvasId, readOnly]);
    const drop = useCallback((dragged: string[], point: Position) => {
        if (readOnly || dragged.length !== 1) return false;
        const source = nodesRef.current.find(node => node.id === dragged[0]);
        // Containers must commit their movement even when released inside their old bounds.
        if (!source || !isWorkflowMaterialSource(source)) return false;
        const target = workflowDropSlot(nodesRef.current, source, point);
        if (!target) {
            const frame = workflowAtPoint(nodesRef.current, point);
            if (canExportWorkflowResult(source, nodesRef.current)) {
                if (!frame) commit(current => [...current, createWorkflowResultNode(source, point)]);
                return true;
            }
            // Releasing over the workflow background must not reparent a source.
            if (frame || source.metadata?.workflowSlot) return true;
            return false;
        }
        void setValue(target.id, source.type === "text" ? { text: source.metadata?.content || "" } : { resourceId: canvasNodeResourceId(source) }).catch(cause => onError(cause instanceof Error ? cause.message : "Replacement failed"));
        return true;
        // Reads current nodes and canvas identity before committing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasId, readOnly, domainProjectId]);
    const uploadBusy = (id: string, busy: boolean) => { if (busy) uploads.current.add(id); else uploads.current.delete(id); };
    const update = async (instanceId: string) => {
        try {
            assertCurrent();
            const control = nodesRef.current.find(node => node.id === instanceId);
            const state = control?.metadata?.reusableWorkflow;
            if (!control || !state || workflowInstanceLocked(control)) throw new Error("Please wait until the workflow ends before updating");
            const latest = (await getWorkflowEditor(state.templateId, undefined, config)).workflow;
            assertCurrent();
            if ((latest.revision || 1) <= (state.templateRevision || 1)) { void message.info("The current instance is already the latest version"); return; }
            const preview = upgradeWorkflowInstance(control, nodesRef.current, connectionsRef.current, latest);
            modal.confirm({ title: `Update to version${latest.revision}？`, content: `New${preview.added} nodes, remove${preview.removed} nodes. Keep input materials with compatible types and clear the last execution results; they can be restored through canvas undo.`, okText: "Update instance", cancelText: "Cancel", onOk: () => {
                assertCurrent();
                const current = nodesRef.current.find(node => node.id === instanceId);
                if (!current || workflowInstanceLocked(current)) throw new Error("The instance has been switched or started running. Please try again after finishing.");
                const upgraded = upgradeWorkflowInstance(current, nodesRef.current, connectionsRef.current, latest);
                connectionsRef.current = upgraded.connections;
                setConnections(upgraded.connections);
                commit(() => upgraded.nodes);
                focusNode(upgraded.frame);
            } });
        } catch (cause) { onError(cause instanceof Error ? cause.message : "Update failed"); }
    };
    return { add, setValue, action, drop, uploadBusy, update };
}
