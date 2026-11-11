import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import localforage from "localforage";

import {
    DIRECTOR_ONBOARDING_KEY,
    DIRECTOR_ONBOARDING_STEPS,
    DIRECTOR_ONBOARDING_VERSION,
    advanceDirectorOnboarding,
    createDirectorOnboardingGate,
    directorOnboardingInitial,
    loadDirectorOnboardingProgress,
    parseDirectorOnboardingProgress,
    reduceDirectorOnboarding,
    resetDirectorOnboardingProgress,
    resolveDirectorOnboardingView,
    saveDirectorOnboardingProgress,
    type DirectorOnboardingAction,
    type DirectorOnboardingProgress,
    type DirectorOnboardingStorage,
} from "../src/lib/canvas/director/director-onboarding";

const ACTIVE: DirectorOnboardingProgress = directorOnboardingInitial;

function progressAt(stepId: DirectorOnboardingProgress["stepId"], status: DirectorOnboardingProgress["status"] = "active"): DirectorOnboardingProgress {
    return { version: DIRECTOR_ONBOARDING_VERSION, status, stepId };
}

/**
 * 剥掉源码里的注释再做契约断言：文档注释里出于说明目的提到的反例词
 * （比如「不是 role="dialog"」这句话本身）不该让断言把「提到」误判成「使用」。
 */
function stripComments(source: string) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 单 scope 的内存存储接缝。生产路径由 localForageStorageForScope 加 `:user:<scope>`，这里只验状态流转。 */
function memoryStorage(initial?: string) {
    const writes: string[] = [];
    let value = initial ?? null;
    const storage: DirectorOnboardingStorage = {
        getItem: async () => value,
        setItem: async (_name, next) => {
            value = next;
            writes.push(next);
        },
    };
    return {
        storage,
        writes,
        current: () => value,
    };
}

/**
 * 真实持久路径的探针：接住 localforage 的默认实例，并记录任何 localStorage 触碰。
 * 引导进度必须只走 IndexedDB —— localStorage 只允许存小型 UI 偏好。
 */
function localforageHarness(options?: { failReads?: boolean }) {
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const originalWindow = (globalThis as { window?: unknown }).window;
    const durable = new Map<string, string>();
    const localStorageCalls: string[] = [];

    const localStorageProbe = {
        getItem: (key: string) => {
            localStorageCalls.push(`get:${key}`);
            return null;
        },
        setItem: (key: string) => {
            localStorageCalls.push(`set:${key}`);
        },
        removeItem: (key: string) => {
            localStorageCalls.push(`remove:${key}`);
        },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: localStorageProbe } });
    localforage.getItem = (async (key: string) => {
        if (options?.failReads) throw new Error("indexeddb unavailable");
        return durable.get(key) ?? null;
    }) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        durable.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    return {
        durable,
        localStorageCalls,
        restore() {
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        },
    };
}

describe("User isolation", () => {
    test("The progress of the two accounts is written into their respective scope keys and is invisible to each other.", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress("user-a", progressAt("pose"));
            await saveDirectorOnboardingProgress("user-b", progressAt("apply", "completed"));

            expect([...harness.durable.keys()].sort()).toEqual([`${DIRECTOR_ONBOARDING_KEY}:user:user-a`, `${DIRECTOR_ONBOARDING_KEY}:user:user-b`]);
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(progressAt("pose"));
            expect(await loadDirectorOnboardingProgress("user-b")).toEqual(progressAt("apply", "completed"));
            // 没写过的账号拿到初始进度，而不是继承别人的已完成状态。
            expect(await loadDirectorOnboardingProgress("user-c")).toEqual(ACTIVE);
        } finally {
            harness.restore();
        }
    });

    test("The progress only goes through localforage and does not touch localStorage at all.", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress("user-a", progressAt("move"));
            await loadDirectorOnboardingProgress("user-a");
            expect(harness.localStorageCalls).toEqual([]);
        } finally {
            harness.restore();
        }
    });

    test("Empty scope will always fail hard and will never fall back to the default account.", async () => {
        await expect(loadDirectorOnboardingProgress("")).rejects.toThrow("Missing user scope for director console guidance");
        await expect(loadDirectorOnboardingProgress("   ")).rejects.toThrow("Missing user scope for director console guidance");
        await expect(saveDirectorOnboardingProgress("", ACTIVE)).rejects.toThrow("Missing user scope for director console guidance");
        await expect(advanceDirectorOnboarding("", ACTIVE, "next")).rejects.toThrow("Missing user scope for director console guidance");
    });

    test("Storage layer failure is thrown upward and does not pretend to be initial progress", async () => {
        const harness = localforageHarness({ failReads: true });
        try {
            await expect(loadDirectorOnboardingProgress("user-a")).rejects.toThrow("indexeddb unavailable");
        } finally {
            harness.restore();
        }
    });
});

