import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { projectDirectorWebgl, readDirectorReproRuntime, releaseProbeContext, safeReproText } from "../src/lib/canvas/director/director-repro-runtime";
import { DIRECTOR_REPRO_ANIMATED_PERSON_URL, DIRECTOR_REPRO_LOCAL_MODEL_URL, DIRECTOR_REPRO_MATRIX, DIRECTOR_REPRO_MISSING_MODEL_URL, createDirectorReproActorScene, createDirectorReproQuaterniusCompareScene, createDirectorReproScene, directorReproSceneIsOffline, injectDirectorReproAnimatedPerson, injectDirectorReproModel } from "../src/lib/canvas/director/director-repro-fixture";
import { DIRECTOR_PLACEMENT_MARGIN, directorObjectFootprint } from "../src/lib/canvas/director/director-placement";
import type { DirectorObject } from "../src/types/director";

const LEAK_PROBES = [
    "https://cdn.example.com/actor.glb?token=abc123#frag",
    "http://localhost:3000/api/tasks?authorization=Bearer%20xyz",
    "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "cookie=session=deadbeef; Path=/",
    "api_key=sk-live-0000",
    "secret_key: hunter2",
    "password=letmein",
];

/** XZ 占位是否相交（含 margin）；Y 完全不参与，与放置模块同一判据。 */
function overlapsInjectedXZ(a: DirectorObject, b: DirectorObject) {
    const fa = directorObjectFootprint(a);
    const fb = directorObjectFootprint(b);
    const dx = Math.abs(a.transform.position[0] - b.transform.position[0]);
    const dz = Math.abs(a.transform.position[2] - b.transform.position[2]);
    return dx < (fa.width + fb.width) / 2 + DIRECTOR_PLACEMENT_MARGIN && dz < (fa.depth + fb.depth) / 2 + DIRECTOR_PLACEMENT_MARGIN;
}

/** 构造一个可控的 WebGL 双替身：参数常量用小整数便于断言。 */
function makeGl(overrides: Partial<Record<string, unknown>> = {}) {
    const values: Record<number, unknown> = {
        1: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
        2: "Google Inc. (Apple)",
        3: "ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)",
        4: 16384,
        5: 16384,
        6: [32767, 32767],
    };
    return {
        VERSION: 1,
        VENDOR: 2,
        RENDERER: 3,
        MAX_TEXTURE_SIZE: 4,
        MAX_RENDERBUFFER_SIZE: 5,
        MAX_VIEWPORT_DIMS: 6,
        getParameter: (name: number) => values[name],
        getExtension: () => null,
        ...overrides,
    };
}

