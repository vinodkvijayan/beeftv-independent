import { Form, Input, Select, Upload, type FormProps, type UploadFile } from "antd";
import { GitBranch, UploadCloud } from "lucide-react";
import { Switch } from "@/components/ui/base/switch";
import { WorkspaceForm } from "@/components/ui/product/workspace-form";
import { fallbackSkillCategories } from "./skill-catalog";

export type InstallMode = "markdown" | "zip" | "github";
export type InstallFormValues = {
    name?: string;
    description?: string;
    tag: string;
    is_public: boolean;
    url?: string;
    ref?: string;
    subdir?: string;
    autoUpdate: boolean;
    files?: UploadFile[];
};

type SkillInstallFormProps = Pick<FormProps<InstallFormValues>, "form" | "id" | "initialValues" | "onFinish"> & {
    mode: InstallMode;
    installing: boolean;
    localRuntime: boolean;
};

/** Import owns its source fields; the shared form owns binding, errors and focus. */
export function SkillInstallForm({ form, id, initialValues, onFinish, mode, installing, localRuntime }: SkillInstallFormProps) {
    return <WorkspaceForm<InstallFormValues> form={form} id={id} name={id} initialValues={initialValues}
        className="skill-install-form" disabled={installing} aria-busy={installing} onFinish={onFinish}>
        {mode === "github" ? <>
            <Form.Item name="url" label="GitHub address" rules={[{ required: true, message: "Please fill in the GitHub warehouse address" }, { type: "url", message: "Please enter a valid link" }]}>
                <Input type="url" inputMode="url" spellCheck={false} prefix={<GitBranch className="size-4 text-foreground/35" />} placeholder="https://github.com/owner/repository" />
            </Form.Item>
            <div className="grid gap-x-3 sm:grid-cols-2">
                <Form.Item name="ref" label="branch or tag" extra="Use default branch when left empty"><Input spellCheck={false} placeholder="main" /></Form.Item>
                <Form.Item name="subdir" label="Skills subdirectory" extra="If the warehouse only contains one skill, it can be left blank."><Input spellCheck={false} placeholder="skills/ai-director" /></Form.Item>
            </div>
        </> : <>
            <Form.Item name="files" valuePropName="fileList" getValueFromEvent={({ fileList }: { fileList: UploadFile[] }) => fileList.slice(-1)}
                rules={[{ required: true, type: "array", min: 1, message: `Please select one${mode === "zip" ? "ZIP skill pack" : "Markdown file"}` }]}>
            <Upload.Dragger disabled={installing} accept={mode === "zip" ? ".zip,application/zip" : ".md,.markdown,text/markdown"}
                maxCount={1}
                beforeUpload={(file) => {
                    if (file.size > 200 * 1024 * 1024) {
                        form?.setFields([{ name: "files", errors: ["The skill file exceeds 200MB, please streamline it and select again."] }]);
                        return Upload.LIST_IGNORE;
                    }
                    return false;
                }}>
                <UploadCloud className="mx-auto mb-3 size-8 text-foreground/38" />
                <div className="text-sm font-medium">Drag or select{mode === "zip" ? "ZIP skill pack" : "Markdown file"}</div>
                <div className="mt-1 text-xs text-foreground/45">{mode === "zip" ? "SKILL.md must be in the root directory or only subdirectory" : "Ordinary .md will be installed as the skill entrance SKILL.md"}</div>
            </Upload.Dragger>
            </Form.Item>
            <div className="grid gap-x-3 sm:grid-cols-2">
                <Form.Item name="name" label="Override name" extra="Optional, automatically read if left blank"><Input maxLength={80} autoComplete="off" /></Form.Item>
                <Form.Item name="description" label="Coverage Introduction" extra="Optional, automatically read if left blank"><Input maxLength={1024} autoComplete="off" /></Form.Item>
            </div>
        </>}
        <div className="grid gap-x-3 sm:grid-cols-2">
            <Form.Item name="tag" label="Skill classification" rules={[{ required: true, message: "Please select a skill category" }]}>
                <Select className="skill-install-category" options={fallbackSkillCategories} />
            </Form.Item>
            <Form.Item hidden={localRuntime} name="is_public" label="public status" valuePropName="checked" extra="After it is made public, other users can join in and use it.">
                <Switch disabled={installing} aria-label="public status" checkedChildren="public" unCheckedChildren="private" />
            </Form.Item>
        </div>
        {mode === "github" ? <Form.Item name="autoUpdate" label="Automatic synchronization" valuePropName="checked" extra="The background checks the submitted version every 6 hours and records the latest check and synchronization time.">
            <Switch disabled={installing} aria-label="Automatic synchronization" checkedChildren="turn on" unCheckedChildren="Close" />
        </Form.Item> : null}
    </WorkspaceForm>;
}