describe("Version lapse and dirty data", () => {
    test("Old progress that does not match the version will be discarded entirely and return to the first step.", () => {
        const stale = JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION - 1, status: "completed", stepId: "apply" });
        expect(parseDirectorOnboardingProgress(stale)).toEqual(ACTIVE);
    });

    test("Missing, non-JSON, non-object, and persistent values with out-of-bounds fields fall back to the initial progress", () => {
        const dirty = [
            null,
            undefined,
            "",
            "{",
            "not json",
            "[]",
            '"active"',
            "42",
            "null",
            JSON.stringify({ status: "active", stepId: "actor" }),
            JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: "paused", stepId: "actor" }),
            JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "lighting" }),
            JSON.stringify({ version: "2", status: "active", stepId: "actor" }),
            JSON.stringify([{ version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "actor" }]),
        ];
        for (const raw of dirty) expect(parseDirectorOnboardingProgress(raw)).toEqual(ACTIVE);
    });

    test("Dirty persistent values will only get the initial progress through the real read path.", async () => {
        const harness = localforageHarness();
        try {
            harness.durable.set(`${DIRECTOR_ONBOARDING_KEY}:user:user-a`, "{ broken");
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(ACTIVE);
        } finally {
            harness.restore();
        }
    });

    test("When placing the order, only controlled fields are written and unknown fields are not written back.", async () => {
        const store = memoryStorage();
        await saveDirectorOnboardingProgress("user-a", { ...progressAt("move"), extra: "x" } as DirectorOnboardingProgress, store.storage);
        expect(JSON.parse(store.writes[0])).toEqual({ version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "move" });
    });

    test("When the state machine encounters a non-existent step, it returns to the initial progress instead of crossing the boundary.", () => {
        const bogus = { version: DIRECTOR_ONBOARDING_VERSION, status: "active", stepId: "lighting" } as unknown as DirectorOnboardingProgress;
        expect(reduceDirectorOnboarding(bogus, "next")).toEqual(ACTIVE);
        expect(reduceDirectorOnboarding(bogus, "back")).toEqual(ACTIVE);
        expect(resolveDirectorOnboardingView(bogus)).toBeNull();
    });
});