describe("safeReproText", () => {
    test("The entire URL is replaced with a fixed [URL], and the domain name and path are not retained.", () => {
        expect(safeReproText("https://cdn.example.com/a.glb?token=abc#frag")).toBe("[URL]");
        expect(safeReproText("http://driver.example.com/x?k=v")).toBe("[URL]");
        expect(safeReproText("ANGLE renderer https://driver.example.com/x?k=v build")).toBe("ANGLE renderer [URL] build");
        for (const probe of ["https://cdn.example.com/a.glb?token=abc123#frag", "http://driver.example.com/x?k=v"]) {
            const safe = safeReproText(probe);
            expect(safe).not.toContain("cdn.example.com");
            expect(safe).not.toContain("driver.example.com");
            expect(safe).not.toContain("abc123");
            expect(safe).not.toContain("token");
        }
    });

    test("The Bearer token is completely obscured and the key value is not retained.", () => {
        const safe = safeReproText("Authorization: Bearer abc123");
        expect(safe).toContain("[REDACTED]");
        expect(safe).not.toContain("abc123");

        const jwt = safeReproText("authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
        expect(jwt).not.toContain("payload.sig");
        expect(jwt).not.toContain("eyJhbGciOiJIUzI1NiJ9");

        expect(safeReproText("bearer SECRETVALUE")).toBe("Bearer [REDACTED]");
    });

    test("key[:=]value form certificate has no residual value", () => {
        for (const [input, secret] of [
            ["api_key=sk-live-0000", "sk-live-0000"],
            ["cookie=session=deadbeef; Path=/", "deadbeef"],
            ["secret_key: hunter2", "hunter2"],
            ["password=letmein", "letmein"],
            ["token=abc123", "abc123"],
        ]) {
            const safe = safeReproText(input);
            expect(safe).toContain("[REDACTED]");
            expect(safe).not.toContain(secret);
        }
    });

    test("Naked query/hash fragments are also not retained", () => {
        expect(safeReproText("renderer?token=abc")).toBe("renderer");
        expect(safeReproText("renderer#secret")).toBe("renderer");
    });

    test("Limit length and compress white space", () => {
        expect(safeReproText("a".repeat(500)).length).toBe(160);
        expect(safeReproText("a".repeat(500), 32).length).toBe(32);
        expect(safeReproText("  a   b \n c  ")).toBe("a b c");
    });

    test("Non-string and null values stably return an empty string.", () => {
        for (const bad of [null, undefined, 42, {}, []]) expect(safeReproText(bad)).toBe("");
    });
});

describe("runtime projection", () => {
    test("Fields are complete and DPR is bounded", () => {
        const runtime = readDirectorReproRuntime();
        expect(typeof runtime.appVersion).toBe("string");
        expect(typeof runtime.buildCommit).toBe("string");
        expect(typeof runtime.browser).toBe("string");
        expect(typeof runtime.os).toBe("string");
        expect(typeof runtime.timezone).toBe("string");
        expect(runtime.devicePixelRatio).toBeGreaterThanOrEqual(0.1);
        expect(runtime.devicePixelRatio).toBeLessThanOrEqual(8);
    });

    test("All strings are limited in length", () => {
        const runtime = readDirectorReproRuntime();
        expect(runtime.appVersion.length).toBeLessThanOrEqual(48);
        expect(runtime.buildCommit.length).toBeLessThanOrEqual(48);
        expect(runtime.browser.length).toBeLessThanOrEqual(160);
        expect(runtime.os.length).toBeLessThanOrEqual(48);
        expect(runtime.timezone.length).toBeLessThanOrEqual(64);
    });
});

describe("WebGL projection", () => {
    test("Available context produces security capability values", () => {
        const webgl = projectDirectorWebgl(makeGl());
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.version).toContain("WebGL 2.0");
        expect(webgl.vendor).toContain("Google");
        expect(webgl.maxTextureSize).toBe(16384);
        expect(webgl.maxRenderbufferSize).toBe(16384);
        expect(webgl.maxViewportWidth).toBe(32767);
        expect(webgl.maxViewportHeight).toBe(32767);
    });

    test("Missing context stable downgrade to unsupported", () => {
        for (const bad of [null, undefined, 42, "webgl", {}]) {
            expect(projectDirectorWebgl(bad)).toEqual({ available: false, reason: "unsupported" });
        }
    });

    test("GetParameter throws an error and downgrades it to context-failed without leaking the exception.", () => {
        const gl = makeGl({
            getParameter: () => {
                throw new Error("context lost");
            },
        });
        expect(() => projectDirectorWebgl(gl)).not.toThrow();
        expect(projectDirectorWebgl(gl)).toEqual({ available: false, reason: "context-failed" });
    });

    test("getExtension throwing errors does not affect overall usability", () => {
        const gl = makeGl({
            getExtension: () => {
                throw new Error("no extension");
            },
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.vendor).toContain("Google");
    });

    test("UNMASKED values take precedence but are still processed as safe text", () => {
        const values: Record<number, unknown> = { 7: "Apple?token=abc", 8: "Apple M2 Pro https://driver.example.com/x?k=v" };
        const gl = makeGl({
            getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 7, UNMASKED_RENDERER_WEBGL: 8 }),
            getParameter: (name: number) => (name in values ? values[name] : makeGl().getParameter(name)),
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.vendor).toBe("Apple");
        expect(webgl.renderer).not.toContain("?k=v");
        expect(webgl.renderer).not.toContain("token");
    });

    test("Non-limited ability values converge to 0 (unknown) and will never produce NaN/Infinity", () => {
        const gl = makeGl({
            getParameter: (name: number) => (name === 4 ? Number.NaN : name === 5 ? Number.POSITIVE_INFINITY : name === 6 ? "not-an-array" : makeGl().getParameter(name)),
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        // 非有限一律当「未知」记 0，而不是编造一个驱动从未声明的能力上限。
        expect(Number.isFinite(webgl.maxTextureSize)).toBe(true);
        expect(Number.isFinite(webgl.maxRenderbufferSize)).toBe(true);
        expect(webgl.maxTextureSize).toBe(0);
        expect(webgl.maxRenderbufferSize).toBe(0);
        expect(webgl.maxViewportWidth).toBe(0);
        expect(webgl.maxViewportHeight).toBe(0);
    });

    test("The super large but limited ability value is clamped to the upper limit", () => {
        const gl = makeGl({
            getParameter: (name: number) => (name === 4 ? 9_999_999 : name === 6 ? [9_999_999, -5] : makeGl().getParameter(name)),
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.maxTextureSize).toBe(1_048_576);
        expect(webgl.maxViewportWidth).toBe(1_048_576);
        // 负值夹到下界 0。
        expect(webgl.maxViewportHeight).toBe(0);
    });

    test("Fake sensitive vendor/renderer does not go into the output unchanged", () => {
        for (const probe of LEAK_PROBES) {
            const gl = makeGl({ getParameter: (name: number) => (name === 2 || name === 3 ? probe : makeGl().getParameter(name)) });
            const webgl = projectDirectorWebgl(gl);
            expect(webgl.available).toBe(true);
            if (!webgl.available) continue;
            const text = webgl.vendor + " " + webgl.renderer;
            for (const secret of ["abc123", "payload.sig", "cdn.example.com", "driver.example.com", "token=abc", "sk-live-0000", "deadbeef", "hunter2", "letmein", "#frag", "eyJhbGciOiJIUzI1NiJ9"]) {
                expect(text).not.toContain(secret);
            }
        }
    });

    test("Return the context after detection: call loseContext when extension is supported", () => {
        let losed = 0;
        releaseProbeContext({
            getExtension: (name: string) =>
                name === "WEBGL_lose_context"
                    ? {
                          loseContext: () => {
                              losed += 1;
                          },
                      }
                    : null,
        });
        expect(losed).toBe(1);
    });

    test("When the extension is unavailable or an error is thrown, it returns to no operation and no exception is leaked.", () => {
        expect(() => releaseProbeContext({ getExtension: () => null })).not.toThrow();
        expect(() => releaseProbeContext({ getExtension: () => ({}) })).not.toThrow();
        expect(() =>
            releaseProbeContext({
                getExtension: () => {
                    throw new Error("no extension");
                },
            }),
        ).not.toThrow();
        expect(() =>
            releaseProbeContext({
                getExtension: () => ({
                    loseContext: () => {
                        throw new Error("lose failed");
                    },
                }),
            }),
        ).not.toThrow();
        for (const bad of [null, undefined, 42, {}, "gl"]) {
            expect(() => releaseProbeContext(bad)).not.toThrow();
        }
    });
});

describe("fixture deterministic and offline", () => {
    test("The two structures are completely identical", () => {
        expect(createDirectorReproScene()).toEqual(createDirectorReproScene());
    });

    test("Returns a brand new object, rewriting does not affect subsequent construction", () => {
        const first = createDirectorReproScene();
        first.objects[0].transform.position[0] = 99;
        first.title = "be rewritten";
        const second = createDirectorReproScene();
        expect(second.objects[0].transform.position[0]).toBe(0);
        expect(second.title).toBe("P0 recurrence scene");
        expect(second.background).toBe("#060608");
    });

    test("Does not contain any remote assets: None url / storageKey / assetId", () => {
        const scene = createDirectorReproScene();
        expect(directorReproSceneIsOffline(scene)).toBe(true);
        const serialized = JSON.stringify(scene);
        expect(serialized).not.toContain("http");
        expect(serialized).not.toContain(".glb");
        expect(serialized).not.toContain("cdn");
    });

    test("The scene structure is operable: there are objects, cameras, lights, lenses and activeShotId is self-consistent", () => {
        const scene = createDirectorReproScene();
        expect(scene.objects.length).toBeGreaterThanOrEqual(3);
        expect(scene.cameras.length).toBeGreaterThanOrEqual(1);
        expect(scene.lights.length).toBeGreaterThanOrEqual(1);
        expect(scene.shots.length).toBeGreaterThanOrEqual(1);
        expect(scene.shots.some((shot) => shot.id === scene.activeShotId)).toBe(true);
        expect(scene.shots.every((shot) => scene.cameras.some((camera) => camera.id === shot.cameraId))).toBe(true);
        expect(scene.objects.every((object) => object.transform.position.every((value) => Number.isFinite(value)))).toBe(true);
    });

    test("The character visual comparison scene uses offline puppets as the main visual and does not introduce network models.", () => {
        const scene = createDirectorReproActorScene();
        expect(scene.cameras[0].name).toBe("Seat 1");
        expect(scene.cameras[0].transform.position).toEqual([0, 2.2, 10]);
        expect(scene.cameras[0].target).toEqual([0, 1.2, 0]);
        expect(scene).toEqual(createDirectorReproActorScene());
        expect(directorReproSceneIsOffline(scene)).toBe(true);
        expect(scene.objects).toHaveLength(1);
        expect(scene.objects[0]).toMatchObject({ id: "repro-actor-1", kind: "actor", name: "actor 1", visible: true, pose: "stand" });
        expect(scene.objects[0].url).toBeUndefined();
        expect(scene.objects[0].rig).toEqual({ status: "unmapped", boneMap: {}, animationNames: [] });
        expect(scene.shots.some((shot) => shot.id === scene.activeShotId)).toBe(true);
    });

    test("Quaternius comparison scene showing free male and female models side by side", () => {
        const original = createDirectorReproActorScene();
        const comparison = createDirectorReproQuaterniusCompareScene();
        expect(comparison.objects).toHaveLength(2);
        expect(comparison.objects[0]).toMatchObject({ id: "repro-actor-1", kind: "actor", name: "Quaternius free women", url: "/canvas/models/quaternius-standard-female.glb" });
        expect(comparison.objects[1]).toMatchObject({ id: "repro-quaternius-male", kind: "actor", name: "Quaternius Free Male", url: "/canvas/models/quaternius-standard-male.glb" });
        expect(comparison.objects.map((object) => object.transform.position[0])).toEqual([-1.1, 1.1]);
        expect(original.objects).toHaveLength(1);
        expect(original.objects[0].url).toBeUndefined();
        expect(directorReproSceneIsOffline(comparison)).toBe(false);
    });

    test("The control resource is a streamlined GLB that can be loaded offline and retains the character skeleton", () => {
        for (const body of ["male", "female"]) {
            const model = readFileSync(new URL(`../public/canvas/models/quaternius-standard-${body}.glb`, import.meta.url));
            expect(model.toString("ascii", 0, 4)).toBe("glTF");
            expect(model.length).toBeLessThan(2_000_000);
            const jsonLength = model.readUInt32LE(12);
            const gltf = JSON.parse(model.toString("utf8", 20, 20 + jsonLength));
            expect(gltf.skins[0].joints.length).toBeGreaterThanOrEqual(50);
            expect(gltf.meshes.length).toBeGreaterThan(0);
            expect(gltf.nodes.some((node: { name?: string }) => node.name === "Head")).toBe(true);
            expect(gltf.images).toBeUndefined();
        }
    });

    test("Animation character rendering fixture uses re-injectable same-origin GLTF resources", () => {
        const base = createDirectorReproScene();
        const scene = injectDirectorReproAnimatedPerson(base);
        const actor = scene.objects.find((object) => object.id === "repro-animated-person");
        expect(actor).toMatchObject({ name: "Offline animated characters", kind: "model", url: DIRECTOR_REPRO_ANIMATED_PERSON_URL, mimeType: "model/gltf+json" });
        expect(DIRECTOR_REPRO_ANIMATED_PERSON_URL.startsWith("/")).toBe(true);
        expect(injectDirectorReproAnimatedPerson(scene).objects.filter((object) => object.id === "repro-animated-person")).toHaveLength(1);
        expect(base.objects.some((object) => object.id === "repro-animated-person")).toBe(false);
    });

    test("Objects do not overlap initially, which facilitates the reproduction of continuously added semantics.", () => {
        const scene = createDirectorReproScene();
        const xs = scene.objects.map((object) => object.transform.position[0]);
        expect(new Set(xs).size).toBe(xs.length);
    });

    test("The recurrence matrix covers all P0 scenes and has a unique ID", () => {
        const ids = DIRECTOR_REPRO_MATRIX.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const required of [
            "empty-click",
            "right-click",
            "switch-object",
            "release-outside",
            "blur",
            "escape",
            "playing",
            "non-zero-time",
            "autokey-on",
            "autokey-off",
            "add-move-delete-undo",
            "delete-while-loading",
            "model-load-failed",
            "save-failed",
            "close-recovery",
        ]) {
            expect(ids).toContain(required);
        }
        for (const item of DIRECTOR_REPRO_MATRIX) {
            expect(item.title.length).toBeGreaterThan(0);
            expect(item.steps.length).toBeGreaterThan(0);
            expect(item.expected.length).toBeGreaterThan(0);
        }
    });
    test("The two rows of the matrix model are executable steps and are no longer to-dos.", () => {
        const rows = DIRECTOR_REPRO_MATRIX.filter((item) => item.id === "delete-while-loading" || item.id === "model-load-failed");
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.steps).not.toContain("Need to be injected");
            expect(row.steps).not.toContain("Stage D");
        }
        expect(DIRECTOR_REPRO_MATRIX.find((item) => item.id === "delete-while-loading")?.steps).toContain("Inject local model");
        expect(DIRECTOR_REPRO_MATRIX.find((item) => item.id === "model-load-failed")?.steps).toContain("Inject missing model");
    });
});

