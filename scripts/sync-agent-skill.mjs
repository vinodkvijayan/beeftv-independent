#!/usr/bin/env bun
// Copies the single editable canvas skill into the backend's embed directory.
// The plugin copy is the source of truth; the backend copy is a build artifact.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "plugins", "beeftv-skills", "skills", "beeftv-canvas", "SKILL.md");
const target = join(root, "backend", "internal", "agentconnect", "skilldata", "SKILL.md");

if (!existsSync(source)) {
    console.error(`Missing normative skills:${source}`);
    process.exit(1);
}

const check = process.argv.includes("--check");
if (check) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== readFileSync(source, "utf8")) {
        console.error("Backend embedded skills are inconsistent with canonical skills; run bun scripts/sync-agent-skill.mjs");
        process.exit(1);
    }
    console.log("The skill copies are consistent.");
    process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Synced skills:${target}`);
