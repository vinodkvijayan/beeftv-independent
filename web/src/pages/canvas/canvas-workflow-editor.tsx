import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { Plus, Redo2, Save, Trash2, Undo2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { AppModal } from "@/components/ui/product/app-modal";
import { canvasNodeResourceId } from "@/lib/canvas/canvas-resource-id";
import { compileCanvasWorkflow } from "@/lib/canvas/reusable-workflow";
import { abstractWorkflowDefinition, connectWorkflowDraft, isWorkflowOperation, removeWorkflowDraftNode, switchWorkflowOperation, validateWorkflowDraft, workflowAppendPositions, workflowDurationSources, workflowEditableFields, workflowEditorPositions, workflowOperationDefaults, workflowOperationId } from "@/lib/canvas/workflow-editor";
import { listCanvasWorkflowCapabilities } from "@/lib/canvas/workflow-capabilities";
import { getNodeIcon } from "@/lib/canvas/node-registry";
import { canvasProcessingRecipe } from "@/lib/canvas/canvas-processing-recipe";
import { uploadMediaFile } from "@/services/file-storage";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { saveCanvasWorkflow, updateCanvasWorkflow, validateCanvasWorkflow, type CanvasWorkflow, type WorkflowMediaType, type WorkflowNode, type WorkflowOperation } from "@/services/api/canvas-workflows";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { CanvasWorkflowEditorGraph } from "./canvas-workflow-editor-graph";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { connectWorkflowPromptReference, normalizeWorkflowNodeMentions, remapWorkflowPromptMentions, validateWorkflowPromptMentions, workflowNodeMentionReferences } from "@/lib/canvas/workflow-node-mentions";
import "./canvas-workflow.css";
import { numberWorkflowNodeTitles } from "@/lib/canvas/workflow-editor";
import { IMAGE_PROMPT_REVERSE } from "@/lib/prompts";

const mediaLabels = { image: "pictures", video: "video", audio: "Audio", text: "text" };

export function CanvasWorkflowEditor({ initial, operations, canvasNodes, canvasConnections, readOnly, onClose, onSaved, onReturnToCanvas }: {
    initial: CanvasWorkflow; operations: WorkflowOperation[]; canvasNodes: CanvasNodeData[]; canvasConnections: CanvasConnection[];
    readOnly: boolean; onClose(): void; onSaved(workflow: CanvasWorkflow): void; onReturnToCanvas(): void;
}) {
    const [initialDraft] = useState(() => {
        const value = structuredClone(initial);
        if (!value.definition.presentationVersion) value.definition = abstractWorkflowDefinition(value.definition, operations);
        value.definition = normalizeWorkflowNodeMentions(value.definition);
        value.definition = numberWorkflowNodeTitles(value.definition, operations);
        if ((value.definition.editorLayoutVersion || 1) < 2) value.definition = { ...value.definition, positions: undefined, editorLayoutVersion: 2 };
        return value;
    });
    const [history, setHistory] = useState({ past: [] as CanvasWorkflow[], current: initialDraft, future: [] as CanvasWorkflow[] });
    const draft = history.current, definition = draft.definition;
    const [selected, setSelected] = useState<string | undefined>(definition.nodes[0]?.id);
    const [connecting, setConnecting] = useState<string>();
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [exitPending, setExitPending] = useState(false);
    const returnToCanvas = useRef(false);
    const [capabilityId, setCapabilityId] = useState<string>();
    const [libraryOpen, setLibraryOpen] = useState(true);
    const fileInput = useRef<HTMLInputElement>(null);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
    const commit = (change: (current: CanvasWorkflow) => CanvasWorkflow) => {
        if (saving || uploading || readOnly) return;
        setHistory(current => {
            const next = change(current.current);
            return { past: [...current.past.slice(-79), current.current], current: { ...next, definition: numberWorkflowNodeTitles(next.definition, operations) }, future: [] };
        });
        setError("");
    };
    const node = definition.nodes.find(item => item.id === selected);
    const operation = node && operations.find(item => item.id === workflowOperationId(node));
    const fields = node ? workflowEditableFields(node, operation) : [];
    const modelOptions = operation?.fields.find(field => field.key === "modelOption")?.options || [];
    const videoProfile = modelOptions.find(option => option.value === node?.config?.modelOption)?.capabilities?.video;
    const capabilities = listCanvasWorkflowCapabilities(operations);
    const capability = capabilities.find(item => item.id === capabilityId);
    const updateNode = (patch: Partial<WorkflowNode>) => { if (selected) commit(current => ({ ...current, definition: { ...current.definition, nodes: current.definition.nodes.map(item => item.id === selected ? { ...item, ...patch } : item) } })); };
    const removeNode = (id: string) => {
        if (readOnly || saving || uploading || !definition.nodes.some(item => item.id === id)) return;
        commit(current => ({ ...current, definition: removeWorkflowDraftNode(current.definition, id) }));
        if (selected === id) setSelected(undefined);
        setConnecting(undefined);
    };
    const addNode = (value: Omit<WorkflowNode, "id">) => {
        const id = `step-${nanoid()}`;
        commit(current => ({ ...current, definition: { ...current.definition, positions: workflowAppendPositions(current.definition, [{ ...value, id }]), nodes: [...current.definition.nodes, { ...value, id }] } }));
        setSelected(id);
    };
    const addOperation = (item: WorkflowOperation) => addNode({ title: item.name, role: "operation", mediaType: item.outputType, operationId: item.id, operationVersion: item.version,
        config: { ...workflowOperationDefaults(item), ...(item.id.endsWith(".ai-upscale") ? { scale:2 } : {}), ...(item.id === "image.describe" ? { prompt:IMAGE_PROMPT_REVERSE } : {}) } });
    const addGeneration = (mediaType: WorkflowMediaType) => {
        const operation = operations.find(item => item.id === `generate.${mediaType}`);
        if (!operation) return;
        const options = operation.fields.find(field => field.key === "modelOption")?.options || [];
        const chosen = options.find(option => mediaType === "video" && option.value === "beeftv::seedance-2.0-fast") || options[0];
        const video = chosen?.capabilities?.video;
        addNode({title:`generate${mediaLabels[mediaType]}`,role:"operation",mediaType,operationId:operation.id,operationVersion:operation.version,config:{prompt:"",...(chosen ? {modelOption:chosen.value} : {}),...(mediaType === "video" ? {size:video?.defaultRatio || "16:9",vquality:video?.defaultResolution || "480p",videoSeconds:5} : mediaType === "image" ? {size:"1:1"} : {})}});
    };
    const connect = (id: string, port: string, source = connecting) => {
        if (!source || readOnly || saving || uploading) return;
        try { const next = connectWorkflowDraft(definition, source, id, port, operations); commit(current => ({ ...current, definition: next })); setConnecting(undefined); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect node"); }
    };
    const sourceCandidates = canvasNodes.filter(item => (item.metadata?.taskId || canvasProcessingRecipe(item)) && !item.metadata?.workflowSlot && item.metadata?.status !== "loading" && !["queued", "running", "failed", "cancelled"].includes(item.metadata?.taskStatus || ""));
    const importSource = async (id: string, title?: string) => {
        try {
            const raw = compileCanvasWorkflow(canvasNodes, canvasConnections, new Set([id])).definition;
            const imported = abstractWorkflowDefinition((await validateCanvasWorkflow(raw)).definition, operations);
            if (!alive.current) return;
            const root = imported.nodes.find(item => item.id === id && isWorkflowOperation(item)) || imported.nodes.find(isWorkflowOperation);
            const ids = new Map(imported.nodes.map(item => [item.id, `step-${nanoid()}`]));
            const nodes = imported.nodes.map(item => ({ ...item, id: ids.get(item.id)!, ...(item.videoDurationSourceNodeId ? { videoDurationSourceNodeId: ids.get(item.videoDurationSourceNodeId) } : {}), ...(typeof item.config?.prompt === "string" ? { config: { ...item.config, prompt: remapWorkflowPromptMentions(item.config.prompt, ids) } } : {}), ...(item.id === root?.id && title ? { title } : {}), ...(isWorkflowOperation(item) ? { role: "operation" as const, operationId: workflowOperationId(item), operationVersion: 1 } : {}) }));
            const edges = imported.edges.map(edge => ({ ...edge, fromNodeId: ids.get(edge.fromNodeId)!, toNodeId: ids.get(edge.toNodeId)! }));
            commit(current => ({ ...current, definition: { ...current.definition, positions: workflowAppendPositions(current.definition, nodes), nodes: [...current.definition.nodes, ...nodes], edges: [...current.definition.edges, ...edges], outputNodeIds: [...new Set([...current.definition.outputNodeIds, ...imported.outputNodeIds.map(value => ids.get(value)!)])] } }));
            setSelected(root ? ids.get(root.id) : undefined);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed"); }
    };
    const save = async () => {
        if (saving || uploading || readOnly) return;
        setError("");
        try {
            if (!draft.name.trim()) throw new Error("Please fill in the workflow name");
            validateWorkflowDraft(definition, operations);
            validateWorkflowPromptMentions(definition);
            setSaving(true);
            const prepared = await validateCanvasWorkflow(definition, {}, draft.id ? { templateId: draft.id, templateRevision: initial.revision || 1 } : undefined);
            const values = { name: draft.name.trim(), description: draft.description, definition: prepared.definition };
            const updated = draft.id
                ? await updateCanvasWorkflow(draft.id, { ...values, expectedRevision: initial.revision || 1 })
                : await saveCanvasWorkflow(values);
            if (alive.current) onSaved(updated);
        } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Save failed, draft has been retained"); }
        finally { if (alive.current) setSaving(false); }
    };
    const finishClose = () => returnToCanvas.current ? onReturnToCanvas() : onClose();
    const close = () => { if (saving || uploading) return; if (dirty) setExitPending(true); else finishClose(); };
    const upload = async (file?: File) => {
        if (!node || !file || readOnly || saving || uploading || node.mediaType === "text") return;
        if (!file.type.startsWith(`${node.mediaType}/`)) { setError("File type does not match input node"); return; }
        const nodeId = node.id;
        setUploading(true);
        try {
            const resource = await uploadMediaFile(file, node.mediaType);
            const resourceId = resourceIdFromStorageKey(resource.storageKey);
            if (!resourceId || resource.pendingRemoteUpload) throw new Error("The material has not been saved yet");
            if (alive.current) setHistory(current => ({ past: [...current.past, current.current], future: [], current: { ...current.current, definition: { ...current.current.definition, nodes: current.current.definition.nodes.map(item => item.id === nodeId ? { ...item, resourceId, useDefault: true } : item) } } }));
        } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Upload failed"); }
        finally { if (alive.current) setUploading(false); }
    };
    const incoming = node ? definition.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.toNodeId === node.id) : [];
    const promptReferences = node ? workflowNodeMentionReferences(definition, node.id, operations) : [];
    const durationSources = node ? workflowDurationSources(definition, node.id) : [];
    const durationOptions = durationSources.map(source => ({ value: source.id, label: source.title, disabled: false }));
    if (node?.videoDurationSourceNodeId && !durationSources.some(source => source.id === node.videoDurationSourceNodeId)) durationOptions.push({ value: node.videoDurationSourceNodeId, label: "The source has been disconnected, please select again", disabled: true });
    const materials = node ? canvasNodes.filter(item => item.type === node.mediaType && canvasNodeResourceId(item)) : [];
    return <AppModal open flush closable={false} footer={null} width="min(1420px, calc(100vw - 32px))" onCancel={close} maskClosable={false} keyboard={!dirty && !saving}>
        <section className="workflow-surface flex max-h-[90vh] flex-col" data-canvas-no-zoom data-canvas-no-drag data-canvas-wheel-scroll aria-label="Workflow settings">
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                <h2 className="font-semibold">Edit workflow</h2>
                <Input aria-label="Edit workflow name" className="min-w-40 max-w-80 flex-1" maxLength={100} value={draft.name} disabled={readOnly || saving} onChange={event => commit(current => ({ ...current, name: event.target.value }))} />
                {dirty ? <span className="text-xs text-muted-foreground">not saved</span> : null}
                <div className="ml-auto flex items-center gap-1">
                    {!readOnly ? <Button type="text" aria-label="Add workflow node" aria-expanded={libraryOpen} icon={<Plus className="size-4" />} disabled={saving || uploading} onClick={() => setLibraryOpen(value => !value)}>add</Button> : null}
                    <Button type="text" aria-label="Undo workflow edits" icon={<Undo2 className="size-4" />} disabled={!history.past.length || saving || uploading} onClick={() => setHistory(current => ({ past: current.past.slice(0, -1), current: current.past.at(-1)!, future: [current.current, ...current.future] }))} />
                    <Button type="text" aria-label="Redo workflow editing" icon={<Redo2 className="size-4" />} disabled={!history.future.length || saving || uploading} onClick={() => setHistory(current => ({ past: [...current.past, current.current], current: current.future[0], future: current.future.slice(1) }))} />
                    {!readOnly ? <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={uploading} onClick={() => void save()}>Save</Button> : null}
                    <Button type="text" aria-label="Close workflow settings" icon={<X className="size-4" />} disabled={saving || uploading} onClick={close} />
                </div>
            </header>
            {error ? <Alert className="mx-4 mt-3" type="error" title={error} showIcon /> : null}
            {exitPending ? <Alert className="mx-4 mt-3" type="warning" title="There are unsaved changes" action={<div className="flex gap-2"><Button size="small" onClick={() => { setExitPending(false); returnToCanvas.current = false; }}>Continue editing</Button><Button size="small" danger onClick={finishClose}>Abandon changes</Button></div>} /> : null}
            {connecting ? <div className="flex items-center justify-between px-5 py-2 text-sm text-muted-foreground">Selected "{definition.nodes.find(item => item.id === connecting)?.title}"Output, please click the input port of the target node.<Button size="small" onClick={() => setConnecting(undefined)}>Cancel connection</Button></div> : null}
            <div className="workflow-editor-layout overflow-hidden" style={{ height: "min(780px, 76vh)" }}>
                <div className="workflow-editor-canvas relative flex min-h-0 min-w-0 flex-col">
                {libraryOpen ? <aside className="workflow-editor-library flex flex-col gap-3 p-4 shadow-xl" aria-label="Add workflow node">
                    <div className="flex items-center justify-between"><span className="font-medium">Add node</span><Button type="text" size="small" aria-label="Collapse node tool" icon={<X className="size-4" />} onClick={() => setLibraryOpen(false)} /></div>
                    <span className="text-sm font-medium">input node</span>
                    <div className="grid grid-cols-2 gap-2">{(["image", "video", "audio", "text"] as WorkflowMediaType[]).map(mediaType => <Button key={mediaType} className="[&_svg]:size-4" icon={getNodeIcon(mediaType)} disabled={readOnly || saving} onClick={() => addNode({ title: `${mediaLabels[mediaType]}input`, role: "input", mediaType })}>{mediaLabels[mediaType]}</Button>)}</div>
                    <span className="mt-3 text-sm font-medium">processing node</span>
                    <Select aria-label="Select Canvas Processing Features" showSearch optionFilterProp="label" placeholder="Search canvas function" value={capabilityId} onChange={setCapabilityId}
                        options={[...new Set(capabilities.map(item => item.group))].map(group => ({ label: group, options: capabilities.filter(item => item.group === group).map(item => ({ value: item.id, label: item.name })) }))} />
                    {capability ? <div className="flex flex-col gap-3 rounded-xl bg-[var(--surface-card)] p-3">
                        <span className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4">{capability.icon}{capability.name}</span>
                        {capability.mode === "direct" && capability.operation ? <Button disabled={readOnly || saving} icon={<Plus className="size-4" />} onClick={() => addOperation({ ...capability.operation!, name: capability.name })}>Add node</Button>
                            : capability.mode === "recipe" ? <Select<string> aria-label={`Choose${capability.name}Recipe`} placeholder="Select the completed steps" showSearch optionFilterProp="label" value={undefined} disabled={readOnly || saving} options={sourceCandidates.filter(n => n.metadata?.taskId && !canvasProcessingRecipe(n) && (!capability.outputType || n.type === capability.outputType)).map(n => ({ label: n.title, value: n.id }))} onChange={id => void importSource(id, capability.name)} />
                                : <><p className="text-xs leading-relaxed text-muted-foreground">{capability.reason}</p><Button disabled={saving || uploading} onClick={() => { returnToCanvas.current = true; close(); }}>Return to canvas processing</Button></>}
                        {capability.mode === "recipe" ? <p className="text-xs leading-relaxed text-muted-foreground">Select the successful result of the canvas and reuse its model, parameters and reference relationships.</p> : null}
                    </div> : null}
                    <span className="mt-3 text-sm font-medium">Generate node</span>
                    <div className="grid grid-cols-2 gap-2">{(["image", "video", "audio", "text"] as WorkflowMediaType[]).map(mediaType => <Button key={mediaType} aria-label={`add${mediaLabels[mediaType]}Generate node`} className="[&_svg]:size-4" icon={getNodeIcon(mediaType)} disabled={readOnly || saving} onClick={() => addGeneration(mediaType)}>{mediaLabels[mediaType]}</Button>)}</div>
                    <label className="mt-3 flex flex-col gap-2 text-sm">Import from canvas<Select<string> aria-label="Import steps from success canvas node" placeholder="Select the completed steps" showSearch optionFilterProp="label" value={undefined} disabled={readOnly || saving || !sourceCandidates.length} options={sourceCandidates.map(item => ({ label: item.title, value: item.id }))} onChange={id => void importSource(id)} /></label>
                </aside> : null}
                <CanvasWorkflowEditorGraph libraryOpen={libraryOpen} definition={definition} operations={operations} selected={selected} connecting={connecting} onSelect={setSelected} onOutput={id => { if (!readOnly && !saving && !uploading) setConnecting(value => value === id ? undefined : id); }} onInput={connect} onConnect={(from, to, port) => connect(to, port, from)} onCancelConnection={() => setConnecting(undefined)}
                    onRename={(id, title) => commit(current => ({ ...current, definition: { ...current.definition, nodes: current.definition.nodes.map(item => item.id === id ? { ...item, title } : item) } }))}
                    readOnly={readOnly || saving || uploading}
                    onDelete={removeNode}
                    onMove={(id, position) => commit(current => ({ ...current, definition: { ...current.definition, positions: { ...workflowEditorPositions(current.definition), [id]: position } } }))}
                    onRemoveEdge={index => commit(current => ({ ...current, definition: { ...current.definition, edges: current.definition.edges.filter((_, i) => i !== index) } }))} />
                </div>
                <aside className="workflow-editor-properties flex min-h-0 flex-col gap-4 overflow-y-auto p-4" aria-label="Workflow node properties">
                    {node ? <>
                        <div className="flex items-center justify-between gap-2"><span className="font-medium">Node properties</span><Button danger type="text" aria-label={`Delete node:${node.title}`} icon={<Trash2 className="size-4" />} disabled={readOnly || saving || uploading} onClick={() => removeNode(node.id)} /></div>
                        <label className="flex flex-col gap-2 text-sm">Name<Input aria-label="Workflow node name" value={node.title} maxLength={100} disabled={readOnly || saving} onChange={event => updateNode({ title: event.target.value })} /></label>
                        {isWorkflowOperation(node) ? <label className="flex flex-col gap-2 text-sm">Processing method<Select aria-label="Node processing method" value={workflowOperationId(node)} disabled={readOnly || saving} options={operations.filter(o => !o.id.startsWith("generate.") || o.id === workflowOperationId(node)).map(o => ({ value: o.id, label: o.name, disabled: Boolean(o.unavailableReason) }))} onChange={id => { const next = operations.find(o => o.id === id); if (next) commit(current => ({ ...current, definition: switchWorkflowOperation(current.definition, node.id, next) })); }} /></label> : <label className="flex flex-col gap-2 text-sm">Usage<Select aria-label="Node usage" value={node.role} disabled={readOnly || saving} options={[{ value: "input", label: "Replaceable every time" }, { value: "constant", label: "Fixed content" }]} onChange={role => updateNode({ role })} /></label>}
                        {!isWorkflowOperation(node) && node.mediaType === "text" ? <label className="flex flex-col gap-2 text-sm">text content<Input.TextArea aria-label="Workflow text content" value={node.text || ""} disabled={readOnly || saving} autoSize={{ minRows: 3, maxRows: 8 }} onChange={event => updateNode({ text: event.target.value })} /></label> : null}
                        {!isWorkflowOperation(node) && node.mediaType !== "text" ? <div className="flex flex-col gap-2">
                            <Select aria-label="Workflow default material" placeholder="Select canvas material" value={node.role === "constant" || node.useDefault ? materials.find(item => canvasNodeResourceId(item) === node.resourceId)?.id : undefined} allowClear disabled={readOnly || saving}
                                options={materials.map(item => ({ value: item.id, label: item.title }))} onChange={id => { const chosen = materials.find(item => item.id === id); updateNode({ resourceId: chosen ? canvasNodeResourceId(chosen) : undefined, useDefault: Boolean(chosen) }); }} />
                            {node.resourceId && node.role === "input" ? <Checkbox checked={Boolean(node.useDefault)} disabled={readOnly || saving} onChange={event => updateNode({ useDefault: event.target.checked })}>Fill in this material by default</Checkbox> : null}
                            <Button loading={uploading} disabled={readOnly || saving} onClick={() => fileInput.current?.click()}>upload{mediaLabels[node.mediaType]}</Button>
                            <input ref={fileInput} type="file" hidden accept={`${node.mediaType}/*`} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
                        </div> : null}
                        {videoProfile?.references ? <p className="text-sm text-muted-foreground">Selected models:{modelOptions.find(option => option.value === node.config?.modelOption)?.label}; most{videoProfile.references.maxVideos || 0}  reference videos, the total does not exceed{videoProfile.references.maxVideoTotalDurationSeconds || "Not declared"}  Second. The original video and depth results are included in the total duration respectively.</p> : null}
                        {fields.map(field => <label key={field.key} className="flex flex-col gap-2 text-sm">{field.label}
                            {field.key === "modelOption" && workflowOperationId(node).startsWith("generate.") ? <Select aria-label="Generate model" showSearch optionFilterProp="label" value={node.config?.modelOption} options={modelOptions} disabled={readOnly || saving} onChange={value => { const profile = modelOptions.find(option => option.value === value)?.capabilities?.video; updateNode({config:{...node.config, modelOption:value, ...(profile ? {size:profile.defaultRatio || "16:9", vquality:profile.defaultResolution || profile.resolutions?.[0]} : {})}}); }} />
                                : field.key === "vquality" || field.key === "size" && videoProfile ? <Select aria-label={field.label} value={node.config?.[field.key]} options={(field.key === "vquality" ? videoProfile?.resolutions || [] : videoProfile?.ratios || []).map(value => ({value,label:value}))} disabled={readOnly || saving} onChange={value => updateNode({config:{...node.config,[field.key]:value}})} />
                                : field.key === "prompt" && workflowOperationId(node) === "image.describe" ? <Input.TextArea aria-label="Push back requirements" value={String(node.config?.prompt || "")} disabled={readOnly || saving} autoSize={{minRows:3,maxRows:8}} onChange={event => updateNode({config:{...node.config,prompt:event.target.value}})} /> : field.key === "prompt" ? <CanvasResourceMentionTextarea aria-label="Workflow prompt words" nodeSectionLabel="Workflow node" value={String(node.config?.prompt || "")} references={promptReferences} disabled={readOnly || saving} sendOnEnter={false} includeAssetLibrary={false} placeholder="Enter @ to select a workflow node" containerClassName="min-h-32 max-h-64 overflow-y-auto rounded-md bg-[var(--bg-secondary)]" className="min-h-32 p-3 text-sm outline-none"
                                onSelectReference={reference => {
                                    try {
                                        const next = connectWorkflowPromptReference(definition, node.id, reference.nodeId, operations);
                                        if (next !== definition) commit(current => ({ ...current, definition: next }));
                                        return reference;
                                    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to reference node"); return undefined; }
                                }} onChange={prompt => updateNode({ config: { ...node.config, prompt } })} /> : field.key === "videoSeconds" && workflowOperationId(node) === "generate.video" ? <>
                                <Select aria-label="Video duration method" value={node.videoDurationSourceNodeId ? "reference" : "fixed"} disabled={readOnly || saving}
                                    options={[{ value: "fixed", label: "Fixed number of seconds" }, { value: "reference", label: "Follow the reference video", disabled: !durationSources.length }]}
                                    onChange={value => updateNode({ videoDurationSourceNodeId: value === "reference" ? durationSources[0]?.id : undefined })} />
                                {node.videoDurationSourceNodeId ? <>
                                    <Select aria-label="Duration reference video" value={node.videoDurationSourceNodeId} options={durationOptions} disabled={readOnly || saving} onChange={value => updateNode({ videoDurationSourceNodeId: value })} />
                                    <span className="text-xs text-muted-foreground">Uses the current duration of the selected video, seconds rounded up</span>
                                </> : <InputNumber aria-label="Fixed duration (seconds)" min={1} precision={0} value={typeof node.config?.videoSeconds === "number" ? node.config.videoSeconds : undefined} disabled={readOnly || saving} className="w-full" onChange={value => updateNode({ config: { ...node.config, videoSeconds: value ?? 1 } })} />}
                            </> : field.type === "number" ? <InputNumber aria-label={field.label} min={field.min} max={field.max} value={typeof node.config?.[field.key] === "number" ? node.config[field.key] as number : undefined} disabled={readOnly || saving} className="w-full" onChange={value => updateNode({ config: { ...node.config, [field.key]: value ?? 0 } })} />
                                : field.type === "select" ? <Select aria-label={field.label} value={node.config?.[field.key]} options={field.options} disabled={readOnly || saving} onChange={value => updateNode({ config: { ...node.config, [field.key]: value } })} />
                                    : <Input.TextArea aria-label={field.label} value={String(node.config?.[field.key] ?? "")} disabled={readOnly || saving} autoSize={{ minRows: field.type === "textarea" ? 3 : 1, maxRows: 8 }} onChange={event => updateNode({ config: { ...node.config, [field.key]: event.target.value } })} />}
                        </label>)}
                        <Checkbox disabled={readOnly || saving} checked={definition.outputNodeIds.includes(node.id)} onChange={event => commit(current => ({ ...current, definition: { ...current.definition, outputNodeIds: event.target.checked ? [...new Set([...current.definition.outputNodeIds, node.id])] : current.definition.outputNodeIds.filter(id => id !== node.id) } }))}>as workflow output</Checkbox>
                        {incoming.length ? <div className="flex flex-col gap-2"><span className="text-sm">Reference node</span>{incoming.map(({ edge, index }) => <div key={index} className="flex items-center gap-2 rounded bg-[var(--surface-active)] p-2 text-sm"><span className="min-w-0 flex-1 break-words">{definition.nodes.find(item => item.id === edge.fromNodeId)?.title}</span><Button type="text" size="small" aria-label={`Remove references:${definition.nodes.find(item => item.id === edge.fromNodeId)?.title}`} disabled={readOnly || saving} icon={<X className="size-3" />} onClick={() => commit(current => ({ ...current, definition: { ...current.definition, edges: current.definition.edges.filter((_, i) => i !== index) } }))} /></div>)}</div> : null}
                    </> : <p className="text-sm text-muted-foreground">Select nodes to modify content and execution parameters</p>}
                </aside>
            </div>
        </section>
    </AppModal>;
}
