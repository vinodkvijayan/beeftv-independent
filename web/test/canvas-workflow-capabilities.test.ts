import { expect, test } from "bun:test";
import { listCanvasWorkflowCapabilities } from "../src/lib/canvas/workflow-capabilities";
import type { WorkflowOperation } from "../src/services/api/canvas-workflows";

test("workflow directory exposes only first-release executable operations", () => {
    const op: WorkflowOperation = { id: "image.crop", name: "Picture cropping", version: 1, outputType: "image", inputs: [], fields: [] };
    const capabilities = listCanvasWorkflowCapabilities([op]);
    expect(capabilities.find(c => c.id === "operation.image.crop")?.mode).toBe("direct");
    expect(listCanvasWorkflowCapabilities([{ ...op, unavailableReason: "Encoder missing" }])[0]).toMatchObject({ mode: "unavailable", reason: "Encoder missing" });
    expect(listCanvasWorkflowCapabilities([{...op,id:"image.split"},{...op,id:"new.adapter"}])).toEqual([]);
    const supported = ["image.select","image.describe","image.ai-upscale","video.ai-upscale","video.trim","video.depth"];
    expect(listCanvasWorkflowCapabilities(supported.map(id=>({...op,id}))).map(item=>item.operation?.id)).toEqual(supported);
    expect(listCanvasWorkflowCapabilities([{...op,id:"generate.image"},{...op,id:"generate.video"}])).toEqual([]);
    expect([...new Set(listCanvasWorkflowCapabilities(supported.map(id=>({...op,id}))).map(item=>item.group))].sort()).toEqual(["Image processing","video processing"]);
});

test("workflow processing labels match canvas action names", () => {
    const expected: Record<string,string> = {"image.crop":"Cut","image.resize":"resize","image.describe":"Reverse prompt word","image.ai-upscale":"AI super score","video.ai-upscale":"AI super score","video.frame":"Key frame interception","video.audio":"Audio and video separation","video.trim":"video clip","video.crop":"Screen cropping","video.depth":"Deep motion capture","video.merge":"Merge selected videos"};
    const operations = Object.keys(expected).map(id=>({id,name:"old name",version:1,outputType:"image" as const,inputs:[],fields:[]}));
    for (const entry of listCanvasWorkflowCapabilities(operations)) {
        expect(entry.name).toBe(expected[entry.operation!.id]);
        expect(entry.operation!.name).toBe(entry.name);
    }
});
