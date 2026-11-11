import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    AI_COMMAND_SCHEMA_VERSION,
    AI_EDITING_OP_CATALOG,
    AiCommandPlanError,
    buildAiEditingSystemPrompt,
    parseAiCommandPlan,
    validateAiCommandBatch,
} from "@/lib/timeline/ai-command-schema";
import { EDITOR_COMMAND_OPS } from "@/lib/timeline/editor-commands";
import type { TimelineProject } from "@/types/timeline";

const commandsGolden = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/commands.golden.json"), "utf8"),
) as { base: TimelineProject };

const aiGolden = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/ai-commands.golden.json"), "utf8"),
) as { schemaVersion: number; ops: string[] };

describe("AI command schema golden synchronization (anti-drift)", () => {
    test("The catalog op set is consistent with the M2.1 command registry", () => {
        const catalogOps = AI_EDITING_OP_CATALOG.map((e) => e.op);
        expect(catalogOps).toEqual([...EDITOR_COMMAND_OPS]);
    });
    test("golden fixture op set/version is consistent with the source code", () => {
        expect(aiGolden.schemaVersion).toBe(AI_COMMAND_SCHEMA_VERSION);
        expect(aiGolden.ops).toEqual([...EDITOR_COMMAND_OPS]);
        expect(aiGolden.ops.length).toBe(12);
    });
    test("Each contract in catalog contains three sections: op/desc/payload.", () => {
        for (const entry of AI_EDITING_OP_CATALOG) {
            expect(entry.op.length).toBeGreaterThan(0);
            expect(entry.desc.length).toBeGreaterThan(0);
            expect(entry.payload.length).toBeGreaterThan(0);
        }
    });
});

describe("parseAiCommandPlan (LLM output parsing)", () => {
    test("Parse bare JSON", () => {
        const plan = parseAiCommandPlan('{"reasoning":"MoveClip","commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}');
        expect(plan.reasoning).toBe("Move it");
        expect(plan.commands).toHaveLength(1);
    });
    test("Parse markdown fence wrapped JSON", () => {
        const plan = parseAiCommandPlan('```json\n{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}\n```');
        expect(plan.commands[0].op).toBe("moveClip");
    });
    test("Tolerate JSON pre- and post-noise and parse starting from the first {", () => {
        const plan = parseAiCommandPlan('OK, I\'ll handle it:\n{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}\nThese are my suggestions.');
        expect(plan.commands[0].op).toBe("moveClip");
    });
    test("reasoning can be omitted", () => {
        const plan = parseAiCommandPlan('{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}');
        expect(plan.reasoning).toBeUndefined();
    });
    test("commands empty array method (read-only Q&A / cannot execute semantics)", () => {
        const plan = parseAiCommandPlan('{"reasoning":"当前没有可用于增加转场效果的命令。","commands":[]}');
        expect(plan.commands).toHaveLength(0);
        expect(plan.reasoning).toContain("Transition");
    });
    test("commands exceeds the upper limit of 8 → throw an error", () => {
        const tooMany = Array.from({ length: 9 }, (_, i) => ({
            op: "moveClip",
            payload: { id: `clip-a`, startMs: i * 1000 },
        }));
        expect(() => parseAiCommandPlan(JSON.stringify({ commands: tooMany }))).toThrow(/8 条上限/);
    });
    test("No JSON object → throw error", () => {
        expect(() => parseAiCommandPlan("Sorry, I can't do it.")).toThrow(/未找到 JSON 对象/);
    });
    test("JSON truncation is not closed → throw error", () => {
        expect(() => parseAiCommandPlan('{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]')).toThrow(/未闭合/);
    });
    test("commands item is not an object → throw error", () => {
        expect(() => parseAiCommandPlan('{"commands":["moveClip"]}')).toThrow(/commands\[0\]/);
    });
    test("Command is missing payload → throw error", () => {
        expect(() => parseAiCommandPlan('{"commands":[{"op":"moveClip"}]}')).toThrow(/payload/);
    });
    test("Strings containing parentheses/braces are not misjudged by parentheses matching", () => {
        const plan = parseAiCommandPlan('{"commands":[{"op":"setClipProperty","payload":{"id":"sub-1","patch":{"text":"你好}世界 {"}}}]}');
        expect(plan.commands[0].payload).toEqual({ id: "sub-1", patch: { text: "hello}world {" } });
    });
});

describe("validateAiCommandBatch (batch-level dry-run preflight)", () => {
    test("Legally approved", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [
                { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } },
                { op: "setTrackFlag", payload: { trackId: "video-1", flag: "muted", value: true } },
            ],
        });
        expect(verdict).toEqual({ ok: true });
    });
    test("Any unknown op → reject the entire batch and report the subscript and op", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [
                { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } },
                { op: "explodeEverything", payload: {} },
            ],
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) {
            expect(verdict.index).toBe(1);
            expect(verdict.op).toBe("explodeEverything");
            expect(verdict.error).toMatch(/unknown edit command op/);
        }
    });
    test("A non-existent clip is referenced → the entire batch is rejected (ADR-0007 is not partially executed)", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [{ op: "removeClip", payload: { id: "ghost-clip" } }],
        });
        expect(verdict.ok).toBe(false);
    });
    test("Illegal payload (out-of-bounds duration) → Reject", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [{ op: "moveClip", payload: { id: "clip-a", startMs: -1 } }],
        });
        expect(verdict.ok).toBe(false);
    });
    test("dry-run has no side effects (the original timeline is not modified)", () => {
        const before = JSON.stringify(commandsGolden.base);
        validateAiCommandBatch(commandsGolden.base, {
            commands: [{ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } }],
        });
        expect(JSON.stringify(commandsGolden.base)).toBe(before);
    });
});

describe("buildAiEditingSystemPrompt (prompt word contract)", () => {
    const prompt = buildAiEditingSystemPrompt("Timeline: empty");
    test("Contains timeline summary, all op contracts and output format instructions", () => {
        expect(prompt).toContain("Timeline: empty");
        expect(prompt).toContain("Available command contracts");
        expect(prompt).toContain("Output requirements");
        expect(prompt).toContain("Example");
        for (const op of EDITOR_COMMAND_OPS) {
            expect(prompt).toContain(`- ${op}：`);
        }
    });
    test("Generate deterministic prompt words with the abstract", () => {
        expect(buildAiEditingSystemPrompt("A")).toBe(buildAiEditingSystemPrompt("A"));
    });
});
