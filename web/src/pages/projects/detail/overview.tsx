import { ArrowRight, BookOpenText, CheckCircle2, CircleAlert, Clapperboard, Clock3, Film, PackageCheck, PlaySquare, Scissors, UsersRound } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import type { ProjectStageCell, ProjectWorkbenchAction } from "@/lib/project-workbench";
import type { ProjectOverview, ProjectOverviewMetrics } from "@/services/api/projects";

import { formatTime, type ProjectDetailViewProps } from "./shared";

export default function ProjectOverviewView({ detail, overview }: ProjectDetailViewProps & { overview: ProjectOverview }) {
    const { project } = detail;
    const metrics = overview.metrics;
    const completedUnits = metrics.completedUnitCount;
    const attentionCount = metrics.pendingCandidateCount + metrics.staleArtifactCount;
    const completion = metrics.unitCount ? Math.round((completedUnits / metrics.unitCount) * 100) : 0;
    const firstUnitId = detail.units.slice().sort((left, right) => left.position - right.position)[0]?.id || overview.units[0]?.unit.id;
    const workflowHref = (targetStage: string) => firstUnitId ? `/projects/${project.id}/workflow/${firstUnitId}/${targetStage}` : `/projects/${project.id}/chapters`;
    const stage = overviewStage(metrics);
    const actions = overviewActions(project.id, metrics, firstUnitId).slice(0, 3);
    const primaryAction = actions[0];
    const secondaryActions = actions.slice(1);
    const unitStages = overview.units.map((item) => ({
        unit: item.unit,
        content: stageCell(item.unit.wordCount > 0, item.unit.wordCount > 0 ? `${formatCompactCount(item.unit.wordCount)} word` : "To be added"),
        assets: stageCell(item.candidateCount === 0 && item.shotCount > 0, item.candidateCount ? `${item.candidateCount} To be confirmed` : item.shotCount ? "Confirmed" : "To be split", item.candidateCount > 0),
        storyboard: stageCell(item.shotCount > 0, item.shotCount ? `${item.shotCount} mirror` : "To be generated"),
        canvas: stageCell(item.canvasCount > 0, item.canvasCount ? `${item.canvasCount} Zhang` : "Not associated"),
    }));
    const productionSteps = [
        { id: "story", icon: BookOpenText, label: "plot chapter", description: "Import or write the text to confirm the narrative goal of each chapter", metric: `${metrics.unitCount} Chapter ·${formatCompactCount(metrics.totalWordCount)} word`, href: `/projects/${project.id}/chapters`, complete: metrics.unitCount > 0 },
        { id: "assets", icon: UsersRound, label: "Roles and Assets", description: "Confirm characters, scenes, props and project style", metric: `${metrics.assetCount} assets`, href: `/projects/${project.id}/assets`, complete: metrics.assetCount > 0 },
        { id: "storyboard", icon: Clapperboard, label: "Storyboard script and screen", description: "Split shots and confirm composition, dialogue and duration", metric: `${metrics.shotCount} mirror ·${metrics.readyStoryboardCount} Picture`, href: workflowHref("storyboard"), complete: metrics.shotCount > 0 },
        { id: "previz", icon: PlaySquare, label: "action rehearsal", description: "Check performance beats, camerawork and continuity", metric: `${metrics.readyPrevizCount}/${metrics.shotCount || 0} mirror`, href: workflowHref("previz"), complete: metrics.shotCount > 0 && metrics.readyPrevizCount === metrics.shotCount },
        { id: "video", icon: Film, label: "Lens video", description: "Generate, screen versions shot by shot and lock the finished film", metric: `${metrics.readyVideoCount}/${metrics.shotCount || 0} mirror`, href: workflowHref("video"), complete: metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount },
        { id: "editor", icon: Scissors, label: "Edited into a film", description: "Arrange shots in the timeline, add subtitles, and export the finished film", metric: metrics.renderSucceededCount > 0 ? `Output${metrics.renderSucceededCount} into pieces` : metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount ? "Can start editing" : `Not good enough${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} mirror`, href: `/projects/${project.id}/editor`, complete: metrics.renderSucceededCount > 0 },
        { id: "delivery", icon: PackageCheck, label: "Delivery and packaging", description: "Check for missing footage and tidy up the final product", metric: metrics.readyVideoCount && metrics.readyVideoCount === metrics.shotCount ? "can be delivered" : `Not good enough${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} mirror`, href: workflowHref("delivery"), complete: metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount },
    ];
    const gaps = [
        metrics.unitCount === 0 ? "There are no plot chapters yet" : metrics.unitsWithoutText ? `${metrics.unitsWithoutText} Chapter has no text yet` : "Chapter text is ready",
        metrics.pendingCandidateCount ? `${metrics.pendingCandidateCount} assets awaiting confirmation` : metrics.assetCount ? "Project assets have been created" : "No characters and assets yet",
        metrics.shotCount ? metrics.readyVideoCount === metrics.shotCount ? "All footage videos have been generated" : `${metrics.shotCount - metrics.readyVideoCount} Shots have not generated video yet` : "No storyboards yet",
    ];

    return (
        <div className="space-y-8">
            <section className="project-overview-focus">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_308px]">
                    <div className="project-overview-primary">
                        <div className="project-overview-eyebrow">
                            <span>current task</span>
                            <span className="project-overview-eyebrow-divider" aria-hidden>/</span>
                            <span className="project-overview-eyebrow-stage">{stage.label}</span>
                            {attentionCount ? <span className="project-overview-eyebrow-badge">{attentionCount}  Items pending</span> : null}
                        </div>
                        <h2 className="project-overview-title">{primaryAction.title}</h2>
                        <p className="project-overview-description">{primaryAction.description}</p>
                        <div className="project-overview-cta">
                            {/* 主按钮走 --btn-solid-* 配对色：原先是 bg-[--workspace-accent] + text-white，
                                而暗色下该 accent 是 #f5f5f5，等于白底白字。 */}
                            <Link to={primaryAction.href} className="project-overview-cta-primary">
                                <span className="truncate">{primaryAction.actionLabel}</span><ArrowRight className="size-4 shrink-0" />
                            </Link>
                            {secondaryActions[0] ? <Link to={secondaryActions[0].href} className="project-overview-cta-secondary">Continue to the next step<ArrowRight className="size-3.5" /></Link> : null}
                        </div>
                    </div>

                    <aside className="project-overview-status" aria-label="Project progress">
                        <div className="project-overview-progress">
                            <div className="project-overview-progress-head">
                                <span className="project-overview-status-label">Chapter progress</span>
                                <span className="project-overview-progress-percent">{completion}%</span>
                            </div>
                            <div className="project-overview-progress-count">{completedUnits}<span>/ {metrics.unitCount}</span></div>
                            <div className="project-overview-progress-track" aria-label={`Chapter completion${completion}%`}><div style={{ width: `${completion}%` }} /></div>
                        </div>
                        <dl className="project-overview-facts">
                            <ProjectFact label="current stage" value={stage.label} />
                            <ProjectFact label="Storyboard shot" value={`${metrics.shotCount} a`} />
                            <ProjectFact label="project canvas" value={`${metrics.canvasCount} Zhang`} />
                            <ProjectFact label="Need to be processed" value={`${attentionCount} item`} attention={attentionCount > 0} />
                        </dl>
                        {secondaryActions.length ? (
                            <div className="project-overview-next">
                                <span className="project-overview-status-label">subsequently processed</span>
                                <div className="mt-2 space-y-0.5">{secondaryActions.map((action) => <SecondaryAction key={action.id} action={action} />)}</div>
                            </div>
                        ) : null}
                    </aside>
                </div>
            </section>

            <section className="project-standard-flow">
                <div className="project-standard-flow-head"><div><span>Standard production process</span><h2>From chapters to deliverable footage</h2><p>First confirm the story and assets, and then complete the scenes, actions and videos shot by shot. Each step can directly enter the corresponding workspace.</p></div><Link to={primaryAction.href}>Continue current task<ArrowRight /></Link></div>
                <div className="project-standard-flow-track">
                    {productionSteps.map((step, index) => { const Icon = step.icon; return <Link key={step.id} to={step.href} className={step.complete ? "is-complete" : ""}><span className="project-standard-flow-index">{step.complete ? <CheckCircle2 /> : index + 1}</span><span className="project-standard-flow-icon"><Icon /></span><strong>{step.label}</strong><p>{step.description}</p><em>{step.metric}</em><ArrowRight className="project-standard-flow-arrow" /></Link>; })}
                </div>
                <div className="project-standard-flow-footer"><div><strong>Current production check</strong>{gaps.map((gap, index) => <span key={gap}><i className={index === 2 && metrics.readyVideoCount !== metrics.shotCount ? "is-attention" : ""} />{gap}</span>)}</div><div><strong>Quick entry</strong><Link to={`/projects/${project.id}/chapters`}>Organize chapters</Link><Link to={`/projects/${project.id}/assets`}>Confirm assets</Link><Link to={workflowHref("video")}>Continue lens production</Link></div></div>
            </section>

            <section>
                <div className="project-pipeline-head">
                    <div className="min-w-0">
                        <h2 className="project-pipeline-title">Chapter progress</h2>
                        <p className="project-pipeline-hint">From content confirmation to project canvas, each chapter only shows the current true status.</p>
                    </div>
                    <Link to={`/projects/${project.id}/chapters`} className="project-pipeline-more">View all chapters<ArrowRight className="size-3.5" /></Link>
                </div>

                {unitStages.length ? (
                    <div className="project-pipeline-surface">
                        {unitStages.map((item) => (
                            <Link key={item.unit.id} to={`/projects/${project.id}/chapters/${item.unit.id}`} className="project-pipeline-row group">
                                <span className="project-pipeline-chapter">
                                    <span className="project-pipeline-index">{String(item.unit.position + 1).padStart(2, "0")}</span>
                                    <span className="min-w-0"><span className="project-pipeline-chapter-title">{item.unit.title}</span><span className="project-pipeline-chapter-time">updated on{formatTime(item.unit.updatedAt)}</span></span>
                                </span>
                                <StagePipeline content={item.content} assets={item.assets} storyboard={item.storyboard} canvas={item.canvas} />
                                <ArrowRight className="project-pipeline-arrow size-4" />
                            </Link>
                        ))}
                    </div>
                ) : <div className="project-pipeline-surface p-2"><WorkspaceState icon="projects" compact title="There are no plot chapters yet" description="After adding a chapter, the progress of content, assets, storyboards, and canvases will be displayed here." /></div>}
            </section>
        </div>
    );
}

