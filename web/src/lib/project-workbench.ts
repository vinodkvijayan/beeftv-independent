import type { ProjectDetail, ProjectSummary, ProjectUnit } from "@/services/api/projects";

export type ProjectActionTone = "default" | "attention" | "danger";

export type ProjectWorkbenchAction = {
    id: string;
    title: string;
    description: string;
    href: string;
    actionLabel: string;
    tone: ProjectActionTone;
};

export type ProjectContinueTarget = {
    href: string;
    title: string;
    context: string;
    updatedAt: string;
};

export type ProjectStageCell = {
    label: string;
    state: "idle" | "active" | "attention" | "completed";
};

export type ProjectUnitStage = {
    unit: ProjectUnit;
    content: ProjectStageCell;
    assets: ProjectStageCell;
    storyboard: ProjectStageCell;
    canvas: ProjectStageCell;
};

export function projectSummaryCompletion(summary: ProjectSummary) {
    return summary.unitCount ? Math.round((summary.completedUnitCount / summary.unitCount) * 100) : 0;
}

export function projectSummaryStage(summary: ProjectSummary) {
    if (summary.project.status === "archived") return { label: "Archived", detail: "Can be restored in project settings" };
    if (!summary.unitCount) return { label: "prepare story", detail: "There are no plot chapters yet" };
    if (summary.completedUnitCount === summary.unitCount) return { label: "Chapter completed", detail: "Can continue to check shots and deliverables" };
    if (!summary.canvasCount) return { label: "Organize Chapters", detail: "The next step is to create a project canvas" };
    if (!summary.assetCount) return { label: "Prepare assets", detail: "Complement the characters, scenes or style" };
    return { label: "In production", detail: `${summary.completedUnitCount}/${summary.unitCount}Chapter completed` };
}

export function projectDetailStage(detail: ProjectDetail) {
    if (detail.project.status === "archived") return { label: "Archived", detail: "You can continue production after restoring the project" };
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    if (failedSteps) return { label: "Need to be processed", detail: `${failedSteps} process steps failed` };
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    if (pendingCandidates) return { label: "Asset confirmation", detail: `${pendingCandidates} candidates to be confirmed` };
    if (!detail.units.length) return { label: "prepare story", detail: "Add or import plot chapters" };
    if (!detail.shots.length) return { label: "Storyboard preparation", detail: "Select a chapter to generate a shot" };
    const runningSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "running" || step.status === "review").length;
    if (runningSteps) return { label: "In production", detail: `${runningSteps} process steps are in progress` };
    const completedUnits = detail.units.filter((unit) => unit.status === "completed").length;
    if (completedUnits === detail.units.length) return { label: "Check delivery", detail: "Chapter is complete, you can check the shots and results" };
    return { label: "Lens production", detail: `${detail.shots.length} shots created` };
}

export function projectAttentionCount(detail: ProjectDetail) {
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    return pendingCandidates + failedSteps;
}

