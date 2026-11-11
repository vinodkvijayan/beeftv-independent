import React, { useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodeContent } from "../../src/components/canvas/canvas-node-content";
import { canvasThemes } from "../../src/lib/canvas-theme";
import { CanvasNodeType } from "../../src/types/canvas";
import { AssetMediaPreview } from "../../src/components/asset-media-preview";
import { AssetVideoPreview } from "../../src/pages/assets";
import { CanvasAssistantAttachments } from "../../src/pages/canvas/canvas-assistant-attachments";
import { EditorPreviewMonitor } from "../../src/lib/plugins/builtin/editor/editor-preview-monitor";
import { EditorStoreProvider } from "../../src/components/editor/editor-context";
import { createEditorStore } from "../../src/stores/editor/editor-store";
import { normalizeTimelineProject } from "../../src/lib/timeline/timeline-tracks";

function Harness() {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const surface = new URLSearchParams(location.search).get("surface");
    const store = useMemo(() => {
        const created = createEditorStore({ saveTimeline: async () => {} });
        created.getState().load(normalizeTimelineProject({ version: 2, durationMs: 400,
            tracks: [{ id: "video-track", kind: "video", label: "video", order: 0 }],
            clips: [{ id: "clip", nodeId: "video", trackId: "video-track", kind: "video", startMs: 0, durationMs: 400,
                directMedia: { id: "video", title: "video", kind: "video", storageKey: "resource:video", url: "/api/resources/video/file" } }] }));
        return created;
    }, []);
    if (surface === "editor") return <EditorStoreProvider store={store} host={{ projectId: "project", assets: [], refreshAssets: async () => [] }}><EditorPreviewMonitor /></EditorStoreProvider>;
    if (surface === "attachment") return <CanvasAssistantAttachments attachments={[{ resourceId: "video", kind: "video", name: "video", mimeType: "video/mp4", bytes: 100, purpose: "analysis" }]} />;
    if (surface === "drawer") return <AssetVideoPreview storageKey="resource:video" url="/api/resources/video/file" title="video" className="" />;
    if (surface === "thumbnail") return <AssetMediaPreview alt="video" asset={{ id: "video", kind: "video", title: "video", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { storageKey: "resource:video", url: "/api/resources/video/file", width: 64, height: 48, bytes: 100, mimeType: "video/mp4" } }} />;
    return <div style={{ width: 320, height: 240 }}><CanvasNodeContent
        node={{ id: "video", title: "Video preview", type: CanvasNodeType.Video, width: 320, height: 240, position: { x: 0, y: 0 }, metadata: { content: "/api/resources/video/file", storageKey: "resource:video", status: "success", mimeType: "video/mp4" } }}
        theme={canvasThemes.light} mediaActive isEditingContent={false} textareaRef={textareaRef} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} onContentChange={() => {}} onStopEditing={() => {}} mentionReferences={[]}
    /></div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