function formatCompactCount(value: number) {
    return value >= 10_000 ? `${Math.round(value / 1_000) / 10} million` : value.toLocaleString("en-US");
}

function ProjectFact({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
    return <div className="min-w-0"><dt>{label}</dt><dd className={attention ? "is-attention" : ""}>{value}</dd></div>;
}

function SecondaryAction({ action }: { action: ProjectWorkbenchAction }) {
    const Icon = action.tone === "danger" ? CircleAlert : action.tone === "attention" ? Clock3 : CheckCircle2;
    return <Link to={action.href} className="project-overview-next-item group"><Icon className={`size-3.5 shrink-0 ${action.tone === "danger" ? "text-foreground/80" : action.tone === "attention" ? "text-foreground/60" : "text-foreground/30"}`} /><span className="min-w-0 flex-1 truncate">{action.title}</span><ArrowRight className="size-3 shrink-0 text-foreground/25 transition group-hover:text-foreground/55" /></Link>;
}

function StagePipeline({ content, assets, storyboard, canvas }: { content: ProjectStageCell; assets: ProjectStageCell; storyboard: ProjectStageCell; canvas: ProjectStageCell }) {
    const stages = [{ label: "content", cell: content }, { label: "assets", cell: assets }, { label: "Storyboard", cell: storyboard }, { label: "canvas", cell: canvas }];
    return (
        <span className="project-pipeline-stages">
            {stages.map(({ label, cell }) => <StageStep key={label} label={label} cell={cell} />)}
        </span>
    );
}

function StageStep({ label, cell }: { label: string; cell: ProjectStageCell }) {
    return (
        <span className={`project-pipeline-stage is-${cell.state}`}>
            <span className="project-pipeline-stage-label">{label}</span>
            <span className="project-pipeline-stage-track" />
            <span className="project-pipeline-stage-value">{cell.label}</span>
        </span>
    );
}

function overviewStage(metrics: ProjectOverviewMetrics) {
    if (!metrics.unitCount) return { label: "prepare story", detail: "Add or import plot chapters" };
    if (metrics.pendingCandidateCount) return { label: "Asset confirmation", detail: `${metrics.pendingCandidateCount} Item to be confirmed` };
    if (!metrics.shotCount || metrics.unitsWithoutShots) return { label: "Storyboard preparation", detail: `${metrics.unitsWithoutShots || metrics.unitCount} Storyboards to be generated` };
    if (metrics.readyVideoCount < metrics.shotCount) return { label: "Lens production", detail: `${metrics.readyVideoCount}/${metrics.shotCount} Mirror video ready` };
    return { label: "Check delivery", detail: "Lens video is ready" };
}

function overviewActions(projectId: string, metrics: ProjectOverviewMetrics, firstUnitId?: string): ProjectWorkbenchAction[] {
    const projectRoot = `/projects/${projectId}`;
    const workflowHref = firstUnitId ? `${projectRoot}/workflow/${firstUnitId}/video` : `${projectRoot}/chapters`;
    if (!metrics.unitCount) {
        return [{ id: "add-story", title: "Add the first plot chapter", description: "Import a novel, paste text, or start with a blank chapter.", href: `${projectRoot}/chapters`, actionLabel: "Add chapter", tone: "default" }];
    }
    const actions: ProjectWorkbenchAction[] = [];
    if (metrics.unitsWithoutText) {
        actions.push({ id: "complete-story", title: `supplement${metrics.unitsWithoutText} Zhang Zhengwen`, description: "Improve the chapter content first, and then follow up with character recognition and storyboarding to get stable input.", href: `${projectRoot}/chapters`, actionLabel: "Organize chapters", tone: "attention" });
    }
    if (metrics.pendingCandidateCount) {
        actions.push({ id: "confirm-assets", title: `Confirm${metrics.pendingCandidateCount} asset candidates`, description: "After confirming the characters, scenes, and props, the shots can stably reference the project assets.", href: `${projectRoot}/assets`, actionLabel: "to confirm", tone: "attention" });
    }
    if (!metrics.shotCount || metrics.unitsWithoutShots) {
        actions.push({ id: "create-storyboards", title: `for${metrics.unitsWithoutShots || metrics.unitCount} Chapter creation storyboard`, description: "Generate shot drafts by chapter, and then adjust the picture, dialogue and duration shot by shot.", href: firstUnitId ? `${projectRoot}/chapters/${firstUnitId}` : `${projectRoot}/chapters`, actionLabel: "Create storyboards", tone: "default" });
    }
    if (metrics.shotCount && metrics.readyVideoCount < metrics.shotCount) {
        actions.push({ id: "continue-video", title: `continue making${metrics.shotCount - metrics.readyVideoCount} lens video`, description: "Check shot cues and reference assets to generate and select the final version shot by shot.", href: workflowHref, actionLabel: "continue making", tone: metrics.staleArtifactCount ? "attention" : "default" });
    }
    if (!metrics.canvasCount) {
        actions.push({ id: "create-canvas", title: "Create the first project canvas", description: "Bring chapters, storyboards, and reference assets into the same production space.", href: `${projectRoot}/canvases`, actionLabel: "view canvas", tone: "default" });
    }
    if (!actions.length) {
        actions.push({ id: "review-delivery", title: "Check shots and prepare for delivery", description: "All footage videos are ready to check for versions, continuity and missing items.", href: workflowHref, actionLabel: "Check delivery", tone: "default" });
    }
    return actions;
}

function stageCell(complete: boolean, label: string, attention = false): ProjectStageCell {
    return { label, state: attention ? "attention" : complete ? "completed" : "idle" };
}
