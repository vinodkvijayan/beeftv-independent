import { expect, test } from "bun:test";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("assets history keeps LibTV source tabs and local media filtering", async () => {
    const [page, styles, finalLock, shell] = await Promise.all([source("../src/pages/assets/index.tsx"), source("../src/styles/assets-frame-lock.css"), source("../src/styles/assets-final-lock.css"), source("../src/components/layout/app-top-nav.tsx")]);
    expect(page).toContain('searchParams.get("tab") === "history"');
    expect(page).toContain('navigate("/assets?tab=history")');
    expect(page).toContain('"Generate History"');
    for (const label of ["All", "pictures", "video", "Audio"]) expect(page).toContain(label);
    for (const label of ["All ratings", "Rated", "Not rated"]) expect(page).not.toContain(label);
    expect(page).toContain("generation-history-preview");
    expect(page).toContain("generation-history-badge");
    expect(styles).toContain(".app-workspace-shell:has(.assets-library-page)");
    expect(styles).not.toContain(".assets-reference-announcement");
    expect(styles).not.toContain("height: 60px");
    expect(styles).toContain(".generation-history-card");
    expect(finalLock).toContain("padding-top: 0");
    expect(shell).not.toContain("assets-reference-countdown");
    expect(shell).not.toContain("Double holiday privileges");
});
