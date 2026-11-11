import { App, Button, Input } from "antd";
import { Select } from "@/components/ui/base/select";
import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";

import { exportDiagnosticBundle, downloadDiagnosticBundle, previewDiagnosticBundle, type DiagnosticExportInput, type DiagnosticPreview } from "@/services/diagnostics/diagnostics-api";
import { getClientDiagnosticSnapshot, getDiagnosticRuntime } from "@/services/diagnostics/client-diagnostics";
import { clearVideoPreviewCache } from "@/services/api/resources";
import { AppModal } from "@/components/ui/product/app-modal";
import { getDesktopAppBinding } from "@/services/desktop-runtime";
import { EnvironmentChecks } from "./environment-checks";

type DiagnosticsPanelProps = {
    taskId?: string;
    projectId?: string;
    open: boolean;
    onClose: () => void;
};

type DiagnosticRange = "15m" | "30m" | "1h" | "24h";

const rangeOptions: { value: DiagnosticRange; label: string }[] = [
    { value: "15m", label: "Last 15 minutes" },
    { value: "30m", label: "Last 30 minutes" },
    { value: "1h", label: "Last 1 hour" },
    { value: "24h", label: "last 24 hours" },
];

export default function DiagnosticsPanel({ taskId, projectId, open, onClose }: DiagnosticsPanelProps) {
    const { message } = App.useApp();
    const [range, setRange] = useState<DiagnosticRange>("30m");
    const [description, setDescription] = useState("");
    const [preview, setPreview] = useState<DiagnosticPreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [bundleId, setBundleId] = useState("");
    const [clearingPreviews, setClearingPreviews] = useState(false);
	const openUpdateLogs = getDesktopAppBinding()?.OpenUpdateLogDirectory;
	const [updateLogError, setUpdateLogError] = useState("");

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoadingPreview(true);
        void buildInput(range, undefined, taskId, projectId).then(previewDiagnosticBundle)
            .then((result) => {
                if (!cancelled) setPreview(result);
            })
            .catch(() => {
                if (!cancelled) setPreview(null);
            })
            .finally(() => {
                if (!cancelled) setLoadingPreview(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, projectId, range, taskId]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const download = await exportDiagnosticBundle(await buildInput(range, description, taskId, projectId));
            const saved = await downloadDiagnosticBundle(download);
            if (saved !== "saved") return;
            setBundleId(download.bundleId);
            message.success("The diagnostic package has been saved, please submit it to support along with the diagnostic number");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to export diagnostic package");
        } finally {
            setExporting(false);
        }
    };

    return (
        <AppModal
            open={open}
            centered
            width={560}
            footer={null}
            closable={false}
            keyboard={!exporting}
            mask={{ closable: !exporting }}
            onCancel={() => { if (!exporting) onClose(); }}
            rootClassName="app-spatial-modal diagnostics-modal"
            title={(
                <div className="flex items-center justify-between gap-2">
                    <span>Problem diagnosis</span>
                    <Button type="text" aria-label="Close problem diagnosis" disabled={exporting} icon={<X className="size-4" />} onClick={onClose} />
                </div>
            )}
        >
            <div className="max-h-[calc(100dvh-180px)] space-y-5 overflow-y-auto pt-4">
                {open ? <EnvironmentChecks /> : null}
                <div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-medium">Log range</span>
                        <Select
                            ariaLabel="Log range"
                            className="w-full sm:w-60"
                            value={range}
                            options={rangeOptions}
                            onChange={(value) => {
                                const next = rangeOptions.find((option) => option.value === value)?.value;
                                if (next) setRange(next);
                            }}
                        />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-foreground/55" aria-live="polite">
                        {loadingPreview ? "Reading logs…" : preview ? `contains${preview.taskCount} generation tasks,${preview.apiCallCount} media requests${preview.assistantTurnCount === undefined ? "" : `、${preview.assistantTurnCount} wheel helper record`}and front-end logs.` : "The number of records cannot be read at the moment. You can continue to try exporting."}
                    </p>
                    {preview && (preview.willTruncate || Object.values(preview.collectors || {}).some(collector => collector.status !== "complete")) ? <p className="mt-1 text-xs leading-5 text-foreground/55" role="status">Some records are missing or have reached the retention limit, and the diagnostic package will indicate the missing range; there is no guarantee that the restoration will be complete.</p> : null}
                </div>
                {openUpdateLogs ? <div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium">App update log</p>
                        <Button onClick={() => { setUpdateLogError(""); void openUpdateLogs().catch(() => setUpdateLogError("Unable to open log folder, please check the current directory in storage settings.")); }}>Open log folder</Button>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/55">{preview?.updateLog?.status === "available" ? `The diagnostic package will contain${preview.updateLog.lines} update records.` : preview?.updateLog?.status === "unreadable" ? "Some update logs cannot be read, but other information can still be exported." : preview?.updateLog?.status === "missing" ? "No update log found, other information can still be exported." : "Please select a log range that covers the time the update failed."}</p>
                    {preview?.updateLog?.truncated ? <p className="mt-1 text-xs leading-5 text-foreground/55">There are many logs and only some recent update records are included.</p> : null}
                    <p className="mt-1 text-xs leading-5 text-foreground/55">The log is located in the current data directory and the file name is update.log.</p>
                    {updateLogError ? <p className="mt-1 text-xs leading-5 text-destructive" role="alert">{updateLogError}</p> : null}
                </div> : null}
                <div>
                    <label className="mb-3 block text-sm font-medium" htmlFor="diagnostic-description">
                                                Problem description<span className="ml-1 text-xs font-normal text-foreground/55">Optional</span>
                    </label>
                    <Input.TextArea id="diagnostic-description" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="For example: The build keeps getting stuck in processing." />
                </div>
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium">Video preview cache</p>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">Clean the preview to free up space and keep the original files.</p>
                    </div>
                    <Button className="shrink-0" loading={clearingPreviews} onClick={async () => {
                        setClearingPreviews(true);
                        try { const result = await clearVideoPreviewCache(); message.success(`Cleaned${result.cleared} video previews`); }
                        catch (error) { message.error(error instanceof Error ? error.message : "Cleanup failed, please try again"); }
                        finally { setClearingPreviews(false); }
                    }}>Clear preview cache</Button>
                </div>
                <div>
                    <div className="flex items-center justify-between gap-4">
                        <p className="min-w-0 text-xs leading-5 text-foreground/55">Diagnostic package does not contain private or original media such as keys, cookies</p>
                        <Button className="shrink-0" type="primary" icon={<Download className="size-4" />} loading={exporting} onClick={() => void handleExport()}>Export diagnostic package</Button>
                    </div>
                    {bundleId ? <p className="mt-3 break-all text-xs text-foreground/65" role="status">Diagnosis number:{bundleId}</p> : null}
                </div>
            </div>
        </AppModal>
    );
}

async function buildInput(range: DiagnosticRange, description: string | undefined, taskId?: string, projectId?: string): Promise<DiagnosticExportInput> {
    const to = new Date();
    const from = new Date(to.getTime() - rangeMilliseconds(range));
    const snapshot = await getClientDiagnosticSnapshot({ from, to });
    return {
        from: from.toISOString(),
        to: to.toISOString(),
        taskId: taskId || undefined,
        projectId: projectId || undefined,
        description: description || undefined,
        runtime: getDiagnosticRuntime(),
        clientEvents: snapshot.events,
        clientCoverage: snapshot.coverage,
    };
}

function rangeMilliseconds(range: DiagnosticRange) {
    switch (range) {
        case "15m":
            return 15 * 60 * 1000;
        case "1h":
            return 60 * 60 * 1000;
        case "24h":
            return 24 * 60 * 60 * 1000;
        default:
            return 30 * 60 * 1000;
    }
}