describe("Step flow", () => {
    test("Next completes the six steps in sequence, and the last step, next, ends the guidance.", () => {
        let progress = ACTIVE;
        const visited = [progress.stepId];
        for (let i = 0; i < DIRECTOR_ONBOARDING_STEPS.length - 1; i += 1) {
            progress = reduceDirectorOnboarding(progress, "next");
            visited.push(progress.stepId);
        }
        expect(visited).toEqual(DIRECTOR_ONBOARDING_STEPS.map((step) => step.id));
        expect(progress.status).toBe("active");

        const done = reduceDirectorOnboarding(progress, "next");
        expect(done.status).toBe("completed");
        // 完成是终态：停在最后一步，且不再前进。
        expect(done.stepId).toBe(DIRECTOR_ONBOARDING_STEPS[DIRECTOR_ONBOARDING_STEPS.length - 1].id);
        expect(reduceDirectorOnboarding(done, "next")).toBe(done);
    });

    test("back means going back step by step. The first step is back means staying put and not closing the boot.", () => {
        const second = reduceDirectorOnboarding(ACTIVE, "next");
        expect(reduceDirectorOnboarding(second, "back").stepId).toBe("actor");
        expect(reduceDirectorOnboarding(ACTIVE, "back")).toBe(ACTIVE);
        expect(reduceDirectorOnboarding(ACTIVE, "back").status).toBe("active");
    });

    test("dismiss and complete are both final states, next/back/dismiss/complete cannot be awakened", () => {
        for (const status of ["dismissed", "completed"] as const) {
            const frozen = progressAt("move", status);
            for (const action of ["next", "back", "dismiss", "complete"] as const) {
                expect(reduceDirectorOnboarding(frozen, action)).toBe(frozen);
            }
            expect(resolveDirectorOnboardingView(frozen)).toBeNull();
        }
    });

    test("reset is the only action that can revive skipped/completed boot", () => {
        expect(reduceDirectorOnboarding(progressAt("apply", "dismissed"), "reset")).toEqual(ACTIVE);
        expect(reduceDirectorOnboarding(progressAt("apply", "completed"), "reset")).toEqual(ACTIVE);
        expect(reduceDirectorOnboarding(progressAt("pose"), "reset")).toEqual(ACTIVE);
    });

    test("dismiss retains the current step and returns to the first step after reset", () => {
        const dismissed = reduceDirectorOnboarding(progressAt("pose"), "dismiss");
        expect(dismissed).toEqual(progressAt("pose", "dismissed"));
        expect(reduceDirectorOnboarding(dismissed, "reset").stepId).toBe("actor");
    });

    test("The display state gives the starting position of 1 and the first and last marks", () => {
        const first = resolveDirectorOnboardingView(ACTIVE);
        expect(first).toEqual({ step: DIRECTOR_ONBOARDING_STEPS[0], position: 1, total: DIRECTOR_ONBOARDING_STEPS.length, isFirst: true, isLast: false });

        const last = resolveDirectorOnboardingView(progressAt("apply"));
        expect(last?.position).toBe(DIRECTOR_ONBOARDING_STEPS.length);
        expect(last?.isLast).toBe(true);
        expect(last?.isFirst).toBe(false);
    });
});

describe("Push forward and place the order", () => {
    test("Each effective push is written to the disk, and the return value is consistent with the disk.", async () => {
        const store = memoryStorage();
        const second = await advanceDirectorOnboarding("user-a", ACTIVE, "next", store.storage);
        expect(second.stepId).toBe("move");
        expect(parseDirectorOnboardingProgress(store.current())).toEqual(second);

        const dismissed = await advanceDirectorOnboarding("user-a", second, "dismiss", store.storage);
        expect(dismissed.status).toBe("dismissed");
        expect(parseDirectorOnboardingProgress(store.current())).toEqual(dismissed);
        expect(store.writes).toHaveLength(2);
    });

    test("Actions without changes do not write to disk", async () => {
        const store = memoryStorage();
        expect(await advanceDirectorOnboarding("user-a", ACTIVE, "back", store.storage)).toBe(ACTIVE);
        const frozen = progressAt("move", "completed");
        expect(await advanceDirectorOnboarding("user-a", frozen, "next", store.storage)).toBe(frozen);
        expect(store.writes).toEqual([]);
    });

    test("Failure to write to the disk is thrown upward, and the caller retains the old progress.", async () => {
        const failing: DirectorOnboardingStorage = {
            getItem: async () => null,
            setItem: async () => {
                throw new Error("indexeddb write failed");
            },
        };
        await expect(advanceDirectorOnboarding("user-a", ACTIVE, "next", failing)).rejects.toThrow("indexeddb write failed");
    });

    test("Restore from disk to same steps after reboot", async () => {
        const harness = localforageHarness();
        try {
            const second = await advanceDirectorOnboarding("user-a", ACTIVE, "next");
            const third = await advanceDirectorOnboarding("user-a", second, "next");
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(third);
            expect(resolveDirectorOnboardingView(third)?.step.id).toBe("pose");
        } finally {
            harness.restore();
        }
    });
});

