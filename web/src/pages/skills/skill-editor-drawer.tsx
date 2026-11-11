import { App, Button, Form, Input, Select } from "antd";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { WorkspaceForm } from "@/components/ui/product/workspace-form";
import { Minus, Plus, Wand2, X } from "lucide-react";
import "./skill-editor.css";
import { useEffect, useRef, useState } from "react";

import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { generateSkillDraft } from "@/lib/canvas/skill-drafting";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { createSkill, updateSkill, type Skill, type SkillMutationInput, type SkillShowcaseMedia } from "@/services/api/skills";
import { skillFailureMessage } from "./skill-feedback";

type SkillFormValues = Omit<SkillMutationInput, "isPrivate"> & { is_public: boolean };

export function SkillEditorDrawer({ open, skill, onClose, onSaved }: { open: boolean; skill: Skill | null; onClose: () => void; onSaved: (skill: Skill) => void }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<SkillFormValues>();
    const advancedRef = useRef<HTMLDetailsElement>(null);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftIdea, setDraftIdea] = useState("");
    const [drafting, setDrafting] = useState(false);
    const effectiveConfig = useEffectiveConfig();
    const isPackageSkill = Boolean(skill && skill.sourceType !== "markdown" && skill.sourceType !== "builtin" && skill.sourceType !== "");

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            skillName: skill?.skillName || "",
            description: skill?.description || "",
            instruction: skill?.instruction || "",
            tag: skill?.tag || "creative",
            is_public: false,
            markdownUrl: skill?.markdownUrl || skill?.sourceUrl || "",
            showcaseMedia: skill?.showcaseMedia || [],
            extraInfo: skill?.extraInfo || "",
        });
        setDirty(false);
        setDraftIdea("");
    }, [form, open, skill]);

    const requestClose = () => {
        if (saving || drafting) return;
        if (!dirty) {
            onClose();
            return;
        }
        modal.confirm({ title: "Discard unsaved changes?", content: "The currently filled content will not be retained.", okText: "Abandon changes", okButtonProps: { danger: true }, cancelText: "Continue editing", onOk: onClose });
    };

    const submit = async (values: SkillFormValues) => {
        setSaving(true);
        try {
            const input: SkillMutationInput = {
                skillName: values.skillName,
                description: values.description,
                instruction: values.instruction || "",
                tag: values.tag,
                isPrivate: true,
                markdownUrl: values.markdownUrl || "",
                showcaseMedia: (values.showcaseMedia || []).map((item) => ({ ...item, showcaseUri: item.showcaseUri || "" })),
                extraInfo: values.extraInfo || "",
            };
            const result = skill ? await updateSkill(skill.skillId, input) : await createSkill(input);
            setDirty(false);
            message.success(skill ? "Skills have been updated" : "Skill created");
            onSaved(result.skill);
        } catch (error) {
            message.error(skillFailureMessage(error, "Skill save failed", "The current form is still retained, please check the required fields and connection and try again."));
        } finally {
            setSaving(false);
        }
    };

    const draftFromIdea = async () => {
        const idea = draftIdea.trim();
        if (!idea) {
            message.warning("Please first describe the skills you want to develop");
            return;
        }
        if (!useConfigStore.getState().isAiConfigReady(effectiveConfig, effectiveConfig.model)) {
            message.info("The available text model has not been configured yet. Please go to the settings page to configure it first.");
            navigateToSettings({ section: "models", continueCreation: true });
            return;
        }
        setDrafting(true);
        try {
            const draft = await generateSkillDraft(idea, effectiveConfig);
            form.setFieldsValue({
                skillName: draft.skillName || "",
                description: draft.description || "",
                instruction: draft.instruction || "",
                ...(draft.tag ? { tag: draft.tag } : {}),
            });
            setDirty(true);
            message.success("A draft has been generated, please check and adjust before saving.");
        } catch (error) {
            message.error(skillFailureMessage(error, "Drafting failed", "Please check the text model configuration and try again, or fill in the instructions directly."));
        } finally {
            setDrafting(false);
        }
    };

    return (
        <AppDrawer className="skill-editor-drawer" flush open={open} size="min(480px, 96vw)" mask={{ closable: !dirty && !saving && !drafting }} title={null} closable={false} onClose={requestClose}>
            <section className="skill-editor-shell" aria-label={skill ? "Editing skills" : "Create skills"}>
                <header className="workspace-panel-header"><h2>{skill ? "Editing skills" : "Create skills"}</h2><Button type="text" size="small" aria-label="Close skill editing" disabled={saving || drafting} icon={<X className="size-4" />} onClick={requestClose} /></header>
                <div className="skill-editor-content">
            {!isPackageSkill ? <details className="skill-editor-disclosure">
                <summary><Wand2 className="size-4" aria-hidden="true" />AI drafting</summary>
                <div className="skill-editor-draft">
                    <Input.TextArea value={draftIdea} onChange={(event) => { setDraftIdea(event.target.value); setDirty(true); }} autoSize={{ minRows: 3, maxRows: 6 }} maxLength={2000} disabled={drafting || saving} placeholder="Describe what you want the skill to accomplish" />
                    <div className="skill-editor-draft-actions"><span>Use the current text model, billed per model configuration.</span><Button size="small" loading={drafting} disabled={!draftIdea.trim() || saving} onClick={() => void draftFromIdea()}>Generate draft</Button></div>
                </div>
            </details> : <p className="skill-editor-note">This is a multi-file skill pack, basic information can be edited here. Please re-import the skill package when modifying the text.</p>}
            <WorkspaceForm form={form} className="skill-editor-form" aria-busy={saving || drafting} disabled={saving || drafting} onFinish={submit} onFinishFailed={({ errorFields }) => { if (advancedRef.current && errorFields.some(field => ["tag", "markdownUrl", "showcaseMedia", "extraInfo"].includes(String(field.name[0])))) advancedRef.current.open = true; }} onValuesChange={() => setDirty(true)}>
                <Form.Item name="skillName" label="Name" rules={[{ required: true, message: "Please fill in the skill name" }, { max: 80, message: "Maximum 80 characters" }]}>
                    <Input maxLength={80} placeholder="Give skills a clear name" autoComplete="off" />
                </Form.Item>

                <Form.Item name="description" label="Introduction" rules={[{ required: true, message: "Please fill in the skills profile" }, { max: 1024, message: "Maximum 1024 characters" }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={1024} placeholder="Explain applicable scenarios, input conditions and final output" />
                </Form.Item>

                {!isPackageSkill ? <Form.Item name="instruction" label="instructions" rules={[{ required: true, message: "Please fill in the skill instructions" }, { max: 100000, message: "Up to 100000 characters" }]}>
                    <Input.TextArea className="font-mono text-xs leading-5" autoSize={{ minRows: 10, maxRows: 24 }} maxLength={100000} placeholder="Use Markdown to write roles, constraints, processes, checklists, and output formats" />
                </Form.Item> : null}

                <details ref={advancedRef} className="skill-editor-disclosure skill-editor-advanced">
                    <summary>More settings</summary>
                    <div className="skill-editor-advanced-content">
                    <Form.Item name="tag" label="Classification" rules={[{ required: true, message: "Please select a skill category" }]}><Select options={fallbackSkillCategories.map(({ value, label }) => ({ value, label }))} /></Form.Item>
                    <Form.Item name="markdownUrl" label="Source link" rules={[{ type: "url", message: "Please enter a valid HTTP(S) link" }]}><Input type="url" inputMode="url" spellCheck={false} placeholder="https://" /></Form.Item>
                <Form.List name="showcaseMedia">
                    {(fields, { add, remove }) => (
                        <section aria-labelledby="skill-media-title">
                            <div className="mb-3 flex items-center justify-between">
                                <h3 id="skill-media-title" className="text-sm font-medium">display media</h3>
                                <Button size="small" disabled={fields.length >= 8} icon={<Plus className="size-4" />} onClick={() => add(emptyMedia())}>Add media</Button>
                            </div>
                            <div className="space-y-2">
                                {fields.map((field) => (
                                    <div key={field.key} className="grid grid-cols-[80px_minmax(0,1fr)_32px] gap-2">
                                        <Form.Item {...field} name={[field.name, "type"]} className="mb-0" rules={[{ required: true, message: "Select type" }]}>
                                            <Select aria-label={`media${field.name + 1} Type`} options={[{ value: "image", label: "pictures" }, { value: "video", label: "video" }]} />
                                        </Form.Item>
                                        <Form.Item {...field} name={[field.name, "showcaseUrl"]} className="mb-0" rules={[{ required: true, message: "Please fill in the media link" }, { type: "url", message: "Invalid link format" }]}>
                                            <Input aria-label={`media${field.name + 1} link`} type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/media" />
                                        </Form.Item>
                                        <Button aria-label="Remove media" title="Remove media" icon={<Minus className="size-4" />} onClick={() => remove(field.name)} />
                                        <Form.Item {...field} name={[field.name, "showcaseUri"]} hidden><Input /></Form.Item>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </Form.List>

                <Form.Item name="extraInfo" label="Supplementary information" className="mt-5" rules={[{ max: 2000, message: "Maximum 2000 characters" }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} placeholder="Version notes, dependent tools or usage notes" />
                </Form.Item>
                    </div>
                </details>
            </WorkspaceForm>
                </div>
                <footer className="workspace-panel-footer"><Button type="primary" loading={saving} aria-busy={saving} disabled={saving || drafting} onClick={() => form.submit()}>{skill ? "Save changes" : "Create skills"}</Button></footer>
            </section>
        </AppDrawer>
    );
}

function emptyMedia(): SkillShowcaseMedia {
    return { type: "image", showcaseUri: "", showcaseUrl: "" };
}
