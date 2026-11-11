import { describe, expect, test } from "bun:test";

import { gateDirectorPreviewFailure, resolveDirectorActiveShot, resolveDirectorPreviewSource, type DirectorNodeContentReader } from "../src/lib/canvas/director/director-preview";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import type { DirectorScene, DirectorShot } from "../src/types/director";

function scene(shots?: DirectorShot[]): DirectorScene {
    const base = createDirectorScene("Shot 1");
    return shots ? { ...base, shots, activeShotId: shots[0]?.id || base.activeShotId } : base;
}

/** 画布节点表；未登记的 id 视为已删除。 */
function reader(nodes: Record<string, string | undefined>): DirectorNodeContentReader {
    return (nodeId) => (nodeId ? nodes[nodeId] : undefined);
}

describe("Preview source priority", () => {
    test("Persistent Director Cover takes precedence over independent image node previews for older projects", () => {
        const current = scene();
        expect(resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            coverUrl: " https://assets.example/new-cover.png ",
            previewNodeId: "legacy",
            readNodeContent: reader({ legacy: "https://assets.example/legacy.png" }),
        })).toEqual({ kind: "image", url: "https://assets.example/new-cover.png" });
    });

    test("Fallback to old preview when cover is not yet parsed or is only blank", () => {
        const current = scene();
        expect(resolveDirectorPreviewSource({
            scene: current, shot: current.shots[0], coverUrl: "  ", previewNodeId: "legacy",
            readNodeContent: reader({ legacy: "https://assets.example/legacy.png" }),
        })).toEqual({ kind: "image", url: "https://assets.example/legacy.png" });
    });

    test("Fallback to still valid old preview after new cover address fails", () => {
        const current = scene();
        expect(resolveDirectorPreviewSource({
            scene: current, shot: current.shots[0], coverUrl: "https://assets.example/broken.png",
            failedUrl: "https://assets.example/broken.png", previewNodeId: "legacy",
            readNodeContent: reader({ legacy: "https://assets.example/legacy.png" }),
        })).toEqual({ kind: "image", url: "https://assets.example/legacy.png" });
    });

    test("metadata preview takes precedence over shot fallback", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "from-shot" };
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot,
            previewNodeId: "from-metadata",
            readNodeContent: reader({ "from-metadata": "data:image/png;base64,META", "from-shot": "data:image/png;base64,SHOT" }),
        });
        expect(source).toEqual({ kind: "image", url: "data:image/png;base64,META" });
    });

    test("Fall back to shot.previewNodeId when metadata is missing", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "from-shot" };
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot,
            previewNodeId: undefined,
            readNodeContent: reader({ "from-shot": "data:image/png;base64,SHOT" }),
        });
        expect(source).toEqual({ kind: "image", url: "data:image/png;base64,SHOT" });
    });

    test("Fall back to shot when the node pointed to by metadata has been deleted", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "from-shot" };
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot,
            previewNodeId: "deleted-node",
            readNodeContent: reader({ "from-shot": "data:image/png;base64,SHOT" }),
        });
        expect(source).toEqual({ kind: "image", url: "data:image/png;base64,SHOT" });
    });

    test("The node has been deleted and has no shot. It is empty when previewing and will never produce an image.", () => {
        const current = scene();
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            previewNodeId: "deleted-node",
            readNodeContent: reader({}),
        });
        expect(source).toEqual({ kind: "empty" });
    });

    test("Empty/plain space body safety fails", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "blank-shot" };
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot,
                previewNodeId: "blank-meta",
                readNodeContent: reader({ "blank-meta": "", "blank-shot": "   \n\t " }),
            }),
        ).toEqual({ kind: "empty" });
    });

    test("Leading and trailing whitespace is stripped, and the URL will not enter <img src> malformedly.", () => {
        const current = scene();
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot: current.shots[0],
                previewNodeId: "padded-meta",
                readNodeContent: reader({ "padded-meta": "  \n data:image/png;base64,PADDED \t " }),
            }),
        ).toEqual({ kind: "image", url: "data:image/png;base64,PADDED" });
    });

    test("The shot fallback path also strips the leading and trailing blanks", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "padded-shot" };
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot,
                previewNodeId: undefined,
                readNodeContent: reader({ "padded-shot": "\t https://cdn.example/preview.png \n" }),
            }),
        ).toEqual({ kind: "image", url: "https://cdn.example/preview.png" });
    });

    test("The text with only blank space is still empty and does not become an empty string URL due to trim.", () => {
        const current = scene();
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            previewNodeId: "ws-only",
            readNodeContent: reader({ "ws-only": "   \n\t\r  " }),
        });
        expect(source).toEqual({ kind: "empty" });
        expect(source).not.toHaveProperty("url");
    });

    test("When scene is null, it is in a ready state instead of an empty state.", () => {
        expect(resolveDirectorPreviewSource({ scene: null, shot: undefined, previewNodeId: undefined, readNodeContent: reader({}) })).toEqual({ kind: "loading" });
    });

    test("When scene is null but there is a real preview, the image will still be displayed first.", () => {
        expect(
            resolveDirectorPreviewSource({
                scene: null,
                shot: undefined,
                previewNodeId: "from-metadata",
                readNodeContent: reader({ "from-metadata": "data:image/png;base64,META" }),
            }),
        ).toEqual({ kind: "image", url: "data:image/png;base64,META" });
    });

    test("Having a scene but never writing back the composition is an honest and empty state", () => {
        const current = scene();
        expect(resolveDirectorPreviewSource({ scene: current, shot: current.shots[0], previewNodeId: undefined, readNodeContent: reader({}) })).toEqual({ kind: "empty" });
    });

    test("After Apply writes metadata, it changes from empty to image.", () => {
        const current = scene();
        const before = resolveDirectorPreviewSource({ scene: current, shot: current.shots[0], previewNodeId: undefined, readNodeContent: reader({}) });
        expect(before).toEqual({ kind: "empty" });
        const after = resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            previewNodeId: "image-director-1",
            readNodeContent: reader({ "image-director-1": "data:image/png;base64,APPLIED" }),
        });
        expect(after).toEqual({ kind: "image", url: "data:image/png;base64,APPLIED" });
    });
});

