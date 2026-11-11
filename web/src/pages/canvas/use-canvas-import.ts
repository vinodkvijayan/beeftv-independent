import { useCallback, useRef } from "react";
import { appendCanvasImport } from "@/lib/canvas/canvas-import-snapshot";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { useCanvasDocumentState } from "./use-canvas-document-state";
import type { useCanvasProjectLifecycle } from "./use-canvas-project-lifecycle";
import { CanvasOwnerAbandonedError, useCanvasOwnerLifetime } from "./canvas-owner-epoch";
import { createCanvasMediaOperation } from "./canvas-media-operation";

type Options = {
    projectId: string;
    document: ReturnType<typeof useCanvasDocumentState>;
    saveCanvasProject: ReturnType<typeof useCanvasProjectLifecycle>["saveCanvasProject"];
};

export function useCanvasImport({ projectId, document, saveCanvasProject }: Options) {
    const { nodesRef, connectionsRef, setNodes, setConnections } = document;
    const canvasIdRef = useRef(projectId);
    canvasIdRef.current = projectId;
    const { lifetime, mountedRef } = useCanvasOwnerLifetime(projectId);
    const applyCanvasImport = useCallback(
        async (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[], sourceLabel: string) => {
            const operation = createCanvasMediaOperation(lifetime, projectId, () => canvasIdRef.current, () => mountedRef.current);
            const previous = { nodes: nodesRef.current, connections: connectionsRef.current };
            const next = appendCanvasImport(previous, importedNodes, importedConnections);
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            setNodes(next.nodes);
            setConnections(next.connections);
            const saved = await saveCanvasProject({ requireRemote: false });
            if (!operation.isCurrent()) throw new CanvasOwnerAbandonedError();
            if (!saved) {
                nodesRef.current = previous.nodes;
                connectionsRef.current = previous.connections;
                setNodes(previous.nodes);
                setConnections(previous.connections);
                throw new Error(`Canvas save failed, this time has been cancelled.${sourceLabel} import`);
            }
        },
        [saveCanvasProject, setConnections, setNodes, nodesRef, connectionsRef, lifetime, projectId, mountedRef],
    );
    const applyLibTVImport = useCallback(
        (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => applyCanvasImport(importedNodes, importedConnections, "LibTV"),
        [applyCanvasImport],
    );
    const applyTapNowImport = useCallback(
        (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => applyCanvasImport(importedNodes, importedConnections, "TapNow"),
        [applyCanvasImport],
    );
    return { applyLibTVImport, applyTapNowImport };
}
