import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasTopBar } from "@/pages/canvas/canvas-project-top-bar";

test("CanvasTopBar keeps sync conflicts visible in the compact chrome without redundant view switches", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(<CanvasTopBar
        libtvChrome syncStatus={<button>Canvas has been updated elsewhere · Use the latest version</button>}
        workspaceView="workflow" onWorkspaceViewChange={noop} versionsOpen={false} onToggleVersions={noop}
        title="Unnamed workspace" titleDraft="Unnamed workspace" isTitleEditing={false} onTitleDraftChange={noop} onStartTitleEditing={noop} onFinishTitleEditing={noop} onCancelTitleEditing={noop}
        canUndo={false} canRedo={false} onCreateCanvas={noop} onDeleteProject={noop} onSave={noop} onForceSave={noop} onImportImage={noop} onImportLibTV={noop} onImportTapNow={noop} onUndo={noop} onRedo={noop}
        shortcutRequestNonce={0} mediaPerformanceMode="auto" onMediaPerformanceModeChange={noop} onOpenSearch={noop} onEnterFocusMode={noop}
    />);

    expect(html).not.toContain('aria-label="Workflow"');
    expect(html).not.toContain('aria-label="storyboard"');
    expect(html).toContain("Canvas has been updated elsewhere · Use the latest version");
});
