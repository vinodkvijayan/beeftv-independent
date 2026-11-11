import { describe, expect, test } from "bun:test";

import "../src/lib/plugins/builtin/ai-art-critique";
import { getNodeAcceptedInputKind, getNodeDefinition } from "../src/lib/canvas/node-registry";
import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "../src/lib/canvas/tool-registry";
import { ART_CRITIQUE_NODE_TYPE, ART_CRITIQUE_RUBRIC_VERSION } from "../src/lib/art-critique/contracts";
import { ART_CRITIQUE_SEVERITY_COLORS, isRenderableArtCritiqueTarget, referenceTargetForIssue, repairIssueTarget, targetBounds, targetPolygon } from "../src/lib/art-critique/annotation";
import { artCritiqueMessages, parseArtCritiqueResponse } from "../src/lib/art-critique/review";
import {
    applyGrounding,
    applyEditPrompts,
    applyReferenceCoordinates,
    applyVerification,
    artCritiquePipelineTools,
    deduplicateAggregateIssues,
    filterAggregateAgainstCandidates,
    parseAggregatePayload,
    parseEditPromptPayload,
    parseGroundingPayload,
    parseSceneReviewPayload,
    parseVerificationPayload,
} from "../src/lib/art-critique/pipeline";
import { ART_CRITIQUE_RUBRIC, buildArtCritiqueRubricPrompt } from "../src/lib/art-critique/rubrics";
import type { ToolResponseResult } from "../src/services/api/image";

function response(value: unknown): ToolResponseResult {
    return {
        content: "",
        toolCalls: [{ id: "call-1", type: "function", function: { name: "submit_art_critique", arguments: JSON.stringify(value) } }],
    };
}

const input = { dataUrl: "data:image/png;base64,placeholder", title: "test picture", sourceFingerprint: "v1-test" };

describe("AI aesthetic correction plug-in registration", () => {
    test("The node only accepts images and hides the output port", () => {
        expect(getNodeAcceptedInputKind(ART_CRITIQUE_NODE_TYPE)).toBe("image");
        expect(getNodeDefinition(ART_CRITIQUE_NODE_TYPE)?.showOutputConnection).toBe(false);
    });

    test("Appears in the Add Node menu when enabled", () => {
        const baseContext = {
            workspaceMode: "simple" as const,
            isProjectLinked: false,
            handlers: {} as AddNodeMenuContext["handlers"],
        };
        const enabledCommands = resolveAddNodeMenuCommands({ ...baseContext, enabledPluginIds: new Set(["ai-art-critique"]) });
        const disabledCommands = resolveAddNodeMenuCommands({ ...baseContext, enabledPluginIds: new Set<string>() });
        expect(enabledCommands.some((command) => command.id === ART_CRITIQUE_NODE_TYPE)).toBe(true);
        expect(disabledCommands.some((command) => command.id === ART_CRITIQUE_NODE_TYPE)).toBe(false);
    });
});

