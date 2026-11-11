import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { DirectorPreviewComposer } from "@/components/canvas/director/director-preview-composer";

const workbench = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

describe("Director's station finished film preview input bar", () => {
    test("Rehearsal provides current shot intent input and writes changes back to the current shot", () => {
        const markup = renderToStaticMarkup(createElement(DirectorPreviewComposer, { prompt: "", onPromptChange: () => {} }));
        expect(workbench).toContain("<DirectorPreviewComposer");
        expect(workbench).toContain("prompt={activeShot.prompt}");
        expect(workbench).toContain("onPromptChange={(prompt) => replaceWithoutHistory");
        expect(markup).toContain('aria-label="Current lens intent"');
        expect(markup).toContain("Select an element or camera position to describe the action and narrative intent of the current shot.");
    });

    test("Mise-en-scène provides shot description, adding references and submitting current composition entries", () => {
        const markup = renderToStaticMarkup(createElement(DirectorPreviewComposer, { intent: "scene", prompt: "", onPromptChange: () => {} }));
        expect(markup).toContain('aria-label="Scene description"');
        expect(markup).toContain('placeholder="Describe the scene you want to build"');
        expect(markup).toContain('aria-label="Add scene reference picture"');
        expect(markup).toContain('aria-label="Send current scene to canvas"');
    });

    test("Preview hides the director's perspective and directional ball tools, but the viewport retains the selected framing mode", () => {
        expect(workbench).toContain('onViewModeChange={workspaceView === "scene" ? changeViewportMode : undefined}');
    });

    test("The desktop size of the scene director's operation bar is aligned with LibTV's compact input box, and the narrow screen falls back to the stacked layout.", () => {
        expect(styles).toMatch(/\.director-scene-control-bar\s*\{[^}]*width:\s*min\(360px,/s);
        expect(styles).toMatch(/\.director-scene-composer\s*\{[^}]*height:\s*48px;[^}]*flex:\s*0 0 224px;/s);
        expect(styles).toMatch(/grid-template-columns:\s*32px minmax\(0, 1fr\) 32px;/);
        expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.director-scene-composer\s*\{[^}]*width:\s*100%;/);
    });

    test("Scene operations are implemented through the existing local image and canvas write-back capabilities. The preview input does not display scene operations.", () => {
        const sceneMarkup = renderToStaticMarkup(createElement(DirectorPreviewComposer, { intent: "scene", prompt: "", onPromptChange: () => {}, onAddReference: () => {}, onSubmit: () => {} }));
        const previewMarkup = renderToStaticMarkup(createElement(DirectorPreviewComposer, { prompt: "", onPromptChange: () => {} }));
        expect(sceneMarkup).toContain('aria-label="Add scene reference picture"');
        expect(sceneMarkup).toContain('aria-label="Send current scene to canvas"');
        expect(sceneMarkup).toContain('aria-label="Scene description"');
        expect(previewMarkup).not.toContain('aria-label="Add scene reference picture"');
        expect(workbench).toContain('onSubmit={() => void applyToCanvas()}');
        expect(workbench).toContain('onAddReference={() => sceneReferenceInputRef.current?.click()}');
        expect(workbench).toContain('createDirectorBillboard(name, uploaded.url, uploaded.storageKey)');
    });
});