describe("scope normalization and concurrent write lock", () => {
    test("Regression: When injecting storage, the blank scope still fails hard, and the detection is not missed because the default localforage branch is skipped.", async () => {
        const store = memoryStorage();
        await expect(loadDirectorOnboardingProgress("   ", store.storage)).rejects.toThrow("Missing user scope for director console guidance");
        await expect(saveDirectorOnboardingProgress("", ACTIVE, store.storage)).rejects.toThrow("Missing user scope for director console guidance");
        await expect(advanceDirectorOnboarding(" ", ACTIVE, "next", store.storage)).rejects.toThrow("Missing user scope for director console guidance");
        await expect(resetDirectorOnboardingProgress("\t", store.storage)).rejects.toThrow("Missing user scope for director console guidance");
        expect(store.writes).toEqual([]);
    });

    test("advance also unconditionally checks scope for unchanged actions, and does not miss detection due to early return.", async () => {
        await expect(advanceDirectorOnboarding("", ACTIVE, "back")).rejects.toThrow("Missing user scope for director console guidance");
        await expect(advanceDirectorOnboarding("   ", progressAt("apply", "completed"), "next")).rejects.toThrow("Missing user scope for director console guidance");
    });

    test("The white space before and after the scope is normalized, and it shares the same production key with the cropped scope and does not separate from each other.", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress(" user-a ", progressAt("pose"));
            expect([...harness.durable.keys()]).toEqual([`${DIRECTOR_ONBOARDING_KEY}:user:user-a`]);
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(progressAt("pose"));
            expect(await loadDirectorOnboardingProgress("  user-a")).toEqual(progressAt("pose"));
            expect(await loadDirectorOnboardingProgress("user-a\t")).toEqual(progressAt("pose"));
        } finally {
            harness.restore();
        }
    });

    test("resetDirectorOnboardingProgress allows the skipped/completed account to return to the first step of activation and place the order", async () => {
        const store = memoryStorage(JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: "completed", stepId: "apply" }));
        const result = await resetDirectorOnboardingProgress("user-a", store.storage);
        expect(result).toEqual(ACTIVE);
        expect(parseDirectorOnboardingProgress(store.current())).toEqual(ACTIVE);
    });

    test("resetDirectorOnboardingProgress can also revive the skipped boot through the real persistence layer", async () => {
        const harness = localforageHarness();
        try {
            await saveDirectorOnboardingProgress("user-a", progressAt("apply", "dismissed"));
            expect(await resetDirectorOnboardingProgress("user-a")).toEqual(ACTIVE);
            expect(await loadDirectorOnboardingProgress("user-a")).toEqual(ACTIVE);
        } finally {
            harness.restore();
        }
    });

    test("Write lock: Repeated entry during the lock period is rejected, and can be entered again after release. Release itself is idempotent.", () => {
        const gate = createDirectorOnboardingGate();
        expect(gate.tryEnter()).toBe(true);
        expect(gate.tryEnter()).toBe(false);
        expect(gate.tryEnter()).toBe(false);
        gate.release();
        expect(gate.tryEnter()).toBe(true);
        gate.release();
        expect(() => gate.release()).not.toThrow();
        expect(gate.tryEnter()).toBe(true);
    });

    test("Repeated actions within the same tick only produce one write (the replica hook uses a write lock to call repeatedly)", async () => {
        const store = memoryStorage();
        const gate = createDirectorOnboardingGate();
        const progress = ACTIVE;
        const fire = (action: DirectorOnboardingAction) => {
            if (!gate.tryEnter()) return null;
            return advanceDirectorOnboarding("user-a", progress, action, store.storage).finally(() => gate.release());
        };
        const first = fire("next");
        const second = fire("next");
        expect(second).toBeNull();
        const resolved = await first;
        expect(resolved?.stepId).toBe("move");
        expect(store.writes).toHaveLength(1);
        // 锁已经 release，后续调用不再被挡。
        expect(gate.tryEnter()).toBe(true);
    });

    test("Cross-generation isolation: release locks captured by the old generation must not misplace locks that are still being written by the new generation.", () => {
        // 精确复刻 hook 的接线方式：换代时把 ref 换成全新的 gate 实例（不 release 旧实例），
        // 每次调用在拿锁的同一刻把 ref 当前指向的实例捕获进局部变量，release 只作用在这份捕获上，
        // 绝不在写入收尾时重新读一次 ref（那时 ref 可能已经转向了新一代的锁）。
        let gateRef = createDirectorOnboardingGate();

        function fire() {
            const gate = gateRef; // 同步捕获调用时刻的实例，而不是稍后再读 gateRef
            const entered = gate.tryEnter();
            return { entered, release: () => gate.release() };
        }

        // 第一代发起一次写入，锁定 gen1 的 gate。
        const gen1 = fire();
        expect(gen1.entered).toBe(true);

        // scope 切换：effect 把 ref 换成全新实例，不 release 旧实例 —— gen1 的写入仍在途、仍锁着自己那把。
        gateRef = createDirectorOnboardingGate();

        // 第二代应该立刻拿到全新的锁，不受 gen1 未完成写入的影响。
        const gen2 = fire();
        expect(gen2.entered).toBe(true);

        // gen2 写入还没收尾时，gen2 的重复调用必须被自己的锁挡住。
        expect(fire().entered).toBe(false);

        // gen1 的写入这时才收尾：它释放的是自己捕获的 gen1 实例，对 gen2 的锁没有任何影响。
        gen1.release();
        expect(fire().entered).toBe(false); // gen2 依旧锁着，没有被 gen1 的 release 误放。

        // gen2 的写入收尾，释放自己的锁，之后才能再次进入。
        gen2.release();
        expect(fire().entered).toBe(true);
    });
});

