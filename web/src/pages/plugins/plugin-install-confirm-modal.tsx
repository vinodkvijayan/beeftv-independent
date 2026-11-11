import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Segmented } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import type { PluginInstallConfirmRequest } from "@/lib/plugins/plugin-types";
import type { BackendPlugin, PluginUpdateCheck } from "@/services/api/plugins";

/** 本地文件夹的绝对路径；其余来源是 npm 包名、地址或仓库。 */
export function isLocalFolderSource(source: string | undefined): boolean {
    return Boolean(source && /^([a-zA-Z]:)?[\\/]/.test(source));
}

// Requests come from plugins too, so nothing in them can waive the risk confirmation.
export function installSourceLabel(request: PluginInstallConfirmRequest): string {
    return isLocalFolderSource(request.source) ? "local directory" : "npm package";
}

/** 更新换的是另一份代码，和安装一样要确认。 */
export function pluginUpdateRequest(plugin: BackendPlugin, check?: PluginUpdateCheck): PluginInstallConfirmRequest {
    const notice = check?.updates.find((item) => item.id === plugin.manifest.id);
    return {
        source: plugin.packageSpec ?? plugin.manifest.id,
        name: plugin.manifest.name,
        version: notice ? `${notice.version} → ${notice.latest}` : plugin.manifest.version,
        author: plugin.manifest.author,
        description: plugin.manifest.description,
        isUpdate: true,
    };
}

type PluginInstallConfirmModalProps = {
    open: boolean;
    initialRequest?: PluginInstallConfirmRequest | null;
    loading?: boolean;
    onCancel: () => void;
    onConfirm: (request: PluginInstallConfirmRequest) => Promise<void> | void;
};

export function PluginInstallConfirmModal({ open, initialRequest, loading = false, onCancel, onConfirm }: PluginInstallConfirmModalProps) {
    const [installMode, setInstallMode] = useState<"npm" | "local">("npm");
    const [sourceInput, setSourceInput] = useState("");
    const [draftRequest, setDraftRequest] = useState<PluginInstallConfirmRequest | null>(initialRequest ?? null);
    const [riskAccepted, setRiskAccepted] = useState(false);

    useEffect(() => {
        setDraftRequest(initialRequest ?? null);
        setRiskAccepted(false);
        if (!initialRequest) setSourceInput("");
    }, [initialRequest, open]);

    const canConfirm = Boolean(draftRequest && riskAccepted);

    return (
        <AppModal
            flush
            scrollBody
            className="plugin-details-modal plugin-install-modal"
            wrapClassName="plugin-details-wrap"
            width="min(560px, calc(100vw - 32px))"
            title={draftRequest ? (draftRequest.isUpdate ? "Confirm update plugin" : "Confirm plug-in installation") : "Install plugin"}
            open={open}
            centered
            footer={<div className="plugin-install-actions">
                {draftRequest && !initialRequest ? <Button onClick={() => { setDraftRequest(null); setRiskAccepted(false); }} disabled={loading}>Return to modification</Button> : null}
                <Button onClick={onCancel} disabled={loading}>Cancel</Button>
                {draftRequest ? (
                    <Button data-testid="plugin-install-submit" type="primary" loading={loading} disabled={!canConfirm} onClick={() => void onConfirm(draftRequest)}>
                        {draftRequest.isUpdate ? "Confirm update" : "Confirm installation"}
                    </Button>
                ) : (
                    <Button type="primary" disabled={!sourceInput.trim()} onClick={() => setDraftRequest({ source: sourceInput.trim() })}>Next</Button>
                )}
            </div>}
            destroyOnHidden
            onCancel={onCancel}
        >
            {!draftRequest ? (
                <div className="plugin-install-content">
                    <Segmented aria-label="Installation source" value={installMode} onChange={setInstallMode} options={[{ value: "npm", label: "npm plugin package" }, { value: "local", label: "local directory" }]} />
                    <div className="plugin-install-field">
                        <span>{installMode === "npm" ? "Plug-in package" : "directory path"}</span>
                        <Input
                            value={sourceInput}
                            onChange={(e) => setSourceInput(e.target.value)}
                            placeholder={installMode === "npm" ? "beeftv-plugin-example" : "/path/to/my-plugin"}
                            aria-label={installMode === "npm" ? "npm plugin package name" : "Local plug-in directory path"}
                        />
                        <p className="plugin-install-hint">{installMode === "npm" ? "Support package name, specified version or warehouse address" : "Fill in the full path to the directory containing package.json"}</p>
                    </div>
                </div>
            ) : (
                <div className="plugin-install-content" data-testid="plugin-install-confirm-body">
                    <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div className="text-base font-semibold text-foreground">{draftRequest.name || draftRequest.source}</div>
                                {draftRequest.version || draftRequest.author ? (
                                    <div className="mt-0.5 text-xs text-foreground/60">
                                        {[draftRequest.version ? `version${draftRequest.version}` : "", draftRequest.author ? `Author${draftRequest.author}` : ""].filter(Boolean).join(" · ")}
                                    </div>
                                ) : null}
                            </div>
                            <span className="plugin-source-label">{installSourceLabel(draftRequest)}</span>
                        </div>
                        {draftRequest.description ? <p className="mt-2 text-xs leading-relaxed text-foreground/75">{draftRequest.description}</p> : null}
                    </div>

                    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-4 shrink-0" />
                            <span>This is a third-party plug-in and BeefTV has not reviewed its code</span>
                        </div>
                        <p className="m-0 leading-relaxed text-foreground/85">
                            {draftRequest.isUpdate ? "After update" : "After installation"}, it can read the data in BeefTV, including the API Key you saved locally, and can also call paid generation, and the fee will be deducted from your account. please only{draftRequest.isUpdate ? "update" : "Installation"}Plugins you trust.
                        </p>
                    </div>

                    <div>
                        <Checkbox data-testid="plugin-install-confirm-checkbox" checked={riskAccepted} onChange={(e) => setRiskAccepted(e.target.checked)}>
                            <span className="text-xs font-medium text-foreground">I understand the risks, confirm{draftRequest.isUpdate ? "update" : "Installation"}</span>
                        </Checkbox>
                    </div>

                </div>
            )}
        </AppModal>
    );
}
