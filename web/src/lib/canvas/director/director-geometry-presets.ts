import { createDirectorObject } from "@/lib/canvas/director/director-scene";
import type { DirectorObject, DirectorPrimitiveKind } from "@/types/director";

export type DirectorGeometryPresetId = Exclude<DirectorPrimitiveKind, "plane" | "character">;

export const DIRECTOR_GEOMETRY_PRESET_OPTIONS: ReadonlyArray<{ id: DirectorGeometryPresetId; label: string; primitive: DirectorPrimitiveKind }> = [
    { id: "box", label: "cube", primitive: "box" },
    { id: "sphere", label: "sphere", primitive: "sphere" },
    { id: "cylinder", label: "cylinder", primitive: "cylinder" },
    { id: "torus", label: "ring body", primitive: "torus" },
    { id: "cone", label: "cone", primitive: "cone" },
    { id: "pyramid", label: "pyramid", primitive: "pyramid" },
    { id: "empty", label: "Add empty object", primitive: "empty" },
];

export function createDirectorGeometricObject(preset: DirectorGeometryPresetId): DirectorObject {
    const option = DIRECTOR_GEOMETRY_PRESET_OPTIONS.find((item) => item.id === preset)!;
    return createDirectorObject(option.primitive, option.label);
}
