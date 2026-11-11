import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, InputNumber, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Switch } from "@/components/ui/base/switch";
import { AlertTriangle, Box, Check, FileImage, Link2, Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import {
    createStyleProfileSnapshot,
    MAX_STYLE_ASSETS,
    styleAssetValidationMessage,
    type StyleAssetBinding,
    type StyleAssetKind,
    type StyleAssetStatus,
    type StyleProfileSnapshot,
} from "@/lib/canvas/style-profile";

const kindOptions: Array<{ value: StyleAssetKind; label: string }> = [
    { value: "lora", label: "LoRA" },
    { value: "template", label: "Picture template" },
    { value: "reference", label: "Reference picture group" },
    { value: "prompt", label: "prompt word module" },
];

const statusOptions: Array<{ value: StyleAssetStatus; label: string }> = [
    { value: "draft", label: "To be verified" },
    { value: "validated", label: "Verified" },
    { value: "unavailable", label: "Not available" },
];

const policyOptions: Array<{ value: NonNullable<StyleProfileSnapshot["executionPolicy"]>; label: string }> = [
    { value: "compatible-fallback", label: "Compatibility downgrade" },
    { value: "strict-assets", label: "Strictly block" },
];

const emptyAsset = (): StyleAssetBinding => ({
    id: nanoid(),
    kind: "lora",
    provider: "liblib",
    title: "",
    enabled: false,
    weight: 0.8,
    status: "draft",
});

type StyleAssetBindingModalProps = {
    open: boolean;
    profile: StyleProfileSnapshot | null;
    onClose: () => void;
    onApply: (profile: StyleProfileSnapshot) => void;
};

export function StyleAssetBindingModal({ open, profile, onClose, onApply }: StyleAssetBindingModalProps) {
    const [draft, setDraft] = useState<StyleProfileSnapshot | null>(profile);
    const [editingId, setEditingId] = useState("");

    useEffect(() => {
        if (!open) return;
        setDraft(profile ? createStyleProfileSnapshot(profile) : null);
        setEditingId(profile?.assets[0]?.id || "");
    }, [open, profile]);

    const editing = useMemo(() => draft?.assets.find((asset) => asset.id === editingId), [draft, editingId]);
    const issues = useMemo(() => draft?.assets.map((asset) => ({ id: asset.id, message: styleAssetValidationMessage(asset) })).filter((issue) => issue.message) || [], [draft]);
    if (!draft) return null;

    const updateAsset = (patch: Partial<StyleAssetBinding>) => {
        setDraft((current) => current ? { ...current, assets: current.assets.map((asset) => asset.id === editingId ? { ...asset, ...patch } : asset) } : current);
    };
    const addAsset = () => {
        const asset = emptyAsset();
        setDraft((current) => current ? { ...current, assets: [...current.assets, asset] } : current);
        setEditingId(asset.id);
    };
    const deleteAsset = (id: string) => {
        setDraft((current) => current ? { ...current, assets: current.assets.filter((asset) => asset.id !== id) } : current);
        setEditingId((current) => current === id ? draft.assets.find((asset) => asset.id !== id)?.id || "" : current);
    };

    return (
        <AppModal
            rootClassName="style-asset-binding-modal"
            open={open}
            title={null}
            footer={null}
            centered
            width="min(980px, calc(100vw - 24px))"
            onCancel={onClose}
            flush
        >
            <div className="flex max-h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
                <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 pr-12 sm:items-center sm:px-5">
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold">style execution assets</h2>
                        <p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">Bind model assets, compatibility scopes, execution parameters and licensing snapshots</p>
                    </div>
                    <Button className="shrink-0" icon={<Plus className="size-3.5" />} disabled={draft.assets.length >= MAX_STYLE_ASSETS} title={draft.assets.length >= MAX_STYLE_ASSETS ? `Most bindings${MAX_STYLE_ASSETS} assets` : undefined} onClick={addAsset}>Add assets</Button>
                </header>

                <div className="grid min-h-0 flex-1 md:grid-cols-3">
                    <aside className="thin-scrollbar max-h-52 min-h-0 overflow-y-auto border-b border-border md:col-span-1 md:max-h-none md:border-b-0 md:border-r">
                        <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
                            <label className="flex items-center justify-between gap-3 text-xs">
                                <span className="min-w-0">
                                    <span className="block font-medium">execution strategy</span>
                                    <span className="mt-0.5 block text-[var(--fs-tiny)] text-foreground/42">How to deal with incompatible and unverified assets</span>
                                </span>
                                <Select<NonNullable<StyleProfileSnapshot["executionPolicy"]>>
                                    className="shrink-0"
                                    size="small"
                                    value={draft.executionPolicy || "compatible-fallback"}
                                    options={policyOptions}
                                    onChange={(executionPolicy) => setDraft({ ...draft, executionPolicy })}
                                />
                            </label>
                        </div>

                        {draft.assets.length ? (
                            <div className="divide-y divide-border">
                                {draft.assets.map((asset) => {
                                    const issue = styleAssetValidationMessage(asset);
                                    return (
                                        <button
                                            key={asset.id}
                                            type="button"
                                            className={`flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset ${editingId === asset.id ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
                                            onClick={() => setEditingId(asset.id)}
                                        >
                                            <AssetKindIcon kind={asset.kind} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-medium">{asset.title || "unnamed asset"}</span>
                                                <span className="mt-1 block truncate text-[var(--fs-tiny)] text-foreground/42">{assetKindLabel(asset.kind)} · {assetStatusLabel(asset.status)}</span>
                                            </span>
                                            <span className={`mt-1 size-1.5 shrink-0 rounded-full ${issue ? "bg-red-500" : asset.enabled ? asset.status === "validated" ? "bg-emerald-500" : "bg-amber-500" : "bg-foreground/20"}`} />
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyAssetList />
                        )}
                    </aside>

                    <main className="thin-scrollbar min-h-0 overflow-y-auto p-4 sm:p-5 md:col-span-2">
                        {editing ? (
                            <AssetEditor asset={editing} onChange={updateAsset} onDelete={() => deleteAsset(editing.id)} />
                        ) : (
                            <div className="grid min-h-72 place-items-center text-center">
                                <div><Plus className="mx-auto size-5 text-foreground/25" /><p className="mt-2 text-xs text-foreground/50">Add or select an execution asset</p></div>
                            </div>
                        )}
                    </main>
                </div>

                <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-start gap-2 text-[var(--fs-tiny)] text-foreground/45">
                        {issues.length ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
                        <span className="min-w-0 leading-5">{issues.length ? `${issues.length} Assets need to be processed:${issues[0].message}` : `${draft.assets.length} assets,${draft.assets.filter((asset) => asset.enabled).length} enabled`}</span>
                    </div>
                    <div className="flex shrink-0 justify-end gap-2">
                        <Button onClick={onClose}>Cancel</Button>
                        <Button
                            type="primary"
                            icon={<Save className="size-3.5" />}
                            disabled={issues.length > 0}
                            onClick={() => onApply(createStyleProfileSnapshot({ ...draft, source: "user", revision: draft.revision + 1 }))}
                        >
                                                        Application configuration
                        </Button>
                    </div>
                </footer>
            </div>
        </AppModal>
    );
}

function AssetEditor({ asset, onChange, onDelete }: { asset: StyleAssetBinding; onChange: (patch: Partial<StyleAssetBinding>) => void; onDelete: () => void }) {
    const validationMessage = styleAssetValidationMessage(asset);
    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                    <h3 className="text-sm font-semibold">Asset allocation</h3>
                    <p className="mt-1 text-[var(--fs-label)] text-foreground/45">Only assets that have been verified and enabled will enter the execution plan</p>
                </div>
                <Button danger type="text" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>Delete</Button>
            </div>

            {validationMessage ? (
                <div className="flex gap-2 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-foreground/65">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                    <span>{validationMessage}</span>
                </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Asset type">
                    <Select<StyleAssetKind> value={asset.kind} options={kindOptions} onChange={(kind) => onChange({ kind })} />
                </Field>
                <Field label="Enabled status">
                    <div className="flex h-8 items-center justify-between border-b border-border">
                        <span className="text-xs text-foreground/55">Participate in generating execution plans</span>
                        <Switch size="sm" checked={asset.enabled !== false} onChange={(enabled) => onChange({ enabled })} />
                    </div>
                </Field>
                <Field label="Asset name">
                    <Input value={asset.title} placeholder="For example: Eastern fantasy martial arts cultivating immortals" onChange={(event) => onChange({ title: event.target.value })} />
                </Field>
                <Field label="Verification status">
                    <Select<StyleAssetStatus> value={asset.status} options={statusOptions} onChange={(status) => onChange({ status })} />
                </Field>
                <Field label="Source Platform/Adapter">
                    <Input value={asset.provider} placeholder="liblib, comfyui or custom adapter" onChange={(event) => onChange({ provider: event.target.value })} />
                </Field>
                <Field label="Source asset ID">
                    <Input value={asset.sourceId} placeholder="Model UUID or template ID" onChange={(event) => onChange({ sourceId: event.target.value })} />
                </Field>
                <Field label="Source page URL" className="sm:col-span-2">
                    <Input value={asset.sourceUrl} placeholder="Record the source of the asset and will not automatically send a generation request to this address." onChange={(event) => onChange({ sourceUrl: event.target.value })} />
                </Field>
                <Field label="Asset model identifier">
                    <Input value={asset.model} placeholder="For example Liblib model name" onChange={(event) => onChange({ model: event.target.value })} />
                </Field>
                <Field label="model version">
                    <Input value={asset.version} placeholder="Version UUID or version number" onChange={(event) => onChange({ version: event.target.value })} />
                </Field>
                <Field label="Compatible with base model" className="sm:col-span-2">
                    <Select<string[]> mode="tags" value={asset.baseModels || []} tokenSeparators={[","]} placeholder="Fill in the actual generated model name, enter it and press Enter" onChange={(baseModels) => onChange({ baseModels })} />
                </Field>
            </div>

            {asset.kind === "lora" ? <LoraFields asset={asset} onChange={onChange} /> : null}
            {asset.kind === "reference" ? <ReferenceFields asset={asset} onChange={onChange} /> : null}
            {asset.kind === "prompt" || asset.kind === "template" ? <PromptFields asset={asset} onChange={onChange} /> : null}

            <GenerationParameterFields asset={asset} onChange={onChange} />
            <LicenseFields asset={asset} onChange={onChange} />

            {asset.enabled !== false && (asset.kind === "lora" || asset.kind === "reference") ? (
                <div className="flex gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-foreground/60">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    <span>Currently the universal build protocol is not enabled{asset.kind === "lora" ? " LoRA" : "Automatic injection of reference picture groups"}adapter. Compatible downgrade continues the project prompt; strict policy blocks the task before building.</span>
                </div>
            ) : null}
        </div>
    );
}

function LoraFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <Field label="LoRA weight">
                <InputNumber className="w-full" min={0} max={2} step={0.05} value={asset.weight} onChange={(weight) => onChange({ weight: weight ?? undefined })} />
            </Field>
            <Field label="trigger words">
                <Select<string[]> mode="tags" value={asset.triggerWords || []} tokenSeparators={[","]} placeholder="Enter after entering" onChange={(triggerWords) => onChange({ triggerWords })} />
            </Field>
        </section>
    );
}

function ReferenceFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="grid gap-4 border-t border-border pt-4">
            <Field label="Reference image URL">
                <Select<string[]> mode="tags" value={asset.referenceUrls || []} tokenSeparators={[","]} placeholder="Enter the accessible reference image address and press Enter" onChange={(referenceUrls) => onChange({ referenceUrls })} />
            </Field>
            <Field label="Project Resource ID">
                <Select<string[]> mode="tags" value={asset.referenceResourceIds || []} tokenSeparators={[","]} placeholder="Enter the uploaded resource ID and press Enter" onChange={(referenceResourceIds) => onChange({ referenceResourceIds })} />
            </Field>
        </section>
    );
}

function PromptFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="border-t border-border pt-4">
            <Field label="prompt word module">
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={asset.promptFragment} placeholder="Only fill in the additional stable visual requirements required for this asset" onChange={(event) => onChange({ promptFragment: event.target.value })} />
            </Field>
        </section>
    );
}

function GenerationParameterFields({ asset, onChange }: AssetFieldProps) {
    const parameters = asset.parameters || {};
    const updateParameters = (patch: NonNullable<StyleAssetBinding["parameters"]>) => onChange({ parameters: { ...parameters, ...patch } });
    return (
        <section className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold">Recommended generation parameters</h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Sampler"><Input value={parameters.sampler} placeholder="Optional" onChange={(event) => updateParameters({ sampler: event.target.value })} /></Field>
                <Field label="Steps"><InputNumber className="w-full" min={1} max={200} value={parameters.steps} onChange={(steps) => updateParameters({ steps: steps ?? undefined })} /></Field>
                <Field label="CFG"><InputNumber className="w-full" min={0} max={50} step={0.5} value={parameters.cfg} onChange={(cfg) => updateParameters({ cfg: cfg ?? undefined })} /></Field>
                <Field label="Recommended size"><Input value={parameters.size} placeholder="For example 1024x1536" onChange={(event) => updateParameters({ size: event.target.value })} /></Field>
            </div>
        </section>
    );
}

function LicenseFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold">License snapshot</h4>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="commercial use">
                    <Select
                        value={asset.license?.commercial === true ? "yes" : asset.license?.commercial === false ? "no" : "unknown"}
                        options={[{ value: "unknown", label: "Not confirmed yet" }, { value: "yes", label: "Commercial use allowed" }, { value: "no", label: "Not for commercial use" }]}
                        onChange={(value: "unknown" | "yes" | "no") => onChange({ license: { ...asset.license, commercial: value === "unknown" ? undefined : value === "yes" } })}
                    />
                </Field>
                <Field label="Licensed source"><Input value={asset.license?.source} placeholder="License page or agreement version" onChange={(event) => onChange({ license: { ...asset.license, source: event.target.value } })} /></Field>
                <Field label="Licensing instructions" className="sm:col-span-2"><Input value={asset.license?.note} placeholder="Document membership restrictions, attribution or resale restrictions" onChange={(event) => onChange({ license: { ...asset.license, note: event.target.value } })} /></Field>
            </div>
        </section>
    );
}

type AssetFieldProps = {
    asset: StyleAssetBinding;
    onChange: (patch: Partial<StyleAssetBinding>) => void;
};

function AssetKindIcon({ kind }: { kind: StyleAssetKind }) {
    return (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded bg-foreground/5 text-foreground/55">
            {kind === "lora" ? <SlidersHorizontal className="size-3.5" /> : kind === "reference" ? <FileImage className="size-3.5" /> : kind === "template" ? <Box className="size-3.5" /> : <Link2 className="size-3.5" />}
        </span>
    );
}

function EmptyAssetList() {
    return (
        <div className="grid min-h-52 place-items-center px-6 text-center">
            <div><Box className="mx-auto size-5 text-foreground/25" /><p className="mt-2 text-xs font-medium">Execution assets have not been bound yet</p><p className="mt-1 text-[var(--fs-tiny)] leading-5 text-foreground/42">The current painting style is only executed through project Prompt</p></div>
        </div>
    );
}

function assetKindLabel(kind: StyleAssetKind) {
    return kindOptions.find((item) => item.value === kind)?.label || kind;
}

function assetStatusLabel(status: StyleAssetStatus) {
    return statusOptions.find((item) => item.value === status)?.label || status;
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/60">{label}</span>{children}</label>;
}