describe("AI aesthetic correction report analysis", () => {
    test("Parse AI-generated local editing prompt words and apply them by issue ID", () => {
        const issue = {
            id: "issue-1",
            category: "lighting",
            title: "Insufficient light on the subject’s face",
            explanation: "The dark parts of the face are too heavy, and the readability of expressions and interactions is reduced.",
            severity: "high",
            confidence: 0.9,
            target: {
                type: "box",
                points: [
                    { x: 0.3, y: 0.2 },
                    { x: 0.6, y: 0.6 },
                ],
            },
            targetDescription: "female subject face",
            suggestion: {
                goal: "Improve the readability of character expressions",
                actions: ["Improve local brightness on face", "Keep original light direction"],
                preserve: ["Preserve the night scene atmosphere"],
                expectedEffect: "Characters return to the visual focus",
            },
        } satisfies import("../src/lib/art-critique/contracts").ArtCritiqueIssue;
        const result = parseEditPromptPayload({
            prompts: [{ issueId: "issue-1", editPrompt: "Only the local brightness of the female subject's face is increased, while the window light direction, character identity, composition and night scene atmosphere are retained." }],
        });
        const warnings: string[] = [];
        const applied = applyEditPrompts([issue], result.prompts, warnings);

        expect(applied[0].editPrompt).toContain("female subject face");
        expect(warnings).toHaveLength(0);
    });

    test("Local splicing substitution is not used when AI prompt words are missing", () => {
        const issue = {
            id: "issue-1",
            category: "lighting" as const,
            title: "Insufficient light on the subject’s face",
            explanation: "Dark parts of the face are too heavy.",
            severity: "high" as const,
            confidence: 0.9,
            target: { type: "global" as const, points: [] },
            suggestion: { goal: "Improve readability", actions: ["Increase local brightness"], preserve: ["Preserve the night scene atmosphere"], expectedEffect: "Characters stand out more" },
        };
        const warnings: string[] = [];
        const applied = applyEditPrompts([issue], [], warnings);

        expect(applied[0].editPrompt).toBeUndefined();
        expect(warnings[0]).toContain("Local splicing overrides will not be used");
    });

    test("Use versioned rubrics and prioritize high-priority issues first", () => {
        const report = parseArtCritiqueResponse(
            response({
                summary: "The picture has a clear subject.",
                strengths: ["Color unity"],
                issues: [
                    {
                        id: "low-first",
                        category: "color",
                        title: "The color is slightly mixed",
                        explanation: "The secondary areas are slightly more saturated.",
                        severity: "low",
                        confidence: 0.98,
                        target: { type: "global", points: [] },
                        suggestion: { goal: "gather colors", actions: ["Decrease secondary area saturation"], preserve: ["Keep the main accent color"], expectedEffect: "The subject is more prominent" },
                    },
                    {
                        id: "high-second",
                        category: "composition",
                        title: "Insufficient sense of subject direction",
                        explanation: "The relationship between the subject and the direction of the blank space is unclear.",
                        severity: "high",
                        confidence: 0.7,
                        target: {
                            type: "box",
                            points: [
                                { x: 0.2, y: 0.2 },
                                { x: 0.6, y: 0.8 },
                            ],
                        },
                        suggestion: { goal: "Enhance sense of direction", actions: ["Adjust subject position"], preserve: ["Preserve character posture"], expectedEffect: "Eyes move more naturally" },
                    },
                ],
            }),
            input,
        );
        expect(report.rubricVersion).toBe(ART_CRITIQUE_RUBRIC_VERSION);
        expect(report.issues.map((issue) => issue.id)).toEqual(["high-second", "low-first"]);
    });

    test("Prompt contains rubric version, reference method and compositional intent constraints", () => {
        const systemText = artCritiqueMessages(input)[0].content;
        expect(typeof systemText).toBe("string");
        expect(systemText).toContain(ART_CRITIQUE_RUBRIC_VERSION);
        expect(systemText).toContain("CADB / SAMP-Net");
        expect(systemText).toContain("Do not report simply because the rule of thirds was not used");
        expect(buildArtCritiqueRubricPrompt()).toContain("HumanAesExpert");
        expect(ART_CRITIQUE_RUBRIC).toHaveLength(4);
    });

    test("Narrow Reviewer Prompt only injects its own rules and allows no issues", () => {
        const prompt = buildArtCritiqueRubricPrompt({ categories: ["color"], includeReferenceMapping: false });
        expect(prompt).toContain("【Color｜color】");
        expect(prompt).not.toContain("【Composition and visual hierarchy｜composition】");
        expect(prompt).not.toContain("Reference method mapping");
        expect(prompt).toContain("Allow no problem");
    });

    test("Preserve reporting contracts and demote incomplete local goals to global issues", () => {
        const report = parseArtCritiqueResponse(
            response({
                summary: "The subject is clear, but the picture level could be more focused.",
                strengths: ["The subject is clearly outlined"],
                issues: [
                    {
                        id: "composition-1",
                        category: "composition",
                        title: "The subject deviates from the visual center of gravity",
                        explanation: "The white space around the subject is uneven.",
                        severity: "high",
                        confidence: 0.86,
                        target: { type: "box", points: [{ x: 0.2, y: 0.3 }] },
                        suggestion: { goal: "focus", actions: ["Tighten the left margin"], preserve: ["Keep the subject's posture"], expectedEffect: "The visual center of gravity is more stable" },
                    },
                ],
            }),
            input,
        );
        expect(report.sourceFingerprint).toBe("v1-test");
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0].target).toEqual({ type: "global", points: [] });
    });

    test("Keep up to five questions and clip out-of-bounds coordinates", () => {
        const issues = Array.from({ length: 8 }, (_, index) => ({
            id: `issue-${index}`,
            category: "color",
            title: `problem${index}`,
            explanation: "Needs adjustment.",
            severity: "low",
            confidence: 2,
            target: { type: "point", points: [{ x: -1, y: 2 }] },
            suggestion: { goal: "improve", actions: ["adjust"], preserve: [], expectedEffect: "more unified" },
        }));
        const report = parseArtCritiqueResponse(response({ summary: "Summary", strengths: [], issues }), input);
        expect(report.issues).toHaveLength(5);
        expect(report.issues[0].confidence).toBe(1);
        expect(report.issues[0].target.points[0]).toEqual({ x: 0, y: 1 });
    });
});

