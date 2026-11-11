import { describe, expect, test } from "bun:test";

import { storyboardRowsFromTask } from "../src/lib/canvas/canvas-project-domain";
import type { GenerationTask } from "../src/services/api/task-center";

function storyboardTask(resultJson: string): GenerationTask {
    return { id: "task-1", resultJson } as GenerationTask;
}

// 后端 canvas_text 任务统一落 {mode, reasoning, text} 包装，模型输出正文嵌在 text 里；
// 分镜解析必须穿透包装取内层 {title, rows}，同时兼容模板路径直接落顶层的结构。
describe("storyboardRowsFromTask", () => {
    test("Parsing storyboard lines from the inner layer of text wrapped by {mode, reasoning, text}", () => {
        const payload = { title: "Three sworn brothers in Taoyuan", rows: [
            { shotNumber: 1, durationSeconds: 8, plotDescription: "The beginning of the court", dialogue: "", characters: ["Liu Bei"], mustHave: ["line up"], optionalDetails: [] },
            { shotNumber: 2, durationSeconds: 10, plotDescription: "Sigh in front of the notice wall", dialogue: "Alas...", characters: ["Liu Bei", "Guan Yu"] },
        ] };
        const task = storyboardTask(JSON.stringify({ mode: "text", reasoning: "thought process", text: JSON.stringify(payload) }));
        const result = storyboardRowsFromTask(task);
        expect(result.title).toBe("Three sworn brothers in Taoyuan");
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0].shotNumber).toBe(1);
        expect(result.rows[0].status).toBe("idle");
        expect(result.rows[0].characters).toEqual(["Liu Bei"]);
        expect(result.rows[1].characters).toEqual(["Liu Bei", "Guan Yu"]);
    });

    test("The text inner layer can still be parsed when it is wrapped by ```json code block", () => {
        const payload = { title: "Chapter", rows: [{ shotNumber: 1, plotDescription: "single lens" }] };
        const wrappedText = "```json\n" + JSON.stringify(payload) + "\n```";
        const task = storyboardTask(JSON.stringify({ mode: "text", text: wrappedText }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("When text is mixed with explanation text in the inner layer, it is intercepted and parsed according to the first and last curly brackets.", () => {
        const payload = { title: "Chapter", rows: [{ shotNumber: 1, plotDescription: "single lens" }] };
        const noisyText = "The following is the storyboard:" + JSON.stringify(payload) + "Please let us know if adjustments are needed.";
        const task = storyboardTask(JSON.stringify({ mode: "text", text: noisyText }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("Compatible with the structure where the top layer directly falls into {title, rows}", () => {
        const task = storyboardTask(JSON.stringify({ title: "Chapter", rows: [{ shotNumber: 1, plotDescription: "single lens" }] }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("A missing line error is thrown when the inner layer of text is not JSON", () => {
        // 无契约时期模型返回 Markdown 表格的真实场景。
        const task = storyboardTask(JSON.stringify({ mode: "text", text: "| 7-41 | Panorama/Zoom | Taoyuan Brothers |" }));
        expect(() => storyboardRowsFromTask(task)).toThrow("Storyboard task does not return shot rows");
    });

    test("Throws a missing row error when rows is an empty array", () => {
        const task = storyboardTask(JSON.stringify({ mode: "text", text: JSON.stringify({ title: "empty", rows: [] }) }));
        expect(() => storyboardRowsFromTask(task)).toThrow("Storyboard task does not return shot rows");
    });
});
