import { describe, expect, test } from "bun:test";

import type { Skill, SkillPackageFile, SkillPackageFileContent } from "../src/services/api/skills";
import { createSkillRuntime, resolveSkillMentions } from "../src/services/skill-runtime";

function skill(overrides: Partial<Skill> = {}): Skill {
    return {
        skillId: "director",
        skillName: "AI director",
        description: "Director workflow",
        versionId: "version-2",
        version: "2.0.0",
        contentHash: "hash",
        fileCount: 5,
        totalBytes: 1024,
        sourceType: "zip",
        sourceUrl: "",
        sourceRef: "",
        sourceSubdir: "",
        sourceCommit: "",
        syncStatus: "synced",
        autoUpdate: false,
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        status: 1,
        markdownUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        source: 0,
        tag: "Film and television",
        sortWeight: 0,
        isPrivate: true,
        likeCount: 0,
        isLike: false,
        ownerUid: "user",
        effectiveUser: { name: "User", avatarUrl: "", uid: "user" },
        originalSkillId: null,
        showcaseMedia: [],
        addedCount: 1,
        isTest: false,
        extraInfo: "",
        isAdded: true,
        isOwner: true,
        ...overrides,
    };
}

function file(path: string, content: string, kind: SkillPackageFile["kind"] = "markdown"): SkillPackageFileContent {
    return {
        file: { path, kind, mimeType: "text/markdown", size: content.length, sha256: `sha-${path}` },
        content,
        binary: false,
    };
}

describe("skill runtime", () => {
    test("Skill reference parsing is supported by unified rules to support both stable tokens and natural mentions", () => {
        const director = skill();
        const storyboard = skill({ skillId: "storyboard", skillName: "Novel to storyboard" });

        expect(resolveSkillMentions("Use @[skill:director] to handle", [director, storyboard]).map((item) => item.skillId)).toEqual(["director"]);
        expect(resolveSkillMentions("Please use @novel to storyboard.", [director, storyboard]).map((item) => item.skillId)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("Please use /novel to storyboard to process.", [director, storyboard]).map((item) => item.skillId)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("@AI director enhanced version", [director])).toEqual([]);
        expect(resolveSkillMentions("/AI director enhanced version", [director])).toEqual([]);
    });

    test("Ordinary generation only loads the entry and the direct reference text most relevant to the current task.", async () => {
        const entry = [
            "#AIDirector",
            "The video prompt word reads `references/prompt_templates.md`.",
            "Character assets read [character rules](references/character_assets.md).",
            "See `scripts/audit_skill.py` for the maintenance script.",
            "See `assets/project-ledger-template.md` for the project template.",
        ].join("\n");
        const files: SkillPackageFile[] = [
            file("SKILL.md", entry).file,
            file("references/prompt_templates.md", "Video prompt word template text").file,
            file("references/character_assets.md", "Character asset text").file,
            file("scripts/audit_skill.py", "print('audit')", "code").file,
            file("assets/project-ledger-template.md", "ledger template").file,
        ];
        const readPaths: string[] = [];
        const runtime = createSkillRuntime({
            getFile: async (_id, path) => {
                readPaths.push(path);
                if (path === "SKILL.md") return { file: file(path, entry) };
                return { file: file(path, path.includes("prompt_templates") ? "Video prompt word template text" : "Character asset text") };
            },
            listFiles: async () => ({ files }),
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] Help me generate video prompt words", skills: [skill()] });

        expect(result.prompt).toContain('<skill-file path="SKILL.md">');
        expect(result.prompt).toContain('<skill-file path="references/prompt_templates.md">');
        expect(readPaths).not.toContain("references/character_assets.md");
        expect(readPaths).not.toContain("scripts/audit_skill.py");
        expect(readPaths).not.toContain("assets/project-ledger-template.md");
        expect(result.prompt).toContain("[User tasks]\n@AI Director Help me generate video prompt words");
        expect(result.metadata.skillIds).toEqual(["director"]);
    });

    test("The cloud agent only prepares the context of added skills and retains the source", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => ({ file: file("SKILL.md", "#AIDirector") }),
            listFiles: async () => ({ files: [] }),
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] Start", skills: [skill()] });
        expect(result.selectedSkills.map((item) => item.skillId)).toEqual(["director"]);
        expect(result.prompt).toContain('<skill-context skill-id="director"');
        expect(result.metadata.skillIds).toEqual(["director"]);
    });
});