export function projectContinueTarget(detail: ProjectDetail): ProjectContinueTarget {
    const latestCanvas = [...detail.canvases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const latestUnit = [...detail.units].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (latestCanvas && (!latestUnit || latestCanvas.updatedAt >= latestUnit.updatedAt)) {
        return {
            href: `/canvas/${latestCanvas.id}`,
            title: latestCanvas.title,
            context: "Continue editing the project canvas",
            updatedAt: latestCanvas.updatedAt,
        };
    }
    if (latestUnit) {
        return {
            href: `/projects/${detail.project.id}/chapters/${latestUnit.id}`,
            title: latestUnit.title,
            context: "Continue working on plot chapters",
            updatedAt: latestUnit.updatedAt,
        };
    }
    return {
        href: `/projects/${detail.project.id}/chapters`,
        title: detail.project.name,
        context: "Start from the plot chapter",
        updatedAt: detail.project.updatedAt,
    };
}

// 项目概览必须把真实阻塞转成动作；没有事实依据时只提示通用的制作下一步。
export function projectNextActions(detail: ProjectDetail, limit = 4): ProjectWorkbenchAction[] {
    const actions: ProjectWorkbenchAction[] = [];
    const projectRoot = `/projects/${detail.project.id}`;
    if (detail.project.status === "archived") {
        return [{
            id: "restore-project",
            title: "Project archived",
            description: "Canvas cannot be created and build tasks submitted until restored.",
            href: `${projectRoot}/settings`,
            actionLabel: "Go to restore",
            tone: "attention",
        }];
    }

    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed");
    if (failedSteps.length) {
        actions.push({
            id: "failed-steps",
            title: `Process${failedSteps.length} failed steps`,
            description: failedSteps[0].error?.trim() || "After reviewing the failure reason and input, retry only the affected tasks.",
            href: "/tasks?status=failed",
            actionLabel: "View failed tasks",
            tone: "danger",
        });
    }

    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation");
    if (pendingCandidates.length) {
        const categories = new Set(pendingCandidates.map((candidate) => candidate.category));
        actions.push({
            id: "pending-assets",
            title: `Confirm${pendingCandidates.length} asset candidates`,
            description: `${categories.size} Class characters, scenes or production assets need to be confirmed before they can be reused stably.`,
            href: `${projectRoot}/assets`,
            actionLabel: "to confirm",
            tone: "attention",
        });
    }

    if (!detail.units.length) {
        actions.push({
            id: "add-story",
            title: "Add the first plot chapter",
            description: "Import a novel, paste text, or start with a blank chapter.",
            href: `${projectRoot}/chapters`,
            actionLabel: "Add chapter",
            tone: "default",
        });
    } else {
        const firstDraft = [...detail.units].sort(byPosition).find((unit) => unit.status === "draft");
        if (firstDraft) {
            actions.push({
                id: `review-unit-${firstDraft.id}`,
                title: `Confirm No.${firstDraft.position + 1} Chapter content`,
                description: firstDraft.title,
                href: `${projectRoot}/chapters/${firstDraft.id}`,
                actionLabel: "Continue processing",
                tone: "default",
            });
        }

        const unitsWithShots = new Set(detail.shots.map((shot) => shot.unitId).filter(Boolean));
        const firstUnitWithoutShots = [...detail.units].sort(byPosition).find((unit) => unit.status !== "draft" && !unitsWithShots.has(unit.id));
        if (firstUnitWithoutShots) {
            actions.push({
                id: `storyboard-unit-${firstUnitWithoutShots.id}`,
                title: `for the first${firstUnitWithoutShots.position + 1} Chapter creation storyboard`,
                description: `${firstUnitWithoutShots.title}There are no shots yet, so I can make drafts of the footage and adjust them one by one.`,
                href: `${projectRoot}/chapters/${firstUnitWithoutShots.id}`,
                actionLabel: "Create storyboards",
                tone: "default",
            });
        }
    }

    if (!detail.canvases.length && detail.units.length) {
        actions.push({
            id: "create-canvas",
            title: "Create the first project canvas",
            description: "Bring chapters, storyboards, and reference assets into the same production space.",
            href: `${projectRoot}/canvases`,
            actionLabel: "View project canvas",
            tone: "default",
        });
    }

    if (!actions.length) {
        const target = projectContinueTarget(detail);
        actions.push({
            id: "continue-project",
            title: "Continue recent production content",
            description: `${target.context}：${target.title}`,
            href: target.href,
            actionLabel: "Keep creating",
            tone: "default",
        });
    }
    return actions.slice(0, limit);
}

export function projectUnitStages(detail: ProjectDetail, limit = 8): ProjectUnitStage[] {
    const sortedUnits = [...detail.units].sort(byPosition).slice(0, limit);
    return sortedUnits.map((unit) => {
        const candidates = detail.assetCandidates.filter((candidate) => candidate.unitId === unit.id);
        const pendingCandidates = candidates.filter((candidate) => candidate.status === "pending_confirmation").length;
        const confirmedCandidates = candidates.filter((candidate) => candidate.status === "confirmed").length;
        const shots = detail.shots.filter((shot) => shot.unitId === unit.id);
        const canvasCount = new Set(detail.canvasUnitLinks.filter((link) => link.unitId === unit.id).map((link) => link.canvasId)).size;
        return {
            unit,
            content: contentStage(unit),
            assets: pendingCandidates
                ? { label: `${pendingCandidates} To be confirmed`, state: "attention" }
                : confirmedCandidates
                  ? { label: `${confirmedCandidates} Confirmed`, state: "completed" }
                  : { label: "Not recognized", state: "idle" },
            storyboard: shots.length
                ? { label: `${shots.length} lens`, state: shots.every((shot) => shot.status === "completed") ? "completed" : "active" }
                : { label: "Not started", state: "idle" },
            canvas: canvasCount
                ? { label: `${canvasCount} Zhang`, state: "active" }
                : { label: "Not associated", state: "idle" },
        };
    });
}

function contentStage(unit: ProjectUnit): ProjectStageCell {
    if (unit.status === "completed") return { label: "Completed", state: "completed" };
    if (unit.status === "ready") return { label: "To be produced", state: "active" };
    return { label: "draft", state: "attention" };
}

function byPosition(left: ProjectUnit, right: ProjectUnit) {
    return left.position - right.position;
}
