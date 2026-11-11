import { describe, expect, test } from "bun:test";

import { getNodeDefinition, getNodeGenerationMode, getNodeInputKind, getNodeListLabel, getNodeMinSize, getNodeResourceKind, listCreatableNodeDefinitions, listNodeDefinitions, shouldKeepAspectRatio } from "../src/lib/canvas/node-registry";
import { connectionInputSummary } from "../src/lib/canvas/canvas-connection-policy";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "../src/types/canvas";

function node(type: CanvasNodeType, metadata?: CanvasNodeMetadata, id = type): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

const ALL_TYPES = Object.values(CanvasNodeType);

describe("Node Registry - Coverage Completeness", () => {
    test("Each node type has a definition", () => {
        expect(ALL_TYPES.every((type) => Boolean(getNodeDefinition(type)))).toBe(true);
        for (const type of ALL_TYPES) expect(getNodeMinSize(type)).toBeDefined();
    });

    test("Skills, build configurations and workflow container nodes do not enter the creation menu", () => {
        const hidden = ALL_TYPES.filter((type) => !listCreatableNodeDefinitions().some((def) => def.type === type));
        expect(hidden.sort()).toEqual([CanvasNodeType.Config, CanvasNodeType.Skill, CanvasNodeType.Workflow, CanvasNodeType.WorkflowControl].sort());
    });
});

describe("Node Registry - Geometry", () => {
    test("Minimum size by type", () => {
        expect(getNodeMinSize(CanvasNodeType.Image)).toEqual({ width: 420, height: 236 });
        expect(getNodeMinSize(CanvasNodeType.Video)).toEqual({ width: 420, height: 236 });
        expect(getNodeMinSize(CanvasNodeType.Script).width).toBe(800);
        expect(getNodeMinSize(CanvasNodeType.Text)).toEqual({ width: 220, height: 160 });
    });

    test("Only pictures (without free ratio) and videos lock aspect ratio", () => {
        expect(shouldKeepAspectRatio(node(CanvasNodeType.Image))).toBe(true);
        expect(shouldKeepAspectRatio(node(CanvasNodeType.Image, { freeResize: true }))).toBe(false);
        expect(shouldKeepAspectRatio(node(CanvasNodeType.Video))).toBe(true);
        expect(shouldKeepAspectRatio(node(CanvasNodeType.Video, { freeResize: true }))).toBe(true);
        for (const type of [CanvasNodeType.Text, CanvasNodeType.Drawing, CanvasNodeType.Script, CanvasNodeType.Skill, CanvasNodeType.Config, CanvasNodeType.Audio, CanvasNodeType.Frame]) {
            expect(shouldKeepAspectRatio(node(type))).toBe(false);
        }
    });
});

describe("Node registry - material type (resourceKind)", () => {
    test("Only if there is content, it counts as material, and empty nodes don’t count.", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Image, { content: "x" }))).toBe("image");
        expect(getNodeResourceKind(node(CanvasNodeType.Image))).toBeNull();
        expect(getNodeResourceKind(node(CanvasNodeType.Video, { content: "x" }))).toBe("video");
        expect(getNodeResourceKind(node(CanvasNodeType.Video))).toBeNull();
        expect(getNodeResourceKind(node(CanvasNodeType.Audio, { content: "x" }))).toBe("audio");
        expect(getNodeResourceKind(node(CanvasNodeType.Audio))).toBeNull();
    });

    test("Drawings are calculated based on pictures, and the drawingId is recognized instead of content.", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Drawing, { drawingId: "d1" }))).toBe("image");
        expect(getNodeResourceKind(node(CanvasNodeType.Drawing, { content: "x" }))).toBeNull();
    });

    test("Text ID content or prompt", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Text, { content: "x" }))).toBe("text");
        expect(getNodeResourceKind(node(CanvasNodeType.Text, { prompt: "p" }))).toBe("text");
        expect(getNodeResourceKind(node(CanvasNodeType.Text))).toBeNull();
    });

    test("Skills are calculated as text, see skillSnapshot or content", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Skill, { content: "x" }))).toBe("text");
        expect(getNodeResourceKind(node(CanvasNodeType.Skill))).toBeNull();
    });

    test("Storyboards, generation configurations, and backplanes are not materials.", () => {
        for (const type of [CanvasNodeType.Script, CanvasNodeType.Config, CanvasNodeType.Frame]) {
            expect(getNodeResourceKind(node(type, { content: "x" }))).toBeNull();
        }
    });
});

