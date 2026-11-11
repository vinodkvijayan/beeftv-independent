import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Box3, SkinnedMesh, Vector3 } from "three";
import { GLTFLoader, SkeletonUtils } from "three-stdlib";

import { reshapeDirectorQuaterniusActor } from "../src/lib/canvas/director/director-quaternius-body";
import type { DirectorActorPresetId } from "../src/types/director";

async function body(preset?: DirectorActorPresetId) {
    const source = readFileSync(new URL("../public/canvas/models/quaternius-standard-male.glb", import.meta.url));
    const parsed = await new Promise<{ scene: import("three").Group }>((resolve, reject) => {
        new GLTFLoader().parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), "", resolve, reject);
    });
    const clone = SkeletonUtils.clone(parsed.scene);
    if (preset) reshapeDirectorQuaterniusActor(clone, preset);
    clone.updateMatrixWorld(true);
    return { root: clone, bounds: new Box3().setFromObject(clone, true), original: parsed.scene };
}

function joint(root: import("three").Object3D, name: string) {
    return root.getObjectByName(name)!.getWorldPosition(new Vector3());
}

test("Strong, slender, and generous have their own shoulder widths and heights, not the same global scale.", async () => {
    const standard = await body();
    const athletic = await body("athletic");
    const slim = await body("slim");
    const broad = await body("broad");
    const standardShoulder = Math.abs(joint(standard.root, "upperarm_l").x);

    expect(Math.abs(joint(athletic.root, "upperarm_l").x)).toBeGreaterThan(standardShoulder * 1.09);
    expect(Math.abs(joint(slim.root, "upperarm_l").x)).toBeLessThan(standardShoulder * 0.94);
    expect(athletic.bounds.max.y).toBeGreaterThan(standard.bounds.max.y * 1.04);
    expect(slim.bounds.max.y).toBeLessThan(standard.bounds.max.y);
    expect(broad.bounds.max.y).toBeLessThan(athletic.bounds.max.y);
    expect(Math.abs(joint(broad.root, "upperarm_l").x)).toBeGreaterThan(standardShoulder * 1.08);
});

test("Adolescents, children, and biceps can gradually reduce their height and increase their head-to-body ratio according to LibTV reference.", async () => {
    const standard = await body();
    const teen = await body("teen");
    const child = await body("child");
    const chibi = await body("chibi");
    const height = (item: Awaited<ReturnType<typeof body>>) => item.bounds.max.y - item.bounds.min.y;
    const headRatio = (item: Awaited<ReturnType<typeof body>>) => (item.bounds.max.y - joint(item.root, "neck_01").y) / height(item);

    expect(height(teen)).toBeLessThan(height(standard) * 0.9);
    expect(height(child)).toBeLessThan(height(teen) * 0.8);
    expect(height(chibi)).toBeLessThan(height(child) * 0.82);
    expect(headRatio(child)).toBeGreaterThan(headRatio(standard) * 1.2);
    expect(headRatio(chibi)).toBeGreaterThan(headRatio(child) * 1.2);
});

test("The deformed mesh remains consistent with the bone binding and does not modify the shared source resources.", async () => {
    const { root, original } = await body("child");
    const mesh = root.getObjectByName("SuperHero_Male") as SkinnedMesh;
    const sourceMesh = original.getObjectByName("SuperHero_Male") as SkinnedMesh;
    const vertices = mesh.geometry.getAttribute("position");
    const sourceVertices = sourceMesh.geometry.getAttribute("position");

    expect(mesh.geometry).not.toBe(sourceMesh.geometry);
    for (const index of [0, 100, 1000, 5000]) {
        expect(mesh.getVertexPosition(index, new Vector3()).distanceTo(new Vector3().fromBufferAttribute(vertices, index))).toBeLessThan(0.002);
    }
    expect(new Vector3().fromBufferAttribute(vertices, 1000).distanceTo(new Vector3().fromBufferAttribute(sourceVertices, 1000))).toBeGreaterThan(0.001);
});

test("The transition between the head and neck and chest and abdomen will not pull out spikes on the adjacent surfaces", async () => {
    const { root, original } = await body("chibi");
    const mesh = root.getObjectByName("SuperHero_Male") as SkinnedMesh;
    const sourceMesh = original.getObjectByName("SuperHero_Male") as SkinnedMesh;
    const positions = mesh.geometry.getAttribute("position");
    const sourcePositions = sourceMesh.geometry.getAttribute("position");
    const indices = mesh.geometry.getIndex()!;
    const a = new Vector3();
    const b = new Vector3();
    const originalA = new Vector3();
    const originalB = new Vector3();
    let largestStretch = 0;
    for (let index = 0; index < indices.count; index += 3) {
        for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
            const leftIndex = indices.getX(index + left);
            const rightIndex = indices.getX(index + right);
            const originalLength = originalA.fromBufferAttribute(sourcePositions, leftIndex).distanceTo(originalB.fromBufferAttribute(sourcePositions, rightIndex));
            if (originalLength < 0.002) continue;
            const nextLength = a.fromBufferAttribute(positions, leftIndex).distanceTo(b.fromBufferAttribute(positions, rightIndex));
            largestStretch = Math.max(largestStretch, nextLength / originalLength);
        }
    }
    expect(largestStretch).toBeLessThan(2.2);
});
