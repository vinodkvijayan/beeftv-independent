import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Switch } from "antd";
import { getDesktopAppBinding, type ReferenceStorageConfig } from "@/services/desktop-runtime";

const fields = [
    ["endpoint", "S3 endpoint", "For example https://cos.ap-guangzhou.myqcloud.com or R2 S3 address"],
    ["bucket", "bucket name", "For example beeftv-media (Tencent Cloud includes -APPID)"],
    ["region", "area", "R2 fills in auto; COS such as ap-guangzhou; OSS such as cn-hangzhou"],
    ["accessKeyId", "Access Key ID", ""],
    ["publicBaseURL", "Bucket public network address", "For example, https://media.example.com or the default domain name of the public network of the bucket"],
] as const;

export function ReferenceStoragePane() {
    const binding = getDesktopAppBinding();
    const { message } = App.useApp();
    const [config, setConfig] = useState<ReferenceStorageConfig>({ enabled: false, endpoint: "", bucket: "", region: "auto", accessKeyId: "", publicBaseURL: "", hasSecret: false });
    const [secret, setSecret] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; detail: string } | null>(null);
    useEffect(() => {
        let active = true;
        void binding
            ?.ReferenceStorageSettings?.()
            .then((value) => {
                if (active) setConfig(value);
            })
            .catch(() => {
                if (active) setLoadError(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [binding]);
    if (!binding?.SaveReferenceStorage) return null;
    const save = async (test = false) => {
        setBusy(true);
        setTestResult(null);
        try {
            const value = await binding.SaveReferenceStorage!({ ...config, secretAccessKey: secret });
            setConfig(value);
            setLoadError(false);
            setSecret("");
            if (test) {
                await binding.TestReferenceStorage!();
                setTestResult({ success: true, detail: "Upload, public read and test file cleanup all passed" });
            } else message.success("Object storage configuration saved");
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (test) setTestResult({ success: false, detail });
            else message.error(detail);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="settings-section storage-settings-block space-y-4" aria-label="Reference material object storage">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>Reference material object storage</h2>
                </div>
            </div>
            <label className="flex items-center justify-between gap-4 text-sm">
                <span>Upload reference materials that require a public network address when generating</span>
                <Switch checked={config.enabled} disabled={busy || loading} onChange={(enabled) => { setTestResult(null); setConfig((value) => ({ ...value, enabled })); }} />
            </label>
            <p className="text-sm leading-6 text-foreground/60">When enabled, channels that require online materials will use the uploaded link. The original material is still saved locally; storage and traffic are billed by your storage service.</p>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
                {fields.map(([key, label, placeholder]) => (
                    <label key={key} className="block min-w-0 space-y-2 text-sm">
                        <span>{label}</span>
                        <Input aria-label={label} value={config[key]} placeholder={placeholder} disabled={busy || loading} autoComplete="off" onChange={(event) => { setTestResult(null); setConfig((value) => ({ ...value, [key]: event.target.value })); }} />
                    </label>
                ))}
                <label className="block min-w-0 space-y-2 text-sm">
                    <span>Secret Access Key</span>
                    <Input.Password
                        aria-label="Secret Access Key"
                        value={secret}
                        autoComplete="new-password"
                        placeholder={config.hasSecret ? "Saved, leave blank to keep" : "Please enter access key"}
                        disabled={busy || loading}
                        onChange={(event) => { setTestResult(null); setSecret(event.target.value); }}
                    />
                </label>
            </div>
            {loadError ? (
                <p role="alert" className="text-sm text-destructive">
                                        If the existing object storage configuration cannot be read (for example, the local key has been reset), you can directly save and close the object storage, or refill the complete configuration and Secret Key and save and overwrite it.</p>
            ) : null}
            {testResult && <Alert showIcon type={testResult.success ? "success" : "error"} title={testResult.success ? "Storage test passed" : "Storage test failed"} description={testResult.detail} />}
            <div className="flex flex-wrap gap-3">
                <Button onClick={() => void save()} loading={busy} disabled={loading}>Save object storage configuration</Button>
                {binding.TestReferenceStorage && <Button onClick={() => void save(true)} loading={busy} disabled={loading || !config.enabled}>Save and test upload</Button>}
            </div>
            <p className="text-sm leading-6 text-foreground/60">Supports S3 compatible storage. The test will upload a small image, check it for public reading and then delete it; the storage service may charge a small request fee.</p>
        </section>
    );
}
