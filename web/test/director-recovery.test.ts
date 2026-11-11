import { describe, expect, test } from "bun:test";

import {
    directorCaptureInitial,
    directorCaptureUsable,
    directorLoadIdentity,
    directorLoadInitial,
    installDirectorContextListeners,
    reduceDirectorCapture,
    reduceDirectorLoad,
    removeDirectorFailedLoad,
    releaseDirectorCapture,
    resolveDirectorDisplay,
    restoreDirectorCapture,
    upsertDirectorFailedLoad,
    type DirectorCanvasTarget,
    type DirectorFailedLoads,
} from "../src/lib/canvas/director/director-recovery";

function fakeCanvas() {
    const listeners = new Map<string, Array<(event: Event) => void>>();
    const target: DirectorCanvasTarget = {
        addEventListener: (type, listener) => {
            listeners.set(type, [...(listeners.get(type) || []), listener]);
        },
        removeEventListener: (type, listener) => {
            listeners.set(
                type,
                (listeners.get(type) || []).filter((item) => item !== listener),
            );
        },
    };
    return {
        target,
        emit: (type: string, event: Partial<Event> = {}) => (listeners.get(type) || []).forEach((listener) => listener(event as Event)),
        count: () => [...listeners.values()].reduce((sum, items) => sum + items.length, 0),
    };
}

describe("Loading state machine: error -> retry -> ready (D3 regression)", () => {
    test("Initially loading", () => {
        expect(directorLoadInitial).toEqual({ phase: "loading", generation: 0 });
    });

    test("After failure, you can retry, retry increments generation and returns to loading", () => {
        const failed = reduceDirectorLoad(directorLoadInitial, { type: "failed", generation: 0 });
        expect(failed.phase).toBe("error");
        const retried = reduceDirectorLoad(failed, { type: "retry" });
        expect(retried).toEqual({ phase: "loading", generation: 1 });
        const ready = reduceDirectorLoad(retried, { type: "loaded", generation: 1 });
        expect(ready).toEqual({ phase: "ready", generation: 1 });
    });

    test("Late success callbacks for old generation are ignored", () => {
        const retried = reduceDirectorLoad(reduceDirectorLoad(directorLoadInitial, { type: "failed", generation: 0 }), { type: "retry" });
        expect(reduceDirectorLoad(retried, { type: "loaded", generation: 0 })).toBe(retried);
    });

    test("Late failure callbacks from the old generation will not pollute the new generation", () => {
        const retried = reduceDirectorLoad(directorLoadInitial, { type: "retry" });
        const ready = reduceDirectorLoad(retried, { type: "loaded", generation: 1 });
        expect(reduceDirectorLoad(ready, { type: "failed", generation: 0 })).toBe(ready);
        expect(ready.phase).toBe("ready");
    });

    test("start does not change generation, only returns to loading", () => {
        const ready = reduceDirectorLoad(directorLoadInitial, { type: "loaded", generation: 0 });
        expect(reduceDirectorLoad(ready, { type: "start" })).toEqual({ phase: "loading", generation: 0 });
    });

    test("Continuous retry increases monotonically, and old callbacks are always rejected.", () => {
        let state = directorLoadInitial;
        for (let index = 0; index < 3; index += 1) state = reduceDirectorLoad(state, { type: "retry" });
        expect(state.generation).toBe(3);
        [0, 1, 2].forEach((generation) => expect(reduceDirectorLoad(state, { type: "loaded", generation })).toBe(state));
        expect(reduceDirectorLoad(state, { type: "loaded", generation: 3 }).phase).toBe("ready");
    });
});

describe("WebGL context listening (D2 regression)", () => {
    test("lost must preventDefault, otherwise the browser will not reissue restored", () => {
        const canvas = fakeCanvas();
        const events: string[] = [];
        installDirectorContextListeners(canvas.target, { onLost: () => events.push("lost"), onRestored: () => events.push("restored") });
        let prevented = 0;
        canvas.emit("webglcontextlost", {
            preventDefault: () => {
                prevented += 1;
            },
        } as unknown as Event);
        expect(prevented).toBe(1);
        expect(events).toEqual(["lost"]);
    });

    test("restored will call back the recovery process", () => {
        const canvas = fakeCanvas();
        const events: string[] = [];
        installDirectorContextListeners(canvas.target, { onLost: () => events.push("lost"), onRestored: () => events.push("restored") });
        canvas.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        canvas.emit("webglcontextrestored");
        expect(events).toEqual(["lost", "restored"]);
    });

    test("disposer accurately removes all monitors", () => {
        const canvas = fakeCanvas();
        const events: string[] = [];
        const dispose = installDirectorContextListeners(canvas.target, { onLost: () => events.push("lost"), onRestored: () => events.push("restored") });
        expect(canvas.count()).toBe(2);
        dispose();
        expect(canvas.count()).toBe(0);
        canvas.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        canvas.emit("webglcontextrestored");
        expect(events).toEqual([]);
    });

    test("Repeated installation/removal without interfering with each other (renderer rebuilds the scene)", () => {
        const first = fakeCanvas();
        const second = fakeCanvas();
        const events: string[] = [];
        const disposeFirst = installDirectorContextListeners(first.target, { onLost: () => events.push("first-lost"), onRestored: () => undefined });
        disposeFirst();
        installDirectorContextListeners(second.target, { onLost: () => events.push("second-lost"), onRestored: () => undefined });
        first.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        second.emit("webglcontextlost", { preventDefault: () => undefined } as unknown as Event);
        expect(events).toEqual(["second-lost"]);
    });
});