describe("step content contract", () => {
    test("Six steps covering adding actors, movement, posture, trajectory, CAM and application, in a fixed order", () => {
        expect(DIRECTOR_ONBOARDING_STEPS.map((step) => step.id)).toEqual(["actor", "move", "pose", "path", "camera", "apply"]);
    });

    test("Each step has a title and executable instructions, and the ID is not repeated.", () => {
        for (const step of DIRECTOR_ONBOARDING_STEPS) {
            expect(step.title.length).toBeGreaterThan(0);
            expect(step.detail.length).toBeGreaterThan(0);
        }
        expect(new Set(DIRECTOR_ONBOARDING_STEPS.map((step) => step.id)).size).toBe(DIRECTOR_ONBOARDING_STEPS.length);
    });

    test("Each step is given a corresponding first-level mode, covering posing, posture, animation and camera", () => {
        const byId = Object.fromEntries(DIRECTOR_ONBOARDING_STEPS.map((step) => [step.id, step]));
        expect(byId.actor.mode).toBe("layout");
        expect(byId.move.mode).toBe("layout");
        expect(byId.pose.mode).toBe("pose");
        expect(byId.path.mode).toBe("animate");
        expect(byId.camera.mode).toBe("camera");
        expect(byId.apply.mode).toBe("camera");
        for (const step of DIRECTOR_ONBOARDING_STEPS) {
            if (step.mode) expect(["layout", "pose", "animate", "camera"]).toContain(step.mode);
        }
    });

    test("The step copy points to the real entrance and does not refer to the browsing steps as task completion.", () => {
        const content = DIRECTOR_ONBOARDING_STEPS.map((step) => `${step.title} ${step.detail}`).join("\n");
        for (const label of ["Quick add", "Move tool", "attitude mode", "Transform keyframe", "CAM", "Apply to lens"]) expect(content).toContain(label);
    });
});

/**
 * 组件契约用源码断言：web 没有 jsdom/testing-library（见 package.json），
 * 这里与 create-library-button.test.ts 同一手法 —— 守住无障碍与 token 边界，
 * 而不是假装渲染过组件。
 */
