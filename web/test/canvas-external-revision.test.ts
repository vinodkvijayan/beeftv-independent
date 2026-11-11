import { describe, expect, test } from "bun:test";

import { decideExternalCanvasRevision } from "@/lib/canvas/canvas-external-revision";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";

function node(id: string, title: string, prompt: string): CanvasNodeData {
    return { id, type: "image", title, position: { x: 0, y: 0 }, width: 320, height: 220, metadata: { prompt } };
}

function project(patch: Partial<CanvasProject> & { id: string; revision: number }): CanvasProject {
    return {
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
    };
}

describe("Trade-offs for external new revisions", () => {
    test("Apply external content when there are no unconfirmed edits locally", () => {
        const remote = project({ id: "c1", revision: 4, title: "external name change", nodes: [node("n1", "Shot 1", "external cues")] });
        const local = project({ id: "c1", revision: 3, title: "old name" });

        const decision = decideExternalCanvasRevision({ remote, local, hasLocalEdits: false });

        expect(decision.kind).toBe("apply");
        if (decision.kind !== "apply") throw new Error("expected apply");
        expect(decision.project.title).toBe("external name change");
        expect(decision.project.revision).toBe(4);
        expect(decision.project.nodes).toHaveLength(1);
        expect(decision.remoteRevision).toBe(4);
        expect(decision.localRevision).toBe(3);
    });

    test("When there are unconfirmed edits locally, the local content is retained and the remote content is left as a candidate.", () => {
        const remote = project({ id: "c1", revision: 9, title: "external name change", nodes: [node("n1", "Shot 1", "external cues")] });
        const local = project({ id: "c1", revision: 3, title: "Editing locally", nodes: [node("n1", "Shot 1", "Tip just written by the user")] });

        const decision = decideExternalCanvasRevision({ remote, local, hasLocalEdits: true });

        expect(decision.kind).toBe("keep-local");
        if (decision.kind !== "keep-local") throw new Error("expected keep-local");
        expect(decision.projectId).toBe("c1");
        expect(decision.candidate).toBe(remote);
        expect(decision.candidate.nodes[0].metadata?.prompt).toBe("external cues");
        expect(decision.localRevision).toBe(3);
        expect(decision.remoteRevision).toBe(9);
    });

    test("Preserve native perspective and canvas appearance preferences when applying locally", () => {
        const remote = project({ id: "c1", revision: 5, viewport: { x: 0, y: 0, k: 1 } });
        const local = project({
            id: "c1",
            revision: 4,
            viewport: { x: 640, y: -120, k: 1.75 },
            appearance: { mode: "light" },
            backgroundMode: "dots",
        });

        const decision = decideExternalCanvasRevision({ remote, local, hasLocalEdits: false });

        if (decision.kind !== "apply") throw new Error("expected apply");
        expect(decision.project.viewport).toEqual({ x: 640, y: -120, k: 1.75 });
        expect(decision.project.backgroundMode).toBe("dots");
        expect(decision.project.appearance).toEqual({ mode: "light" });
    });

    test("If there is no record of the canvas locally, it will fall directly to the local area.", () => {
        const remote = project({ id: "new", revision: 1 });

        const decision = decideExternalCanvasRevision({ remote, local: undefined, hasLocalEdits: false });

        expect(decision.kind).toBe("apply");
        if (decision.kind !== "apply") throw new Error("expected apply");
        expect(decision.project.id).toBe("new");
        expect(decision.localRevision).toBe(0);
    });
});
