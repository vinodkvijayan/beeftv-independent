import { describe, expect, test } from "bun:test";

import { parseChartSource } from "../src/components/canvas/nodes/chart-node";
import { colorGradeCssFilter, DEFAULT_COLOR_GRADE, isNeutralColorGrade } from "../src/lib/canvas/canvas-color-grade";
import { NODE_DEFAULT_SIZE, NODE_SPECS } from "../src/constant/canvas";
import { getNodeGenerationMode, getNodeInputKind, getNodeLabel, getNodeResourceKind } from "../src/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const EXTENSION_TYPES = [
    CanvasNodeType.Markdown,
    CanvasNodeType.Svg,
    CanvasNodeType.Html,
    CanvasNodeType.Panorama,
    CanvasNodeType.Compare,
    CanvasNodeType.Chart,
    CanvasNodeType.ColorGrade,
] as const;

function node(type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id: `${type}-1`, type, title: "", position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("Extended node registration integrity", () => {
    test("7 expansion nodes are registered in four tables", () => {
        EXTENSION_TYPES.forEach((type) => {
            expect(getNodeLabel(type), `${type} Missing registry definition`).toBeTruthy();
            expect(NODE_DEFAULT_SIZE[type], `${type} Missing default size`).toBeTruthy();
            expect(NODE_SPECS[type], `${type} Missing node specs`).toBeTruthy();
        });
    });

    test("The display node does not participate in the generation and does not initiate the generation behavior itself.", () => {
        EXTENSION_TYPES.forEach((type) => {
            expect(getNodeGenerationMode(node(type)), `${type} There should be no build mode`).toBeNull();
        });
    });
});

describe("Materials and input criteria for expansion nodes", () => {
    test("Text extension nodes are considered material only if they have content.", () => {
        [CanvasNodeType.Markdown, CanvasNodeType.Svg, CanvasNodeType.Html].forEach((type) => {
            expect(getNodeResourceKind(node(type, { content: "x" }))).toBe("text");
            expect(getNodeResourceKind(node(type, {}))).toBeNull();
            expect(getNodeInputKind(type)).toBe("text");
        });
    });

    test("The viewer class node consumes images but is not a material itself", () => {
        [CanvasNodeType.Panorama, CanvasNodeType.Compare].forEach((type) => {
            expect(getNodeResourceKind(node(type, { content: "x" })), `${type}should not be used as material`).toBeNull();
            expect(getNodeInputKind(type)).toBe("image");
        });
    });

    test("Chart nodes eat text but do not produce material", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Chart, { content: "[]" }))).toBeNull();
        expect(getNodeInputKind(CanvasNodeType.Chart)).toBe("text");
    });

    test("Even if the coloring node itself has no content, it must be considered as picture material.", () => {
        // 它的图来自上游。若按「有没有 content」判断，它会永远进不了生成输入——
        // 这是个不报错的静默失效，所以单独钉住。
        expect(getNodeResourceKind(node(CanvasNodeType.ColorGrade, {}))).toBe("image");
        expect(getNodeInputKind(CanvasNodeType.ColorGrade)).toBe("image");
    });
});

describe("Color correction parameters", () => {
    test("Default parameters are considered unadjusted", () => {
        expect(isNeutralColorGrade(DEFAULT_COLOR_GRADE)).toBe(true);
        expect(isNeutralColorGrade({ ...DEFAULT_COLOR_GRADE, brightness: 120 })).toBe(false);
        expect(isNeutralColorGrade({ ...DEFAULT_COLOR_GRADE, hueRotate: -10 })).toBe(false);
    });

    test("Preview and export share the same filter string", () => {
        expect(colorGradeCssFilter({ brightness: 110, contrast: 90, saturate: 120, hueRotate: -15 }))
            .toBe("brightness(110%) contrast(90%) saturate(120%) hue-rotate(-15deg)");
    });
});

describe("Chart data analysis", () => {
    test("Parse JSON array, numeric column as series", () => {
        const parsed = parseChartSource('[{"月份":"1月","销量":120,"退货":8},{"月份":"2月","销量":150,"退货":5}]');
        expect(parsed?.xKey).toBe("month");
        expect(parsed?.series).toEqual(["Sales volume", "Return"]);
        expect(parsed?.rows.length).toBe(2);
    });

    test("Parse CSV and convert numeric strings into numeric values", () => {
        const parsed = parseChartSource("city, population\nBeijing,2189\nShanghai,2487");
        expect(parsed?.xKey).toBe("city");
        expect(parsed?.series).toEqual(["population"]);
        expect(parsed?.rows[0].人口).toBe(2189);
    });

    test("When all columns are numerical values, fall back to the row number and make the horizontal axis", () => {
        const parsed = parseChartSource("[{\"a\":1,\"b\":2},{\"a\":3,\"b\":4}]");
        expect(parsed?.xKey).toBe("__index");
        expect(parsed?.rows[0].__index).toBe(1);
    });

    // 数据来自模型输出，非法输入是常态而不是异常；抛出来会连带整个画布白屏。
    test("Illegal or unseries input returns null without throwing", () => {
        expect(parseChartSource("")).toBeNull();
        expect(parseChartSource("{This is not JSON")).toBeNull();
        expect(parseChartSource("just a sentence")).toBeNull();
        expect(parseChartSource("[]")).toBeNull();
        expect(parseChartSource('{"a":1}')).toBeNull();
        expect(parseChartSource('[{"名称":"甲"},{"名称":"乙"}]')).toBeNull();
        expect(parseChartSource("only one line")).toBeNull();
    });
});
