import { expect, test } from "bun:test";

test("Chapter pages are generated directly into storyboarding and skills are executed through shared selectors", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/chapters.tsx", import.meta.url)).text();
    expect(source).not.toContain("Import storyboards");
    expect(source).not.toContain("importStoryboardToCanvas");
    expect(source).not.toContain("Storyboard in canvas");
    expect(source).toContain("Generate to storyboard production");
    expect(source).toContain("replaceProjectUnitShots");
    expect(source).toContain("approvedRevision");
    expect(source).toContain("approvedShotIds");
    expect(source).toContain("detail.project.revision");
    expect(source).toContain("/storyboard`");
    expect(source).toContain('<SkillRuntimePicker profile="shortDrama"');
    expect(source.match(/<ModelPicker config=\{effectiveConfig\} capability="text"/g)).toHaveLength(2);
    expect(source).toContain("chapterAnalysisInput(selectedTextModel)");
    expect(source).toContain("const textModel = selectedTextModel");
    expect(source).toContain("generateChapterStoryboard");
});

test("Lens frames use the @ reference editor for bound assets", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    expect(source).toContain('name="plotDescription"');
    expect(source).toContain('<ShotAssetMentionTextarea variant="scene"');
    expect(source).toContain("resolveShotAssetMentionPrompt(basePrompt, shotAssetReferenceContext");
    expect(source).toContain("<Image.PreviewGroup>");
});

test("Skill selector fills form width", async () => {
    const source = await Bun.file(new URL("../src/components/skills/skill-runtime-picker.tsx", import.meta.url)).text();
    expect(source).toContain('style={{ width: "100%" }}');
});

test("Canvas storyboard generation unified process Skill Runtime", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-storyboard.ts", import.meta.url)).text();
    expect(source).toContain('profile: "shortDrama"');
    expect(source).toContain("skillRuntime.prepare");
    expect(source).toContain("...skillExecution.metadata");
    expect(source).not.toContain("getSkillFile");
    expect(source).not.toContain("getSkillBundle");
});
