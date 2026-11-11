import { StatusBadge } from "@/components/ui/base/badges";
import type { ReactNode } from "react";

import type { ProjectDetail, ProjectUnit } from "@/services/api/projects";
import { ASSET_CATEGORY_LABELS, assetCategoryLabel as sharedAssetCategoryLabel } from "@/lib/asset-category";

export type ProjectDetailViewProps = {
    detail: ProjectDetail;
    refreshProject: () => void;
    onCreateCanvas: () => void;
};

export const categoryLabels: Record<string, string> = ASSET_CATEGORY_LABELS;

export const mediaLabels: Record<string, string> = {
    image: "pictures",
    video: "video",
    audio: "Audio",
    text: "text",
    model: "3D model",
    entity: "character card",
};

const statusLabels: Record<string, string> = {
    active: "In progress",
    archived: "Archived",
    draft: "draft",
    ready: "To be produced",
    completed: "Completed",
    review: "Pending review",
    confirmed: "Confirmed",
    pending: "Pending",
    pending_confirmation: "To be confirmed",
    running: "In progress",
    failed: "failed",
    ignored: "Ignored",
    skipped: "skipped",
    cancelled: "Canceled",
    succeeded: "Completed",
    disabled: "Deactivated",
    idle: "To be started",
    loading: "Processing",
    queued: "Queuing",
    success: "Completed",
    error: "Abnormal",
    deleted: "Deleted",
    reserved: "frozen",
    settled: "Settled",
    refunded: "Refunded",
    uncertain: "To be verified",
};

const sourceTypeLabels: Record<string, string> = {
    blank: "blank start",
    novel: "Import novels",
    text: "Paste text",
};

export function categoryLabel(value: string) {
    return sharedAssetCategoryLabel(value);
}

export function statusLabel(value: string) {
    return statusLabels[value] || "unknown status";
}

export function mediaLabel(value: string) {
    return mediaLabels[value] || "Other types";
}

export function sourceTypeLabel(value: string) {
    return sourceTypeLabels[value] || "other sources";
}

export function StatusPill({ status }: { status: string }) {
    const tone = status === "completed" || status === "confirmed" || status === "succeeded" ? "success" : status === "failed" ? "error" : status === "running" || status === "active" ? "loading" : status === "review" || status === "pending_confirmation" ? "warning" : "neutral";
    return <StatusBadge tone={tone} label={statusLabel(status)} className="m-0" />;
}

export function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col gap-2 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                {eyebrow ? <div className="mb-1 text-[var(--fs-tiny)] font-semibold text-foreground/40">{eyebrow}</div> : null}
                <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
                {description ? <p className="mt-1 text-sm leading-5 text-foreground/55">{description}</p> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

export function MetricTile({ label, value, detail, accent = false }: { label: string; value: string | number; detail?: string; accent?: boolean }) {
    return (
        <div className={`overflow-hidden rounded-lg border px-3 py-3 ${accent ? "border-[color-mix(in_srgb,var(--workspace-accent)_30%,transparent)] bg-[var(--workspace-accent-soft)]" : "border-border/80 bg-background/70"}`}>
            <div className="text-xs text-foreground/50">{label}</div>
            <div className="mt-2 flex items-end gap-2"><strong className="text-2xl font-semibold tracking-normal">{value}</strong>{detail ? <span className="pb-0.5 text-xs text-foreground/45">{detail}</span> : null}</div>
        </div>
    );
}

export function UnitProgress({ unit }: { unit: ProjectUnit }) {
    const progress = unit.status === "completed" ? 100 : unit.status === "ready" ? 66 : 24;
    return <div className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-[var(--workspace-accent)] transition-[width] duration-200" style={{ width: `${progress}%` }} /></div>;
}

export function formatTime(value?: string) {
    if (!value) return "-";
    return new Date(value).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatCount(value: number) {
    return new Intl.NumberFormat("en-US").format(value);
}

export function textValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
