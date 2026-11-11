import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { Button, Input, Select } from "antd";
import { Check, ImagePlus, LoaderCircle, Play, Plus, RefreshCw, Square, Upload, X } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { useResourceVideoPlayback } from "@/hooks/use-resource-video-playback";
import { canvasNodeResourceId } from "@/lib/canvas/canvas-resource-id";
import { isWorkflowOperation } from "@/lib/canvas/workflow-editor";
import { canExportWorkflowResult, workflowInstanceLocked, type WorkflowInstanceAction } from "@/lib/canvas/reusable-workflow-instance";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { uploadMediaFile } from "@/services/file-storage";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import type { WorkflowValue } from "@/services/api/canvas-workflows";
import type { CanvasNodeData } from "@/types/canvas";
import { WorkflowSlotHeader, WorkflowSlotSurface } from "./workflow-slot-surface";

const labels: Record<string, string> = { pending: "Waiting for upstream", queued: "Already queued", running: "In progress", waiting_selection: "Please select a picture to continue", succeeded: "Completed", failed: "failed", cancelled: "Stopped" };
const mediaLabels = { image: "pictures", video: "video", audio: "Audio", text: "text" };

function WorkflowVideo({ storageKey }: { storageKey: string }) {
    const playback = useResourceVideoPlayback(storageKey, "");
    return playback.error ? <button className="p-3 text-sm" onClick={() => playback.retry()}>Video preview failed to load, click to try again</button>
        : playback.url ? <video className="h-full w-full object-contain" src={playback.url} controls preload="metadata" onError={() => { if (!playback.requestCompatible()) playback.fail(); }} />
            : <LoaderCircle aria-label="Load video" className="size-5 animate-spin" />;
}

