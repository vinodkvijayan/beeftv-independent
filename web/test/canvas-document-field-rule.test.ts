import { describe, expect, test } from "bun:test";

import { canvasContentSnapshot, sameCanvasContent, sameCanvasDocument } from "@/lib/canvas/canvas-content";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

function project(patch: Record<string, unknown> = {}): CanvasProject {
    return {
        id: "c1",
        revision: 3,
        title: "canvas",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...patch,
    } as unknown as CanvasProject;
}

// 字段覆盖：任何文档字段的本地差异都必须被判为「有未确认编辑」。
// 旧实现用七字段白名单，folderId/projectId/canvasTitle 这类字段的编辑会被静默漏判。
const DOCUMENT_FIELD_CASES: Array<[string, Record<string, unknown>]> = [
    ["title", { title: "changed title" }],
    ["folderId", { folderId: "folder-1" }],
    ["projectId", { projectId: "domain-project" }],
    ["canvasTitle", { canvasTitle: "canvas alias" }],
    ["workspaceProjectId", { workspaceProjectId: "ws-2" }],
    ["nodes", { nodes: [{ id: "n1", type: "text", title: "node", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} }] }],
    ["connections", { connections: [{ id: "e1", fromNodeId: "n1", toNodeId: "n2" }] }],
    ["chatSessions", { chatSessions: [{ id: "s1", title: "session", messages: [] }] }],
    ["activeChatId", { activeChatId: "s1" }],
    ["timeline", { timeline: { version: 2, tracks: [], clips: [], durationMs: 0 } }],
    ["directorScenes", { directorScenes: [{ id: "scene-1" }] }],
    ["starterMode", { starterMode: "short-drama" }],
];

describe("Field rules for sameCanvasDocument", () => {
    for (const [field, patch] of DOCUMENT_FIELD_CASES) {
        test(`${field} Local differences must be identified`, () => {
            expect(sameCanvasDocument(project(), project(patch))).toBe(false);
        });
    }

    test("Native viewing preferences and server-side metadata do not constitute document editing", () => {
        expect(sameCanvasDocument(project(), project({ appearance: { mode: "light" } }))).toBe(true);
        expect(sameCanvasDocument(project(), project({ backgroundMode: "dots" }))).toBe(true);
        expect(sameCanvasDocument(project(), project({ showImageInfo: true }))).toBe(true);
        expect(sameCanvasDocument(project(), project({ viewport: { x: 900, y: -20, k: 2 } }))).toBe(true);
        expect(sameCanvasDocument(project(), project({ updatedAt: "2099-01-01T00:00:00.000Z" }))).toBe(true);
        expect(sameCanvasDocument(project(), project({ revision: 99 }))).toBe(true);
    });

    test("Documents written externally with missing fields will not be judged as having unconfirmed edits due to native appearance preferences or empty defaults", () => {
        // 服务端/外部入口产出的画布可能完全没有外观、背景与会话数组。
        const external = { id: "c1", revision: 5, title: "canvas", nodes: [], connections: [] } as unknown as CanvasProject;
        const local = project({ appearance: { mode: "dark" }, backgroundMode: "grid", showImageInfo: true, chatSessions: [], activeChatId: null, directorScenes: [] });
        expect(sameCanvasDocument(external, local)).toBe(true);
    });

    test("Missing fields are only equivalent when the other is null: all non-null values are counted as differences.", () => {
        const withoutFolder = project();
        delete (withoutFolder as unknown as Record<string, unknown>).folderId;

        // 本地把画布移进文件夹（服务端这一版还没有该字段）→ 必须识别为用户编辑。
        expect(sameCanvasDocument(withoutFolder, project({ folderId: "folder-9" }))).toBe(false);
        // 服务端有文件夹、本地缺字段 → 同样必须识别。
        expect(sameCanvasDocument(project({ folderId: "folder-9" }), withoutFolder)).toBe(false);
        // 空字符串文件夹等价于没有文件夹。
        expect(sameCanvasDocument(withoutFolder, project({ folderId: "" }))).toBe(true);
    });

    test("Equality when the document content is consistent, distinguished from the entire content comparison (sameCanvasContent)", () => {
        const base = project();
        expect(sameCanvasDocument(base, project({ viewport: { x: 5, y: 5, k: 1 } }))).toBe(true);
        expect(sameCanvasContent(base, project({ viewport: { x: 5, y: 5, k: 1 } }))).toBe(true);
        // 外观差异：整份内容比较会判为不同，文档比较按本机偏好容忍。
        expect(sameCanvasContent(base, project({ backgroundMode: "dots" }))).toBe(false);
        expect(sameCanvasDocument(base, project({ backgroundMode: "dots" }))).toBe(true);
    });

    test("canvasContentSnapshot is still the only source of rejected fields (viewport/timestamp/revision/remote hash)", () => {
        const snapshot = canvasContentSnapshot(project({ viewport: { x: 1, y: 1, k: 1 }, revision: 42 }));
        expect("viewport" in snapshot).toBe(false);
        expect("updatedAt" in snapshot).toBe(false);
        expect("revision" in snapshot).toBe(false);
        expect("remoteContentHash" in snapshot).toBe(false);
    });
});