describe("Failure registration table does not retain stale entries (regression #4)", () => {
    const retryA = () => undefined;
    const retryB = () => undefined;

    test("error registration -> unmounted logout -> empty table", () => {
        const registered = upsertDirectorFailedLoad({}, "a", "error", retryA);
        expect(Object.keys(registered)).toEqual(["a"]);
        expect(upsertDirectorFailedLoad(registered, "a", "unmounted", retryA)).toEqual({});
    });

    test("retrying back to loading will remove the entry", () => {
        const registered = upsertDirectorFailedLoad({}, "a", "error", retryA);
        expect(upsertDirectorFailedLoad(registered, "a", "loading", retryA)).toEqual({});
    });

    test("ready will also be removed", () => {
        const registered = upsertDirectorFailedLoad({}, "a", "error", retryA);
        expect(upsertDirectorFailedLoad(registered, "a", "ready", retryA)).toEqual({});
    });

    test("Unregistering an object does not affect adjacent objects", () => {
        let table: DirectorFailedLoads = {};
        table = upsertDirectorFailedLoad(table, "a", "error", retryA);
        table = upsertDirectorFailedLoad(table, "b", "error", retryB);
        expect(Object.keys(table).sort()).toEqual(["a", "b"]);
        const afterUnmount = upsertDirectorFailedLoad(table, "a", "unmounted", retryA);
        expect(Object.keys(afterUnmount)).toEqual(["b"]);
        expect(afterUnmount.b).toBe(retryB);
    });

    test("Repeating errors does not generate new references (avoiding unnecessary re-rendering)", () => {
        const registered = upsertDirectorFailedLoad({}, "a", "error", retryA);
        expect(upsertDirectorFailedLoad(registered, "a", "error", retryA)).toBe(registered);
    });

    test("removeDirectorFailedLoad is a no-op operation for non-existent ids.", () => {
        const table = upsertDirectorFailedLoad({}, "a", "error", retryA);
        expect(removeDirectorFailedLoad(table, "missing")).toBe(table);
        expect(removeDirectorFailedLoad(table, "a")).toEqual({});
    });
});

describe("capture availability lost/restored with context (regression in #7)", () => {
    test("Not available when not registered", () => {
        expect(directorCaptureUsable(directorCaptureInitial)).toBe(false);
    });

    test("Available after registration; unavailable immediately during lost period", () => {
        const registered = reduceDirectorCapture(directorCaptureInitial, "register");
        expect(directorCaptureUsable(registered)).toBe(true);
        const lost = reduceDirectorCapture(registered, "lost");
        expect(directorCaptureUsable(lost)).toBe(false);
    });

    test("You must re-register after restored to be available.", () => {
        const lost = reduceDirectorCapture(reduceDirectorCapture(directorCaptureInitial, "register"), "lost");
        const restored = reduceDirectorCapture(lost, "restored");
        expect(restored.contextLost).toBe(false);
        expect(directorCaptureUsable(restored)).toBe(false);
        expect(directorCaptureUsable(reduceDirectorCapture(restored, "register"))).toBe(true);
    });

    test("reset (manual reconstruction) to return to the unavailable initial state", () => {
        const registered = reduceDirectorCapture(directorCaptureInitial, "register");
        expect(reduceDirectorCapture(registered, "reset")).toEqual(directorCaptureInitial);
    });

    test("restoreDirectorCapture registered=true / contextLost=false after going through the complete sequence (#7 production wiring return)", () => {
        // 用生产 handler 调用的同一个 helper 驱动真实 reducer，
        // 避免「reducer 单测过、生产漏掉 register」这种脱节。
        let state = reduceDirectorCapture(reduceDirectorCapture(directorCaptureInitial, "register"), "lost");
        expect(directorCaptureUsable(state)).toBe(false);
        const contexts: string[] = [];
        let invalidated = 0;
        restoreDirectorCapture<string>({
            readContext: () => "renderer-after-restore",
            onAvailability: (event) => {
                state = reduceDirectorCapture(state, event);
            },
            onRegister: (context) => {
                contexts.push(context);
                state = reduceDirectorCapture(state, "register");
            },
            invalidate: () => {
                invalidated += 1;
            },
        });
        expect(contexts).toEqual(["renderer-after-restore"]);
        expect(state).toEqual({ registered: true, contextLost: false });
        expect(directorCaptureUsable(state)).toBe(true);
        expect(invalidated).toBe(1);
    });

    test("Sequence order fixed: reset availability first, then register, then redraw", () => {
        const order: string[] = [];
        restoreDirectorCapture<string>({
            readContext: () => "ctx",
            onAvailability: () => order.push("availability"),
            onRegister: () => order.push("register"),
            invalidate: () => order.push("invalidate"),
        });
        expect(order).toEqual(["availability", "register", "invalidate"]);
    });

    test("When only availability is used but register is omitted, it is still unavailable (explaining the defective state)", () => {
        let state = reduceDirectorCapture(reduceDirectorCapture(directorCaptureInitial, "register"), "lost");
        state = reduceDirectorCapture(state, "restored");
        expect(state.contextLost).toBe(false);
        expect(directorCaptureUsable(state)).toBe(false);
    });

    test("readContext is evaluated once during registration, and what is obtained is the new reference after restoration.", () => {
        let reads = 0;
        const seen: string[] = [];
        restoreDirectorCapture<string>({
            readContext: () => {
                reads += 1;
                return `ctx-${reads}`;
            },
            onAvailability: () => undefined,
            onRegister: (context) => seen.push(context),
        });
        expect(reads).toBe(1);
        expect(seen).toEqual(["ctx-1"]);
    });
});

