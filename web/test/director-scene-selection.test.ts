import { describe, expect, test } from "bun:test";
import * as selection from "@/lib/canvas/director/director-scene-search";

const ids = ["camera-1", "camera-2", "actor-a", "actor-b"];

describe("Director's desk scene list multiple selections", () => {
    test("Normal click selects only the current row, Shift click selects a continuous range from the anchor point to the target.", () => {
        const resolve = Reflect.get(selection, "resolveDirectorSceneSelection") as ((order: string[], current: string[], anchor: string | null, target: string, shift: boolean) => string[]) | undefined;
        expect(resolve).toBeFunction();
        expect(resolve!(ids, [], null, "actor-a", false)).toEqual(["actor-a"]);
        expect(resolve!(ids, ["actor-a"], "actor-a", "actor-b", true)).toEqual(["actor-a", "actor-b"]);
        expect(resolve!(ids, ["actor-a", "actor-b"], "actor-a", "camera-2", false)).toEqual(["camera-2"]);
    });

    test("Invalid anchor points after filtering and deletion will not introduce non-existent objects", () => {
        const resolve = Reflect.get(selection, "resolveDirectorSceneSelection") as ((order: string[], current: string[], anchor: string | null, target: string, shift: boolean) => string[]) | undefined;
        expect(resolve).toBeFunction();
        expect(resolve!(["actor-b"], ["actor-a"], "actor-a", "actor-b", true)).toEqual(["actor-b"]);
    });
});
