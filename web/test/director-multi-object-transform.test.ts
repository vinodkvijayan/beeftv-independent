import { describe, expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import { resolveDirectorMultiObjectBoneRotationEdit, resolveDirectorMultiObjectGroupTransformEdit, resolveDirectorMultiObjectTransformEdit } from "@/lib/canvas/director/director-animation-semantics";
import { createDirectorActor } from "@/lib/canvas/director/director-scene";

describe("Director's desk multi-object transformation", () => {
    test("Static editing synchronizes the transform delta of represented objects to the entire selection and preserves relative spacing", () => {
        const first = createDirectorActor("Role A", [0, 0, 0]);
        const second = createDirectorActor("Role B", [-2.41, 0, -0.11]);
        const next = resolveDirectorMultiObjectTransformEdit({
            objects: [first, second],
            selectedIds: [first.id, second.id],
            representativeId: second.id,
            from: second.transform,
            to: { ...second.transform, position: [-2.31, 0, -0.11] },
            autoKey: false,
            time: 0,
        });
        expect(next[0].transform.position[0]).toBeCloseTo(0.1);
        expect(next[0].transform.position.slice(1)).toEqual([0, 0]);
        expect(next[1].transform.position[0]).toBeCloseTo(-2.31);
        expect(next[1].transform.position.slice(1)).toEqual([0, -0.11]);
    });

    test("Animation mode writes the same relative transform keyframes on all selected objects", () => {
        const first = createDirectorActor("Role A", [0, 0, 0]);
        const second = createDirectorActor("Role B", [-2, 0, 0]);
        const next = resolveDirectorMultiObjectTransformEdit({
            objects: [first, second],
            selectedIds: [first.id, second.id],
            representativeId: second.id,
            from: second.transform,
            to: { ...second.transform, position: [-1.5, 0, 0] },
            autoKey: true,
            time: 1,
        });
        expect(next.map((object) => object.keyframes)).toHaveLength(2);
        expect(next[0].keyframes[0].transform.position).toEqual([0.5, 0, 0]);
        expect(next[1].keyframes[0].transform.position).toEqual([-1.5, 0, 0]);
        expect(next[0].transform.position).toEqual([0, 0, 0]);
    });

    test("Group rotation rotates the object position around the center of the selection and synchronizes the object's own orientation.", () => {
        const first = createDirectorActor("Role A", [1, 0, 0]);
        const second = createDirectorActor("Role B", [-1, 0, 0]);
        const next = resolveDirectorMultiObjectGroupTransformEdit({
            objects: [first, second],
            selectedIds: [first.id, second.id],
            from: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            to: { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
            autoKey: false,
            time: 0,
        });
        expect(next[0].transform.position[0]).toBeCloseTo(0);
        expect(next[0].transform.position[2]).toBeCloseTo(-1);
        expect(next[1].transform.position[2]).toBeCloseTo(1);
        expect(next[0].transform.rotation[1]).toBeCloseTo(Math.PI / 2);
    });

    test("Group zoom enlarges the distance between objects from the center of the selection without modifying unselected objects.", () => {
        const first = createDirectorActor("Role A", [1, 0, 0]);
        const second = createDirectorActor("Role B", [-1, 0, 0]);
        const outsider = createDirectorActor("Role C", [8, 0, 0]);
        const next = resolveDirectorMultiObjectGroupTransformEdit({
            objects: [first, second, outsider],
            selectedIds: [first.id, second.id],
            from: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            to: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] },
            autoKey: false,
            time: 0,
        });
        expect(next[0].transform.position[0]).toBeCloseTo(2);
        expect(next[1].transform.position[0]).toBeCloseTo(-2);
        expect(next[0].transform.scale).toEqual([2, 2, 2]);
        expect(next[2]).toBe(outsider);
    });

    test("Multi-selected bone poses are applied simultaneously in rotational increments representing the characters and retain relative poses between characters.", () => {
        const first = createDirectorActor("Role A", [0, 0, 0]);
        const second = createDirectorActor("Role B", [2, 0, 0]);
        const outsider = createDirectorActor("Role C", [4, 0, 0]);
        const from = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
        const other = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.2);
        const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5);
        first.boneOverrides = { head: from.toArray() as [number, number, number, number] };
        second.boneOverrides = { head: other.toArray() as [number, number, number, number] };
        const next = resolveDirectorMultiObjectBoneRotationEdit({
            objects: [first, second, outsider], selectedIds: [first.id, second.id], representativeId: first.id, bone: "head",
            from: from.toArray() as [number, number, number, number],
            to: delta.clone().multiply(from).toArray() as [number, number, number, number],
            autoKey: false, time: 0,
        });
        expect(new Quaternion(...(next[0].boneOverrides!.head!)).angleTo(delta.clone().multiply(from))).toBeCloseTo(0);
        expect(new Quaternion(...(next[1].boneOverrides!.head!)).angleTo(delta.clone().multiply(other))).toBeCloseTo(0);
        expect(next[2]).toBe(outsider);
    });

    test("Multi-select bone poses write current frame keyframes for each character during Auto Key", () => {
        const first = createDirectorActor("Role A", [0, 0, 0]);
        const second = createDirectorActor("Role B", [2, 0, 0]);
        const from = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
        const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5);
        first.boneOverrides = { head: from.toArray() as [number, number, number, number] };
        const next = resolveDirectorMultiObjectBoneRotationEdit({
            objects: [first, second], selectedIds: [first.id, second.id], representativeId: first.id, bone: "head",
            from: from.toArray() as [number, number, number, number],
            to: delta.clone().multiply(from).toArray() as [number, number, number, number],
            autoKey: true, time: 1.25,
        });
        expect(next.map((object) => object.boneTracks?.[0].keyframes[0].time)).toEqual([1.25, 1.25]);
        expect(new Quaternion(...next[1].boneTracks![0].keyframes[0].rotation).angleTo(delta)).toBeCloseTo(0);
    });
});