describe("Model injection", () => {
    test("The local variant uses the local public asset address", () => {
        const scene = injectDirectorReproModel(createDirectorReproScene(), "local");
        const model = scene.objects.find((object) => object.id === "repro-model-local");
        expect(model?.url).toBe(DIRECTOR_REPRO_LOCAL_MODEL_URL);
        expect(model?.url).toBe("/canvas/models/director-repro-triangle.gltf");
        expect(model?.mimeType).toBe("model/gltf+json");
        expect(model?.name).toBe("Local model repro triangle");
        // 无压缩扩展/无纹理，因此不需要 KTX2Loader 或 DRACOLoader。
        expect(model?.url).not.toContain(".glb");
    });

    test("The missing variant uses an unreachable address from the same origin", () => {
        const scene = injectDirectorReproModel(createDirectorReproScene(), "missing");
        const model = scene.objects.find((object) => object.id === "repro-model-missing");
        expect(model?.url).toBe(DIRECTOR_REPRO_MISSING_MODEL_URL);
        expect(model?.url).toBe("/__director-repro-missing.glb");
        // 同源相对路径，不依赖外网可达性。
        expect(model?.url?.startsWith("/")).toBe(true);
    });

    test("Both variants are model kind and id stable", () => {
        for (const [variant, id] of [
            ["local", "repro-model-local"],
            ["missing", "repro-model-missing"],
        ] as const) {
            const scene = injectDirectorReproModel(createDirectorReproScene(), variant);
            const model = scene.objects.find((object) => object.id === id);
            expect(model).toBeDefined();
            expect(model?.kind).toBe("model");
            expect(model?.primitive).toBeUndefined();
        }
    });

    test("Model Y remains 0 (close to the ground), and only changes XZ", () => {
        for (const variant of ["local", "missing"] as const) {
            const scene = injectDirectorReproModel(createDirectorReproScene(), variant);
            const model = scene.objects.find((object) => object.kind === "model");
            expect(model?.transform.position[1]).toBe(0);
            expect(model?.transform.position.every((value) => Number.isFinite(value))).toBe(true);
        }
    });

    test("Pure function: do not change the parameter scene", () => {
        const original = createDirectorReproScene();
        const before = JSON.stringify(original);
        injectDirectorReproModel(original, "local");
        injectDirectorReproModel(original, "missing");
        expect(JSON.stringify(original)).toBe(before);
        expect(original.objects.some((object) => object.kind === "model")).toBe(false);
    });

    test("Repeatedly injecting the same variant only retains one object", () => {
        let scene = injectDirectorReproModel(createDirectorReproScene(), "local");
        const afterFirst = scene.objects.length;
        scene = injectDirectorReproModel(scene, "local");
        scene = injectDirectorReproModel(scene, "local");
        expect(scene.objects.filter((object) => object.id === "repro-model-local")).toHaveLength(1);
        expect(scene.objects.length).toBe(afterFirst);
    });

    test("First local and then missing: both are present and the positions do not intersect.", () => {
        const scene = injectDirectorReproModel(injectDirectorReproModel(createDirectorReproScene(), "local"), "missing");
        const local = scene.objects.find((object) => object.id === "repro-model-local");
        const missing = scene.objects.find((object) => object.id === "repro-model-missing");
        expect(local).toBeDefined();
        expect(missing).toBeDefined();
        if (!local || !missing) return;

        const others = scene.objects.filter((object) => object.id !== missing.id);
        for (const other of others) {
            expect(overlapsInjectedXZ(missing, other)).toBe(false);
        }
        expect(overlapsInjectedXZ(local, missing)).toBe(false);
    });

    test("Injection does not overlap with initial primitive", () => {
        const scene = injectDirectorReproModel(createDirectorReproScene(), "local");
        const model = scene.objects.find((object) => object.id === "repro-model-local");
        expect(model).toBeDefined();
        if (!model) return;
        for (const other of scene.objects.filter((object) => object.id !== model.id)) {
            expect(overlapsInjectedXZ(model, other)).toBe(false);
        }
    });

    test("The initial fixture is offline and no longer claims to be offline after injection.", () => {
        const base = createDirectorReproScene();
        expect(directorReproSceneIsOffline(base)).toBe(true);
        expect(directorReproSceneIsOffline(injectDirectorReproModel(base, "local"))).toBe(false);
        expect(directorReproSceneIsOffline(injectDirectorReproModel(base, "missing"))).toBe(false);
    });

    test("Injection will advance updatedAt, making the saved link count as a real change", () => {
        const base = createDirectorReproScene();
        const injected = injectDirectorReproModel(base, "local");
        expect(injected.updatedAt >= base.updatedAt).toBe(true);
        expect(injected.id).toBe(base.id);
    });

    test("The number of matrix entries does not change due to the injection function", () => {
        expect(DIRECTOR_REPRO_MATRIX).toHaveLength(15);
    });
});
