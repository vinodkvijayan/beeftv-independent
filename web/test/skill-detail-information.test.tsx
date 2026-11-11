import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillFileDetails } from "../src/pages/skills/skill-file-details";
import { skillFailureMessage } from "../src/pages/skills/skill-feedback";
import { PublicationDetailContent } from "../src/pages/skills/publication-detail-content";
import { SkillReleaseMarkdown } from "../src/pages/skills/market-file-preview";
import { SkillPackageAbout, sourceLabel } from "../src/pages/skills/skill-detail-drawer";
import { skillCategoryLabel } from "../src/pages/skills/skill-catalog";

test("file bytes and diagnostic IDs remain available in a closed disclosure", () => {
    const html = renderToStaticMarkup(<SkillFileDetails files={[{ path: "SKILL.md", size: 2193, kind: "markdown", mimeType: "text/markdown", sha256: "hash" }]} info={[{ label: "content hash", value: "a".repeat(64) }, { label: "Native draft number", value: "draft-one" }, { label: "Not provided", value: undefined }, { label: "null value", value: "" }]} />);
    expect(html).toStartWith('<details class="skill-file-details">');
    expect(html).not.toContain(" open");
    for (const value of ["Documentation and advanced information", "SKILL.md", "2193 bytes", "a".repeat(64), "draft-one"]) expect(html).toContain(value);
    expect(html).not.toContain("Not provided");
    expect(html).not.toContain("null value");
});

test("script files remain accessible without a separate scripts notice", () => {
    const html = renderToStaticMarkup(<SkillFileDetails files={[{ path: "scripts/run.py", size: 100, kind: "code", mimeType: "text/plain", sha256: "hash" }]} info={[]} />);
    expect(html).toContain("scripts/run.py");
    expect(html).toContain("100 bytes");
    expect(html).not.toContain("Contains script");
    expect(html).not.toContain("The assistant will work as instructed");
});

test("errors retain the actual reason and an explicit recovery step", () => {
    expect(skillFailureMessage(new Error("The file format is invalid."), "Installation failed", "Please select SKILL.md again.")).toBe("Installation failed: The file format is invalid. Please select SKILL.md again.");
    expect(skillFailureMessage(undefined, "Read failed", "Please reopen the details.")).toBe("Read failed: No specific reason was returned. Please reopen the details.");
});

test("publication details retain metadata and requirements in a closed disclosure", () => {
    const html = renderToStaticMarkup(<PublicationDetailContent metadata={{ name: "creative skills", description: "Full introduction", versionLabel: "1.0.0", license: "MIT", sourceUrl: "", requirements: [], requirementNotes: "Need reference material", showcase: [] }} status="awaiting_upload_confirmation" author="Author" notices={<p>Need to confirm the submission target</p>}><section>File information</section></PublicationDetailContent>);
    for (const value of ["1.0.0", "MIT", "Author", "Full introduction", "No additional tools required", "Need reference material", "Need to confirm the submission target", "File information"]) expect(html).toContain(value);
    expect(html).toContain("<details><summary>Conditions of use</summary>");
    expect(html).not.toContain("<details open");
});

test("publication instructions share market Markdown formatting", () => {
    const html = renderToStaticMarkup(<SkillReleaseMarkdown content={'---\nname: skill\n---\n# Instructions for use\n\n- Full content\n\n[Reference](https://example.com)'} />);
    expect(html).toContain("<h1>Instructions for use</h1>");
    expect(html).toContain("<li>Full content</li>");
    expect(html).not.toContain("name: skill");
    expect(html).toContain('rel="noreferrer"');
});

test("installed skill about section retains version, author, market source and category fallback", () => {
    expect(sourceLabel("market")).toBe("skills market");
    expect(skillCategoryLabel("drama", [])).toBe("Short drama film and television");
    const html = renderToStaticMarkup(
        <SkillPackageAbout
            skill={{
                description: "Comic split and reference picture setting",
                version: "2.1.0",
                effectiveUser: { name: "BeefTV Official", avatarUrl: "", uid: "official" },
                sourceType: "market",
                tag: "drama",
                updatedAt: "2026-11-06T00:00:00Z",
            }}
            categories={[]}
        />,
    );
    for (const value of ["Skill introduction", "Comic split and reference picture setting", "2.1.0", "BeefTV Official", "skills market", "Short drama film and television"]) {
        expect(html).toContain(value);
    }
});
