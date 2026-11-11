import { beforeEach, describe, expect, test } from "bun:test";

import { recordDirectorDiagnostic, resetDirectorDiagnosticDedupe } from "../src/lib/canvas/director/director-diagnostics-recorder";
import { getClientDiagnosticEvents } from "../src/services/diagnostics/client-diagnostics";

/** 只看导演台自己的稳定码事件，避免与其它测试写入的诊断流互相干扰。 */
function directorEvents() {
    return getClientDiagnosticEvents().filter((event) => (event.code || "").startsWith("DIRECTOR_"));
}

function newestDirectorEvent() {
    return directorEvents().at(-1);
}

const LEAK_PROBES = [
    "https://cdn.example.com/actor.glb?token=abc123#frag",
    "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "cookie=session=deadbeef; Path=/",
    "api_key=sk-live-0000",
    "Error: boom\n    at DirectorModel (director-viewport.tsx:571:29)",
    "Actor 1’s shot intention text",
];

beforeEach(() => {
    resetDirectorDiagnosticDedupe();
});

describe("Record into unified diagnostic buffer", () => {
    test("The written events have stable codes, fixed copywriting and runtime classification", () => {
        const before = directorEvents().length;
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_RENDER_FAILED")).toBe(true);

        expect(directorEvents().length).toBe(before + 1);
        const event = newestDirectorEvent();
        expect(event?.code).toBe("DIRECTOR_VIEWPORT_RENDER_FAILED");
        expect(event?.level).toBe("error");
        expect(event?.category).toBe("runtime");
        expect(event?.message).toBe("Director's desk 3D viewport rendering fails");
        // 绝不落 stack。
        expect(event?.stack || "").toBe("");
    });

    test("Security fields enter the code with an enumeration suffix for easy retrieval.", () => {
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1", objectKind: "model", attempt: 2 })).toBe(true);
        const event = newestDirectorEvent();
        expect(event?.code).toBe("DIRECTOR_MODEL_LOAD_FAILED object=obj-1 kind=model attempt=2");
    });

    test("sceneId only enters the code suffix and does not impersonate canvasId", () => {
        expect(recordDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { sceneId: "repro-scene-1", revision: 3 })).toBe(true);
        const event = newestDirectorEvent();
        // DirectorScene.id 不是 canvas id，绝不写入既有后端契约字段。
        expect(event?.canvasId).toBeUndefined();
        expect(event?.code).toBe("DIRECTOR_SAVE_FLUSH_FAILED scene=repro-scene-1 revision=3");
    });

    test("All three save-related codes can be written and the levels are correct.", () => {
        recordDirectorDiagnostic("DIRECTOR_SAVE_RETRY_RECOVERED", { revision: 1 });
        expect(newestDirectorEvent()?.level).toBe("info");
        recordDirectorDiagnostic("DIRECTOR_SAVE_DRAFT_UNAVAILABLE", { revision: 1 });
        expect(newestDirectorEvent()?.level).toBe("error");
        recordDirectorDiagnostic("DIRECTOR_CLOSE_BLOCKED", { saveOutcome: "stay" });
        expect(newestDirectorEvent()?.level).toBe("warning");
    });
});

describe("Deduplication and noise control", () => {
    test("The same code+ field is only recorded once in the window", () => {
        const before = directorEvents().length;
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_LOST")).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_LOST")).toBe(false);
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_LOST")).toBe(false);
        expect(directorEvents().length).toBe(before + 1);
    });

    test("Different fields are considered different events and will not be mistakenly deduplicated.", () => {
        const before = directorEvents().length;
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "model", attempt: 1 })).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "model", attempt: 2 })).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "actor", attempt: 1 })).toBe(true);
        expect(directorEvents().length).toBe(before + 3);
    });

    test("Different objectIds do not swallow each other within the window", () => {
        const before = directorEvents().length;
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1", objectKind: "model" })).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-2", objectKind: "model" })).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-3", objectKind: "model" })).toBe(true);
        // 同一 objectId 重复仍要被去重。
        expect(recordDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1", objectKind: "model" })).toBe(false);
        expect(directorEvents().length).toBe(before + 3);
    });

    test("Different sceneIds do not eat each other within the window.", () => {
        const before = directorEvents().length;
        expect(recordDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { sceneId: "scene-1", revision: 1 })).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { sceneId: "scene-2", revision: 1 })).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { sceneId: "scene-1", revision: 1 })).toBe(false);
        expect(directorEvents().length).toBe(before + 2);
    });

    test("All written code starts with the stable DIRECTOR_ prefix", () => {
        resetDirectorDiagnosticDedupe();
        recordDirectorDiagnostic("DIRECTOR_CLOSE_BLOCKED", { sceneId: "scene-1", saveOutcome: "stay" });
        for (const event of directorEvents()) {
            expect((event.code || "").startsWith("DIRECTOR_")).toBe(true);
        }
    });

    test("The same event can be recorded again after resetting the deduplication state.", () => {
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_RESTORED")).toBe(true);
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_RESTORED")).toBe(false);
        resetDirectorDiagnosticDedupe();
        expect(recordDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_RESTORED")).toBe(true);
    });
});

describe("Do not leak sensitive content", () => {
    test("Forged sensitive fields will not enter any fields in the buffer", () => {
        for (const probe of LEAK_PROBES) {
            resetDirectorDiagnosticDedupe();
            recordDirectorDiagnostic("DIRECTOR_MODEL_ADOPT_FAILED", {
                objectId: probe,
                sceneId: probe,
                // @ts-expect-error 故意传入非法枚举，验证运行时白名单而非仅靠类型。
                objectKind: probe,
                // @ts-expect-error 故意传入非法数值类型。
                attempt: probe,
            });

            const event = newestDirectorEvent();
            const serialized = JSON.stringify(event);
            expect(serialized).not.toContain("cdn.example.com");
            expect(serialized).not.toContain("token=abc123");
            expect(serialized).not.toContain("sk-live-0000");
            expect(serialized).not.toContain("deadbeef");
            expect(serialized).not.toContain("Bearer");
            expect(serialized).not.toContain("actor");
            expect(serialized).not.toContain("director-viewport.tsx");
            expect(event?.canvasId).toBeUndefined();
            expect(event?.code).toBe("DIRECTOR_MODEL_ADOPT_FAILED");
        }
    });

    test("Unknown code is neither written nor throws an error", () => {
        const before = directorEvents().length;
        // @ts-expect-error 故意传入白名单外的 code。
        expect(recordDirectorDiagnostic("DIRECTOR_NOT_A_REAL_CODE", { objectId: "obj-1" })).toBe(false);
        expect(directorEvents().length).toBe(before);
    });
});
