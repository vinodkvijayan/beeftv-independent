import { App, Button, Form } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { FileArchive, FileText, GitBranch } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { isLocalRuntimeMode } from "@/lib/runtime-mode";
import { installGitHubSkill, installSkillUpload, type Skill } from "@/services/api/skills";
import { skillFailureMessage } from "./skill-feedback";
import { SkillInstallForm, type InstallFormValues, type InstallMode } from "./skill-install-form";
import "./skill-install.css";

const modeOptions = [
    { value: "markdown", label: <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />Markdown</span> },
    { value: "zip", label: <span className="inline-flex items-center gap-1.5"><FileArchive className="size-3.5" />ZIP skill pack</span> },
    { value: "github", label: <span className="inline-flex items-center gap-1.5"><GitBranch className="size-3.5" />GitHub</span> },
];

export function SkillInstallModal({ open, onClose, onInstalled, onManualCreate }: { open: boolean; onClose: () => void; onInstalled: (skill: Skill) => void; onManualCreate?: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<InstallFormValues>();
    const [mode, setMode] = useState<InstallMode>("markdown");
    const [installing, setInstalling] = useState(false);
    const submitting = useRef(false);
    const formId = useId();
    const localRuntime = isLocalRuntimeMode();

    useEffect(() => {
        if (!open) return;
        setMode("markdown");
        form.setFieldsValue({ files: [], tag: "creative", is_public: !localRuntime, autoUpdate: true, name: "", description: "", url: "", ref: "", subdir: "" });
    }, [form, open, localRuntime]);

    const install = async (values: InstallFormValues) => {
        if (submitting.current) return;
        const file = values.files?.[0]?.originFileObj;
        if (mode !== "github" && !file) {
            form.setFields([{ name: "files", errors: [`Please select one${mode === "zip" ? "ZIP skill pack" : "Markdown file"}`] }]);
            return;
        }
        submitting.current = true;
        setInstalling(true);
        try {
            const result = mode === "github"
                ? await installGitHubSkill({
                    url: values.url || "",
                    ref: values.ref || undefined,
                    subdir: values.subdir || undefined,
                    tag: values.tag,
                    isPrivate: localRuntime || !values.is_public,
                    autoUpdate: values.autoUpdate,
                })
                : await installSkillUpload({
                    file: file as File,
                    sourceType: mode,
                    name: values.name || undefined,
                    description: values.description || undefined,
                    tag: values.tag,
                    isPrivate: localRuntime || !values.is_public,
                });
            message.success("Skill installed");
            onInstalled(result.skill);
        } catch (error) {
            const field = mode === "github" ? "url" : "files";
            form.setFields([{ name: field, errors: [skillFailureMessage(error, "Skill installation failed", "Please check the selected files and formats, confirm the connection and reinstall.")] }]);
            form.scrollToField(field, { block: "center", focus: mode === "github" });
        } finally {
            submitting.current = false;
            setInstalling(false);
        }
    };

    return (
        <AppModal
            className="skill-install-modal"
            open={open}
            width={680}
            scrollBody
            styles={{ body: { overflowX: "hidden" } }}
            closable={!installing}
            keyboard={!installing}
            mask={{ closable: !installing }}
            title="Installation skills"
            onCancel={() => { if (!submitting.current) onClose(); }}
            footer={(
                <div className="flex flex-wrap items-center justify-between gap-3">
                    {onManualCreate ? <Button type="text" disabled={installing} onClick={() => { if (!submitting.current) onManualCreate(); }}>Create single file from blank skill</Button> : <span />}
                    <div className="ml-auto flex gap-2"><Button disabled={installing} onClick={() => { if (!submitting.current) onClose(); }}>Cancel</Button><Button type="primary" form={formId} htmlType="submit" loading={installing} disabled={installing} onClick={(event) => { event.preventDefault(); if (!submitting.current) form.submit(); }}>Installation skills</Button></div>
                </div>
            )}
        >
            <p className="mb-4 text-sm leading-6 text-foreground/55">Support standards<code>SKILL.md</code>  Or a ZIP skills package containing multiple levels of directories. The name and introduction will be automatically read from the skill portal first.</p>
            <SegmentedControl className="skill-install-mode" block disabled={installing} options={modeOptions} value={mode}
                onChange={(value) => {
                    if (submitting.current) return;
                    setMode(value as InstallMode);
                    form.setFields([{ name: "files", value: [], errors: [] }]);
                }} />
            <SkillInstallForm form={form} id={formId} mode={mode} installing={installing} localRuntime={localRuntime}
                onFinish={install} />
        </AppModal>
    );
}
