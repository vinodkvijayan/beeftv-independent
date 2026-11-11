import { describe, expect, test } from "bun:test";

import { applyFrameDrop, buildCanvasFrameDropIndex, canFolderContain, canLinkedFolderArchive, extractNodeFromCanvasFolder, findFrameDropTarget, findFrameDropTargetFromIndex, isCanvasFolderNode, packNodesIntoCollapsedFolder, unpackCanvasFolder } from "@/lib/canvas/canvas-frame";
import { resolveCanvasFolderTheme, resolveCanvasFolderThemeCover } from "@/lib/canvas/canvas-folder-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function folder(id: string, linked = false): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Frame,
        title: linked ? "Material catalog" : "my files",
        position: { x: 100, y: 100 },
        width: 360,
        height: 280,
        metadata: {
            frame: { collapsed: true, expandedWidth: 760, expandedHeight: 520 },
            folder: {
                style: "glass",
                createdAt: "2026-08-20T00:00:00.000Z",
                ...(linked ? { assetFolderId: "asset-folder", projectId: "project" } : {}),
            },
        },
    };
}

function image(id: string, content = "resource:image"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 150, y: 150 },
        width: 180,
        height: 120,
        metadata: { content },
    };
}

describe("canvas folders", () => {
    test("Folder styles and theme skins are resolved independently", () => {
        expect(resolveCanvasFolderTheme("ember")).toBe("ember");
        expect(resolveCanvasFolderTheme("unknown")).toBe("aurora");
        expect(resolveCanvasFolderThemeCover("obsidian")).toContain("folder-theme-obsidian.png");
        expect(resolveCanvasFolderThemeCover("pearl", "resource:custom-cover")).toBe("resource:custom-cover");
    });

    test("Identify folders and allow non-container nodes to enter local folders", () => {
        const target = folder("folder");
        expect(isCanvasFolderNode(target)).toBe(true);
        expect(canFolderContain(image("image"))).toBe(true);
        expect(canFolderContain(folder("nested"))).toBe(false);
    });

    test("Collapsed folders can still be dragged and dropped targets and expanded layouts saved", () => {
        const target = folder("folder");
        const dragged = image("image");
        const nodes = [target, dragged];

        expect(findFrameDropTarget(nodes, new Set([dragged.id]))).toBe(target.id);
        const next = applyFrameDrop(nodes, new Set([dragged.id]), target.id);
        const nextFolder = next.find((node) => node.id === target.id)!;
        const nextImage = next.find((node) => node.id === dragged.id)!;

        expect(nextImage.parentId).toBe(target.id);
        expect(nextFolder.metadata?.frame?.collapsed).toBe(true);
        expect(nextFolder.metadata?.frame?.expandedWidth).toBeGreaterThan(dragged.width);
        expect(nextFolder.metadata?.frame?.expandedHeight).toBeGreaterThan(dragged.height);
    });

    test("The placement point of the spatial index frame is consistent with the regular placement point", () => {
        const target = folder("folder");
        const dragged = image("image");
        const nodes = [target, dragged];
        const index = buildCanvasFrameDropIndex(nodes);

        expect(findFrameDropTargetFromIndex(index, [dragged], new Set([dragged.id]), { x: 0, y: 0 })).toBe(findFrameDropTarget(nodes, new Set([dragged.id])));
        expect(findFrameDropTargetFromIndex(index, [dragged], new Set([dragged.id]), { x: 400, y: 400 })).toBeNull();
    });

    test("Library link folders only receive archiveable real content nodes", () => {
        const target = folder("linked", true);
        const ready = image("ready");
        const empty = image("empty", "");
        const existing = { ...image("existing", ""), metadata: { content: "", assetId: "asset-existing" } };
        const config: CanvasNodeData = { id: "config", type: CanvasNodeType.Config, title: "Configuration", position: { x: 150, y: 150 }, width: 180, height: 120 };

        expect(canLinkedFolderArchive(ready)).toBe(true);
        expect(canLinkedFolderArchive(empty)).toBe(false);
        expect(canLinkedFolderArchive(existing)).toBe(true);
        expect(canLinkedFolderArchive(config)).toBe(false);
        expect(findFrameDropTarget([target, ready], new Set([ready.id]))).toBe(target.id);
        expect(findFrameDropTarget([target, empty], new Set([empty.id]))).toBeNull();
    });

    test("Dragging out a local folder will dissolve the parent-child relationship", () => {
        const child = { ...image("image"), parentId: "folder" };
        const next = applyFrameDrop([folder("folder"), child], new Set([child.id]), null);
        expect(next.find((node) => node.id === child.id)?.parentId).toBeUndefined();
    });

    test("When dragging multi-select scattered nodes to the collapsed folder, as long as any node is hit, it can be included.", () => {
        const target = folder("folder");
        const hitNode = { ...image("hit"), position: { x: 140, y: 140 } };
        const farNode = { ...image("far"), position: { x: 920, y: 680 } };
        const nodes = [target, hitNode, farNode];
        const draggedIds = new Set([hitNode.id, farNode.id]);
        const index = buildCanvasFrameDropIndex(nodes);

        expect(findFrameDropTarget(nodes, draggedIds)).toBe(target.id);
        expect(findFrameDropTargetFromIndex(index, [hitNode, farNode], draggedIds, { x: 0, y: 0 })).toBe(target.id);
    });

    test("Collect selected nodes into a new folded folder with one click", () => {
        const first = { ...image("first"), position: { x: 200, y: 180 } };
        const second = { ...image("second"), position: { x: 640, y: 420 } };
        const packed = packNodesIntoCollapsedFolder([first, second], new Set([first.id, second.id]), (position) => ({
            ...folder("packed-folder"),
            position,
        }));

        expect(packed).not.toBeNull();
        expect(packed?.folderId).toBe("packed-folder");
        expect(packed?.count).toBe(2);
        const packedChildren = packed!.nodes.filter((node) => node.parentId === "packed-folder");
        expect(packedChildren).toHaveLength(2);

        const singleWithContainer = packNodesIntoCollapsedFolder([first, folder("existing-folder")], new Set([first.id, "existing-folder"]), (position) => ({
            ...folder("packed-folder-2"),
            position,
        }));
        expect(singleWithContainer).toBeNull();
    });

    test("Dismissing a folder will arrange the internal nodes back to the canvas in a balanced multi-column grid and remove the folder shell.", () => {
        const target = folder("folder-16");
        const children = Array.from({ length: 16 }, (_, index) => ({
            ...image(`img-${index + 1}`),
            parentId: target.id,
            position: { x: 100 + index * 10, y: 100 + index * 10 },
        }));
        const unpacked = unpackCanvasFolder([target, ...children], target.id);
        expect(unpacked).not.toBeNull();
        expect(unpacked?.unpackedIds).toHaveLength(16);
        expect(unpacked?.nodes.some((node) => node.id === target.id)).toBe(false);
        expect(unpacked?.nodes.every((node) => node.parentId === undefined)).toBe(true);

        const uniqueColumns = new Set(unpacked?.nodes.map((node) => node.position.x));
        const uniqueRows = new Set(unpacked?.nodes.map((node) => node.position.y));
        expect(uniqueColumns.size).toBe(4);
        expect(uniqueRows.size).toBe(4);
    });

    test("Moving a node individually from a folder will move it to the right side of the folder and keep the remaining nodes included.", () => {
        const target = folder("folder-extract");
        const first = { ...image("first"), parentId: target.id };
        const second = { ...image("second"), parentId: target.id };
        const extracted = extractNodeFromCanvasFolder([target, first, second], first.id);

        expect(extracted).not.toBeNull();
        const nextFirst = extracted!.nodes.find((node) => node.id === first.id)!;
        const nextSecond = extracted!.nodes.find((node) => node.id === second.id)!;
        expect(nextFirst.parentId).toBeUndefined();
        expect(nextFirst.position.x).toBeGreaterThan(target.position.x + target.width);
        expect(nextSecond.parentId).toBe(target.id);
    });

    test("When you drag nodes created earlier in the canvas into the folder, they will be appended to the end to ensure that the latest dragged items are displayed on the cover.", () => {
        const earlier = image("earlier");
        const target = folder("folder-recency");
        const existing1 = { ...image("existing-1"), parentId: target.id };
        const existing2 = { ...image("existing-2"), parentId: target.id };
        const existing3 = { ...image("existing-3"), parentId: target.id };

        const next = applyFrameDrop([earlier, target, existing1, existing2, existing3], new Set([earlier.id]), target.id);
        const children = next.filter((node) => node.parentId === target.id);
        expect(children.map((node) => node.id)).toEqual(["existing-1", "existing-2", "existing-3", "earlier"]);
        expect(children.slice(-3).map((node) => node.id)).toEqual(["existing-2", "existing-3", "earlier"]);
    });

    test("Correctly handle boundaries and maximum 8-column limit when dissolving empty folders or large folders with hundreds of items", () => {
        const emptyFolder = folder("empty-folder");
        const emptyResult = unpackCanvasFolder([emptyFolder], emptyFolder.id);
        expect(emptyResult?.unpackedIds).toEqual([]);
        expect(emptyResult?.nodes).toEqual([]);

        const bigFolder = folder("big-folder");
        const manyChildren = Array.from({ length: 80 }, (_, index) => ({
            ...image(`img-${index + 1}`),
            parentId: bigFolder.id,
        }));
        const bigResult = unpackCanvasFolder([bigFolder, ...manyChildren], bigFolder.id);
        const uniqueColumns = new Set(bigResult?.nodes.map((node) => node.position.x));
        const uniqueRows = new Set(bigResult?.nodes.map((node) => node.position.y));
        expect(uniqueColumns.size).toBe(8);
        expect(uniqueRows.size).toBe(10);
    });
});
