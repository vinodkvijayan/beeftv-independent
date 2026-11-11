import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorViewportDock } from "../src/components/canvas/director/director-viewport-dock";

describe("Director's desk viewport change menu", () => {
    test("The resting state has only one transformation entry consistent with the current mode and exposes menu semantics", () => {
        for (const [mode, label] of [["translate", "move"], ["rotate", "rotate"], ["scale", "Zoom"]] as const) {
            const html = renderToStaticMarkup(createElement(DirectorViewportDock, {
                transformMode: mode,
                renderMode: "beauty",
                renderModes: ["beauty"],
                onTransformModeChange: () => {},
                onRenderModeChange: () => {},
                timelineOpen: false,
                onToggleTimeline: () => {},
                captureBusy: false,
                captureReady: true,
                onCapture: () => {},
                onExportClay: () => {},
                exportBusy: false,
                onApplyToCanvas: () => {},
                applyBusy: false,
                saveRetryable: false,
                saveRetryBusy: false,
                onRetrySave: () => {},
            }));
            expect(html).toContain(`aria-label="${label}"`);
            expect(html).toContain('aria-haspopup="menu"');
            expect(html).not.toContain('aria-label="Mobile object"');
            expect(html).not.toContain('aria-label="rotate object"');
            expect(html).not.toContain('aria-label="Scale object"');
            expect(html).not.toContain('aria-label="More viewport tools"');
            expect(html).not.toContain('aria-label="Add actor"');
            expect(html).not.toContain('aria-label="Add cube"');
            expect(html).not.toContain('aria-label="Composition preview"');
        }
    });

    test("The bottom timeline button appears pressed in the expanded state.", () => {
        for (const timelineOpen of [false, true]) {
            const html = renderToStaticMarkup(createElement(DirectorViewportDock, {
                transformMode: "translate", renderMode: "beauty", renderModes: ["beauty"],
                onTransformModeChange: () => {}, onRenderModeChange: () => {},
                timelineOpen, onToggleTimeline: () => {}, captureBusy: false, captureReady: true, onCapture: () => {},
                onExportClay: () => {}, exportBusy: false, onApplyToCanvas: () => {}, applyBusy: false,
                saveRetryable: false, saveRetryBusy: false, onRetrySave: () => {},
            }));
            expect(html).toContain(`aria-label="Animation Timeline" aria-pressed="${timelineOpen}"`);
        }
    });

    test("Three LibTV resident tools are retained, director mode and workspace status are exposed by the dock for auditing", () => {
        const html = renderToStaticMarkup(createElement(DirectorViewportDock, {
            transformMode: "translate", renderMode: "beauty", renderModes: ["beauty"],
            onTransformModeChange: () => {}, onRenderModeChange: () => {},
            timelineOpen: false, onToggleTimeline: () => {}, captureBusy: false, captureReady: true, onCapture: () => {},
            onExportClay: () => {}, exportBusy: false, onApplyToCanvas: () => {}, applyBusy: false,
            saveRetryable: false, saveRetryBusy: false, onRetrySave: () => {},
            mode: "camera", workspaceView: "preview",
        }));
        expect(html).toContain('aria-label="Director\'s desk viewport tool" data-director-mode="camera" data-workspace-view="preview"');
        expect(html).toContain('aria-label="Animation Timeline"');
        expect((html.match(/aria-label="(?:移动|截图|动画时间轴)"/g) || []).length).toBe(3);
        expect(html).not.toContain('aria-label="More viewport tools"');
    });

    test("Screenshot entry is disabled during capture to avoid repeated uploads", () => {
        const render = (captureBusy: boolean, captureReady = true) => renderToStaticMarkup(createElement(DirectorViewportDock, {
            transformMode: "translate", renderMode: "beauty", renderModes: ["beauty"],
            onTransformModeChange: () => {}, onRenderModeChange: () => {},
            timelineOpen: false, onToggleTimeline: () => {}, captureBusy, captureReady, onCapture: () => {},
            onExportClay: () => {}, exportBusy: false, onApplyToCanvas: () => {}, applyBusy: false,
            saveRetryable: false, saveRetryBusy: false, onRetrySave: () => {},
        }));
        expect(render(false)).toContain('aria-label="Screenshot"');
        expect(render(false)).not.toMatch(/aria-label="截图"[^>]*disabled/);
        expect(render(true)).toMatch(/aria-label="截图"[^>]*disabled/);
        expect(render(false, false)).toMatch(/aria-label="截图"[^>]*disabled/);
        expect(render(false, false)).toContain('title="Viewport loading"');
    });
});
