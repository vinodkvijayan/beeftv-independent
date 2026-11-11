import type { ReactNode } from "react";
import { Brush, Camera, Copy, FileText, Globe2, Grid2x2, Lock, LockOpen, Maximize2, PencilLine, Crop, SlidersHorizontal, Smile, Sun, Upload, Scaling } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import type { NodeToolbarGroup } from "@/lib/canvas/tool-registry";
import type { CanvasWorkflowContribution } from "@/lib/canvas/workflow-capability";

type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "annotation" | "maskEdit" | "emotion" | "portraitTexture" | "crop" | "split" | "upscale" | "superResolve" | "angle" | "lighting" | "panorama" | "view";

type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onLighting: (node: CanvasNodeData) => void;
    onPanorama: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
};

type ImageToolDefinition = {
    workflow?: CanvasWorkflowContribution;
    id: ImageNodeActionToolId;
    label: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    group: NodeToolbarGroup;
    order: number;
    section?: string;
    description?: string;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

const imageToolDefinitions: ImageToolDefinition[] = [
    {
        id: "copyPrompt",
        section: "Generate information",
        label: "copy prompt word",
        icon: () => <Copy className="size-3.5" />,
        group: "more",
        order: 50,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        workflow: { mode: "recipe", outputType: "text" },
        section: "Generate information",
        label: "Reverse prompt word",
        icon: () => <FileText className="size-3.5" />,
        group: "more",
        order: 60,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "replace",
        label: "Replace picture",
        icon: () => <Upload className="size-3.5" />,
        group: "more",
        section: "Material",
        order: 45,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        label: "Lock aspect ratio",
        section: "Node management",
        active: (node) => !node.metadata?.freeResize,
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />),
        group: "more",
        order: 70,
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "annotation",
        workflow: { mode: "manual", reason: "The annotation needs to be hand-drawn, please enter it as a fixed reference after the canvas is completed." },
        section: "Split and mark",
        description: "Add tag, save as new image",
        label: "mark",
        icon: () => <PencilLine className="size-3.5" />,
        group: "process",
        order: 40,
        run: (node, handlers) => handlers.onAnnotate(node),
    },
    {
        id: "maskEdit",
        workflow: { mode: "recipe", outputType: "image" },
        label: "partial redraw",
        description: "Paint the area to be modified and generate a new picture",
        icon: () => <Brush className="size-3.5" />,
        group: "primary",
        order: 10,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "emotion",
        workflow: { mode: "recipe", outputType: "image" },
        label: "Expression adjustment",
        section: "Portrait adjustment",
        description: "Adjust character expressions and generate new pictures",
        icon: () => <Smile className="size-3.5" />,
        group: "portrait",
        order: 50,
        run: (node, handlers) => handlers.onEmotion(node),
    },
    {
        id: "portraitTexture",
        workflow: { mode: "recipe", outputType: "image" },
        label: "Texture adjustment",
        section: "Portrait adjustment",
        description: "Set skin texture, lighting and blending, and then execute generation",
        icon: () => <SlidersHorizontal className="size-3.5" />,
        group: "portrait",
        order: 60,
        run: (node, handlers) => handlers.onPortraitTexture(node),
    },
    {
        id: "crop",
        workflow: { operationId: "image.crop", outputType: "image" },
        label: "Cut",
        section: "Composition and size",
        description: "Keep the selected area and generate a new picture",
        icon: () => <Crop className="size-3.5" />,
        group: "process",
        order: 10,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        workflow: { operationId: "image.split", outputType: "image" },
        label: "Palace division",
        section: "Split and mark",
        description: "Split into multiple image nodes by row and column",
        icon: () => <Grid2x2 className="size-3.5" />,
        group: "process",
        order: 45,
        run: () => undefined,
    },
    {
        id: "upscale",
        workflow: { operationId: "image.resize", outputType: "image" },
        label: "resize",
        section: "Composition and size",
        description: "Interpolation enlarges pixel size, not AI super resolution",
        icon: () => <Scaling className="size-3.5" />,
        group: "process",
        order: 20,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "angle",
        workflow: { mode: "recipe", outputType: "image" },
        label: "multiple angles",
        section: "perspective",
        description: "Adjust the camera angle to create a new perspective",
        icon: () => <Camera className="size-3.5" />,
        group: "viewpoint",
        order: 20,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "lighting",
        workflow: { mode: "recipe", outputType: "image" },
        label: "Lighting",
        section: "perspective",
        description: "Adjust light direction, brightness and light effects to generate new pictures",
        icon: () => <Sun className="size-3.5" />,
        group: "lighting",
        order: 30,
        run: (node, handlers) => handlers.onLighting(node),
    },
    {
        id: "view",
        label: "Preview",
        icon: () => <Maximize2 className="size-3.5" />,
        group: "utility",
        order: 10,
        run: (node, handlers) => handlers.onViewImage(node),
    },
    {
        id: "panorama",
        workflow: { mode: "recipe", outputType: "image" },
        label: "Panorama",
        section: "perspective",
        description: "Create a 360° panoramic view node based on the image",
        icon: () => <Globe2 className="size-3.5" />,
        group: "panorama",
        order: 80,
        run: (node, handlers) => handlers.onPanorama(node),
    },
];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.label, node),
        icon: tool.icon(node),
        group: tool.group,
        order: tool.order,
        section: tool.section,
        description: tool.description,
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers),
    }));
}

export function listImageWorkflowTools(node: CanvasNodeData) {
    return imageToolDefinitions.filter(tool => tool.workflow || ["process", "portrait", "viewpoint", "lighting", "panorama"].includes(tool.group)).map(tool => ({
        id: `image.${tool.id}`, label: resolveToolText(tool.label, node), icon: tool.icon(node),
        workflow: tool.workflow || { mode: "manual" as const }, description: tool.description,
    }));
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : value;
}
