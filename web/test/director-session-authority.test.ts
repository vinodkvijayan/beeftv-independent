import { describe, expect, test } from "bun:test";

import { createDirectorTransaction } from "../src/lib/canvas/director/director-gesture-transaction";
import { isDirectorOutputSnapshotCurrent, isDirectorOutputTargetCurrent, mergeDirectorOutputPreview, shouldReinitializeDirectorSession, upsertDirectorSceneById } from "../src/lib/canvas/director/director-session";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import type { DirectorScene } from "../src/types/director";

function scene(id: string, title = id): DirectorScene {
    return { ...createDirectorScene(title), id };
}

describe("Session initialization judgment: only recognize scene id (A1 regression)", () => {
    test("The first mount will initialize", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: null, nextSceneId: "s1" })).toBe(true);
    });

    test("The parent image reflow with the same ID does not rebuild the session.", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: "s1", nextSceneId: "s1" })).toBe(false);
    });

    test("Switch to a different scene id before rebuilding", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: "s1", nextSceneId: "s2" })).toBe(true);
    });

    test("No initialization when there is no scene", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: "s1", nextSceneId: null })).toBe(false);
        expect(shouldReinitializeDirectorSession({ initializedSceneId: null, nextSceneId: null })).toBe(false);
    });

    test("Only the time when the id changes in the mirror reflow sequence will be rebuilt.", () => {
        let initialized: string | null = null;
        const rebuilds: string[] = [];
        ["s1", "s1", "s1", "s2", "s2"].forEach((nextSceneId) => {
            if (!shouldReinitializeDirectorSession({ initializedSceneId: initialized, nextSceneId })) return;
            initialized = nextSceneId;
            rebuilds.push(nextSceneId);
        });
        expect(rebuilds).toEqual(["s1", "s2"]);
    });
});

describe("upsertDirectorSceneById: Continuous saving without losing scene (A6 return)", () => {
    test("After saving A/B continuously, both are present.", () => {
        const a = scene("a");
        const b = scene("b");
        const afterA = upsertDirectorSceneById([], a);
        const afterB = upsertDirectorSceneById(afterA, b);
        expect(afterB.map((item) => item.id)).toEqual(["a", "b"]);
    });

    test("The same id is replaced rather than appended", () => {
        const first = scene("a", "old title");
        const second = { ...first, title: "new title" };
        const next = upsertDirectorSceneById([first], second);
        expect(next).toHaveLength(1);
        expect(next[0].title).toBe("new title");
    });

    test("Replacement does not affect the order and content of other scenes.", () => {
        const list = [scene("a"), scene("b"), scene("c")];
        const next = upsertDirectorSceneById(list, { ...list[1], title: "modified b" });
        expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
        expect(next[0]).toBe(list[0]);
        expect(next[2]).toBe(list[2]);
        expect(next[1].title).toBe("modified b");
    });

    test("Successive saves based on the latest array are not overwritten with older snapshots", () => {
        // 模拟缺陷：第二次保存若以「第一次之前的数组」为基准，就会丢掉 a。
        const a = scene("a");
        const b = scene("b");
        const stale: DirectorScene[] = [];
        const authoritative = upsertDirectorSceneById(stale, a);
        expect(upsertDirectorSceneById(stale, b).map((item) => item.id)).toEqual(["b"]);
        expect(upsertDirectorSceneById(authoritative, b).map((item) => item.id)).toEqual(["a", "b"]);
    });
});

describe("Asynchronous output only merges preview references and does not cover the latest scene", () => {
    test("Before and after resource registration is completed, you must confirm that the project, node, and lens are still the same output target.", () => {
        const latest = scene("s1");
        const target = {
            currentProjectId: "project-1",
            outputProjectId: "project-1",
            projectExists: true,
            sourceNode: { id: "node-1", metadata: { directorSceneId: "s1" } },
            sourceNodeId: "node-1",
            latestScene: latest,
            sceneId: "s1",
            shotId: latest.shots[0].id,
        };
        expect(isDirectorOutputTargetCurrent(target)).toBe(true);
        expect(isDirectorOutputTargetCurrent({ ...target, currentProjectId: "project-2" })).toBe(false);
        expect(isDirectorOutputTargetCurrent({ ...target, projectExists: false })).toBe(false);
        expect(isDirectorOutputTargetCurrent({ ...target, sourceNode: undefined })).toBe(false);
        expect(isDirectorOutputTargetCurrent({ ...target, sourceNode: { id: "node-1", metadata: { directorSceneId: "s2" } } })).toBe(false);
        expect(isDirectorOutputTargetCurrent({ ...target, latestScene: undefined })).toBe(false);
        expect(isDirectorOutputTargetCurrent({ ...target, shotId: "deleted-shot" })).toBe(false);
    });
    test("Preserve scene and shot edits that occurred during upload", () => {
        const latest = scene("s1", "Title changed during upload");
        const shotId = latest.shots[0].id;
        latest.shots[0] = { ...latest.shots[0], name: "Shots modified during upload" };
        const merged = mergeDirectorOutputPreview(latest, { sceneId: latest.id, shotId, previewNodeId: "preview-1" });
        expect(merged?.title).toBe("Title changed during upload");
        expect(merged?.shots[0].name).toBe("Shots modified during upload");
        expect(merged?.shots[0].previewNodeId).toBe("preview-1");
        expect(merged?.shots[0].depthNodeId).toBeUndefined();
        expect(merged?.shots[0].normalNodeId).toBeUndefined();
    });

    test("Refuse to merge when scenes or shots have been switched/deleted", () => {
        const latest = scene("s1");
        expect(mergeDirectorOutputPreview(latest, { sceneId: "other", shotId: latest.shots[0].id, previewNodeId: "preview" })).toBeNull();
        expect(mergeDirectorOutputPreview(latest, { sceneId: latest.id, shotId: "missing", previewNodeId: "preview" })).toBeNull();
    });
});

