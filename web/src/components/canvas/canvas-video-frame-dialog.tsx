import { useEffect, useRef, useState, type CSSProperties } from "react";
import { App, Button, InputNumber, Modal } from "antd";
import { Check, Image as ImageIcon, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatVideoFrameTime, normalizeVideoFrameTimes } from "@/lib/canvas/canvas-video-frame";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

type SelectedVideoFrame = {
    id: string;
    timeMs: number;
};

export type CanvasVideoFrameParams = {
    timesMs: number[];
};

type CanvasVideoFrameDialogProps = {
    node: CanvasNodeData;
    open: boolean;
    onClose: () => void;
    onConfirm: (params: CanvasVideoFrameParams) => void;
};

const MAX_SELECTED_FRAMES = 30;

export function CanvasVideoFrameDialog({ node, open, onClose, onConfirm }: CanvasVideoFrameDialogProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoUrl, setVideoUrl] = useState("");
    const [videoError, setVideoError] = useState(false);
    const [durationMs, setDurationMs] = useState(0);
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [frames, setFrames] = useState<SelectedVideoFrame[]>([]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setVideoUrl("");
        setVideoError(false);
        setDurationMs(0);
        setCurrentTimeMs(0);
        setFrames([]);
        const storageKey = node.metadata?.storageKey || "";
        const fallback = node.metadata?.content || "";
        const applyUrl = (url: string) => {
            if (!cancelled) setVideoUrl(url);
        };
        if (resourceIdFromStorageKey(storageKey)) {
            void cacheResourceObjectUrl(storageKey)
                .then((cached) => {
                    if (cancelled) return;
                    if (cached) setVideoUrl(cached);
                    else void resolveMediaUrl(storageKey, fallback).then(applyUrl);
                })
                .catch(() => {
                    if (!cancelled) void resolveMediaUrl(storageKey, fallback).then(applyUrl);
                });
        } else {
            void resolveMediaUrl(storageKey, fallback).then(applyUrl);
        }
        return () => {
            cancelled = true;
        };
    }, [node.id, node.metadata?.content, node.metadata?.storageKey, open]);

    const seekTo = (timeMs: number) => {
        const normalized = normalizeVideoFrameTimes([timeMs], durationMs)[0];
        if (normalized === undefined) return;
        setCurrentTimeMs(normalized);
        if (videoRef.current) videoRef.current.currentTime = normalized / 1000;
    };

    const addFrame = (timeMs: number) => {
        const normalized = normalizeVideoFrameTimes([timeMs], durationMs)[0];
        if (normalized === undefined) {
            message.warning("The video length is not ready, please try again later.");
            return;
        }
        if (frames.some((frame) => frame.timeMs === normalized)) {
            message.info("This time point has been added");
            return;
        }
        if (frames.length >= MAX_SELECTED_FRAMES) {
            message.warning(`Maximum single withdrawal${MAX_SELECTED_FRAMES} Frame, please complete the current batch first`);
            return;
        }
        setFrames((current) => [...current, { id: nanoid(), timeMs: normalized }].sort((left, right) => left.timeMs - right.timeMs));
    };

    const removeFrame = (id: string) => setFrames((current) => current.filter((frame) => frame.id !== id));
    const lastFrameMs = Math.max(0, durationMs - 1);

    const title = (
        <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                <ImageIcon className="size-4" />
            </span>
            <div className="min-w-0">
                <div className="truncate font-semibold leading-6">Key frame interception</div>
                <div className="truncate text-xs opacity-45">{node.title || "video node"}</div>
            </div>
        </div>
    );

    return (
        <Modal title={title} open={open} onCancel={onClose} footer={null} width={760} centered destroyOnHidden>
            <div className="space-y-4">
                <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-xl bg-black">
                    {videoUrl ? (
                        <video
                            ref={videoRef}
                            src={videoUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="block max-h-[var(--video-segment-preview-max-height)] w-full"
                            onLoadedMetadata={(event) => {
                                const video = event.currentTarget;
                                if (!Number.isFinite(video.duration) || video.duration <= 0) return;
                                setDurationMs(Math.round(video.duration * 1000));
                                setCurrentTimeMs(Math.round(video.currentTime * 1000));
                            }}
                            onTimeUpdate={(event) => setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))}
                            onSeeked={(event) => setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))}
                            onError={() => setVideoError(true)}
                        />
                    ) : (
                        <div className="grid h-44 w-full place-items-center text-xs opacity-60">{videoError ? "Video preview failed to load, please check if the footage is still available" : "Loading video…"}</div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: theme.toolbar.itemHover }}>
                    <span className="text-xs font-medium opacity-60">current time</span>
                    <InputNumber
                        size="small"
                        min={0}
                        max={Math.max(0, lastFrameMs / 1000)}
                        step={0.001}
                        precision={3}
                        value={currentTimeMs / 1000}
                        className="w-28"
                        aria-label="Current frame time (seconds)"
                        onChange={(value) => seekTo(Math.round((value || 0) * 1000))}
                    />
                    <span className="mr-auto text-xs opacity-45">/ {durationMs ? formatVideoFrameTime(durationMs) : "--:--.---"}</span>
                    <Button
                        size="small"
                        icon={<SkipBack className="size-3.5" />}
                        disabled={!durationMs}
                        onClick={() => {
                            seekTo(0);
                            addFrame(0);
                        }}
                    >
                                                first frame
                    </Button>
                    <Button size="small" type="primary" icon={<ImageIcon className="size-3.5" />} disabled={!durationMs} onClick={() => addFrame(currentTimeMs)}>
                                                        current frame
                    </Button>
                    <Button
                        size="small"
                        icon={<SkipForward className="size-3.5" />}
                        disabled={!durationMs}
                        onClick={() => {
                            seekTo(lastFrameMs);
                            addFrame(lastFrameMs);
                        }}
                    >
                                                last frame
                    </Button>
                </div>

                <section aria-labelledby="selected-video-frames-title">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div id="selected-video-frames-title" className="text-sm font-medium">
                                                        selected screen
                        </div>
                        <div className="text-xs opacity-45">
                            {frames.length}/{MAX_SELECTED_FRAMES}
                        </div>
                    </div>
                    {frames.length ? (
                        <div className="thin-scrollbar grid max-h-52 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                            {frames.map((frame, index) => (
                                <div key={frame.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: theme.toolbar.itemHover }}>
                                    <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2" style={{ "--tw-ring-color": theme.node.activeStroke } as CSSProperties} onClick={() => seekTo(frame.timeMs)}>
                                        <span className="block text-[var(--fs-micro)] opacity-45">picture{index + 1}</span>
                                        <span className="block truncate font-mono text-xs font-medium">{formatVideoFrameTime(frame.timeMs)}</span>
                                    </button>
                                    <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={`delete screen${index + 1}`} onClick={() => removeFrame(frame.id)} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg px-3 py-5 text-center text-xs opacity-50" style={{ background: theme.toolbar.itemHover }}>
                                                        Play or drag to the desired location and add the current frame. Multiple time points can be added consecutively.
                        </div>
                    )}
                </section>

                <div className="flex items-center justify-between gap-3">
                    <div className="text-xs opacity-45">After extraction, only image nodes will be created, and the generation task will not be automatically initiated.</div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button onClick={onClose}>Cancel</Button>
                        <Button type="primary" icon={<Check className="size-4" />} disabled={!frames.length} onClick={() => onConfirm({ timesMs: frames.map((frame) => frame.timeMs) })}>
                            {frames.length ? `intercept${frames.length} keyframes` : "Key frame interception"}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
