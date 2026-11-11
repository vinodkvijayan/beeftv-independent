import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { ReusableWorkflowNode } from "@/components/canvas/nodes/reusable-workflow-node";
import { createWorkflowInstance } from "@/lib/canvas/reusable-workflow-instance";
import type { CanvasWorkflow, WorkflowRun } from "@/services/api/canvas-workflows";

const template: CanvasWorkflow = { id: "test", name: "Character replacement", description: "", createdAt: "", updatedAt: "", definition: { version: 1, nodes: [
    { id: "in", role: "input", title: "Action reference", mediaType: "video", resourceId: "old" },
    { id: "depth", role: "depth", title: "Depth", mediaType: "video" },
    { id: "out", role: "generation", title: "Generate results", mediaType: "video", sourceTaskId: "source" },
], edges: [{ fromNodeId: "in", toNodeId: "depth" }, { fromNodeId: "depth", toNodeId: "out" }], outputNodeIds: ["out"] } };
const noop = () => {};

test("workflow header sits outside the frame and keeps its screen size", () => {
    const graph = createWorkflowInstance(template, { x: 0, y: 0 });
    const html = renderToStaticMarkup(<CanvasFrameNode data={graph.frame} scale={0.25} childNodes={graph.nodes.slice(1)} isSelected={false} isDropTarget={false} readOnly onMouseDown={noop} onResize={noop} onToggleCollapsed={noop} onFolderStyleChange={noop} onTitleChange={noop} onContextMenu={noop} />);
    expect(html).toMatch(/data-canvas-frame-header[^>]*bottom-full[^>]*transform:scale\(var\(--canvas-live-inverse-scale, 4\)\)/);
    expect(html).not.toContain("data-canvas-frame-count");
});

test("workflow progress counts executable steps and presents a running command", () => {
    const graph = createWorkflowInstance(template, { x: 0, y: 0 });
    graph.control.metadata!.reusableWorkflow!.run = { id: "run", status: "running", steps: [{ nodeId: "in", status: "succeeded" }, { nodeId: "depth", status: "succeeded" }, { nodeId: "out", status: "running" }] } as WorkflowRun;
    const html = renderToStaticMarkup(<ReusableWorkflowNode node={graph.control} nodes={graph.nodes} readOnly={false} onAction={async () => {}} onValue={async () => {}} onUploadBusy={noop} onError={noop} />);
    expect(html).toContain('aria-label="Workflow execution progress"');
    expect(html).toContain('aria-valuemax="2"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain("Running");
    expect(html).not.toContain("Rerun");
    expect(html).not.toContain("The run will use model credits");
    expect(html).not.toContain("generation steps");
    expect(html).not.toContain("input");
    expect(html).toMatch(/justify-end[^>]*data-workflow-actions/);
    expect(html).toContain("text-2xl");
});
