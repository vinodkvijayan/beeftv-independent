import { App } from "antd";
import { CanvasDeleteConfirmation } from "./canvas-delete-confirmation";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { deleteWorkspaceCanvasProjects } from "@/services/workspace-project-repository";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const deletionLabel = isLocalWorkspaceMode() ? "local canvas" : "canvas";
    const confirm = async () => {
        const selected = [...useCanvasUiStore.getState().deleteProjectIds];
        if (!selected.length) return;
        await deleteWorkspaceCanvasProjects(selected);
        void cleanupImages();
        removeSelectedIds(selected);
        message.success(`Deleted${selected.length} a${deletionLabel}`);
    };
    if (!ids.length) return null;
    return <CanvasDeleteConfirmation title={`Delete${deletionLabel}？`}
        description={`will be deleted${ids.length} a${deletionLabel}, the nodes and connections inside will also be removed together.`}
        onCancel={() => setDeleteIds([])} onConfirm={confirm} />;
}
