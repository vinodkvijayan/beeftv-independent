import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("settings page focuses on channel and model configuration", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/pages/settings/index.tsx"), "utf8");
    expect(source).not.toContain("Creative preferences");
    expect(source).not.toContain("Configure default models, generation parameters and material storage.");
    expect(source).not.toContain("audio defaults");
    expect(source).not.toContain("audio commands");
    expect(source).not.toContain("Default audio command");
    expect(source).toContain("ChannelSettingsPane");
    expect(source).toContain("ModelDefaultGrid");
});

test("wallet tabs and preference blocks keep a visible gap from neighboring surfaces", () => {
    const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    expect(css).toContain(".workspace-wallet-tabs {");
    expect(css).toContain("margin: 12px 24px 0;");
    expect(css).toContain("margin: 16px 24px 24px;");
    expect(css).toContain(".settings-preference-heading { margin-bottom: var(--space-5); }");
    expect(css).toContain(".app-user-workspace.settings-page .settings-preference-block {\n    padding: 20px 20px 12px;");
});
