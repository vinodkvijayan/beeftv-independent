import type { ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";
import { Link } from "react-router";

import { StatusBadge } from "@/components/ui/base/badges";
import { assetCategoryLabel as sharedAssetCategoryLabel } from "@/lib/asset-category";
import type { ProjectDetail, ProjectShot, ShotArtifact, ShotRevision, WorkflowStep } from "@/services/api/projects";
import type { TaskStatus } from "@/services/api/task-center";

export type ShortDramaWorkflowStage = "story" | "assets" | "storyboard" | "previz" | "video" | "delivery";

export const workflowStages: Array<{ key: ShortDramaWorkflowStage; label: string; shortLabel: string }> = [
    { key: "story", label: "Plot and chapters", shortLabel: "plot" },
    { key: "assets", label: "Asset split", shortLabel: "assets" },
    { key: "storyboard", label: "Storyboard", shortLabel: "Storyboard" },
    { key: "previz", label: "Black and white action preview", shortLabel: "preview" },
    { key: "video", label: "video generation", shortLabel: "video" },
    { key: "delivery", label: "Delivery and packaging", shortLabel: "Delivery" },
];

export function WorkflowStageLink({ href, active, step, index, label, shortLabel }: { href: string; active: boolean; step?: WorkflowStep; index: number; label: string; shortLabel: string }) {
    const completed = step?.status === "completed" || step?.status === "skipped";
    const failed = step?.status === "failed";
    return (
        <Link to={href} className={`workflow-stage-link ${active ? "is-active" : ""}`} aria-current={active ? "step" : undefined}>
            <span className={`workflow-stage-index ${completed ? "is-completed" : failed ? "is-failed" : ""}`}>
                {completed ? <Check className="size-3" /> : failed ? <CircleAlert className="size-3" /> : index + 1}
            </span>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
        </Link>
    );
}

export function StageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
    return <div><div className="text-[var(--fs-micro)] font-medium uppercase tracking-[.18em] text-[var(--workspace-accent)]">{eyebrow}</div><h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/50">{description}</p></div>;
}

export function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return <div className="rounded-xl border border-border/70 bg-surface p-5"><div className="text-foreground/35">{icon}</div><div className="mt-4 text-2xl font-semibold">{value}</div><div className="mt-1 text-xs text-foreground/45">{label}</div></div>;
}

export function ArtifactStatus({ artifact, taskStatus }: { artifact?: ShotArtifact; taskStatus?: TaskStatus; compact?: boolean }) {
    if (taskStatus === "queued" || taskStatus === "running" || (taskStatus === "succeeded" && !artifact)) {
        return <StatusBadge variant="filled" tone="loading" label="Generating" />;
    }
    if (taskStatus === "failed") return <StatusBadge variant="filled" tone="error" label="Build failed" />;
    if (!artifact) return <StatusBadge variant="filled" tone="neutral" label="To be generated" />;
    const tone = artifact.status === "ready" ? "success" : artifact.status === "failed" ? "error" : artifact.status === "stale" ? "warning" : "loading";
    const label = artifact.status === "ready" ? "Generated" : artifact.status === "failed" ? "Build failed" : artifact.status === "stale" ? "Expired" : "Generating";
    return <StatusBadge variant="filled" tone={tone} label={label} />;
}

export function currentRevision(detail: ProjectDetail, shot?: ProjectShot): ShotRevision | undefined {
    if (!shot) return undefined;
    const revisions = detail.shotRevisions || [];
    return revisions.find((item) => item.id === shot.currentRevisionId)
        || revisions.filter((item) => item.shotId === shot.id).slice().sort((left, right) => right.version - left.version)[0];
}

export function currentArtifact(detail: ProjectDetail, shotId: string, type: string) {
    const artifacts = (detail.shotArtifacts || []).filter((item) => item.shotId === shotId && item.type === type).slice().sort((left, right) => right.version - left.version);
    return artifacts.find((item) => item.selected) || artifacts[0];
}

export function artifactTypeForStage(stage: ShortDramaWorkflowStage) {
    if (stage === "video") return "video";
    if (stage === "previz") return "action_board";
    return "storyboard";
}

export function assetCategoryLabel(category: string) {
    return sharedAssetCategoryLabel(category);
}

export function formatDuration(durationMs: number) {
    if (durationMs < 60_000) return `${Math.round(durationMs / 100) / 10}s`;
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
}

export function stageActionLabel(step?: WorkflowStep) {
    if (!step || step.status === "pending") return "Wait for the previous step";
    if (step.status === "running" || step.status === "review") return "completion stage";
    if (step.status === "completed") return "reopen";
    if (step.status === "failed") return "Start over";
    return "Beginning stage";
}