describe("Node registry - generation mode (generationMode)", () => {
    test("Map by type", () => {
        expect(getNodeGenerationMode(node(CanvasNodeType.Image))).toBe("image");
        expect(getNodeGenerationMode(node(CanvasNodeType.Video))).toBe("video");
        expect(getNodeGenerationMode(node(CanvasNodeType.Audio))).toBe("audio");
        expect(getNodeGenerationMode(node(CanvasNodeType.Text))).toBe("text");
        expect(getNodeGenerationMode(node(CanvasNodeType.Script))).toBe("text");
    });

    test("The generation configuration is determined by metadata, and the default is based on images.", () => {
        expect(getNodeGenerationMode(node(CanvasNodeType.Config, { generationMode: "video" }))).toBe("video");
        expect(getNodeGenerationMode(node(CanvasNodeType.Config))).toBe("image");
    });

    test("Drawing, skills, and backboards do not generate generation behavior", () => {
        for (const type of [CanvasNodeType.Drawing, CanvasNodeType.Skill, CanvasNodeType.Frame]) {
            expect(getNodeGenerationMode(node(type))).toBeNull();
        }
    });
});

describe("Node Registry - Input Count Category (inputKind)", () => {
    test("The generated configuration and backplane are not included in the count, and the rest are classified into their own categories.", () => {
        expect(getNodeInputKind(CanvasNodeType.Config)).toBeUndefined();
        expect(getNodeInputKind(CanvasNodeType.Frame)).toBeUndefined();
        expect(getNodeInputKind(CanvasNodeType.Image)).toBe("image");
        expect(getNodeInputKind(CanvasNodeType.Drawing)).toBe("image");
        expect(getNodeInputKind(CanvasNodeType.Video)).toBe("video");
        expect(getNodeInputKind(CanvasNodeType.Audio)).toBe("audio");
        for (const type of [CanvasNodeType.Text, CanvasNodeType.Script, CanvasNodeType.Skill]) {
            expect(getNodeInputKind(type)).toBe("text");
        }
    });
});

describe("connectionInputSummary - counting and cross-type coverage", () => {
    const conn = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `c-${fromNodeId}`, fromNodeId, toNodeId });

    test("Content-agnostic: empty image nodes are still counted in imageCount", () => {
        const nodes = [node(CanvasNodeType.Image, undefined, "img"), node(CanvasNodeType.Text, undefined, "target")];
        expect(connectionInputSummary("target", nodes, [conn("img", "target")]).imageCount).toBe(1);
    });

    test("Drawings count in imageCount, scripts and skills count in textCount", () => {
        const nodes = [
            node(CanvasNodeType.Drawing, undefined, "draw"),
            node(CanvasNodeType.Script, undefined, "script"),
            node(CanvasNodeType.Skill, undefined, "skill"),
            node(CanvasNodeType.Text, undefined, "target"),
        ];
        const summary = connectionInputSummary("target", nodes, [conn("draw", "target"), conn("script", "target"), conn("skill", "target")]);
        expect(summary.imageCount).toBe(1);
        expect(summary.textCount).toBe(2);
    });

    test("Generating configurations and backplanes as upstream will not be counted.", () => {
        const nodes = [
            node(CanvasNodeType.Config, undefined, "config"),
            node(CanvasNodeType.Frame, undefined, "frame"),
            node(CanvasNodeType.Text, undefined, "target"),
        ];
        const summary = connectionInputSummary("target", nodes, [conn("config", "target"), conn("frame", "target")]);
        expect(summary).toEqual({ textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 });
    });

    test("Character card coverage type classification: Picture nodes with character metadata are recorded as characters instead of pictures", () => {
        const nodes = [node(CanvasNodeType.Image, { workflowKind: "character" }, "char"), node(CanvasNodeType.Text, undefined, "target")];
        const summary = connectionInputSummary("target", nodes, [conn("char", "target")]);
        expect(summary.characterCount).toBe(1);
        expect(summary.imageCount).toBe(0);
    });

    test("Uncountable types are not recorded as roles even if they have role metadata (exclusion is earlier than coverage)", () => {
        const nodes = [node(CanvasNodeType.Frame, { workflowKind: "character" }, "frame"), node(CanvasNodeType.Text, undefined, "target")];
        expect(connectionInputSummary("target", nodes, [conn("frame", "target")]).characterCount).toBe(0);
    });
});

describe("Node Registry - List Tags", () => {
    test("Derived from label, the backplane is explicitly pinned without the \"node\" suffix.", () => {
        expect(getNodeListLabel(CanvasNodeType.Image)).toBe("Picture node");
        expect(getNodeListLabel(CanvasNodeType.Text)).toBe("text node");
        expect(getNodeListLabel(CanvasNodeType.Drawing)).toBe("drawing node");
        expect(getNodeListLabel(CanvasNodeType.Script)).toBe("Storyboard node");
        expect(getNodeListLabel(CanvasNodeType.Skill)).toBe("Skill node");
        expect(getNodeListLabel(CanvasNodeType.Config)).toBe("Generate configuration node");
        expect(getNodeListLabel(CanvasNodeType.Video)).toBe("video node");
        expect(getNodeListLabel(CanvasNodeType.Audio)).toBe("audio node");
        expect(getNodeListLabel(CanvasNodeType.Frame)).toBe("backplane");
    });
});
