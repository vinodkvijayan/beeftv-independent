import { expect, test } from "bun:test";
import { settingsPath } from "../src/lib/settings-navigation";
import { isConfigSection } from "../src/pages/settings";
import { canSubmitPublication, isPublicMarketSkillInstalled, needsPublicationTargetCorrection, requirementLabel, publicationStatus, unsupportedRequirements } from "../src/pages/skills/market-copy";
import { isOfficialBuiltinMarketSkill } from "../src/pages/skills/skill-market-install-confirm-modal";
import { agentAssistantFailureText } from "../src/services/api/agent-assistant";
import { isAssistantSettingsUnavailableError } from "../src/services/api/assistant-settings";
import { ApiError } from "../src/services/api/request";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("implemented skill route is discoverable while reference experiments remain hidden", async () => {
    const [router, sidebar] = await Promise.all([
        source("../src/router.tsx"),
        source("../src/components/layout/workspace-sidebar-nav.tsx"),
    ]);
    expect(router).toContain('{ path: "/skill", element: <Navigate to="/skills" replace /> }');
    expect(router).toContain('{ path: "/skills", element: deferred(<SkillsPage />) }');
    expect(router).not.toContain("SkillsReferencePage");
    expect(sidebar).toContain('toolItem("skills", "/skills")');
    expect(isConfigSection("assistant")).toBe(false);
    expect(isConfigSection("channels")).toBe(true);
    expect(isConfigSection("storage")).toBe(true);
    expect(settingsPath("models", true)).toBe("/settings?section=models&continue=1");
});

test("assistant settings distinguish unavailable client sessions from retryable load errors", () => {
    expect(isAssistantSettingsUnavailableError(new Error(agentAssistantFailureText("forbidden")))).toBe(true);
    expect(isAssistantSettingsUnavailableError(new ApiError("Forbidden access", { status: 403 }))).toBe(true);
    expect(isAssistantSettingsUnavailableError(new ApiError("read-only client", { status: 200, reason: "read_only_client" }))).toBe(true);
    expect(isAssistantSettingsUnavailableError(new ApiError("Service exception", { status: 500 }))).toBe(false);
    expect(isAssistantSettingsUnavailableError(new Error("Network disconnected"))).toBe(false);
});

test("public submission requires this preview and a separate user confirmation", () => {
    for (const status of ["awaiting_upload_confirmation", "uploading", "needs_preview", "submitted", "published", "rejected"]) {
        expect(canSubmitPublication({ status, preview: { revision: 2 } }, true)).toBe(false);
    }
    expect(canSubmitPublication({ status: "awaiting_submit_confirmation" }, true)).toBe(false);
    expect(canSubmitPublication({ status: "awaiting_submit_confirmation", preview: {} }, false)).toBe(false);
    expect(canSubmitPublication({ status: "awaiting_submit_confirmation", preview: {} }, true)).toBe(true);
});

test("unknown capabilities and publication states never look accepted", () => {
    expect(requirementLabel("model.audio")).toBe("Audio understanding model");
    expect(requirementLabel("needs secret")).toContain("Not confirmed");
    expect(publicationStatus("new-unknown-state")).toBe("Status to be refreshed");
    expect(publicationStatus("ready_to_submit")).toBe("Awaiting confirmation of release");
    expect(publicationStatus("awaiting_submit_confirmation")).toBe("Awaiting confirmation of release");
    expect(publicationStatus("published")).toBe("Published");
    expect(publicationStatus("rejected")).toBe("Need to modify");
    expect(publicationStatus("submitted")).toBe("Status to be refreshed");
    expect(publicationStatus("in_review")).toBe("Status to be refreshed");
});

test("third-party market skills always ask for risk confirmation while official built-in skills do not", () => {
    expect(isOfficialBuiltinMarketSkill({ skillId: "community-skill" }, [{ skillId: "community-skill", sourceType: "builtin" }])).toBe(true);
    expect(isOfficialBuiltinMarketSkill({ skillId: "community-skill" }, [{ skillId: "community-skill", sourceType: "market" }])).toBe(false);
    expect(isOfficialBuiltinMarketSkill({ skillId: "community-skill" })).toBe(false);
});

test("matches installed GitHub skills against public skill directory items", () => {
    const item = { source: "anthropics/skills", skillId: "frontend-design", name: "frontend-design" };
    const siblingItem = { source: "anthropics/skills", skillId: "mcp-builder", name: "mcp-builder" };
    expect(isPublicMarketSkillInstalled(item, [])).toBe(false);
    expect(
        isPublicMarketSkillInstalled(item, [
            {
                skillName: "Front-end design",
                sourceType: "github",
                sourceUrl: "https://github.com/anthropics/skills",
                sourceSubdir: "skills/frontend-design",
                isAdded: true,
            },
        ]),
    ).toBe(true);
    expect(
        isPublicMarketSkillInstalled(item, [
            {
                skillName: "Front-end design",
                sourceType: "github",
                sourceUrl: "https://github.com/anthropics/skills",
                sourceSubdir: "skills/frontend-design",
                isAdded: false,
            },
        ]),
    ).toBe(true);
    expect(
        isPublicMarketSkillInstalled(siblingItem, [
            {
                skillName: "Front-end design",
                sourceType: "github",
                sourceUrl: "https://github.com/anthropics/skills",
                sourceSubdir: "",
                isAdded: true,
            },
        ]),
    ).toBe(false);
});

test("legacy publication requirements stay visible until the author explicitly removes them", () => {
    const original = ["text", "model.audio", "future"];
    expect(unsupportedRequirements(original)).toEqual(["text", "future"]);
    expect(original).toEqual(["text", "model.audio", "future"]);
    expect(unsupportedRequirements([])).toEqual([]);
    expect(unsupportedRequirements(["beeftv.canvas", "model.image", "model.video", "model.audio"])).toEqual([]);
});

test("ambiguous legacy publication IDs require explicit correction before upload", () => {
    const base = { skillId: "local-one", metadata: { name: "text", description: "text", versionLabel: "1.0.0", license: "MIT", sourceUrl: "", requirements: [], showcase: [] } };
    expect(needsPublicationTargetCorrection(base)).toBe(false);
    expect(needsPublicationTargetCorrection({ ...base, metadata: { ...base.metadata, skillId: "local-one" } })).toBe(true);
    expect(needsPublicationTargetCorrection({ ...base, metadata: { ...base.metadata, skillId: "real-cloud-one" } })).toBe(true);
    expect(needsPublicationTargetCorrection({ ...base, publicationTarget: "existing", marketSkillId: "real-cloud-one", metadata: { ...base.metadata, skillId: "real-cloud-one" } })).toBe(false);
    expect(needsPublicationTargetCorrection({ ...base, publicationTarget: "existing", marketSkillId: "local-one", metadata: { ...base.metadata, skillId: "local-one" } })).toBe(true);
    expect(needsPublicationTargetCorrection({ ...base, publicationTarget: "new", submissionId: "draft-one", metadata: { ...base.metadata, skillId: "assigned-cloud-one" } })).toBe(false);
});
