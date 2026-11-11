import { App, Button, Drawer, Tag } from "antd";
import { Box, Copy, Download, Maximize2, Pause, Play, Volume2, VolumeX, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { useCopyText } from "@/hooks/use-copy-text";
import { useResourceVideoPlayback } from "@/hooks/use-resource-video-playback";
import { assetCategoryLabel } from "@/lib/asset-category";
import { formatBytes } from "@/lib/image-utils";
import { resolveMediaUrl } from "@/services/file-storage";
import type { Asset, AssetKind } from "@/stores/use-asset-store";

export type LibraryAsset = Exclude<Asset, { kind: "entity" }>;

export function resolveAssetGenerationPrompt(asset: LibraryAsset | null | undefined): string {
    if (!asset) return "";
    const metaPrompt = typeof asset.metadata?.prompt === "string" ? asset.metadata.prompt.trim() : "";
    if (metaPrompt) return metaPrompt;
    const raw = asset as LibraryAsset & { description?: unknown; contentText?: unknown };
    if (typeof raw.description === "string" && raw.description.trim()) return raw.description.trim();
    if (typeof raw.contentText === "string" && raw.contentText.trim()) return raw.contentText.trim();
    if (asset.kind === "text" && typeof asset.data?.content === "string" && asset.data.content.trim()) {
        return asset.data.content.trim();
    }
    return "";
}

export function resolveAssetGenerationModel(asset: LibraryAsset | null | undefined): string {
    if (!asset) return "";
    return typeof asset.metadata?.model === "string" ? asset.metadata.model.trim() : "";
}

export function resolveAssetGenerationAspectRatio(asset: LibraryAsset | null | undefined): string {
    if (!asset) return "";
    if (typeof asset.metadata?.aspectRatio === "string" && asset.metadata.aspectRatio.trim()) {
        return asset.metadata.aspectRatio.trim();
    }
    if (typeof asset.metadata?.size === "string" && asset.metadata.size.trim()) {
        return asset.metadata.size.trim();
    }
    return "";
}

export async function copyPromptToClipboard(
    promptText: string,
    message?: { success?: (content: string) => unknown; error?: (content: string) => unknown },
    fallbackCopy?: (value: string, successText?: string) => Promise<boolean> | void,
): Promise<boolean> {
    const trimmed = promptText.trim();
    if (!trimmed) return false;
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(trimmed);
            message?.success?.("Prompt word has been copied and generated");
            return true;
        }
    } catch {
        // Fall through to fallback copy helper
    }
    if (fallbackCopy) {
        const result = await fallbackCopy(trimmed, "Prompt word has been copied and generated");
        return typeof result === "boolean" ? result : true;
    }
    message?.error?.("The current environment does not support replication, please select replication manually.");
    return false;
}

export function AssetGenerationPromptSection({ asset }: { asset: LibraryAsset }) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const promptText = resolveAssetGenerationPrompt(asset);
    const model = resolveAssetGenerationModel(asset);
    const aspectRatio = resolveAssetGenerationAspectRatio(asset);
    if (!promptText) return null;

    return (
        <div className="asset-archive-section" data-testid="asset-generation-prompt-section">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="asset-archive-section-title">Generate prompt words</span>
                    {model ? <Tag className="m-0">{model}</Tag> : null}
                    {aspectRatio ? <Tag className="m-0">{aspectRatio}</Tag> : null}
                </div>
                <Button
                    size="small"
                    icon={<Copy className="size-3.5" />}
                    onClick={() => void copyPromptToClipboard(promptText, message, copyText)}
                >
                                        copy prompt word
                </Button>
            </div>
            <div className="asset-archive-section-body select-text whitespace-pre-wrap break-words rounded-lg border border-black/10 bg-black/[0.02] p-3 text-sm leading-relaxed dark:border-white/10 dark:bg-white/[0.03]">
                {promptText}
            </div>
        </div>
    );
}

