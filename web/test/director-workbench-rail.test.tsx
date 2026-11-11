import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorWorkbenchRail } from "@/components/canvas/director/director-workbench-rail";

describe("Director's desk left navigation", () => {
    test("All visible entrances have names and the current entrance is clearly marked", () => {
        const markup = renderToStaticMarkup(<DirectorWorkbenchRail active="scene" onChange={() => {}} onHelp={() => {}} />);
        for (const label of ["scene", "Add role", "Add a seat", "Choose aspect ratio", "AI image recognition import"]) expect(markup).toContain(`aria-label="${label}"`);
        expect(markup).toContain('aria-label="scenario" aria-pressed="true"');
        expect(markup).toContain('aria-label="Add role" aria-pressed="false"');
        expect(markup).toContain('aria-label="Help and shortcut keys"');
        expect(markup).toContain('data-director-rail-help="true"');
        expect(markup).toContain('class="h-2 w-8 border-b"');
        expect(markup).toContain('class="flex size-8 items-center justify-center');
    });
});