describe("AI aesthetic correction annotation geometry", () => {
    test("The box target is converted to a quadrilateral and the bounds are calculated", () => {
        const target = {
            type: "box" as const,
            points: [
                { x: 0.8, y: 0.7 },
                { x: 0.2, y: 0.1 },
            ],
        };
        expect(targetPolygon(target)).toEqual([
            { x: 0.2, y: 0.1 },
            { x: 0.8, y: 0.1 },
            { x: 0.8, y: 0.7 },
            { x: 0.2, y: 0.7 },
        ]);
        expect(targetBounds(target)).toEqual({ x: 0.2, y: 0.1, width: 0.6000000000000001, height: 0.6 });
    });

    test("severity uses a fixed color role", () => {
        expect(ART_CRITIQUE_SEVERITY_COLORS.high).toBe("#ef4444");
        expect(ART_CRITIQUE_SEVERITY_COLORS.medium).toBe("#f59e0b");
    });

    test("Use the problem description to generate a reference area or multiple reference points when positioning fails.", () => {
        const foreground = referenceTargetForIssue({
            category: "composition",
            title: "The foreground figure overwhelms the subject",
            explanation: "The left foreground has too much visual weight.",
            targetDescription: "The person in the foreground and the subject area on the left",
        });
        const table = referenceTargetForIssue({
            category: "proportion",
            title: "The edge of the table cuts off the relationship between characters",
            explanation: "The edge and legs of the table are located at the bottom of the picture.",
            targetDescription: "Table edge, table legs and table top still life",
        });
        const highlights = referenceTargetForIssue({
            category: "color",
            title: "Multiple highly saturated warm color highlights distract the focus",
            explanation: "There are multiple scattered bright spots of warm color in the picture.",
            targetDescription: "Many highly saturated warm color highlights",
        });

        expect(foreground.type).toBe("box");
        expect(targetBounds(foreground).width).toBeCloseTo(0.36);
        expect(table.type).toBe("box");
        expect(targetBounds(table).y).toBe(0.5);
        expect(highlights.type).toBe("points");
        expect(highlights.points.length).toBeGreaterThan(1);
    });

    test("Invalid frame coordinates are recognized and fixed to visible reference frames", () => {
        const issue = {
            id: "invalid-box",
            category: "composition" as const,
            title: "The dark part of the foreground overwhelms the subject",
            explanation: "The foreground on the left forms a continuous dark part.",
            severity: "high" as const,
            confidence: 0.9,
            target: {
                type: "box" as const,
                points: [
                    { x: 0.2, y: 0.1 },
                    { x: 0.8, y: 0.1 },
                ],
            },
            targetDescription: "Foreground figure on the left",
            suggestion: { goal: "Reduce distractions", actions: ["Reduce foreground contrast"], preserve: [], expectedEffect: "The subject is more prominent" },
        };
        expect(isRenderableArtCritiqueTarget(issue.target)).toBe(false);
        const repaired = repairIssueTarget(issue);
        expect(repaired.targetSource).toBe("reference");
        expect(repaired.target.type).toBe("box");
        expect(targetBounds(repaired.target).height).toBeGreaterThan(0.8);
    });
});

