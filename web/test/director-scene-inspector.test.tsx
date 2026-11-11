import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorSceneInspector } from "@/components/canvas/director/director-scene-inspector";
import { createDirectorSceneFromTemplate } from "@/lib/canvas/director/director-templates";

describe("Director's desk scene properties", () => {
    test("Scene page provides recognizable sky, lighting and grid controls", () => {
        const markup = renderToStaticMarkup(<DirectorSceneInspector scene={createDirectorSceneFromTemplate("empty")} onChange={() => {}} />);
        expect(markup).toContain("3D scene");
        expect(markup).toContain("sky color");
        expect(markup).toContain("ambient brightness");
        expect(markup).toContain("show grid");
        expect(markup).toContain('aria-label="Show grid"');
        expect(markup).toContain('aria-label="Show ground"');
        expect(markup).toContain('aria-label="Ground transparency"');
        expect(markup).toContain('aria-label="ground height"');
        expect(markup).toContain('aria-label="Scene zoom"');
        for (const axis of ["X", "Y", "Z"]) {
            expect(markup).toContain(`aria-label="Scene pan${axis}"`);
            expect(markup).toContain(`aria-label="Scene rotation${axis}"`);
        }
        expect(markup.indexOf('aria-label="Scene change"')).toBeLessThan(markup.indexOf('aria-label="Panoramic background"'));
        expect(markup).toContain('aria-label="role label"');
        expect(markup.indexOf('aria-label="role label"')).toBeGreaterThan(markup.indexOf('aria-label="Panorama Sphere"'));
    });

    test("Character labels are displayed by default in old scenes and can be explicitly turned off in new scenes.", () => {
        const scene = createDirectorSceneFromTemplate("empty");
        delete scene.labelsVisible;
        const legacy = renderToStaticMarkup(<DirectorSceneInspector scene={scene} onChange={() => {}} />);
        expect(legacy).toMatch(/<button(?=[^>]*aria-label="角色标签")(?=[^>]*aria-checked="true")[^>]*>/);
        const hidden = renderToStaticMarkup(<DirectorSceneInspector scene={{ ...scene, labelsVisible: false }} onChange={() => {}} />);
        expect(hidden).toMatch(/<button(?=[^>]*aria-label="角色标签")(?=[^>]*aria-checked="false")[^>]*>/);
    });

    test("Directly after the scene title are the transform controls, and the sky color can be entered from the color block or hexadecimal", () => {
        const scene = createDirectorSceneFromTemplate("empty");
        scene.background = "#060608";
        const markup = renderToStaticMarkup(<DirectorSceneInspector scene={scene} onChange={() => {}} />);
        expect(markup).not.toMatch(/<h3[^>]*>场景变换<\/h3>/);
        expect(markup).toMatch(/<input[^>]*type="color"[^>]*value="#060608"/);
        expect(markup).toMatch(/<input[^>]*aria-label="天空颜色色值"[^>]*value="060608"/);
    });
});
