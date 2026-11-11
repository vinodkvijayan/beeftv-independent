import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { creationConflictPreview } from "../src/pages/create/creation-conflict";

test("conflict preview uses last user text without inventing a title", () => {
    expect(creationConflictPreview({ title: "  ", messages: [] })).toEqual({
        title: "Unnamed conversation",
        messageCount: 0,
        excerpt: "No text yet",
    });
    expect(creationConflictPreview({
        title: "lens",
        messages: [
            { role: "user", content: "first sentence" },
            { role: "assistant", content: "Reply" },
            { role: "user", content: "  The last sentence is quite long and needs to be cut into a preview" },
        ],
    })).toEqual({
        title: "lens",
        messageCount: 3,
        excerpt: "The last sentence is quite long and needs to be cut into a preview",
    });
});

test("conflict UI copy is concrete Chinese actions without implementation jargon", () => {
    const conflictUi = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-conflict.tsx"), "utf8");
    const createPage = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
    expect(conflictUi).toContain("This conversation is different from the saved version. Look at both sides before deciding which one to use.");
    expect(conflictUi).toContain("look both sides");
    expect(conflictUi).toContain("Use saved version");
    expect(conflictUi).toContain("Replace the saved version with this draft");
    expect(conflictUi).toContain("Don't deal with it yet");
    expect(conflictUi).toContain("Changed to saved version. The draft just now is still there, you can change it back again.");
    expect(conflictUi).toContain("Restore the previous draft");
    expect(conflictUi).toContain("There are two versions");
    expect(conflictUi).not.toContain("CAS");
    expect(conflictUi).not.toContain("IndexedDB");
    expect(conflictUi).not.toContain("far end");
    expect(conflictUi).not.toContain("conflictRemote");
    expect(createPage).toContain("CreationConflictBanner");
    expect(createPage).toContain("resolveConflictIds");
    expect(createPage).toContain("acceptSavedCreationConversation");
    expect(createPage).toContain("restoreParkedCreationConversation");
    expect(createPage).toContain("Unable to switch to saved version");
    expect(createPage).toContain("This draft was not saved successfully, the original version is still there");
});