function WorkflowAudio({ storageKey }: { storageKey: string }) {
    const [url, setUrl] = useState("");
    const [error, setError] = useState(false);
    useEffect(() => { let active = true; setUrl(""); setError(false); void cacheResourceObjectUrl(storageKey).then(value => { if (active) setUrl(value || ""); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [storageKey]);
    return error ? <span className="text-sm">Audio preview failed to load</span> : url ? <audio className="w-full" src={url} controls preload="metadata" /> : <LoaderCircle className="size-5 animate-spin" aria-label="Load audio" />;
}

export function ReusableWorkflowNode({ node, nodes, readOnly, dropTarget, onAction, onValue, onUploadBusy, onError, onResultDrag, onUpdate }: {
    node: CanvasNodeData; nodes: CanvasNodeData[]; readOnly: boolean; dropTarget?: boolean;
    onAction(id: string, action: WorkflowInstanceAction): Promise<void>;
    onValue(id: string, value: WorkflowValue): Promise<void>;
    onUploadBusy(id: string, busy: boolean): void;
    onError(message: string): void;
    onResultDrag?: (event: ReactPointerEvent, nodeId: string) => void;
    onUpdate?: (nodeId: string) => Promise<void>;
}) {
    const state = node.metadata?.reusableWorkflow;
    const slot = node.metadata?.workflowSlot;
    const control = state ? node : nodes.find(item => item.id === slot?.instanceId);
    const locked = workflowInstanceLocked(control) || readOnly;
    const [busy, setBusy] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const setValue = async (value: WorkflowValue) => {
        setBusy(true);
        try { await onValue(node.id, value); setPickerOpen(false); }
        catch (cause) { if (active.current) onError(cause instanceof Error ? cause.message : "Replacement failed"); }
        finally { if (active.current) setBusy(false); }
    };
    const upload = async (file?: File) => {
        if (!file || !slot || locked || busy || slot.role !== "input" || slot.mediaType === "text") return;
        if (!file.type.startsWith(`${slot.mediaType}/`)) { onError(`「${node.title}"Need${mediaLabels[slot.mediaType]}File`); return; }
        setBusy(true);
        onUploadBusy(node.id, true);
        try {
            const result = await uploadMediaFile(file, slot.mediaType);
            if (!active.current) return;
            const resourceId = resourceIdFromStorageKey(result.storageKey);
            if (!resourceId || result.pendingRemoteUpload) throw new Error("The material has not been saved yet, please try again later.");
            await onValue(node.id, { resourceId });
        } catch (cause) { if (active.current) onError(cause instanceof Error ? cause.message : "Upload failed"); }
        finally { onUploadBusy(node.id, false); if (active.current) setBusy(false); }
    };
    const stop = (event: SyntheticEvent) => event.stopPropagation();
    if (state) {
        const run = state.run;
        const running = run?.status === "queued" || run?.status === "running";
        const waitingSelection = run?.status === "running" && run.steps.some(step => step.status === "waiting_selection");
        const recoverOriginal = run?.status === "failed" && !state.inputsChanged && run.steps.some(step => step.status === "failed" && state.definition.nodes.find(item => item.id === step.nodeId)?.operationId?.endsWith(".ai-upscale"));
        const ready = state.definition.nodes.filter(item => item.role === "input").filter(item => nodes.some(candidate => candidate.metadata?.workflowSlot?.instanceId === node.id && candidate.metadata.workflowSlot.nodeId === item.id && (item.mediaType === "text" || canvasNodeResourceId(candidate)))).length;
        const total = state.definition.nodes.filter(item => item.role === "input").length;
        const operations = state.definition.nodes.filter(isWorkflowOperation);
        const completed = operations.filter(item => run?.steps.some(step => step.nodeId === item.id && step.status === "succeeded")).length;
        return <div className="flex h-full w-full flex-col justify-between gap-3 rounded-[inherit] bg-[var(--surface-card)] p-5 text-foreground" data-canvas-no-drag data-canvas-no-zoom onMouseDown={stop} onPointerDown={stop} onDoubleClick={stop}>
            <div className="flex flex-wrap items-center gap-3 text-2xl"><span className="font-medium">{state.inputsChanged && run ? "Input updated" : waitingSelection ? "Waiting for image selection" : run ? labels[run.status] : ready === total ? "Material is ready" : "Prepare materials"}</span><span className="text-xl tabular-nums text-muted-foreground">{ready}/{total}</span></div>
            {waitingSelection ? <p className="text-sm text-muted-foreground">Select an image in the "Select Image Result" node and continue processing.</p> : null}
            {state.error || run?.error ? <p role="alert" className="max-h-14 overflow-auto text-lg text-destructive" data-canvas-wheel-scroll>{state.error || run?.error}</p> : null}
            <div className="flex items-center gap-3"><div role="progressbar" aria-label="Workflow execution progress" aria-valuemin={0} aria-valuemax={operations.length} aria-valuenow={completed} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-active)]"><div className="h-full rounded-full bg-[var(--workspace-accent)]" style={{ width: `${operations.length ? completed / operations.length * 100 : 0}%` }} /></div><span className="shrink-0 text-lg tabular-nums text-muted-foreground">steps{completed}/{operations.length}</span></div>
            <div className="flex flex-wrap items-center justify-end gap-2" data-workflow-actions>
                {onUpdate ? <Button type="text" className="mr-auto" disabled={readOnly || busy || running || Boolean(state.intent)} onClick={() => void onUpdate(node.id)}>version{state.templateRevision || 1}  · Update instance</Button> : null}
                <Button size="large" style={{ fontSize: 20 }} type="primary" icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />} disabled={readOnly || busy || running || ready < total && !state.intent} loading={busy} onClick={() => { setBusy(true); void onAction(node.id, recoverOriginal ? "retry" : "start").finally(() => { if (active.current) setBusy(false); }); }}>{state.intent ? "Confirm last commit" : running ? "Running" : recoverOriginal ? "Continue the original task" : run ? "Rerun" : "Run workflow"}</Button>
                {running ? <Button icon={<Square className="size-3" />} disabled={readOnly || busy} onClick={() => void onAction(node.id, "cancel")}>stop</Button> : run?.status === "failed" && !state.inputsChanged && !recoverOriginal ? <Button icon={<RefreshCw className="size-4" />} disabled={readOnly || busy || Boolean(state.intent)} onClick={() => void onAction(node.id, "retry")}>Retry failed steps</Button> : null}
            </div>
        </div>;
    }
    if (!slot) return null;
    const isInput = slot.role === "input";
    const exportable = !readOnly && canExportWorkflowResult(node, nodes);
    const startResultDrag = (event: ReactPointerEvent) => {
        event.stopPropagation();
        if (!exportable || event.button !== 0 || !onResultDrag) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onResultDrag(event, node.id);
    };
    const resourceId = canvasNodeResourceId(node);
    const step = control?.metadata?.reusableWorkflow?.run?.steps.find(item => item.nodeId === slot.nodeId);
    const choices = step?.candidates?.filter(item => item.resourceId) || [];
    const selecting = step?.status === "waiting_selection" && control?.metadata?.reusableWorkflow?.run?.status === "running";
    const hasValue = slot.mediaType === "text" ? Boolean(node.metadata?.content) : Boolean(resourceId);
    const status = slot.role === "constant" ? "fixed material" : isInput ? hasValue ? "Added" : "To be added" : labels[slot.status || "pending"] || "To be run";
    const candidates = nodes.filter(item => item.id !== node.id && item.type === slot.mediaType && item.metadata?.workflowSlot?.instanceId !== slot.instanceId && canvasNodeResourceId(item));
    const recipeNode = control?.metadata?.reusableWorkflow?.definition.nodes.find(item => item.id === slot.nodeId);
    const modelSummary = recipeNode?.config?.modelOption ? [String(recipeNode.config.modelOption).split("::").at(-1), recipeNode.config.vquality, recipeNode.config.size].filter(Boolean).join(" · ") : "";
    return <WorkflowSlotSurface data-workflow-slot={slot.nodeId} data-workflow-drop-active={dropTarget || dragOver ? "true" : undefined} data-canvas-no-zoom
        style={{ outline: dropTarget || dragOver ? "2px solid var(--primary)" : undefined }}
        onDragOver={event => { if (!isInput || locked) return; event.preventDefault(); event.stopPropagation(); setDragOver(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
        onDrop={event => { if (!isInput || locked) return; event.preventDefault(); event.stopPropagation(); setDragOver(false); void upload(event.dataTransfer.files[0]); }}>
        {modelSummary ? <div className="shrink-0 break-words text-sm text-muted-foreground" title={modelSummary}>{modelSummary}</div> : null}
        <WorkflowSlotHeader status={<span className={slot.status === "failed" ? "text-destructive" : undefined}>{status}</span>} />
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[var(--bg-secondary)]" data-canvas-no-drag onMouseDown={stop} onPointerDown={exportable && slot.mediaType === "image" ? startResultDrag : stop} onDoubleClick={stop}>
            {slot.mediaType === "image" && choices.length > 1 && (selecting || !resourceId) ? <div className="grid h-full w-full grid-cols-2 gap-2 overflow-auto p-2" data-canvas-wheel-scroll>{choices.map((value, index) => <button key={value.resourceId} type="button" aria-label={`Select picture${index + 1}`} disabled={readOnly || busy || !selecting} className="relative min-h-20 overflow-hidden rounded bg-[var(--surface-card)] hover:outline hover:outline-2 hover:outline-[var(--primary)]" onPointerDown={stop} onClick={() => void setValue(value)}><CachedResourceImage storageKey={`resource:${value.resourceId}`} alt={`Candidate images${index + 1}`} className="h-full w-full object-contain" draggable={false} /><span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs text-white">{index + 1}</span></button>)}</div> : slot.mediaType === "text" ? isInput ? <Input.TextArea aria-label={node.title} value={node.metadata?.content || ""} disabled={locked} className="h-full! resize-none!" placeholder={`fill in${node.title}`} onChange={event => { void onValue(node.id, { text: event.target.value }).catch(cause => onError(cause instanceof Error ? cause.message : "Failed to save text")); }} /> : <p className="h-full w-full overflow-auto whitespace-pre-wrap break-words p-2 text-sm" data-canvas-wheel-scroll>{node.metadata?.content || "Wait for text to be generated"}</p>
                : resourceId ? slot.mediaType === "image" ? <CachedResourceImage storageKey={`resource:${resourceId}`} alt={node.title} className="h-full w-full object-contain" draggable={false} fallback={<span className="p-3 text-sm">Preview loading failed, please select the material again</span>} loadingFallback={<LoaderCircle className="size-5 animate-spin" />} />
                    : slot.mediaType === "video" ? <WorkflowVideo storageKey={`resource:${resourceId}`} /> : <WorkflowAudio storageKey={`resource:${resourceId}`} />
                    : isInput ? <button type="button" aria-label={`upload${node.title}`} disabled={locked || busy} className="flex h-full w-full flex-col items-center justify-center gap-2 border border-dashed border-border p-3 hover:bg-[var(--surface-hover)] disabled:opacity-50" onClick={() => inputRef.current?.click()}>{busy ? <LoaderCircle className="size-7 animate-spin" /> : <Plus className="size-8" />}<span className="text-xs text-muted-foreground">upload{mediaLabels[slot.mediaType]}Or drag into the canvas material</span></button>
                        : <div className="flex flex-col items-center gap-2 p-3 text-center text-muted-foreground">{slot.status === "running" ? <LoaderCircle className="size-7 animate-spin" /> : slot.status === "succeeded" ? <Check className="size-7" /> : <ImagePlus className="size-7" />}<span className="text-sm">{slot.status === "failed" ? "Processing failed" : `${node.title}will be shown here`}</span></div>}
        </div>
        {exportable && onResultDrag ? <button type="button" className="shrink-0 cursor-grab px-1 py-1 text-left text-sm text-muted-foreground active:cursor-grabbing" aria-label={`Drag out${node.title}to canvas`} onMouseDown={stop} onPointerDown={startResultDrag}>Drag out to canvas</button> : null}
        {slot.error ? <p role="alert" className="line-clamp-2 break-words text-xs text-destructive" title={slot.error}>{slot.error}</p> : null}
        {isInput && slot.mediaType !== "text" ? <div className="flex items-center gap-1" data-canvas-no-drag onMouseDown={stop} onPointerDown={stop}>
            <Button type="text" size="small" icon={<Upload className="size-3.5" />} disabled={locked || busy} loading={busy} onClick={() => inputRef.current?.click()}>{hasValue ? "replace" : "upload"}</Button>
            <Button type="text" size="small" disabled={locked || busy} onClick={() => setPickerOpen(value => !value)}>Canvas material</Button>
            {hasValue ? <Button type="text" size="small" className="ml-auto" aria-label={`Clear${node.title}`} icon={<X className="size-3.5" />} disabled={locked || busy} onClick={() => void setValue({})} /> : null}
            <input ref={inputRef} className="hidden" type="file" accept={`${slot.mediaType}/*`} aria-label={`Select file:${node.title}`} disabled={locked || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
        </div> : null}
        {pickerOpen && isInput ? <Select autoFocus open className="w-full" aria-label={`Select canvas material:${node.title}`} placeholder="Select current canvas material" disabled={locked || busy} options={candidates.map(item => ({ value: item.id, label: item.title }))} onOpenChange={setPickerOpen} onChange={id => { const source = candidates.find(item => item.id === id); if (source) void setValue({ resourceId: canvasNodeResourceId(source) }); }} /> : null}
    </WorkflowSlotSurface>;
}
