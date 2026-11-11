// SRT 导入导出（复用 srt-parser）+ 「从节点重建字幕片段」命令（快照契约：
// 节点 subtitleEntries 权威 → 重建时间线字幕快照，替换过期快照，单向显式同步）。
// 时间线字幕片段是节点字幕的只读快照；AI 高亮只写权威节点字幕。
// 当前预览不渲染字幕高亮，因此本工具不重复发起 AI 请求，避免产生两份互相漂移的结果。

import { useMemo, useState } from "react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { parseSrt, serializeSrtEntries } from "@/lib/timeline/srt-parser";
import { getSubtitleTracks } from "@/lib/timeline/timeline-tracks";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import type { SrtEntry, TimelineClip } from "@/types/timeline";

const DEFAULT_SRT_NODE_ID = "srt-import";

export function EditorSubtitleTools() {
    const { project, dispatch } = useEditorStoreContext();
    const [srtText, setSrtText] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    const subtitleClips = useMemo(
        () => (project?.clips ?? []).filter((c) => c.kind === "subtitle").sort((a, b) => a.startMs - b.startMs),
        [project],
    );
    const subtitleTracks = useMemo(() => (project ? getSubtitleTracks(project.tracks) : []), [project]);

    // SRT 导入：解析文本 → rebuildSubtitleClips 以 DEFAULT_SRT_NODE_ID 为权威节点重建
    // 字幕快照。确定性 id（nodeId:subtitle:index）保证重复导入原地替换，不堆积漂移。
    const importSrt = () => {
        const entries = parseSrt(srtText);
        if (entries.length === 0) {
            setMessage("No valid SRT entry resolved");
            return;
        }
        dispatch({
            op: "rebuildSubtitleClips",
            payload: { nodeId: DEFAULT_SRT_NODE_ID, entries, trackId: subtitleTracks[0]?.id },
        });
        setMessage(`Already removed from node${DEFAULT_SRT_NODE_ID} rebuild${entries.length} subtitle snapshot`);
    };

    // SRT 导出：当前时间线字幕快照 → 序列化 → 下载 .srt（往返一致）。
    const exportSrt = () => {
        if (subtitleClips.length === 0) {
            setMessage("There are no subtitle clips on the timeline");
            return;
        }
        const entries: SrtEntry[] = subtitleClips.map((clip, idx) => ({
            index: clip.subtitleEntryIndex ?? idx + 1,
            startMs: clip.startMs,
            endMs: clip.startMs + clip.durationMs,
            text: clip.text ?? "",
        }));
        const content = serializeSrtEntries(entries);
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "subtitles.srt";
        a.click();
        URL.revokeObjectURL(url);
        setMessage(`Exported${entries.length} subtitles`);
    };

    return (
        <div className="flex h-full flex-col bg-[var(--director-sequencer-surface)]">
            <div className="director-scroll min-h-0 flex-1 overflow-y-auto p-3">
                <div className="mb-3 rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] p-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--director-dock-fg-strong)]">Timeline subtitles</span>
                        <span className="text-[10px] text-[var(--director-dock-fg)]/60">{subtitleClips.length}  Article</span>
                    </div>
                    {subtitleClips.length === 0 ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--director-dock-fg)]/55">There are no subtitle snapshots yet. After pasting the SRT import, the subtitles are rebuilt into the timeline.</p>
                    ) : (
                        <ul className="mt-2 space-y-1">
                            {subtitleClips.slice(0, 6).map((clip) => (
                                <SubtitleRow key={clip.id} clip={clip} />
                            ))}
                            {subtitleClips.length > 6 && (
                                <li className="pt-1 text-[10px] text-[var(--director-dock-fg)]/50">…total{subtitleClips.length}  Article</li>
                            )}
                        </ul>
                    )}
                </div>

                <label className="mb-3 block">
                    <span className="mb-1 block text-[11px] text-[var(--director-dock-fg)]/70">SRT text (import)</span>
                    <textarea
                        value={srtText}
                        onChange={(e) => setSrtText(e.target.value)}
                        rows={8}
                        placeholder={"1\n00:00:00,500 --> 00:00:02,500\nHello BeefTV"}
                        className="w-full resize-y rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--director-dock-fg-strong)] outline-none focus:border-[var(--workspace-accent)]/60"
                    />
                </label>

                <div className="mb-3 flex gap-2">
                    <button
                        type="button"
                        onClick={importSrt}
                        disabled={!srtText.trim()}
                        className="flex-1 rounded-md bg-[var(--director-accent)] px-2 py-1.5 text-xs font-medium text-[var(--director-on-accent)] hover:bg-[var(--director-accent-hover)] disabled:opacity-40"
                    >
                                                Import (rebuild subtitles)
                    </button>
                    <button
                        type="button"
                        onClick={exportSrt}
                        disabled={subtitleClips.length === 0}
                        className="flex-1 rounded-md border border-[var(--director-sequencer-border)] px-2 py-1.5 text-xs text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:opacity-40"
                    >
                                                Export SRT
                    </button>
                </div>

                <div className="rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] p-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--director-dock-fg-strong)]">AI Highlight</span>
                        <span className="rounded-full bg-[var(--director-dock-active-surface)] px-1.5 py-0.5 text-[10px] text-[var(--director-dock-fg)]/80">Available</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--director-dock-fg)]/55">
                                                AI subtitle highlighting and keyword annotation have been implemented, and the entrance is in the canvas "Subtitles" pop-up window (click Subtitles → AI Highlight, and access ai.text permissions).
                        The timeline subtitle fragment is reconstructed from the subtitle snapshot; after the editor preview supports subtitle text rendering, the highlight will be synchronized here with the snapshot.</p>
                </div>

                {message && <p className="mt-2 text-[11px] text-[var(--director-dock-fg)]/70">{message}</p>}
            </div>
        </div>
    );
}


function SubtitleRow({ clip }: { clip: TimelineClip }) {
    return (
        <li className="flex items-baseline gap-2 rounded border border-[var(--director-sequencer-border)]/70 bg-[var(--director-control-hover)]/60 px-1.5 py-1">
            <span className="shrink-0 tabular-nums text-[10px] text-[var(--director-dock-fg)]/60">
                {formatTimelineTime(clip.startMs)} – {formatTimelineTime(clip.startMs + clip.durationMs)}
            </span>
            <span className="truncate text-[11px] text-[var(--director-dock-fg)]/80">{clip.text ?? ""}</span>
        </li>
    );
}
