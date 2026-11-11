import { useState } from "react";
import { Alert, Button, Input, type App } from "antd";
import { navigateToSettings } from "@/lib/settings-navigation";
import { startOperation } from "@/stores/use-operation-progress";
import { isReferenceHTTPSLink, uploadReferenceLinks, type ReferenceLinkRequest, type ResolveReferenceLinks } from "@/services/api/reference-link-replacement";

type ModalAPI = ReturnType<typeof App.useApp>["modal"];

export function ReferenceLinkFields({ references, onChange }: { references: ReferenceLinkRequest[]; onChange: (links: Record<string, string>) => void }) {
    const [links, setLinks] = useState<Record<string, string>>({});
    return (
        <div data-canvas-no-zoom data-canvas-wheel-scroll>
            <p>The current channel can only read online materials. Please fill in the HTTPS link of the corresponding material for this generation.</p>
            <div style={{ maxHeight: "45vh", overflowY: "auto", display: "grid", gap: 12 }}>
                {references.map((reference) => (
                    <label key={reference.key} style={{ display: "grid", gap: 4 }}>
                        <span style={{ overflowWrap: "anywhere" }}>
                            {reference.label}
                            {reference.name ? ` · ${reference.name}` : ""}
                        </span>
                        <Input
                            aria-label={reference.label}
                            value={links[reference.key] || ""}
                            placeholder="https://…"
                            autoComplete="off"
                            status={links[reference.key] && !isReferenceHTTPSLink(links[reference.key]) ? "error" : undefined}
                            onChange={(event) => {
                                const next = { ...links, [reference.key]: event.target.value };
                                setLinks(next);
                                onChange(next);
                            }}
                        />
                    </label>
                ))}
            </div>
            <p>The link must allow the service provider to read it directly. The original material will be retained.</p>
        </div>
    );
}

// One generation may submit several images concurrently; share one decision for identical inputs.
export function createReferenceLinkResolver(modal: ModalAPI): ResolveReferenceLinks {
    const requests = new Map<string, Promise<Record<string, string> | null>>();
    return (references, signal, target) => {
        if (signal?.aborted) return Promise.resolve(null);
        const key = JSON.stringify(references);
        const existing = requests.get(key);
        if (existing) {
            if (!target) return existing;
            const waiting = startOperation("Prepare reference materials", { target, detail: "Waiting for reference material confirmation" });
            return existing.finally(() => waiting.dismiss());
        }
        const pending = (async () => {
            let uploaded: Record<string, string> = {};
            let uploadError = "";
            try {
                uploaded = await uploadReferenceLinks(references, signal, target);
            } catch (error) {
                if (signal?.aborted) return null;
                uploadError = error instanceof Error ? error.message : String(error);
            }
            const missing = references.filter((item) => !uploaded[item.key]);
            if (!missing.length) return uploaded;
            return new Promise<Record<string, string> | null>((resolve) => {
                let links: Record<string, string> = {};
                const finish = (result: Record<string, string> | null) => {
                    signal?.removeEventListener("abort", cancel);
                    resolve(result);
                };
                const dialog = modal.confirm({
                    title: "Fill in the reference material link",
                    centered: true,
                    closable: true,
                    width: 520,
                    okText: "Use link and generate",
                    cancelText: "Cancel",
                    okButtonProps: { disabled: true },
                    content: (
                        <>
                            {uploadError && <Alert type="warning" showIcon title="Object storage upload not completed" description={`${uploadError}. You can check your storage settings, or fill in a publicly readable HTTPS link to continue.`} style={{ marginBottom: 16 }} />}
                            <ReferenceLinkFields
                                references={missing}
                                onChange={(value) => {
                                    links = value;
                                    dialog.update({ okButtonProps: { disabled: !missing.every((item) => isReferenceHTTPSLink(value[item.key] || "")) } });
                                }}
                            />
                            <Button
                                onClick={() => {
                                    finish(null);
                                    dialog.destroy();
                                    navigateToSettings({ section: "channels", continueCreation: true });
                                }}
                            >
                                                                Switch channels
                            </Button>
                            <Button onClick={() => { finish(null); dialog.destroy(); navigateToSettings({ section: "storage", continueCreation: true }); }}>
                                                                Configure object storage
                            </Button>
                        </>
                    ),
                    onOk: () => finish({ ...uploaded, ...links }),
                    onCancel: () => finish(null),
                });
                const cancel = () => {
                    finish(null);
                    dialog.destroy();
                };
                signal?.addEventListener("abort", cancel, { once: true });
                if (signal?.aborted) cancel();
            });
        })();
        requests.set(key, pending);
        void pending.then(() => requests.delete(key), () => requests.delete(key));
        return pending;
    };
}
