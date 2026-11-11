import { describe, expect, test } from "bun:test";

import { rebaseCanvasProjects, parseCanvasStorageDocument } from "../src/lib/canvas/canvas-storage-revision";

const tombstones = () => ({ projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} });

/**
 * 外部写入（内置助手、CLI/MCP 操作层）直接写画布文档，产出的记录常常只有
 * nodes/connections，没有 chatSessions，会话也可能没有 messages。
 * 这种文档进入本地合并时不能把整次持久化打挂，否则界面上的外部改动永远落不下来。
 */
describe("Canvas documents produced by external writing can be safely merged", () => {
    test("Projects missing chatSessions are merged as usual", () => {
        const document = parseCanvasStorageDocument(JSON.stringify({
            state: { projects: [{ id: "c1", revision: 1, title: "external canvas", nodes: [{ id: "n1" }], connections: [] }] },
            version: 0,
            storageRevision: 3,
            tombstones: tombstones(),
        }));
        const external = { id: "c1", revision: 2, title: "external name change", nodes: [{ id: "n1" }, { id: "n2" }], connections: [] } as never;

        const result = rebaseCanvasProjects({ document, baseProjects: document.state.projects, localProjects: [external], baseRevision: 3 });

        expect(result.document.state.projects).toHaveLength(1);
        expect(result.document.state.projects[0].title).toBe("external name change");
        expect(result.document.state.projects[0].nodes).toHaveLength(2);
    });

    test("No error is thrown when the session is missing the messages field", () => {
        const document = parseCanvasStorageDocument(null, []);
        const local = {
            id: "c1",
            revision: 0,
            title: "canvas",
            nodes: [],
            connections: [],
            chatSessions: [{ id: "s1", title: "dialogue" }],
            activeChatId: "s1",
        } as never;

        const result = rebaseCanvasProjects({ document, baseProjects: [], localProjects: [local], baseRevision: 0 });

        expect(result.document.state.projects[0].chatSessions).toHaveLength(1);
        expect(result.document.state.projects[0].chatSessions[0].messages).toEqual([]);
    });

    test("When the project lacks the nodes/connections array, it is treated as an empty collection.", () => {
        const document = parseCanvasStorageDocument(null, []);
        const local = { id: "c1", revision: 0, title: "only title" } as never;

        const result = rebaseCanvasProjects({ document, baseProjects: [], localProjects: [local], baseRevision: 0 });

        expect(result.document.state.projects[0].nodes).toEqual([]);
        expect(result.document.state.projects[0].connections).toEqual([]);
    });
});
