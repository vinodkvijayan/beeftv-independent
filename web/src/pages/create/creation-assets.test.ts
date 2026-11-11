import assert from "node:assert/strict";
import test from "node:test";

// Node 原生 TypeScript 测试运行器要求保留扩展名，项目编译器不允许该写法。
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { creationAssetKey, isSameCreationAsset } from "./creation-assets.ts";

test("The same result of the same task can only match the same material", () => {
    const identity = { taskId: "task-1", resultIndex: 0 };
    const asset = { metadata: { creationAssetKey: creationAssetKey(identity) } };

    assert.equal(isSameCreationAsset(asset, identity), true);
    assert.equal(isSameCreationAsset(asset, { taskId: "task-1", resultIndex: 1 }), false);
});

test("Results from different tasks cannot be misjudged as duplicate material", () => {
    const asset = { metadata: { creationAssetKey: creationAssetKey({ taskId: "task-1", resultIndex: 0 }) } };

    assert.equal(isSameCreationAsset(asset, { taskId: "task-2", resultIndex: 0 }), false);
});

test("Before the fix, only the first result of the material that saved the task ID could still be recognized.", () => {
    const asset = { metadata: { source: "create-generation", taskId: "task-legacy" } };

    assert.equal(isSameCreationAsset(asset, { taskId: "task-legacy", resultIndex: 0 }), true);
    assert.equal(isSameCreationAsset(asset, { taskId: "task-legacy", resultIndex: 1 }), false);
});