describe("Guide floating layer contract", () => {
    const componentPath = resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-onboarding.tsx");
    const source = readFileSync(componentPath, "utf8");
    // 契约断言只看真正的代码：文档注释里为了解释「为什么不这样做」而提到的反例词
    // （role="dialog"、getActiveUserScope、DirectorScene）不该让断言把「提到」误判成「使用」。
    const code = stripComments(source);

    test("Non-blocking floating layer: region semantics, not dialog, and no mask or focus trap", () => {
        expect(code).toContain("<section");
        expect(code).toContain('aria-label="Director\'s hands-on guidance on stage"');
        expect(code).not.toContain('role="dialog"');
        expect(code).not.toContain("aria-modal");
        expect(code).not.toContain("Modal");
        expect(code).not.toContain(".focus()");
    });

    test("The three actions are all native buttons and have visible focus rings.", () => {
        const buttons = code.match(/<button\b/g) || [];
        expect(buttons).toHaveLength(3);
        expect(code.match(/type="button"/g) || []).toHaveLength(3);
        expect(code).toContain("Skip boot");
        expect(code).toContain("Back");
        expect(code).toContain("Next");
        expect(code).toContain("end boot");
        expect(code).not.toContain("Complete boot");
        expect(code).toContain("focus-visible:[outline:var(--stroke-2)_solid_var(--control-focus-ring)]");
    });

    test("The progress has both text and broadcast, and the decorative dots are hidden from the reading screen.", () => {
        expect(code).toContain("Step ${position} / Total steps ${total}");
        expect(code).toContain('aria-live="polite"');
        expect(code).toContain("aria-hidden");
    });

    test("The first step is to disable the previous step, and the last step is to replace the main button with neutral closing copy.", () => {
        expect(code).toContain("disabled={busy || isFirst}");
        expect(code).toContain('{isLast ? "结束引导" : "下一步"}');
    });

    test("Only use existing tokens, do not write color/rounded corners/font size literal values", () => {
        expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(code).not.toMatch(/\b(rgba?|oklch|hsla?)\(/);
        expect(code).not.toMatch(/:\s*"\d+px"/);
        expect(code).not.toMatch(/(text|rounded|z|bg|text)-\[\d/);
        for (const token of ["var(--space-3)", "var(--r-lg)", "var(--surface)", "var(--cn-text)", "var(--cn-muted)", "var(--fs-caption)", "var(--elevation-overlay)", "var(--border-semantic)"]) {
            expect(code).toContain(token);
        }
    });

    test("The scope is passed in explicitly by the caller. The component does not read the currently active scope, nor does it touch localStorage itself.", () => {
        expect(code).toContain("scope: string");
        expect(code).not.toContain("getActiveUserScope");
        expect(code).not.toMatch(/import\s*{[^}]*getActiveUserScope/);
        expect(code).not.toContain("localStorage");
        expect(code).not.toContain("localforage");
    });

    test("State and persistence all go through the director-onboarding module, and components do not copy the state machine.", () => {
        expect(code).toContain('from "@/lib/canvas/director/director-onboarding"');
        expect(code).toContain("loadDirectorOnboardingProgress");
        expect(code).toContain("advanceDirectorOnboarding");
        expect(code).toContain("resetDirectorOnboardingProgress");
        expect(code).toContain("resolveDirectorOnboardingView");
        expect(code).not.toContain("DIRECTOR_ONBOARDING_STEPS");
        expect(code).not.toContain('"dismissed"');
        expect(code).not.toContain('"completed"');
    });

    test("Concurrent write protection uses the synchronization gate: replace the new instance instead of releasing the shared instance. What is released is the lock captured when calling.", () => {
        expect(code).toContain("createDirectorOnboardingGate");
        // 换代必须新建实例，绝不能对共享的旧实例调用 release —— 那会把旧一代还没收尾的写入
        // 和新一代刚建好的锁混在一起判定。
        expect(code).toContain("gateRef.current = createDirectorOnboardingGate()");
        expect(code).not.toContain("gateRef.current.release()");
        // run() 必须在拿锁的同一刻把 gateRef.current 同步捕获进局部变量，
        // tryEnter/release 都作用在这份捕获上，绝不在写入收尾时重新读取 gateRef.current。
        expect(code).toMatch(/const\s+gate\s*=\s*gateRef\.current;/);
        expect(code).toContain("gate.tryEnter()");
        expect(code).toContain("gate.release()");
    });

    test("External restart signals can also be reset directly during loading and invalidate old read results", () => {
        expect(code).toContain("restartSignal?: number");
        expect(code).toContain("const previousRestartSignal = useRef(restartSignal)");
        expect(code).toContain("previousRestartSignal.current === restartSignal");
        expect(code).toContain("resetDirectorOnboardingProgress(normalizedScope, storage)");
        expect(code).toContain("return loadDirectorOnboardingProgress(normalizedScope, storage)");
        expect(code).not.toContain('run("reset")');

        const generationAdvance = code.indexOf("generation.current += 1", code.indexOf("const reset = useCallback"));
        const resetWrite = code.indexOf("resetDirectorOnboardingProgress(normalizedScope, storage)");
        expect(generationAdvance).toBeGreaterThan(-1);
        expect(resetWrite).toBeGreaterThan(generationAdvance);
    });

    test("The module does not write scene content, nor does it introduce history/undo", () => {
        const modelSource = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/director/director-onboarding.ts"), "utf8");
        const modelCode = stripComments(modelSource);
        expect(modelCode).not.toContain("DirectorScene");
        expect(modelCode).not.toContain("director-scene");
        expect(modelCode).not.toMatch(/\bhistory\b/i);
        expect(modelCode).not.toContain("window.localStorage");
        expect(modelCode).toContain("localForageStorageForScope");
    });
});

describe("Guide product wiring", () => {
    const projectCode = stripComments(readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8"));
    const editorDialogs = stripComments(readFileSync(resolve(import.meta.dir, "../src/pages/canvas/canvas-project-editor-dialogs.tsx"), "utf8"));
    const workbenchCode = stripComments(readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8"));
    const workbenchStyles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

    test("The page only passes the authenticated user ID to the boot, without using guest fallback or undefined variables.", () => {
        expect(projectCode).toContain('const directorOnboardingScope = useUserStore((state) => state.user?.id?.trim() || "")');
        expect(editorDialogs).toContain("directorOnboardingScope: string");
        expect(editorDialogs).toContain("onboardingScope={directorOnboardingScope}");
        expect(projectCode).not.toContain("trimmedUserId");
        expect(projectCode).not.toContain("onboardingScope={canvasStorageScope}");
    });

    test("The workbench renders modeless bootstrapping and provides a discoverable restart entry", () => {
        expect(workbenchCode).toContain('import { CanvasDirectorOnboarding } from "@/components/canvas/director/canvas-director-onboarding"');
        expect(workbenchCode).toContain("onboardingScope: string");
        expect(workbenchCode).toContain('onHelp={() => setOnboardingRestartSignal((value) => value + 1)}');
        expect(readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8")).toContain("<CanvasDirectorOnboarding");
        expect(readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8")).toContain("scope={onboardingScope}");
        expect(readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8")).toContain("restartSignal={onboardingRestartSignal}");
        expect(workbenchCode).toContain('data-director-topbar="true"');
        const responsiveTopbarStyles = workbenchStyles.match(/@media \(max-width: 1023px\) \{\s*\.director-workbench-topbar \{([^}]*)\}/)?.[1] || "";
        expect(responsiveTopbarStyles).toContain("overflow-x: auto");
        expect(responsiveTopbarStyles).toContain("overflow-y: hidden");
    });

    test("The development recurrence page enables independent scope to actually check the first boot and restart.", () => {
        const reproCode = stripComments(readFileSync(resolve(import.meta.dir, "../src/pages/dev/director-repro-lab.tsx"), "utf8"));
        expect(reproCode).toContain('onboardingScope="director-repro-lab"');
        expect(reproCode).not.toContain('onboardingScope=""');
    });
});
