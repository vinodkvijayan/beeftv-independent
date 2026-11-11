import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Segmented, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Braces, Image, Layers3, Save, Sparkles } from "lucide-react";

import { StyleAssetBindingModal } from "@/components/canvas/style-asset-binding-modal";
import { createStyleProfileSnapshot, styleProfileValidationMessage, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";

type EditorSection = "identity" | "prompt" | "execution";

type StyleProfileEditorModalProps = {
    open: boolean;
    initialProfile: StyleProfileSnapshot | null;
    saving?: boolean;
    onClose: () => void;
    onSave: (profile: StyleProfileSnapshot, applyToProject: boolean) => void;
};

export function StyleProfileEditorModal({ open, initialProfile, saving = false, onClose, onSave }: StyleProfileEditorModalProps) {
    const { message, modal } = App.useApp();
    const [section, setSection] = useState<EditorSection>("identity");
    const [draft, setDraft] = useState<StyleProfileSnapshot | null>(initialProfile);
    const [baseline, setBaseline] = useState("");
    const [assetsOpen, setAssetsOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const next = initialProfile ? createStyleProfileSnapshot(initialProfile) : null;
        setDraft(next);
        setBaseline(next ? JSON.stringify(next) : "");
        setSection("identity");
        setAssetsOpen(false);
    }, [initialProfile, open]);

    const validationMessage = useMemo(() => draft ? styleProfileValidationMessage(draft) : "Style draft does not exist", [draft]);
    if (!draft) return null;

    const update = (patch: Partial<StyleProfileSnapshot>) => setDraft((current) => current ? { ...current, ...patch } : current);
    const requestClose = () => {
        if (JSON.stringify(draft) === baseline) {
            onClose();
            return;
        }
        modal.confirm({ title: "Discard unsaved style changes?", content: "Changes in name, prompt, cover, and execution configuration will be lost.", okText: "Abandon changes", cancelText: "Continue editing", okButtonProps: { danger: true }, onOk: onClose });
    };
    const submit = (applyToProject: boolean) => {
        if (validationMessage) {
            message.error(validationMessage);
            return;
        }
        onSave(createStyleProfileSnapshot({ ...draft, source: "user" }), applyToProject);
    };

    return (
        <>
            <AppModal
                rootClassName="style-profile-editor-modal"
                open={open}
                title={null}
                footer={null}
                centered
                width="min(1120px, calc(100vw - 24px))"
                onCancel={requestClose}
                flush
            >
                <div className="flex max-h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
                    <header className="flex min-h-16 items-center border-b border-border px-4 pr-12 sm:px-5 sm:pr-14">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-foreground/5"><Sparkles className="size-3.5" /></span>
                                <div>
                                    <h2 className="text-sm font-semibold">style editor</h2>
                                    <p className="mt-0.5 truncate text-[var(--fs-tiny)] text-foreground/45">{draft.title || "unnamed style"}  · My style</p>
                                </div>
                            </div>
                        </div>
                    </header>

                    <nav className="style-profile-editor-tabs grid shrink-0 grid-cols-3 border-b border-border px-2 sm:flex sm:px-4" role="tablist" aria-label="Style editor section">
                        <EditorTab id="style-profile-tab-identity" panelId="style-profile-panel-identity" active={section === "identity"} icon={<Image className="size-3.5" />} label="Basic information" onClick={() => setSection("identity")} />
                        <EditorTab id="style-profile-tab-prompt" panelId="style-profile-panel-prompt" active={section === "prompt"} icon={<Braces className="size-3.5" />} label="Prompt rules" onClick={() => setSection("prompt")} />
                        <EditorTab id="style-profile-tab-execution" panelId="style-profile-panel-execution" active={section === "execution"} icon={<Layers3 className="size-3.5" />} label="Execute configuration" onClick={() => setSection("execution")} />
                    </nav>

                    <div className="style-profile-editor-workspace grid min-h-0 flex-1 lg:grid-cols-3">
                        <StylePreview profile={draft} />
                        <main id={`style-profile-panel-${section}`} className="thin-scrollbar min-h-0 overflow-y-auto p-4 sm:p-5 lg:col-span-2" role="tabpanel" aria-labelledby={`style-profile-tab-${section}`}>
                            {section === "identity" ? <IdentityFields profile={draft} onChange={update} /> : null}
                            {section === "prompt" ? <PromptFields profile={draft} onChange={update} /> : null}
                            {section === "execution" ? <ExecutionFields profile={draft} onChange={update} onEditAssets={() => setAssetsOpen(true)} /> : null}
                        </main>
                    </div>

                    <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <p className={`text-[var(--fs-tiny)] ${validationMessage ? "text-red-500" : "text-foreground/45"}`}>{validationMessage || "After saving, enter \"My Style\"; when applying, the current version will be copied as a project snapshot"}</p>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <Button onClick={requestClose}>Cancel</Button>
                            <Button icon={<Save className="size-3.5" />} disabled={Boolean(validationMessage)} loading={saving} onClick={() => submit(false)}>Save to my styles</Button>
                            <Button type="primary" icon={<Sparkles className="size-3.5" />} disabled={Boolean(validationMessage)} loading={saving} onClick={() => submit(true)}>Save and apply</Button>
                        </div>
                    </footer>
                </div>
            </AppModal>
            <StyleAssetBindingModal
                open={assetsOpen}
                profile={draft}
                onClose={() => setAssetsOpen(false)}
                onApply={(profile) => {
                    setDraft(profile);
                    setAssetsOpen(false);
                }}
            />
        </>
    );
}

