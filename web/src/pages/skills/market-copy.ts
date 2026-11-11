export const capabilityOptions = [{ value: "beeftv.canvas", label: "BeefTV Canvas Tool" }, { value: "model.image", label: "Image understanding model" }, { value: "model.video", label: "Video understanding model" }, { value: "model.audio", label: "Audio understanding model" }];
export function requirementLabel(value: string) {
    return capabilityOptions.find(item => item.value === value)?.label || `Unconfirmed capabilities:${value}`;
}
export function unsupportedRequirements(values: string[]) {
    return values.filter(value => !capabilityOptions.some(option => option.value === value));
}
export function releaseUnsupportedReasons(
    release: { requirements?: string[]; compatibility?: { status: string; reasons: string[] } },
    itemCompatibility?: { status: string; reasons: string[] },
): string[] {
    const reasons: string[] = [];
    const addReason = (value: string) => {
        const trimmed = value.trim();
        if (trimmed && !reasons.includes(trimmed)) reasons.push(trimmed);
    };
    for (const source of [release.compatibility, itemCompatibility]) {
        if (source?.status === "unsupported") {
            for (const item of source.reasons || []) addReason(item);
        }
    }
    for (const req of unsupportedRequirements(release.requirements || [])) {
        const label = requirementLabel(req);
        if (!reasons.some(reason => reason.includes(req))) addReason(label);
    }
    if ((release.compatibility?.status === "unsupported" || itemCompatibility?.status === "unsupported") && reasons.length === 0) {
        addReason("The current environment does not support this version yet");
    }
    return reasons;
}
export function canInstallMarketRelease(options: {
    busy?: boolean;
    installedLoading: boolean;
    installedError?: string;
    installation: "install" | "update" | "installed";
    unsupportedReasons: string[];
}) {
    return !options.busy
        && !options.installedLoading
        && !options.installedError
        && options.installation !== "installed"
        && options.unsupportedReasons.length === 0;
}
export function publicationStatus(status: string) {
    return ({ draft: "draft", ready_to_submit: "Awaiting confirmation of release", awaiting_upload_confirmation: "Waiting for confirmation of upload", uploading: "Upload results to be verified", needs_preview: "Need to refresh preview", awaiting_submit_confirmation: "Awaiting confirmation of release", rejected: "Need to modify", withdrawn: "Withdrawn", published: "Published" } as Record<string, string>)[status] || "Status to be refreshed";
}
export function canSubmitPublication(plan: { status: string; preview?: unknown }, confirmed: boolean) {
    return confirmed && plan.status === "awaiting_submit_confirmation" && Boolean(plan.preview);
}
import type { MarketItem, PublicMarketSkill, PublishPlan } from "@/services/api/skill-market";
import type { Skill } from "@/services/api/skills";

export function marketInstallationState(release: Pick<MarketItem, "skillId" | "releaseId" | "versionLabel">, skills: Array<Pick<Skill, "skillId" | "sourceType" | "sourceRef" | "sourceCommit" | "version" | "isAdded">>): "install" | "update" | "installed" {
    const installed = skills.find(skill => (skill.sourceType === "market" && skill.sourceRef === release.skillId)
        || (skill.sourceType === "builtin" && skill.skillId === release.skillId && skill.isAdded));
    if (!installed) return "install";
    const current = installed.sourceType === "builtin" ? installed.version === release.versionLabel : installed.sourceCommit === release.releaseId;
    return current ? "installed" : "update";
}

export function isPublicMarketSkillInstalled(
    item: Pick<PublicMarketSkill, "source" | "skillId" | "name">,
    skills: Array<Pick<Skill, "skillName" | "sourceType" | "sourceUrl" | "sourceSubdir" | "isAdded">>,
): boolean {
    const repoUrl = `https://github.com/${item.source}`.toLowerCase();
    return skills.some((skill) => {
        if (skill.sourceType === "builtin" && !skill.isAdded) return false;
        if (
            skill.sourceType === "github" &&
            skill.sourceUrl?.toLowerCase() === repoUrl &&
            (skill.sourceSubdir === item.skillId ||
                Boolean(skill.sourceSubdir?.endsWith(`/${item.skillId}`)) ||
                skill.skillName === item.name ||
                skill.skillName === item.skillId)
        ) {
            return true;
        }
        return skill.skillName === item.name || skill.skillName === item.skillId;
    });
}

export function needsPublicationTargetCorrection(plan: Pick<PublishPlan, "submissionId" | "publicationTarget" | "marketSkillId" | "skillId" | "metadata">) {
    if (plan.submissionId) return false;
    if (plan.publicationTarget === "existing") return !plan.marketSkillId || plan.marketSkillId === plan.skillId || plan.metadata.skillId !== plan.marketSkillId;
    return Boolean(plan.metadata.skillId || plan.marketSkillId);
}
