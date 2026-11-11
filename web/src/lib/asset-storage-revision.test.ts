import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { parseAssetRecord } from "./asset-record.ts";

test("Historical footage with missing image data will be rejected instead of completing the renderable fields.", () => {
    assert.throws(() => parseAssetRecord({
        id: "legacy-image",
        kind: "image",
        title: "historical pictures",
        coverUrl: "https://example.com/image.png",
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: undefined,
    }), /data/);
});