function StylePreview({ profile }: { profile: StyleProfileSnapshot }) {
    return (
        <aside className="style-profile-editor-preview thin-scrollbar min-h-0 overflow-y-auto border-b border-border bg-foreground/5 lg:border-b-0 lg:border-r">
            <div className="relative aspect-video overflow-hidden border-b border-border bg-foreground/5">
                {profile.coverUrl ? <img src={profile.coverUrl} alt={`${profile.title || "unnamed style"}cover`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-foreground/25"><Image className="size-7" /></div>}
                <span className="absolute bottom-3 left-3 rounded bg-background/85 px-2 py-1 text-[var(--fs-tiny)] font-medium backdrop-blur">my style</span>
            </div>
            <div className="p-4 sm:p-5">
                <h3 className="text-base font-semibold">{profile.title || "unnamed style"}</h3>
                <p className="mt-1.5 text-xs leading-5 text-foreground/48">{profile.description || "Fill out the introduction to make it easier to judge what project it is suitable for in the style library."}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.tags.length ? profile.tags.map((tag) => <span key={tag} className="rounded bg-foreground/10 px-2 py-1 text-[var(--fs-tiny)] text-foreground/58">{tag}</span>) : <span className="text-[var(--fs-tiny)] text-foreground/35">No tags yet</span>}
                </div>
                <dl className="mt-5 grid grid-cols-2 border-y border-border py-3 text-[var(--fs-tiny)]">
                    <Metric label="Prompt" value={`${profile.prompt.length} word`} />
                    <Metric label="negative constraints" value={`${profile.negativePrompt?.length || 0} word`} />
                    <Metric label="execution assets" value={`${profile.assets.length} a`} />
                    <Metric label="Strategy" value={profile.executionPolicy === "strict-assets" ? "Strictly block" : "Compatibility downgrade"} />
                </dl>
            </div>
        </aside>
    );
}

function IdentityFields({ profile, onChange }: EditorFieldsProps) {
    const selection = profile.selection || {};
    const setSelection = (key: string, value: string) => onChange({ selection: { ...selection, [key]: value } });
    return (
        <div className="space-y-5">
            <SectionHeading title="style identity" description="Name, cover, and tags appear in My Styles" />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="style name" className="sm:col-span-2"><Input maxLength={80} showCount value={profile.title} placeholder="For example: Oriental Zhiguai·Gongbi Dark Color" onChange={(event) => onChange({ title: event.target.value })} /></Field>
                <Field label="Style introduction" className="sm:col-span-2"><Input.TextArea maxLength={500} showCount autoSize={{ minRows: 3, maxRows: 6 }} value={profile.description} placeholder="Explain the applicable themes, picture temperament and core recognition" onChange={(event) => onChange({ description: event.target.value })} /></Field>
                <Field label="Cover image URL" className="sm:col-span-2"><Input value={profile.coverUrl} placeholder="You can fill in the project resource URL or accessible image address." onChange={(event) => onChange({ coverUrl: event.target.value })} /></Field>
                <Field label="label" className="sm:col-span-2"><Select mode="tags" maxCount={20} tokenSeparators={[",", "，"]} value={profile.tags} placeholder="Enter the subject, medium, color or texture and press Enter" onChange={(tags) => onChange({ tags })} /></Field>
            </div>
            <SectionHeading title="Auxiliary annotation" description="These fields are used for retrieval and understanding and do not restrict you from writing prompts freely." />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Theme world"><Input value={selection.world || ""} placeholder="Fairy tale, city, suspense..." onChange={(event) => setSelection("world", event.target.value)} /></Field>
                <Field label="visual media"><Input value={selection.medium || ""} placeholder="Real-life photography, 2D, ink..." onChange={(event) => setSelection("medium", event.target.value)} /></Field>
                <Field label="narrative temperament"><Input value={selection.tone || ""} placeholder="Epic, restrained, light comedy..." onChange={(event) => setSelection("tone", event.target.value)} /></Field>
                <Field label="Character modeling"><Input value={selection.character || ""} placeholder="Realistic, semi-realistic, stylized..." onChange={(event) => setSelection("character", event.target.value)} /></Field>
            </div>
        </div>
    );
}

function PromptFields({ profile, onChange }: EditorFieldsProps) {
    return (
        <div className="space-y-5">
            <SectionHeading title="Complete style Prompt" description="Directly define the long-term stable art system of the project; there are no fixed combination restrictions here" />
            <Field label="Forward Prompt">
                <Input.TextArea value={profile.prompt} autoSize={{ minRows: 16, maxRows: 28 }} placeholder="Fill in the visual medium, character design, colors, materials, architectural world view, image baseline and consistency rules..." onChange={(event) => onChange({ prompt: event.target.value })} />
            </Field>
            <Field label="Recommend Negative Prompt">
                <Input.TextArea value={profile.negativePrompt} autoSize={{ minRows: 6, maxRows: 14 }} placeholder="Fill in the media drift, character errors, material errors, text watermarks, etc. that need to be avoided throughout the project." onChange={(event) => onChange({ negativePrompt: event.target.value })} />
            </Field>
        </div>
    );
}

function ExecutionFields({ profile, onChange, onEditAssets }: EditorFieldsProps & { onEditAssets: () => void }) {
    const enabled = profile.assets.filter((asset) => asset.enabled !== false);
    return (
        <div className="space-y-5">
            <SectionHeading title="Build execution" description="Controls whether to continue using Prompt or blocking tasks when model assets are incompatible" />
            <Field label="execution strategy">
                <Segmented
                    block
                    value={profile.executionPolicy || "compatible-fallback"}
                    options={[{ value: "compatible-fallback", label: "Compatibility downgrade" }, { value: "strict-assets", label: "Strictly block" }]}
                    onChange={(executionPolicy) => onChange({ executionPolicy: executionPolicy as StyleProfileSnapshot["executionPolicy"] })}
                />
            </Field>
            <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-sm font-medium">execution assets</h4>
                    <p className="mt-1 text-[var(--fs-label)] text-foreground/45">{profile.assets.length}  are bound,{enabled.length}  enabled</p>
                </div>
                <Button icon={<Layers3 className="size-3.5" />} onClick={onEditAssets}>Configure LoRA, templates and reference images</Button>
            </div>
            {profile.assets.length ? <div className="divide-y divide-border border-b border-border">{profile.assets.map((asset) => <div key={asset.id} className="flex items-center gap-3 py-3 text-xs"><span className={`size-1.5 shrink-0 rounded-full ${asset.enabled !== false && asset.status === "validated" ? "bg-emerald-500" : asset.status === "unavailable" ? "bg-red-500" : "bg-amber-500"}`} /><span className="min-w-0 flex-1 truncate font-medium">{asset.title}</span><span className="shrink-0 text-foreground/40">{asset.kind.toUpperCase()} · {asset.status === "validated" ? "Verified" : asset.status === "unavailable" ? "Not available" : "To be verified"}</span></div>)}</div> : <div className="grid min-h-36 place-items-center border-b border-border text-center text-xs text-foreground/38">The execution assets have not been bound yet, the current style will only be executed through Prompt</div>}
            <p className="text-[var(--fs-tiny)] leading-5 text-foreground/42">LoRA and reference images already support binding, verification and compatibility judgment; when the specific generation channel does not have a native adapter, the compatibility policy will be downgraded to Prompt, and the strict policy will prevent generation.</p>
        </div>
    );
}

type EditorFieldsProps = { profile: StyleProfileSnapshot; onChange: (patch: Partial<StyleProfileSnapshot>) => void };

function SectionHeading({ title, description }: { title: string; description: string }) {
    return <div className="border-b border-border pb-3"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[var(--fs-label)] text-foreground/45">{description}</p></div>;
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
    return <div className="min-w-0 py-1"><dt className="text-foreground/38">{label}</dt><dd className="mt-0.5 truncate font-medium text-foreground/65">{value}</dd></div>;
}

function EditorTab({ id, panelId, active, icon, label, onClick }: { id: string; panelId: string; active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            id={id}
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            className={`style-profile-editor-tab relative flex h-11 min-w-0 items-center justify-center gap-2 px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset sm:justify-start ${active ? "is-active text-foreground" : "text-foreground/45 hover:text-foreground/75"}`}
            onClick={onClick}
        >
            {icon}
            <span className="truncate">{label}</span>
        </button>
    );
}
