import { describe, expect, test } from "bun:test";

import { DIRECTOR_DIAGNOSTIC_CODES, directorDiagnosticObjectKind, formatDirectorDiagnosticCode, isDirectorDiagnosticCode, projectDirectorDiagnostic } from "../src/lib/canvas/director/director-diagnostics";

/** 任何一个都不允许出现在投影输出里。 */
const LEAK_PROBES = [
    "https://cdn.example.com/actor.glb?token=abc123",
    "http://localhost:3000/api/tasks?authorization=Bearer%20xyz",
    "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "authorization: Bearer secret-token",
    "cookie=session=deadbeef; Path=/",
    "api_key=sk-live-0000",
    "Error: adopt failed\n    at DirectorModel (director-viewport.tsx:571:29)",
    "Actor 1’s shot intention text",
    "/private/example/secret/path/scene.glb",
];

function serialize(value: unknown) {
    return JSON.stringify(value ?? {});
}

describe("code whitelist", () => {
    test("All codes in the whitelist are accepted and have stable copywriting and levels.", () => {
        for (const code of DIRECTOR_DIAGNOSTIC_CODES) {
            expect(isDirectorDiagnosticCode(code)).toBe(true);
            const event = projectDirectorDiagnostic(code, {});
            expect(event).not.toBeNull();
            expect(event?.code).toBe(code);
            expect(event?.message.length).toBeGreaterThan(0);
            expect(["info", "warning", "error"]).toContain(event?.level ?? "");
        }
    });

    test("Unknown codes will be rejected and will not be transmitted transparently.", () => {
        const rejected = ["", "director_viewport_render_failed", "DIRECTOR_UNKNOWN", "SOME_OTHER_CODE", "DIRECTOR_VIEWPORT_RENDER_FAILED ", null, undefined, 42, {}, []];
        for (const code of rejected) {
            expect(isDirectorDiagnosticCode(code)).toBe(false);
            expect(projectDirectorDiagnostic(code, {})).toBeNull();
        }
    });
});

describe("Field whitelist", () => {
    test("Unknown fields do not appear in the output", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", {
            objectId: "obj-1",
            sceneName: "Actor 1 scene",
            url: "https://cdn.example.com/a.glb",
            stack: "Error: boom\n at x",
            prompt: "Lens intention text",
            storageKey: "assets/secret.glb",
            token: "sk-live-0000",
        });

        expect(event?.fields).toEqual({ objectId: "obj-1" });
        expect(serialize(event)).not.toContain("cdn.example.com");
        expect(serialize(event)).not.toContain("Lens intention text");
        expect(serialize(event)).not.toContain("sk-live-0000");
    });

    test("Fake sensitive input cannot enter the output via either field", () => {
        for (const probe of LEAK_PROBES) {
            const event = projectDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", {
                objectId: probe,
                sceneId: probe,
                objectKind: probe,
                saveOutcome: probe,
                attempt: probe,
                revision: probe,
                draftStored: probe,
                userInitiated: probe,
            });

            expect(event).not.toBeNull();
            // 所有字段都应被拒绝：probe 既不是 safe-id，也不在枚举内，也不是数值/布尔。
            expect(event?.fields).toEqual({});
            const text = serialize(event);
            expect(text).not.toContain("http");
            expect(text).not.toContain("token");
            expect(text).not.toContain("cookie");
            expect(text).not.toContain("Bearer");
            expect(text).not.toContain("actor");
        }
    });

    test("safe-id only accepts restricted character sets", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1_a.b:c" })?.fields.objectId).toBe("obj-1_a.b:c");
        for (const bad of ["obj 1", "obj/1", "obj?1", "obj#1", "a".repeat(97), "", "  ", "obj\n1", "obj%201"]) {
            expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: bad })?.fields.objectId).toBeUndefined();
        }
    });

    test("Enum fields only accept whitelist values", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "actor" })?.fields.objectKind).toBe("actor");
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "spaceship" })?.fields.objectKind).toBeUndefined();
        expect(projectDirectorDiagnostic("DIRECTOR_CLOSE_BLOCKED", { saveOutcome: "stay" })?.fields.saveOutcome).toBe("stay");
        expect(projectDirectorDiagnostic("DIRECTOR_CLOSE_BLOCKED", { saveOutcome: "explode" })?.fields.saveOutcome).toBeUndefined();
    });

    test("Numeric fields are bounded and non-finite values are rejected", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_RETRY", { attempt: 3 })?.fields.attempt).toBe(3);
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_RETRY", { attempt: 2.6 })?.fields.attempt).toBe(3);
        for (const bad of [-1, 1000, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
            expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_RETRY", { attempt: bad })?.fields.attempt).toBeUndefined();
        }
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { revision: 0 })?.fields.revision).toBe(0);
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { revision: -1 })?.fields.revision).toBeUndefined();
    });

    test("Boolean fields only accept true booleans", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { draftStored: false })?.fields.draftStored).toBe(false);
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { draftStored: true })?.fields.draftStored).toBe(true);
        for (const bad of ["true", 1, 0, null, {}]) {
            expect(projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { draftStored: bad })?.fields.draftStored).toBeUndefined();
        }
    });

    test("Non-object fields do not throw an error and produce empty fields", () => {
        for (const fields of [null, undefined, 42, "objectId=1", [1, 2, 3]]) {
            const event = projectDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_LOST", fields);
            expect(event?.fields).toEqual({});
        }
    });
});

