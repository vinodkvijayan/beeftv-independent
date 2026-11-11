import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorViewToolbar } from "@/components/canvas/director/director-view-toolbar";

describe("Director's desk framing level", () => {
    test("The director/camera position is the main operation, and the five orthogonal axes can be found in the direction ball.", () => {
        const markup = renderToStaticMarkup(<DirectorViewToolbar viewMode="free" onViewModeChange={() => {}} />);
        expect(markup).toContain("Director's perspective");
        expect(markup).toContain("camera angle");
        expect(markup).toContain('aria-label="directional ball"');
        for (const label of ["looking down", "Face it squarely", "dorsal view", "left view", "right view", "Reset perspective"]) expect(markup).toContain(`aria-label="${label}"`);
        expect(markup).not.toContain('aria-label="below"');
    });
});
