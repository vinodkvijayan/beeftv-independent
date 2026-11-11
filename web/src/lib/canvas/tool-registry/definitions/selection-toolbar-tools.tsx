import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignHorizontalSpaceAround, AlignHorizontalSpaceBetween, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalSpaceAround, AlignVerticalSpaceBetween, Film, FolderPlus, FolderTree, Grid3X3, LayoutTemplate, Link2, LoaderCircle, Sparkles, Workflow } from "lucide-react";

import { registerToolbarTools, type ToolDefinition } from "@/lib/canvas/tool-registry";

export const selectionToolbarTools: ToolDefinition[] = [
    { id: "selection-save-workflow", toolbar: "selection", category: "selection", label: "Save as workflow", icon: <Workflow />, defaultVisible: true, defaultOrder: 6, applicable: (ctx) => Boolean(ctx.handlers.onSaveWorkflow), run: (ctx) => ctx.handlers.onSaveWorkflow?.() },
    { id: "selection-ask-assistant", toolbar: "selection", category: "selection", label: "Ask the assistant", icon: <Sparkles />, defaultVisible: true, defaultOrder: 5, applicable: (ctx) => Boolean(ctx.handlers.onAskAssistant), run: (ctx) => ctx.handlers.onAskAssistant?.() },
    { id: "selection-align-left", toolbar: "selection", category: "layout", label: "left aligned", icon: <AlignHorizontalJustifyStart />, defaultVisible: true, defaultOrder: 10, run: (ctx) => ctx.handlers.onAlign("left") },
    { id: "selection-align-center-x", toolbar: "selection", category: "layout", label: "Center horizontally", icon: <AlignHorizontalJustifyCenter />, defaultVisible: true, defaultOrder: 20, run: (ctx) => ctx.handlers.onAlign("centerX") },
    { id: "selection-align-right", toolbar: "selection", category: "layout", label: "Align right", icon: <AlignHorizontalJustifyEnd />, defaultVisible: true, defaultOrder: 30, run: (ctx) => ctx.handlers.onAlign("right") },
    { id: "selection-align-top", toolbar: "selection", category: "layout", label: "top aligned", icon: <AlignVerticalJustifyStart />, defaultVisible: true, defaultOrder: 40, run: (ctx) => ctx.handlers.onAlign("top") },
    { id: "selection-align-center-y", toolbar: "selection", category: "layout", label: "Center vertically", icon: <AlignVerticalJustifyCenter />, defaultVisible: true, defaultOrder: 50, run: (ctx) => ctx.handlers.onAlign("centerY") },
    { id: "selection-align-bottom", toolbar: "selection", category: "layout", label: "bottom aligned", icon: <AlignVerticalJustifyEnd />, defaultVisible: true, defaultOrder: 60, run: (ctx) => ctx.handlers.onAlign("bottom") },
    { id: "selection-distribute-x", toolbar: "selection", category: "layout", label: "Horizontal isometric", icon: <AlignHorizontalSpaceBetween />, defaultVisible: true, defaultOrder: 70, disabled: (ctx) => ctx.selectedCount < 3, run: (ctx) => ctx.handlers.onAlign("distributeX") },
    { id: "selection-distribute-y", toolbar: "selection", category: "layout", label: "vertical isometric", icon: <AlignVerticalSpaceBetween />, defaultVisible: true, defaultOrder: 80, disabled: (ctx) => ctx.selectedCount < 3, run: (ctx) => ctx.handlers.onAlign("distributeY") },
    { id: "selection-arrange-row", toolbar: "selection", category: "arrange", label: "Horizontal arrangement", icon: <AlignHorizontalSpaceAround />, defaultVisible: false, defaultOrder: 90, run: (ctx) => ctx.handlers.onArrange("row") },
    { id: "selection-arrange-column", toolbar: "selection", category: "arrange", label: "Vertically arranged", icon: <AlignVerticalSpaceAround />, defaultVisible: false, defaultOrder: 100, run: (ctx) => ctx.handlers.onArrange("column") },
    { id: "selection-arrange-grid", toolbar: "selection", category: "arrange", label: "Palace arrangement", icon: <Grid3X3 />, defaultVisible: false, defaultOrder: 110, run: (ctx) => ctx.handlers.onArrange("grid") },
    { id: "selection-arrange-flow", toolbar: "selection", category: "arrange", label: "Organize by connection", icon: <Workflow />, defaultVisible: false, defaultOrder: 120, run: (ctx) => ctx.handlers.onArrange("flow") },
    { id: "selection-create-storyboard", toolbar: "selection", category: "selection", label: "Create storyboard", icon: <LayoutTemplate />, defaultVisible: true, defaultOrder: 130, disabled: (ctx) => ctx.selectedCount < 2, run: (ctx) => ctx.handlers.onCreateStoryboard() },
    { id: "selection-pack-folder", toolbar: "selection", category: "selection", label: "Save to folder", icon: <FolderPlus />, defaultVisible: true, defaultOrder: 135, applicable: (ctx) => Boolean(ctx.handlers.onPackToFolder), disabled: (ctx) => ctx.selectedCount < 2, run: (ctx) => ctx.handlers.onPackToFolder?.() },
    { id: "selection-create-reference-group", toolbar: "selection", category: "selection", label: "Create reference group", icon: <FolderTree />, defaultVisible: false, defaultOrder: 140, disabled: (ctx) => ctx.selectedCount < 2, run: (ctx) => ctx.handlers.onCreateReferenceGroup() },
    { id: "selection-batch-connect", toolbar: "selection", category: "selection", label: "Batch connection", icon: <Link2 />, defaultVisible: true, defaultOrder: 145, disabled: (ctx) => ctx.selectedCount < 2, run: (ctx) => ctx.handlers.onBatchConnect() },
    {
        id: "selection-merge-videos",
        workflow: { operationId: "video.merge", outputType: "video" },
        toolbar: "selection",
        category: "selection",
        label: (ctx) => `Merge selected videos (${ctx.selectedVideoCount}）`,
        icon: (ctx) => ctx.mergingVideos ? <LoaderCircle className="animate-spin" /> : <Film />,
        defaultVisible: true,
        defaultOrder: 150,
        applicable: (ctx) => ctx.selectedVideoCount >= 2,
        disabled: (ctx) => ctx.mergingVideos,
        run: (ctx) => ctx.handlers.onMergeVideos(),
    },
];

registerToolbarTools(selectionToolbarTools);
