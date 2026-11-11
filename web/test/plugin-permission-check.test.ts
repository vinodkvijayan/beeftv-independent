import { afterAll, describe, expect, it } from "bun:test";

import {
    EDITOR_SLOT_REQUIRED_PERMISSION,
    assertEditorPermission,
    checkEditorPermission,
    pluginMayRenderEditorSlot,
    pluginPermissions,
    requiredPermissionForEditorSlot,
} from "@/lib/plugins/plugin-permission-check";
import { registerPlugin, unregisterPlugin } from "@/lib/plugins/plugin-registry";
import type { RegisteredPlugin } from "@/lib/plugins/plugin-types";

const ALL_SLOTS = [
    "timeline-panel",
    "preview-renderer",
    "inspector",
    "asset-ingest",
    "subtitle-tool",
    "transcription-provider",
    "export-renderer",
    "ai-assistant",
] as const;

function fakePlugin(id: string, permissions: string[], slots: string[]): RegisteredPlugin {
    return {
        manifest: {
            apiVersion: "beeftv.plugin/v2",
            id,
            name: id,
            version: "0.0.1",
            description: "M5 test plug-in",
            author: "test",
            surfaces: ["fullscreen"],
            permissions,
            trusted: false,
            runtime: { backend: "trusted-backend", web: "declarative" },
            contributes: { editorSlots: slots.map((slot) => ({ slot })) },
        },
    };
}

const FAKE_READ_ONLY_ID = "m5-test-read-only";
const FAKE_FULL_ID = "m5-test-full";

afterAll(() => {
    unregisterPlugin(FAKE_READ_ONLY_ID);
    unregisterPlugin(FAKE_FULL_ID);
});

describe("M5 permission table", () => {
    it("Each of the 8 slots has the exact required permissions", () => {
        // Record<EditorSlotKind, ...> 类型已保证键完整；运行期再兜底验证值与域合法。
        const expected: Record<(typeof ALL_SLOTS)[number], string> = {
            "timeline-panel": "timeline.command",
            "preview-renderer": "timeline.read",
            inspector: "timeline.command",
            "asset-ingest": "timeline.command",
            "subtitle-tool": "timeline.command",
            "transcription-provider": "timeline.command",
            "export-renderer": "export.run",
            "ai-assistant": "timeline.read",
        };
        for (const slot of ALL_SLOTS) {
            expect(EDITOR_SLOT_REQUIRED_PERMISSION[slot]).toBe(expected[slot]);
            expect(requiredPermissionForEditorSlot(slot)).toMatch(/^(timeline\.read|timeline\.command|export\.run)$/);
        }
    });
});

describe("checkEditorPermission（fail-closed）", () => {
    it("Empty permission set denied", () => {
        expect(checkEditorPermission(null, "timeline.read")).toBe(false);
        expect(checkEditorPermission(new Set<string>(), "timeline.read")).toBe(false);
    });
    it("If the statement contains necessary permissions, it will be allowed; if it lacks, it will be rejected.", () => {
        expect(checkEditorPermission(new Set(["timeline.command"]), "timeline.command")).toBe(true);
        expect(checkEditorPermission(new Set(["timeline.read"]), "timeline.command")).toBe(false);
    });
});

describe("pluginMayRenderEditorSlot", () => {
    it("Unregistered plug-in fail-closed refuses to render", () => {
        expect(pluginMayRenderEditorSlot("m5-test-ghost", "inspector")).toEqual({
            allowed: false,
            reason: "plugin-not-registered",
            missing: null,
        });
    });
    it("Registered but lacks permissions → refuse to render and point out missing permissions", () => {
        // 贡献 preview-renderer（只需 timeline.read）但想渲染 inspector（需 timeline.command）
        registerPlugin(fakePlugin(FAKE_READ_ONLY_ID, ["timeline.read"], ["preview-renderer"]));
        expect(pluginMayRenderEditorSlot(FAKE_READ_ONLY_ID, "inspector")).toEqual({
            allowed: false,
            reason: "missing-permission",
            missing: "timeline.command",
        });
        // 只读插槽（preview-renderer）它反而有权限 → 放行，证明不是全量封杀
        expect(pluginMayRenderEditorSlot(FAKE_READ_ONLY_ID, "preview-renderer").allowed).toBe(true);
    });
    it("Complete permissions → Release", () => {
        registerPlugin(
            fakePlugin(FAKE_FULL_ID, ["timeline.read", "timeline.command", "export.run"], ["export-renderer"]),
        );
        for (const slot of ALL_SLOTS) {
            expect(pluginMayRenderEditorSlot(FAKE_FULL_ID, slot).allowed).toBe(true);
        }
    });
});

describe("assertEditorPermission (command generation assertion)", () => {
    it("Not registered → throw error", () => {
        expect(() => assertEditorPermission("m5-test-ghost", "timeline.command")).toThrow(/未注册/);
    });
    it("Lack of permission → throw error", () => {
        expect(() => assertEditorPermission(FAKE_READ_ONLY_ID, "timeline.command")).toThrow(/缺少 timeline\.command/);
    });
    it("Complete permissions → Passed (not thrown)", () => {
        expect(() => assertEditorPermission(FAKE_FULL_ID, "export.run")).not.toThrow();
    });
});

describe("editor-shell true return (the editor must not self-block after M5.2 is connected)", () => {
    // import 副作用注册 editor-shell；其 manifest 权限必须覆盖全部 8 个插槽的最小权限表。
    it("All 8 slots of editor-shell can be rendered", async () => {
        await import("@/lib/plugins/builtin/editor/editor-shell");
        const permissions = pluginPermissions("editor-shell");
        expect(permissions).not.toBeNull();
        for (const slot of ALL_SLOTS) {
            const verdict = pluginMayRenderEditorSlot("editor-shell", slot);
            expect(verdict.allowed, `editor-shell rendering${slot} should be allowed`).toBe(true);
        }
    });
});
