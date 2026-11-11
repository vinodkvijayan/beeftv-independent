import { App, Button, Input, Modal, Tag } from "antd";
import { CircleAlert, ExternalLink, Import, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { formatTapNowBatchTime, parseTapNowShareID } from "@/lib/canvas/tapnow-import";
import { normalizeVideoBoolean } from "@/lib/video-generation-options";
import { importTapNowCanvas, type TapNowImportResult } from "@/services/api/tapnow";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

type Props = {
    open: boolean;
    projectId: string;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    onClose: () => void;
    onApply: (nodes: CanvasNodeData[], connections: CanvasConnection[]) => Promise<void>;
};

function buildCanvasNodes(result: TapNowImportResult, viewport: ViewportTransform, viewportSize: { width: number; height: number }) {
    const minX = Math.min(...result.nodes.map((node) => node.x));
    const minY = Math.min(...result.nodes.map((node) => node.y));
    const maxX = Math.max(...result.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...result.nodes.map((node) => node.y + node.height));
    const offsetX = (viewportSize.width / 2 - viewport.x) / viewport.k - (minX + maxX) / 2;
    const offsetY = (viewportSize.height / 2 - viewport.y) / viewport.k - (minY + maxY) / 2;
    return result.nodes.map<CanvasNodeData>((node) => ({
        id: node.id,
        type: node.type === "video" ? CanvasNodeType.Video : node.type === "audio" ? CanvasNodeType.Audio : node.type === "text" ? CanvasNodeType.Text : CanvasNodeType.Image,
        title: node.title,
        position: { x: node.x + offsetX, y: node.y + offsetY },
        width: node.width,
        height: node.height,
        metadata: {
            content: node.content,
            prompt: node.prompt,
            model: node.model,
            size: node.size,
            quality: node.quality,
            seconds: node.seconds,
            vquality: node.vquality,
            generateAudio: normalizeVideoBoolean(node.generateAudio),
            status: node.status || "idle",
            errorDetails: node.errorDetails,
            naturalWidth: node.naturalWidth,
            naturalHeight: node.naturalHeight,
            durationMs: node.durationMs,
            mimeType: node.mimeType,
            importSource: node.metadata,
        },
    }));
}

export function TapNowImportDialog({ open, projectId, viewport, viewportSize, onClose, onApply }: Props) {
    const { message } = App.useApp();
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TapNowImportResult | null>(null);
    const shareID = useMemo(() => parseTapNowShareID(value), [value]);

    const reset = () => {
        setValue("");
        setResult(null);
    };

    const close = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const changeValue = (nextValue: string) => {
        setValue(nextValue);
        setResult(null);
    };

    const load = async () => {
        if (!shareID) {
            message.error("Please fill in a valid TapNow canvas share link or share ID");
            return;
        }
        setLoading(true);
        try {
            setResult(await importTapNowCanvas(projectId, shareID));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to read TapNow canvas");
        } finally {
            setLoading(false);
        }
    };

    const apply = async () => {
        if (!result) return;
        setLoading(true);
        try {
            await onApply(buildCanvasNodes(result, viewport, viewportSize), result.connections);
            reset();
            onClose();
            message.success(`Imported${result.importedNodeCount} nodes and${result.importedConnectionCount}links`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to save import results");
        } finally {
            setLoading(false);
        }
    };

    const hasWarnings = result ? Boolean(result.skippedNodes.length || result.skippedConnections.length || result.multiResultNodeCount || result.reusedFailedNodeCount || result.placeholderNodeCount || result.warnings.length) : false;

    return (
        <Modal
            className="workspace-modal"
            open={open}
            onCancel={close}
            title="Import TapNow canvas"
            width={620}
            footer={
                result ? (
                    [
                        <Button key="close" onClick={close}>
                                                        Close
                        </Button>,
                        <Button key="apply" type="primary" icon={<Import className="size-4" />} loading={loading} onClick={() => void apply()}>
                                                        Confirm import
                        </Button>,
                    ]
                ) : (
                    <Button type="primary" loading={loading} onClick={() => void load()}>
                                                Read canvas
                    </Button>
                )
            }
        >
            <div className="space-y-4">
                <div>
                    <label className="mb-2 block text-sm font-medium">TapNow canvas share link or share ID</label>
                    <Input
                        value={value}
                        onChange={(event) => changeValue(event.target.value)}
                        placeholder="Paste https://app.tapnow.media/tapflow/view/…"
                        disabled={loading}
                        suffix={shareID && value !== shareID ? <ExternalLink className="size-4 text-foreground/35" /> : null}
                    />
                </div>
                {loading && !result ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/55">
                        <LoaderCircle className="size-4 animate-spin" />
                                                Reading TapNow canvas...
                    </div>
                ) : null}
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">{result.projectName || "TapNow Canvas"}</div>
                                    <div className="mt-1 text-sm text-foreground/60">
                                                                                Importable{result.importedNodeCount}  nodes ·{result.importedConnectionCount}  lines
                                    </div>
                                </div>
                                <Tag color="blue">Batch:{formatTapNowBatchTime(result.batchCreatedAt)}</Tag>
                            </div>
                            <div className="mt-3 text-xs leading-5 text-foreground/50">Supports image, video, audio and text nodes; the nodes will retain their relative positions and be placed in the center of the current visual area as a whole.</div>
                        </div>
                        {hasWarnings ? (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {result.skippedNodes.length ? <div>{result.skippedNodes.length}  The currently unsupported nodes have not been imported, and the related connections have been automatically ignored.</div> : null}
                                    {!result.skippedNodes.length && result.skippedConnections.length ? <div>{result.skippedConnections.length}  Invalid connections have been automatically ignored.</div> : null}
                                    {result.reusedFailedNodeCount ? <div>{result.reusedFailedNodeCount}  Nodes whose most recent task failed but still have historical results have been retained.</div> : null}
                                    {result.placeholderNodeCount ? <div>{result.placeholderNodeCount}  nodes that have not yet generated results have been reserved as placeholder nodes.</div> : null}
                                    {result.multiResultNodeCount ? <div>{result.multiResultNodeCount}  multi-result nodes have used the first result.</div> : null}
                                    {result.warnings.map((warning, index) => (
                                        <div key={`${warning.id || "warning"}-${index}`}>{warning.message}</div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                            <Tag>Waiting for confirmation of import</Tag>
                        </div>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