describe("Stable code formatting", () => {
    test("Only concatenate safe enums and numbers", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { sceneId: "scene-1", revision: 4, draftStored: true, userInitiated: true });
        expect(event).not.toBeNull();
        if (!event) return;
        const formatted = formatDirectorDiagnosticCode(event);
        expect(formatted).toBe("DIRECTOR_SAVE_RETRY_FAILED scene=scene-1 revision=4 draft=1 user=1");
        // scene/object 后缀只可能是 safe-id 投影后的值。
        expect(formatted.startsWith("DIRECTOR_")).toBe(true);
    });

    test("Both scene and object suffixes enter the code, and the order is determined.", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { sceneId: "scene-1", objectId: "obj-9", objectKind: "model", attempt: 2 });
        expect(event).not.toBeNull();
        if (!event) return;
        expect(formatDirectorDiagnosticCode(event)).toBe("DIRECTOR_MODEL_LOAD_FAILED scene=scene-1 object=obj-9 kind=model attempt=2");
    });

    test("Different objectId / sceneId produce different signatures", () => {
        const a = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1" });
        const b = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-2" });
        const c = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { sceneId: "scene-1" });
        const d = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { sceneId: "scene-2" });
        expect(a && b && c && d).toBeTruthy();
        if (!a || !b || !c || !d) return;
        const signatures = [a, b, c, d].map(formatDirectorDiagnosticCode);
        expect(new Set(signatures).size).toBe(4);
    });

    test("Illegal ids do not enter the code suffix", () => {
        for (const bad of ["https://cdn.example.com/a.glb?token=abc", "obj 1", "obj/1", "a".repeat(97)]) {
            const event = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: bad, sceneId: bad });
            expect(event).not.toBeNull();
            if (!event) continue;
            const formatted = formatDirectorDiagnosticCode(event);
            expect(formatted).toBe("DIRECTOR_MODEL_LOAD_FAILED");
            expect(formatted).not.toContain("scene=");
            expect(formatted).not.toContain("object=");
            expect(formatted).not.toContain("cdn.example.com");
        }
    });

    test("When there is no field, only the code itself", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_VIEWPORT_RENDER_FAILED", {});
        expect(event).not.toBeNull();
        if (!event) return;
        expect(formatDirectorDiagnosticCode(event)).toBe("DIRECTOR_VIEWPORT_RENDER_FAILED");
    });
});

describe("Object type derivation", () => {
    test("Mapping by shape, does not read names or addresses", () => {
        expect(directorDiagnosticObjectKind({ kind: "actor" })).toBe("actor");
        expect(directorDiagnosticObjectKind({ kind: "model" })).toBe("model");
        expect(directorDiagnosticObjectKind({ kind: "billboard" })).toBe("billboard");
        expect(directorDiagnosticObjectKind({ primitive: "box" })).toBe("primitive");
        expect(directorDiagnosticObjectKind({})).toBe("unknown");
        expect(directorDiagnosticObjectKind(null)).toBe("unknown");
        expect(directorDiagnosticObjectKind(undefined)).toBe("unknown");
    });
});