describe("capture release path (subtree unloading/boundary capture)", () => {
    /** 与生产接线同构：captureContext ref + capture reducer，只是不挂 React。 */
    function harness() {
        let context: string | null = null;
        let state = directorCaptureInitial;
        return {
            usable: () => directorCaptureUsable(state) && context !== null,
            context: () => context,
            register: (next: string) => {
                context = next;
                state = reduceDirectorCapture(state, "register");
            },
            release: () =>
                releaseDirectorCapture({
                    clearContext: () => {
                        context = null;
                    },
                    onAvailability: (event) => {
                        state = reduceDirectorCapture(state, event);
                    },
                }),
            state: () => state,
        };
    }

    test("After release, the context is cleared and capture is unavailable.", () => {
        const h = harness();
        h.register("renderer-1");
        expect(h.usable()).toBe(true);
        h.release();
        expect(h.context()).toBeNull();
        expect(h.state()).toEqual(directorCaptureInitial);
        expect(h.usable()).toBe(false);
    });

    test("After release, the new renderer can still be re-registered (the retry path is not blocked)", () => {
        const h = harness();
        h.register("renderer-1");
        h.release();
        h.register("renderer-2");
        expect(h.context()).toBe("renderer-2");
        expect(h.usable()).toBe(true);
    });

    test("Repeated release is idempotent, and reset returns the same reference in the initial state (avoiding infinite render)", () => {
        const h = harness();
        h.register("renderer-1");
        h.release();
        const first = h.state();
        h.release();
        expect(h.state()).toBe(first);
        expect(h.usable()).toBe(false);
    });

    test("During the context loss, release is also reset to zero, and no contextLost remains.", () => {
        const h = harness();
        h.register("renderer-1");
        const lost = reduceDirectorCapture(h.state(), "lost");
        expect(directorCaptureUsable(lost)).toBe(false);
        h.release();
        expect(h.state()).toEqual(directorCaptureInitial);
        expect(h.context()).toBeNull();
    });
});

describe("Expose identity to block old resources during render phase (return to #2)", () => {
    test("identity is determined by generation and parsing input", () => {
        const base = { generation: 0, url: "a.glb", storageKey: "k", kind: "model" };
        expect(directorLoadIdentity(base)).toBe(directorLoadIdentity({ ...base }));
        expect(directorLoadIdentity({ ...base, generation: 1 })).not.toBe(directorLoadIdentity(base));
        expect(directorLoadIdentity({ ...base, url: "b.glb" })).not.toBe(directorLoadIdentity(base));
        expect(directorLoadIdentity({ ...base, storageKey: "k2" })).not.toBe(directorLoadIdentity(base));
        expect(directorLoadIdentity({ ...base, kind: "actor" })).not.toBe(directorLoadIdentity(base));
    });

    test("The time you change the URL, render immediately stops handing over the old resources.", () => {
        const oldIdentity = directorLoadIdentity({ generation: 0, url: "old.glb" });
        const loaded = { identity: oldIdentity, value: "old-model" };
        // 仍是同一 identity：正常展示。
        expect(resolveDirectorDisplay(loaded, oldIdentity)).toBe("old-model");
        // URL 变化后的第一次 render：identity 不匹配，立即当作无资源（此时 cleanup 还没 dispose）。
        expect(resolveDirectorDisplay(loaded, directorLoadIdentity({ generation: 0, url: "new.glb" }))).toBeNull();
    });

    test("After retry increments generation, old resources are also blocked.", () => {
        const loaded = { identity: directorLoadIdentity({ generation: 0, url: "a.glb" }), value: "gen0" };
        expect(resolveDirectorDisplay(loaded, directorLoadIdentity({ generation: 1, url: "a.glb" }))).toBeNull();
    });

    test("Empty state safety", () => {
        expect(resolveDirectorDisplay(null, directorLoadIdentity({ generation: 0 }))).toBeNull();
    });
});