describe("Snapshot of the scene at the beginning of the screenshot and recording binding", () => {
    test("The same scene snapshot reference and the same active lens are allowed to continue.", () => {
        const current = scene("s1");
        const expected = { scene: current, shotId: current.shots[0].id };
        expect(isDirectorOutputSnapshotCurrent(current, expected)).toBe(true);
        expect(isDirectorOutputSnapshotCurrent({ ...current }, expected)).toBe(false);
        expect(isDirectorOutputSnapshotCurrent(null, expected)).toBe(false);
    });

    test("Refuses to continue when active camera switches, even if the original camera still exists", () => {
        const current = scene("s1");
        const originalShot = current.shots[0];
        const otherShot = { ...originalShot, id: "shot-2", name: "Shot 2" };
        const withOtherActive = { ...current, shots: [originalShot, otherShot], activeShotId: otherShot.id };
        expect(isDirectorOutputSnapshotCurrent(withOtherActive, { scene: withOtherActive, shotId: originalShot.id })).toBe(false);
    });
});

describe("Publish boundaries for previews and persistent changes (A2/A3/A4 regression)", () => {
    /** 最小 session controller：与 workbench 的接线同构，但不依赖 React 挂载。 */
    function harness(initial: DirectorScene) {
        const published: DirectorScene[] = [];
        const history: DirectorScene[] = [];
        const flushes: number[] = [];
        let draft = initial;
        const publish = () => published.push(draft);
        const staged = createDirectorTransaction<DirectorScene>({
            read: () => draft,
            restore: (snapshot) => {
                draft = snapshot;
            },
            commit: (from) => {
                history.push(from);
                publish();
            },
            setActive: () => undefined,
        });
        return {
            published,
            history,
            current: () => draft,
            /** 普通持久提交：先终结暂存手势，再发布。 */
            commit: (next: DirectorScene) => {
                staged.end("commit");
                history.push(draft);
                draft = next;
                publish();
            },
            /** 进行中预览：写草稿但不发布。 */
            stage: (next: DirectorScene) => {
                staged.begin();
                draft = next;
            },
            settle: () => staged.end("commit"),
            cancel: () => staged.end("cancel"),
            close: () => {
                staged.end("cancel");
                publish();
            },
            /** pagehide：active 由 commit 自己 publish，idle 才显式 publish，最后 flush。 */
            pagehide: () => {
                if (staged.active()) staged.end("commit");
                else publish();
                flushes.push(published.length);
            },
            flushes,
        };
    }

    test("The ongoing preview is not published, and the successful final state is only published once.", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.stage({ ...base, title: "Dragging 1" });
        session.stage({ ...base, title: "Dragging 2" });
        expect(session.published).toHaveLength(0);
        session.settle();
        expect(session.published).toHaveLength(1);
        expect(session.published[0].title).toBe("Dragging 2");
    });

    test("Canceled preview values never go into published canonical", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.stage({ ...base, title: "will be cancelled" });
        session.cancel();
        expect(session.published).toHaveLength(0);
        expect(session.current().title).toBe("starting point");
        // 后续关闭发布的是恢复后的值。
        session.close();
        expect(session.published.map((item) => item.title)).toEqual(["starting point"]);
    });

    test("Before closing, cancel the unfinished preview and then publish the restored draft.", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.stage({ ...base, title: "Not over" });
        session.close();
        expect(session.published).toHaveLength(1);
        expect(session.published[0].title).toBe("starting point");
    });

    test("Terminate the temporary save gesture before normal submission. The two changes are released separately and the history is not connected.", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.stage({ ...base, title: "in slider" });
        session.commit({ ...base, title: "another action" });
        expect(session.published.map((item) => item.title)).toEqual(["in slider", "another action"]);
        expect(session.history).toHaveLength(2);
    });

    test("Leaving the page while preview is in progress: Publish only once (return of #6)", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.stage({ ...base, title: "Not settled before departure" });
        session.pagehide();
        // 缺陷版本会 commit publish 一次 + 无条件 publishDraft 再一次。
        expect(session.published).toHaveLength(1);
        expect(session.published[0].title).toBe("Not settled before departure");
        // flush 必须发生在发布之后，否则会把旧快照写盘。
        expect(session.flushes).toEqual([1]);
    });

    test("Leaving the page without an in-progress preview: Explicitly publish once", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.pagehide();
        expect(session.published).toHaveLength(1);
        expect(session.flushes).toEqual([1]);
    });

    test("After leaving the page, pagehide will not repeat the same gesture.", () => {
        const base = scene("s1", "starting point");
        const session = harness(base);
        session.stage({ ...base, title: "one drag" });
        session.pagehide();
        session.pagehide();
        // 第二次是 idle 分支：显式发布当前 canonical，仍然各自恰好一次。
        expect(session.published.map((item) => item.title)).toEqual(["one drag", "one drag"]);
        expect(session.history).toHaveLength(1);
        expect(session.flushes).toEqual([1, 2]);
    });
});
