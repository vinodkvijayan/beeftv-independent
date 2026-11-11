// 时间线确定性摘要：把 TimelineProject 压缩成稳定、可控长度的中文上下文，供 AI 编辑和诊断使用。
// 同一输入永远产出同一输出（无时间戳/无随机），供命令引用 id 与 AI 面板上下文注入。

import type { TimelineClip, TimelineProject, TimelineTrack } from "@/types/timeline";

/** 片段逐行列出的上限；超出后折叠为一行汇总，防止超长时间线撑爆模型上下文。 */
export const SUMMARY_MAX_CLIP_LINES = 60;
/** 标题/文本在摘要中的最大展示长度。 */
export const SUMMARY_MAX_TEXT_CHARS = 24;

const KIND_LABELS: Record<string, string> = {
    video: "video",
    audio: "Audio",
    subtitle: "subtitles",
    text: "text",
    image: "pictures",
};

export function formatMs(ms: number): string {
    const total = Math.max(0, Math.round(ms));
    const s = Math.floor(total / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
}

function clipLine(clip: TimelineClip): string {
    const label = (clip.title || clip.text || "").trim().slice(0, SUMMARY_MAX_TEXT_CHARS);
    const source = clip.directMedia?.title?.slice(0, SUMMARY_MAX_TEXT_CHARS) ?? "";
    const text = label || source || clip.nodeId.slice(0, 12);
    return `  - clip ${clip.id} | ${clip.kind} | orbit${clip.trackId} | ${clip.startMs}-${clip.startMs + clip.durationMs}ms | ${text}`;
}

function trackLine(track: TimelineTrack): string {
    const flags = [
        track.visible === false ? "hide" : null,
        track.muted ? "mute" : null,
    ]
        .filter(Boolean)
        .join("/");
    return `  - ${track.id} | ${KIND_LABELS[track.kind] ?? track.kind}rail |${track.label}${flags ? ` | ${flags}` : ""}`;
}

/** 生成中文时间线摘要（确定性、纯文本）。 */
export function summarizeTimeline(project: TimelineProject): string {
    const lines: string[] = [];
    const subtitleClips = project.clips.filter((c) => c.kind === "subtitle");
    const nodeIds = new Set(project.clips.map((c) => c.nodeId));
    const directCount = project.clips.filter((c) => c.directMedia).length;

    lines.push(`Timeline: Total duration${formatMs(project.durationMs)}，${project.tracks.length} track,${project.clips.length} clips (subtitles${subtitleClips.length}, direct connection material${directCount}, reference node${nodeIds.size} ).`);
    lines.push(`Tracks (order from top to bottom):`);
    for (const track of [...project.tracks].sort((a, b) => a.order - b.order)) {
        lines.push(trackLine(track));
    }
    lines.push(`Snippet:`);
    if (project.clips.length === 0) {
        lines.push(`  (empty timeline)`);
    } else {
        const shown = project.clips.slice(0, SUMMARY_MAX_CLIP_LINES);
        for (const clip of shown) {
            lines.push(clipLine(clip));
        }
        const hidden = project.clips.length - shown.length;
        if (hidden > 0) lines.push(`  …the rest${hidden} fragments omitted`);
    }
    if (subtitleClips.length > 0) {
        const totalChars = subtitleClips.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
        lines.push(`Total subtitles${totalChars} words.`);
    }
    return lines.join("\n");
}