describe("Loading failure gate", () => {
    const image = { kind: "image", url: "data:image/png;base64,A" } as const;

    test("The failed URL will become empty immediately when it is consistent with the current URL.", () => {
        expect(gateDirectorPreviewFailure(image, image.url)).toEqual({ kind: "empty" });
    });

    test("Automatically restores after URL changes, no need to clean up Boolean tags", () => {
        expect(gateDirectorPreviewFailure({ kind: "image", url: "data:image/png;base64,B" }, image.url)).toEqual({ kind: "image", url: "data:image/png;base64,B" });
    });

    test("Pass as is if there is no failure record", () => {
        expect(gateDirectorPreviewFailure(image, null)).toBe(image);
    });

    test("Non-image sources are not affected by gating", () => {
        expect(gateDirectorPreviewFailure({ kind: "loading" }, image.url)).toEqual({ kind: "loading" });
        expect(gateDirectorPreviewFailure({ kind: "empty" }, image.url)).toEqual({ kind: "empty" });
    });

    test("After the failure of Apply, the new image can still be displayed (within the same session)", () => {
        const next = resolveDirectorPreviewSource({
            scene: scene(),
            shot: undefined,
            previewNodeId: "n1",
            readNodeContent: reader({ n1: "data:image/png;base64,NEW" }),
        });
        expect(gateDirectorPreviewFailure(next, "data:image/png;base64,OLD")).toEqual({ kind: "image", url: "data:image/png;base64,NEW" });
    });
});

describe("Current lens analysis", () => {
    test("Prioritize the shot specified by metadata", () => {
        const first = createDirectorScene("s").shots[0];
        const second: DirectorShot = { ...first, id: "shot-2", name: "Shot 2", previewNodeId: "p2" };
        const current = scene([first, second]);
        expect(resolveDirectorActiveShot(current, "shot-2")?.id).toBe("shot-2");
    });

    test("Returns the first shot if metadata is not specified or misses", () => {
        const current = scene();
        expect(resolveDirectorActiveShot(current, undefined)?.id).toBe(current.shots[0].id);
        expect(resolveDirectorActiveShot(current, "missing")?.id).toBe(current.shots[0].id);
    });

    test("When scene is null there is no camera", () => {
        expect(resolveDirectorActiveShot(null, "shot-1")).toBeUndefined();
    });

    test("Specify the shot's previewNodeId to participate in the fallback, not the first shot's", () => {
        const first = { ...createDirectorScene("s").shots[0], previewNodeId: "p1" };
        const second: DirectorShot = { ...first, id: "shot-2", previewNodeId: "p2" };
        const current = scene([first, second]);
        const shot = resolveDirectorActiveShot(current, "shot-2");
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot,
                previewNodeId: undefined,
                readNodeContent: reader({ p1: "data:image/png;base64,ONE", p2: "data:image/png;base64,TWO" }),
            }),
        ).toEqual({ kind: "image", url: "data:image/png;base64,TWO" });
    });
});