describe("AI aesthetic correction multi-stage pipeline", () => {
    test("Stage tools cover scenarios, Reviewer, aggregation, positioning, prompt word generation and review", () => {
        expect(Object.values(artCritiquePipelineTools).map((tool) => tool.function.name)).toEqual([
            "analyze_art_scene",
            "review_art_composition",
            "review_art_color",
            "review_art_lighting",
            "review_art_structure",
            "aggregate_art_critique",
            "ground_art_critique_issues",
            "generate_art_edit_prompts",
            "verify_art_critique",
        ]);
    });

    test("Analyze scenarios and candidate questions", () => {
        const result = parseSceneReviewPayload({
            scene: {
                imageType: "portrait",
                style: ["Cinematic feel"],
                subjects: [{ id: "person", description: "person sitting at table", importance: "primary" }],
                intendedFocus: "Character expression",
                compositionType: ["diagonal"],
                lightingType: ["window light"],
                mood: "quiet",
                estimatedIntent: "Express the character’s loneliness",
                sceneDepth: "medium",
            },
            candidates: [
                {
                    id: "c-1",
                    checkId: "subject-placement",
                    category: "composition",
                    title: "The subject is suppressed by the left foreground",
                    observation: "The foreground on the left occupies a large area",
                    reason: "The visual weight of the character is weakened",
                    evidence: ["The foreground outline covers the left side of the frame"],
                    severity: 0.8,
                    confidence: 0.9,
                    targetDescription: "Left foreground and character area",
                },
            ],
        });
        expect(result.scene.imageType).toBe("portrait");
        expect(result.candidates[0].reviewer).toBe("composition");
        expect(result.candidates[0].confidence).toBe(0.9);
    });

    test("Filter candidates by Rule ID, Reviewer, Image Type, Evidence and Confidence", () => {
        const result = parseSceneReviewPayload({
            scene: {
                imageType: "landscape",
                style: [],
                subjects: [],
                intendedFocus: "landscape level",
                compositionType: [],
                lightingType: [],
                mood: "calm",
                estimatedIntent: "Express a sense of space",
                sceneDepth: "deep",
            },
            candidates: [
                { id: "valid", checkId: "visual-balance", category: "composition", title: "valid question", observation: "There is evidence", reason: "affect expression", evidence: ["There is significant weight on the left side"], severity: 0.8, confidence: 0.8, targetDescription: "left side" },
                { id: "no-rule", checkId: "made-up-rule", category: "composition", title: "unknown rules", observation: "There is evidence", reason: "affect expression", evidence: ["evidence"], severity: 0.8, confidence: 0.9, targetDescription: "Picture" },
                { id: "no-evidence", checkId: "visual-balance", category: "composition", title: "no evidence", observation: "looks unbalanced", reason: "affect expression", evidence: [], severity: 0.8, confidence: 0.9, targetDescription: "Picture" },
                { id: "low-confidence", checkId: "visual-balance", category: "composition", title: "low confidence", observation: "Insufficient evidence", reason: "affect expression", evidence: ["Blurred"], severity: 0.8, confidence: 0.2, targetDescription: "Picture" },
                { id: "wrong-reviewer", checkId: "visual-balance", category: "color", title: "category mismatch", observation: "There is evidence", reason: "affect expression", evidence: ["evidence"], severity: 0.8, confidence: 0.9, targetDescription: "Picture" },
            ],
        });
        expect(result.candidates.map((candidate) => candidate.id)).toEqual(["valid"]);
        expect(result.candidates[0].checkId).toBe("visual-balance");
    });
    test("Aggregated results retain recommendations and sort them by priority", () => {
        const result = parseAggregatePayload({
            summary: "The main body is clear, but the hierarchy can be more centralized.",
            strengths: ["Color unity"],
            issues: [
                {
                    id: "low",
                    category: "color",
                    title: "Secondary areas are slightly brighter",
                    explanation: "The background has local highly saturated color patches.",
                    severity: "low",
                    confidence: 0.95,
                    targetDescription: "Background upper right corner",
                    suggestion: { goal: "Reduce interference", actions: ["Reduce saturation"], preserve: ["Keep the main accent color"], expectedEffect: "The subject is more prominent" },
                    sourceCandidateIds: ["c-2"],
                },
                {
                    id: "high",
                    category: "lighting",
                    title: "Insufficient separation of characters and background",
                    explanation: "The brightness of the character's face and the wall are close.",
                    severity: "high",
                    confidence: 0.72,
                    targetDescription: "Character’s face and rear wall",
                    suggestion: { goal: "Enhanced separation", actions: ["Improve local brightness on face"], preserve: ["Keep window light direction"], expectedEffect: "Focus is clearer" },
                    sourceCandidateIds: ["c-3"],
                },
            ],
        });
        expect(result.issues.map((issue) => issue.id)).toEqual(["high", "low"]);
        expect(result.issues[0].suggestion.actions).toEqual(["Improve local brightness on face"]);
    });

    test("Aggregation results can only reference real candidates and filter unsourced issues", () => {
        const candidates = [
            {
                id: "c-valid",
                checkId: "palette",
                kind: "issue" as const,
                category: "color" as const,
                title: "background color interference",
                observation: "There is a highly saturated color patch in the upper right corner of the background",
                reason: "It steals the subject's attention",
                evidence: ["The character block on the upper right forms a strong saturation contrast with the main body."],
                severity: 0.8,
                confidence: 0.85,
                targetDescription: "Background upper right corner",
                reviewer: "color" as const,
            },
        ];
        const aggregate = parseAggregatePayload({
            summary: "The subject is clear.",
            strengths: ["The subject is clear"],
            issues: [
                {
                    id: "valid",
                    category: "color",
                    title: "background color interference",
                    explanation: "Highly saturated color blocks in the background steal attention.",
                    severity: "medium",
                    confidence: 0.8,
                    targetDescription: "Background upper right corner",
                    suggestion: { goal: "Reduce interference", actions: ["Reduce saturation"], preserve: ["Keep body color"], expectedEffect: "The subject is more prominent" },
                    sourceCandidateIds: ["c-valid"],
                },
                {
                    id: "invented",
                    category: "lighting",
                    title: "Questions added out of thin air",
                    explanation: "This problem does not exist with input candidates.",
                    severity: "high",
                    confidence: 0.9,
                    targetDescription: "Picture",
                    suggestion: { goal: "improve", actions: ["adjust"], preserve: [], expectedEffect: "better" },
                    sourceCandidateIds: ["missing-candidate"],
                },
            ],
        });
        const warnings: string[] = [];
        const filtered = filterAggregateAgainstCandidates(aggregate, candidates, warnings);
        expect(filtered.issues.map((issue) => issue.id)).toEqual(["valid"]);
        expect(warnings).toHaveLength(1);
    });

    test("Optional directions cannot be disguised as questions and can only refer to similar candidates.", () => {
        const candidates = [
            {
                id: "c-option",
                checkId: "temperature",
                kind: "option" as const,
                category: "color" as const,
                title: "Try a cooler atmosphere",
                observation: "The picture currently has a balance of cool and warm colors, and there is room for a shift towards cooler colors.",
                reason: "This may make the mood more restrained, but it is not a definite flaw",
                evidence: ["The relationship between warm and cold temperatures between the subject and the background is clear"],
                severity: 0.6,
                confidence: 0.82,
                targetDescription: "Overall tone",
                reviewer: "color" as const,
            },
        ];
        const aggregate = parseAggregatePayload({
            summary: "The whole picture is established.",
            strengths: ["Clear color relationship"],
            issues: [
                {
                    id: "wrong-issue",
                    category: "color",
                    title: "Wrong color",
                    explanation: "Optional directions were mistakenly written as questions.",
                    severity: "medium",
                    confidence: 0.9,
                    targetDescription: "Overall tone",
                    suggestion: { goal: "improve", actions: ["adjust"], preserve: [], expectedEffect: "better" },
                    sourceCandidateIds: ["c-option"],
                },
            ],
            options: [
                {
                    id: "valid-option",
                    category: "color",
                    title: "Try a cooler atmosphere",
                    explanation: "If you want to enhance your sense of restraint, consider moving to cooler colors.",
                    confidence: 0.84,
                    suggestion: { goal: "Try cool colors", actions: ["Slightly lower color temperature"], preserve: ["Preserve subject skin tone"], expectedEffect: "Emotions are more controlled" },
                    sourceCandidateIds: ["c-option"],
                },
            ],
        });
        const warnings: string[] = [];
        const filtered = filterAggregateAgainstCandidates(aggregate, candidates, warnings);
        expect(filtered.issues).toHaveLength(0);
        expect(filtered.options.map((option) => option.id)).toEqual(["valid-option"]);
        expect(warnings).toHaveLength(1);
    });

    test("Low-confidence positioning is downgraded to global, and review rejections are filtered.", () => {
        const issues = [
            {
                id: "confirmed",
                category: "composition" as const,
                title: "subject position",
                explanation: "The subject is tilted to one side.",
                severity: "high" as const,
                confidence: 0.9,
                target: { type: "global" as const, points: [] },
                suggestion: { goal: "improve", actions: ["Adjust position"], preserve: [], expectedEffect: "more balanced" },
            },
            {
                id: "rejected",
                category: "color" as const,
                title: "color problem",
                explanation: "The color relationship is unclear.",
                severity: "medium" as const,
                confidence: 0.8,
                target: { type: "global" as const, points: [] },
                suggestion: { goal: "improve", actions: ["Adjust color"], preserve: [], expectedEffect: "more unified" },
            },
        ];
        const grounded = applyGrounding(issues, [
            {
                issueId: "confirmed",
                target: {
                    type: "box",
                    points: [
                        { x: 0.2, y: 0.2 },
                        { x: 0.6, y: 0.8 },
                    ],
                },
                groundingConfidence: 0.9,
            },
            {
                issueId: "rejected",
                target: {
                    type: "box",
                    points: [
                        { x: 0.1, y: 0.1 },
                        { x: 0.4, y: 0.4 },
                    ],
                },
                groundingConfidence: 0.4,
            },
        ]);
        expect(grounded[0].target.type).toBe("box");
        expect(grounded[1].target.type).toBe("global");

        const verified = applyVerification(grounded, [
            { issueId: "confirmed", verification: { verdict: "confirmed", confidence: 0.92, reason: "Image evidence is clear" } },
            { issueId: "rejected", verification: { verdict: "rejected", confidence: 0.9, reason: "Does not match the image" } },
        ]);
        expect(verified.issues.map((issue) => issue.id)).toEqual(["confirmed"]);
        expect(verified.summary).toEqual({ checked: 2, confirmed: 1, uncertain: 0, rejected: 1 });
    });

    test("Apply reference coordinates and mark source when location service fails", () => {
        const issues = [
            {
                id: "reference-1",
                category: "composition" as const,
                title: "The person in the foreground on the left is too heavy",
                explanation: "The foreground figures on the left form a continuous dark block.",
                severity: "high" as const,
                confidence: 0.9,
                target: { type: "global" as const, points: [] },
                targetDescription: "Foreground figure on the left",
                suggestion: { goal: "Reduce distractions", actions: ["Narrow prospects"], preserve: [], expectedEffect: "The subject is more prominent" },
            },
        ];
        const grounded = applyReferenceCoordinates(issues);
        expect(grounded[0].target.type).toBe("box");
        expect(grounded[0].targetSource).toBe("reference");
    });

    test("Locate and review parsing to preserve confidence", () => {
        const grounding = parseGroundingPayload({ targets: [{ issueId: "i-1", target: { type: "global", points: [] }, groundingConfidence: 0.61 }] });
        const verification = parseVerificationPayload({ decisions: [{ issueId: "i-1", verdict: "uncertain", confidence: 0.77, reason: "Partial evidence is not clear enough" }] });
        expect(grounding.targets[0].groundingConfidence).toBe(0.61);
        expect(verification.decisions[0].verification.verdict).toBe("uncertain");
    });

    test("Positioning parsing supports multiple reference points for dispersed problems", () => {
        const grounding = parseGroundingPayload({
            targets: [
                {
                    issueId: "i-2",
                    target: {
                        type: "points",
                        points: [
                            { x: 0.2, y: 0.2 },
                            { x: 0.8, y: 0.7 },
                        ],
                    },
                    groundingConfidence: 0.8,
                },
            ],
        });
        expect(grounding.targets[0].target.type).toBe("points");
        expect(targetPolygon(grounding.targets[0].target)).toHaveLength(2);
    });

    test("When the model returns an invalid frame, the reference area is used instead of the degenerate horizontal line.", () => {
        const issues = [
            {
                id: "grounding-invalid-box",
                category: "composition" as const,
                title: "The dark parts of the foreground are too heavy",
                explanation: "The foreground on the left presses the main moving line.",
                severity: "high" as const,
                confidence: 0.9,
                target: { type: "global" as const, points: [] },
                targetDescription: "Foreground figure on the left",
                suggestion: { goal: "Reduce prospect weight", actions: ["Shrink foreground people"], preserve: [], expectedEffect: "The subject is more prominent" },
            },
        ];
        const grounded = applyGrounding(issues, [
            {
                issueId: "grounding-invalid-box",
                target: {
                    type: "box",
                    points: [
                        { x: 0.2, y: 0.1 },
                        { x: 0.8, y: 0.1 },
                    ],
                },
                groundingConfidence: 0.92,
            },
        ]);
        expect(grounded[0].targetSource).toBe("reference");
        expect(grounded[0].target.type).toBe("box");
        expect(targetBounds(grounded[0].target).height).toBeGreaterThan(0.8);
    });

    test("Similar problems with the same root cause will be merged and the sources and suggestions will be retained.", () => {
        const issues = [
            {
                id: "face-light",
                category: "lighting" as const,
                title: "Insufficient light on the subject’s face",
                explanation: "The face is in darkness and the expression is unclear.",
                severity: "high" as const,
                confidence: 0.9,
                targetDescription: "subject face",
                suggestion: { goal: "Improve emoticon readability", actions: ["Improve local brightness on face"], preserve: ["Keep the cool atmosphere"], expectedEffect: "Expression is clearer" },
                sourceCandidateIds: ["lighting-exposure"],
            },
            {
                id: "subject-separation",
                category: "lighting" as const,
                title: "Dark parts of characters blend into the background",
                explanation: "The brightness of the characters is close to that of the background, and the subject separation is insufficient.",
                severity: "medium" as const,
                confidence: 0.86,
                targetDescription: "Character hair and right shoulder",
                suggestion: { goal: "Strengthen the separation of subjects", actions: ["Complement restrained contour light"], preserve: ["Preserve character outlines"], expectedEffect: "The spatial hierarchy is clearer" },
                sourceCandidateIds: ["lighting-separation"],
            },
        ];
        const warnings: string[] = [];
        const result = deduplicateAggregateIssues(issues, warnings);
        expect(result).toHaveLength(1);
        expect(result[0].sourceCandidateIds).toEqual(["lighting-exposure", "lighting-separation"]);
        expect(result[0].suggestion.actions).toEqual(["Improve local brightness on face", "Complement restrained contour light"]);
        expect(warnings).toEqual(["The aggregation phase merges 1 duplicate or same root cause issue."]);
    });
});
