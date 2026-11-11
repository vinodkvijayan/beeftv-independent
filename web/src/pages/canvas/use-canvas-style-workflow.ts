import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import type { CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { updateProject as updateDomainProject } from "@/services/api/projects";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import { getActiveUserScope } from "@/lib/user-scope";
import type { CanvasPageUiStoreHook } from "@/stores/canvas/use-canvas-page-ui-store";

type UseCanvasStyleWorkflowOptions = {
    pageUi: CanvasPageUiStoreHook;
    canvasId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    getCanvasCenter: () => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setStylePickerOpen: Dispatch<SetStateAction<boolean>>;
};

export function useCanvasStyleWorkflow({pageUi,  canvasId, domainProjectId, nodesRef, selectedNodeIdsRef, getCanvasCenter, setNodes, setStylePickerOpen }: UseCanvasStyleWorkflowOptions) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const liveContext = useRef({ canvasId, domainProjectId, mounted: true });
    liveContext.current = { canvasId, domainProjectId, mounted: liveContext.current.mounted };
    const applyingRef = useRef(false);
    useEffect(() => { liveContext.current.mounted = true; return () => { liveContext.current.mounted = false; }; }, []);

    const applyCanvasStyle = useCallback(
        (preset: CanvasStylePreset, profileJson: string) => {
            const current = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
            const metadata: CanvasNodeMetadata = {
                content: preset.prompt,
                prompt: preset.prompt,
                status: "success",
                workflowKind: "styleboard",
                workflowTitle: "Project style",
                workflowDescription: preset.description,
                stylePresetId: preset.id,
                styleProfileJson: profileJson,
                fontSize: 14,
            };
            let styleNode: CanvasNodeData;
            if (current) {
                styleNode = { ...current, title: `Painting style ·${preset.title}`, metadata: { ...current.metadata, ...metadata } };
                nodesRef.current = nodesRef.current.map((node) => (node.id === current.id ? styleNode : node));
            } else {
                styleNode = createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), metadata);
                styleNode.title = `Painting style ·${preset.title}`;
                styleNode.width = 420;
                styleNode.height = 240;
                nodesRef.current = [...nodesRef.current, styleNode];
            }
            setNodes(nodesRef.current);
            const selection = new Set([styleNode.id]);
            selectedNodeIdsRef.current = selection;
            pageUi.getState().setSelectedNodeIds(selection);
            pageUi.getState().setSelectedConnectionId(null);
            pageUi.getState().setDialogNodeId(null);
            setStylePickerOpen(false);
            message.success(`Applied"${preset.title}" style of painting`);
        },
        [pageUi, getCanvasCenter, message, nodesRef, selectedNodeIdsRef, setNodes, setStylePickerOpen],
    );

    const persistStyleMutation = useMutation({
        mutationFn: ({ preset, profileJson }: { preset: CanvasStylePreset; profileJson: string }) => {
            if (!domainProjectId) throw new Error("Canvas has no associated project yet");
            return updateDomainProject(domainProjectId, { stylePresetId: preset.id, styleProfileJson: profileJson });
        },
    });

    const applyCanvasStyleAsync = useCallback(async (preset: CanvasStylePreset) => {
        if (applyingRef.current) throw new Error("The style is being saved, please try again later.");
        const scope = getActiveUserScope();
        applyingRef.current = true;
        try {
            const profileJson = serializeStyleProfile(preset.profile || createStyleProfileSnapshot(preset));
            if (domainProjectId) {
                await persistStyleMutation.mutateAsync({ preset, profileJson });
                void queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
            }
            if (!liveContext.current.mounted || liveContext.current.canvasId !== canvasId || liveContext.current.domainProjectId !== domainProjectId || getActiveUserScope() !== scope) throw new Error("The page or account has changed, and the painting style has not been applied to the current canvas; if the project saving has been completed, please go back to the original project to view");
            applyCanvasStyle(preset, profileJson);
        } finally { applyingRef.current = false; }
    }, [canvasId, domainProjectId, persistStyleMutation.mutateAsync, queryClient, applyCanvasStyle]);

    const selectCanvasStyle = useCallback(
        (preset: CanvasStylePreset) => {
            void applyCanvasStyleAsync(preset).catch((error) => message.error(error instanceof Error ? error.message : "Failed to save project style"));
        },
        [applyCanvasStyleAsync, message],
    );

    return { selectCanvasStyle, applyCanvasStyleAsync, styleApplying: persistStyleMutation.isPending };
}
