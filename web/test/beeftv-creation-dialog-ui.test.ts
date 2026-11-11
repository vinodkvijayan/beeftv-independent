import { expect, test } from "bun:test";

const page = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const composer = await Bun.file(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url)).text();
const styles = await Bun.file(new URL("../src/pages/create/creation-product.css", import.meta.url)).text();
const creationTypes = await Bun.file(new URL("../src/pages/create/creation-types.ts", import.meta.url)).text();

test("BeefTV creation dialog uses the simplified composer controls", () => {
    expect(page).toContain("Create with {brandName}");
    expect(page).not.toContain("Agent creates together");
    expect(page).not.toContain("Start with an image, a character, or a sentence");
    expect(composer).toContain("creation-chat-reference-add");
    expect(composer).toContain('className="creation-submit is-icon-only"');
    expect(composer).not.toContain('<span>{showWorkingSpinner ? "生成中" : "开始创作"}</span>');
    expect(styles).toContain("creation-submit.is-icon-only");
});

test("New creation sessions use LibTV video mode by default", () => {
    expect(creationTypes).toContain('export const defaultCreationMode: CreationMode = "video";');
});
