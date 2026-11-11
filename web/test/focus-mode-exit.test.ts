import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../src/hooks/use-focus-mode.ts", import.meta.url)).text();

test("After exiting focus mode, it cannot be reopened immediately by the small screen automatic policy", () => {
    expect(source).toContain("const focusMode = userPreference;");
    expect(source).not.toContain("const focusMode = smallScreen || userPreference;");
});
