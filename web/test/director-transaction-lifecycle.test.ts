import { describe, expect, test } from "bun:test";

import { createDirectorTransaction, installDirectorTerminalListeners, type DirectorListenerTarget } from "../src/lib/canvas/director/director-gesture-transaction";

type Recorded = { commits: Array<[number, number]>; restores: number[]; active: boolean[]; terminated: number };

function harness(initial = 0) {
    const log: Recorded = { commits: [], restores: [], active: [], terminated: 0 };
    let value = initial;
    const transaction = createDirectorTransaction<number>({
        read: () => value,
        restore: (snapshot) => {
            value = snapshot;
            log.restores.push(snapshot);
        },
        commit: (from, to) => log.commits.push([from, to]),
        setActive: (next) => log.active.push(next),
        terminateDrag: () => {
            log.terminated += 1;
        },
    });
    return {
        log,
        transaction,
        set: (next: number) => {
            value = next;
        },
        get: () => value,
    };
}

function fakeTarget() {
    const listeners = new Map<string, Array<(event: Event) => void>>();
    const target: DirectorListenerTarget = {
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
    return { target, emit: (type: string, event: Partial<Event> = {}) => (listeners.get(type) || []).forEach((listener) => listener(event as Event)), count: () => [...listeners.values()].reduce((sum, items) => sum + items.length, 0) };
}

describe("Terminating the listener's installation lifecycle (regression #1)", () => {
    test("The monitoring is installed first and started after the gesture. The termination event still takes effect.", () => {
        const { log, transaction, set } = harness(5);
        const win = fakeTarget();
        const doc = fakeTarget();
        // 关键顺序：先安装监听，此时并没有活跃手势。
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        expect(win.count() + doc.count()).toBeGreaterThan(0);
        transaction.begin();
        set(9);
        win.emit("pointerup");
        expect(log.commits).toEqual([[5, 9]]);
    });

    test("Escape cancels and restores a snapshot", () => {
        const { log, transaction, set, get } = harness(1);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(42);
        win.emit("keydown", { key: "Escape" } as unknown as Event);
        expect(log.commits).toEqual([]);
        expect(get()).toBe(1);
        expect(log.terminated).toBe(1);
    });

    test("window blur retains the current visible value and only commits once (#305 Acceptance: Defocusing will not return to the origin)", () => {
        const { log, transaction, set, get } = harness(2);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(77);
        win.emit("blur");
        expect(log.commits).toEqual([[2, 77]]);
        expect(get()).toBe(77);
        expect(log.restores).toEqual([]);
        // 失焦后再来终态事件不得二次提交。
        win.emit("blur");
        win.emit("pointerup");
        expect(log.commits).toEqual([[2, 77]]);
    });

    test("document hidden retains the currently visible value and commits only once", () => {
        const { log, transaction, set, get } = harness(3);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => true });
        transaction.begin();
        set(88);
        doc.emit("visibilitychange");
        expect(log.commits).toEqual([[3, 88]]);
        expect(get()).toBe(88);
        expect(log.restores).toEqual([]);
        doc.emit("visibilitychange");
        expect(log.commits).toEqual([[3, 88]]);
    });

    test("pointercancel still cancels and restores the snapshot", () => {
        const { log, transaction, set, get } = harness(2);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(77);
        win.emit("pointercancel");
        expect(log.commits).toEqual([]);
        expect(get()).toBe(2);
        expect(log.restores).toEqual([2]);
    });

    test("Visibility events are neither submitted nor canceled when not hidden", () => {
        const { log, transaction, set } = harness(4);
        const win = fakeTarget();
        const doc = fakeTarget();
        installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        transaction.begin();
        set(6);
        doc.emit("visibilitychange");
        expect(transaction.active()).toBe(true);
        expect(log.commits).toEqual([]);
        win.emit("pointerup");
        expect(log.commits).toEqual([[4, 6]]);
    });

    test("disposer removes all monitors", () => {
        const { log, transaction, set } = harness(0);
        const win = fakeTarget();
        const doc = fakeTarget();
        const dispose = installDirectorTerminalListeners(transaction, { window: win.target, document: doc.target, isHidden: () => false });
        dispose();
        expect(win.count() + doc.count()).toBe(0);
        transaction.begin();
        set(3);
        win.emit("pointerup");
        expect(log.commits).toEqual([]);
    });
});

describe("Final state idempotence and stale base protection (#4 regression)", () => {
    test("Normal end is submitted exactly once, repeated termination is no longer submitted.", () => {
        const { log, transaction, set } = harness(1);
        transaction.begin();
        set(2);
        transaction.end("commit");
        transaction.end("commit");
        transaction.end("cancel");
        expect(log.commits).toEqual([[1, 2]]);
        expect(log.restores).toEqual([]);
        expect(log.active).toEqual([true, false]);
    });

    test("It will not be submitted after cancellation, and there will be no base left that can be consumed later.", () => {
        const { log, transaction, set, get } = harness(10);
        transaction.begin();
        set(20);
        transaction.end("cancel");
        expect(get()).toBe(10);
        // 取消后的 end 不能拿旧 base 再提交一次。
        transaction.end("commit");
        expect(log.commits).toEqual([]);
        expect(transaction.active()).toBe(false);
    });

    test("The termination when the gesture has not started is a no-op, and ordinary clicks will not be mistakenly submitted.", () => {
        const { log, transaction } = harness(7);
        transaction.end("commit");
        transaction.end("cancel");
        expect(log.commits).toEqual([]);
        expect(log.restores).toEqual([]);
        expect(log.active).toEqual([]);
    });

    test("You can restart a new gesture after the final state, and the base takes a new snapshot instead of the old value.", () => {
        const { log, transaction, set } = harness(1);
        transaction.begin();
        set(2);
        transaction.end("commit");
        set(50);
        transaction.begin();
        set(60);
        transaction.end("commit");
        expect(log.commits).toEqual([
            [1, 2],
            [50, 60],
        ]);
    });

    test("The base of the new gesture after cancellation is the restored value.", () => {
        const { log, transaction, set } = harness(5);
        transaction.begin();
        set(99);
        transaction.end("cancel");
        transaction.begin();
        set(8);
        transaction.end("commit");
        expect(log.commits).toEqual([[5, 8]]);
    });

    test("When read returns null, it does not enter the gesture, and it does not commit when it terminates.", () => {
        const log: Array<[number, number]> = [];
        const transaction = createDirectorTransaction<number>({
            read: () => null,
            restore: () => undefined,
            commit: (from, to) => log.push([from, to]),
            setActive: () => undefined,
        });
        transaction.begin();
        expect(transaction.active()).toBe(false);
        transaction.end("commit");
        expect(log).toEqual([]);
    });

    test("Submitting the path does not trigger third-party drag termination. It only triggers when canceling the path.", () => {
        const committed = harness(0);
        committed.transaction.begin();
        committed.transaction.end("commit");
        expect(committed.log.terminated).toBe(0);
        const cancelled = harness(0);
        cancelled.transaction.begin();
        cancelled.transaction.end("cancel");
        expect(cancelled.log.terminated).toBe(1);
    });
});