export function AssetVideoPreview({ storageKey, url, title, className }: { storageKey?: string; url: string; title: string; className: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playback = useResourceVideoPlayback(storageKey || "", url);
    const source = playback.url;
    const error = Boolean(playback.error);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    return (
        <div className="asset-video-player">
            {source ? (
                <>
                    <video
                        ref={videoRef}
                        src={source}
                        playsInline
                        preload="metadata"
                        aria-label={title}
                        className={className}
                        onError={() => { if (!playback.requestCompatible()) playback.fail(); }}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                        onVolumeChange={(event) => {
                            setMuted(event.currentTarget.muted);
                            setVolume(event.currentTarget.volume);
                        }}
                    />
                    <div className="asset-video-controls" aria-label="Video playback control">
                        <button type="button" className="asset-video-control-button" aria-label={playing ? "pause" : "play"} onClick={() => {
                            const video = videoRef.current;
                            if (!video) return;
                            if (video.paused) void video.play().catch(() => playback.fail());
                            else video.pause();
                        }}>
                            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                        </button>
                        <span className="asset-video-time">{formatAssetClock(currentTime * 1000) || "0:00"}</span>
                        <input
                            className="asset-video-seek"
                            type="range"
                            min={0}
                            max={Math.max(duration, 0.1)}
                            step={0.1}
                            value={Math.min(currentTime, duration || 0)}
                            aria-label="Playback progress"
                            onChange={(event) => {
                                const time = Number(event.currentTarget.value);
                                if (videoRef.current) videoRef.current.currentTime = time;
                                setCurrentTime(time);
                            }}
                        />
                        <span className="asset-video-time">{formatAssetClock(duration * 1000) || "0:00"}</span>
                        <div className="asset-video-volume">
                            <button type="button" className="asset-video-control-button" aria-label={muted || volume === 0 ? "Turn on sound" : "mute"} onClick={() => {
                                const video = videoRef.current;
                                if (!video) return;
                                video.muted = !video.muted;
                                setMuted(video.muted);
                            }}>
                                {muted || volume === 0 ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
                            </button>
                            <input
                                className="asset-video-volume-slider"
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={volume}
                                aria-label="Volume"
                                onChange={(event) => {
                                    const nextVolume = Number(event.currentTarget.value);
                                    if (videoRef.current) {
                                        videoRef.current.volume = nextVolume;
                                        videoRef.current.muted = nextVolume === 0;
                                    }
                                    setVolume(nextVolume);
                                    setMuted(nextVolume === 0);
                                }}
                            />
                        </div>
                        <button type="button" className="asset-video-control-button" aria-label="full screen" onClick={() => void videoRef.current?.requestFullscreen?.()}>
                            <Maximize2 aria-hidden="true" />
                        </button>
                    </div>
                </>
            ) : null}
            {!source && !error ? <span className="text-sm text-white/65">Loading video…</span> : null}
            {error ? (
                <div className="absolute inset-0 grid place-content-center justify-items-center gap-3 bg-black px-4 text-center text-sm text-white/80">
                    <span>Video loading failed, please check the resource service and try again.</span>
                    <Button size="small" onClick={playback.retry}>Try again</Button>
                </div>
            ) : null}
        </div>
    );
}

export function AssetDrawer({
    asset,
    onClose,
    onCopy,
    onDownload,
}: {
    asset: LibraryAsset | null;
    onClose: () => void;
    onCopy: (asset: LibraryAsset) => void;
    onDownload: (asset: LibraryAsset) => void;
}) {
    const [playable, setPlayable] = useState<{ asset: LibraryAsset; url: string } | null>(null);
    useEffect(() => {
        if (!asset || asset.kind !== "audio") {
            setPlayable(null);
            return;
        }
        let cancelled = false;
        void resolveMediaUrl(asset.data.storageKey, asset.data.url).then((url) => {
            if (!cancelled) setPlayable({ asset, url });
        }).catch(() => {
            if (!cancelled) setPlayable(null);
        });
        return () => { cancelled = true; };
    }, [asset]);
    const mediaUrl = playable?.asset === asset ? playable?.url : undefined;
    const facts = asset ? assetArchiveFacts(asset) : [];
    const model = resolveAssetGenerationModel(asset);
    const aspectRatio = resolveAssetGenerationAspectRatio(asset);
    return (
        <Drawer className="library-drawer asset-detail-drawer" title={null} closable={false} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-4">
                    <div className="asset-archive-header">
                        <h2 className="asset-archive-title min-w-0">{asset.title}</h2>
                        <Button type="text" className="asset-detail-close" icon={<X className="size-4" />} aria-label="Close asset details" onClick={onClose} />
                    </div>
                    <div className="asset-archive-preview">
                        {asset.kind === "text" ? (
                            <div className="asset-archive-preview-note">{asset.data.content}</div>
                        ) : asset.kind === "audio" ? (
                            <div className="asset-archive-audio">
                                <audio src={mediaUrl} controls />
                            </div>
                        ) : asset.kind === "model" ? (
                            <div className="asset-archive-preview-model">
                                <Box />
                                <span>
                                    {asset.data.fileName} · {formatBytes(asset.data.bytes)}
                                </span>
                            </div>
                        ) : asset.kind === "video" ? (
                            <AssetVideoPreview storageKey={asset.data.storageKey} url={asset.data.url} title={asset.title} className="asset-archive-preview-media" />
                        ) : (
                            <AssetImageZoom asset={asset} />
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {asset.arkAssetId ? (
                            <Tag className="m-0" color="geekblue" title="Volcano Ark material ID, which can be directly referenced by asset:// when generating videos">
                                                                Ark{asset.arkAssetId}
                            </Tag>
                        ) : null}
                        {model ? <Tag className="m-0">{model}</Tag> : null}
                        {aspectRatio ? <Tag className="m-0">{aspectRatio}</Tag> : null}
                    </div>
                    <div className="asset-archive-facts">
                        {facts.map((fact) => (
                            <div key={fact.label} className="asset-archive-fact">
                                <span className="asset-archive-fact-label">{fact.label}</span>
                                <span className="asset-archive-fact-value" title={fact.value}>
                                    {fact.value}
                                </span>
                            </div>
                        ))}
                    </div>
                    <AssetGenerationPromptSection asset={asset} />
                    {asset.note ? (
                        <div className="asset-archive-section">
                            <span className="asset-archive-section-title">Remarks</span>
                            <p className="asset-archive-section-body">{asset.note}</p>
                        </div>
                    ) : null}
                    <div className="asset-archive-actions">
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                                                copy text
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? (
                            <Button className="asset-detail-download" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {assetDownloadLabel(asset)}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

function AssetImageZoom({ asset }: { asset: LibraryAsset & { kind: "image" } }) {
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [retry, setRetry] = useState(0);
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
    return (
        <div className="asset-zoom-viewer" onWheel={(event) => { event.preventDefault(); setScale((value) => Math.min(4, Math.max(.25, value * (event.deltaY < 0 ? 1.12 : .89)))); }} onPointerDown={(event) => { if (scale <= 1) return; event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag) return; setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y }); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
            <CachedResourceImage
                key={`${asset.id}:${retry}`}
                storageKey={asset.data.storageKey}
                src={asset.coverUrl || asset.data.dataUrl}
                alt={asset.title}
                eager
                decoding="async"
                className="asset-archive-preview-media asset-zoom-image"
                style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                loadingFallback={<span className="text-sm text-white/65">Loading images…</span>}
                fallback={<div className="grid justify-items-center gap-3 text-sm text-white/75"><span>Image loading failed, please try again.</span><Button size="small" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
            />
            <div className="asset-zoom-controls" data-canvas-no-zoom>
                <button type="button" title="zoom out" aria-label="zoom out" onClick={() => setScale((value) => Math.max(.25, value / 1.25))}><ZoomOut className="size-4" /></button>
                <button type="button" title="recovery adaptation" aria-label="recovery adaptation" onClick={reset}>{Math.round(scale * 100)}%</button>
                <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setScale((value) => Math.min(4, value * 1.25))}><ZoomIn className="size-4" /></button>
                <button type="button" title="View original image size" aria-label="View original image size" onClick={() => setScale(1)}><Maximize2 className="size-4" /></button>
            </div>
        </div>
    );
}

export function assetArchiveFacts(asset: LibraryAsset) {
    const facts: Array<{ label: string; value: string }> = [
        { label: "Type", value: assetKindLabel(asset.kind) },
        { label: "Classification", value: assetCategoryLabel(asset.category) },
    ];
    if (asset.kind === "image" || asset.kind === "video") {
        facts.push({ label: "Size", value: assetSizeLabel(asset.data.width, asset.data.height) });
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        facts.push({ label: "duration", value: formatAssetClock(asset.data.durationMs) || "unknown" });
    }
    if (asset.kind !== "text") {
        facts.push({ label: "size", value: formatBytes(asset.data.bytes) });
        facts.push({ label: "Format", value: asset.data.mimeType });
    }
    facts.push({ label: "Source", value: asset.source || "Not labeled" });
    facts.push({ label: "Create", value: formatAssetDateTime(asset.createdAt) });
    return facts;
}

function assetSizeLabel(width: number, height: number) {
    return width > 0 && height > 0 ? `${width}x${height}` : "unknown";
}

function assetKindLabel(kind: AssetKind) {
    return kind === "image" ? "pictures" : kind === "video" ? "video" : kind === "audio" ? "Audio" : kind === "model" ? "model" : "text";
}

function assetDownloadLabel(asset: LibraryAsset) {
    if (asset.kind === "video") return "Download video";
    if (asset.kind === "audio") return "Download audio";
    if (asset.kind === "model") return "Download model";
    return "Download pictures";
}

export function formatAssetClock(durationMs?: number) {
    if (!durationMs || durationMs < 1000) return null;
    const total = Math.round(durationMs / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatAssetDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
