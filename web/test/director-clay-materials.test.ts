import { describe, expect, test } from "bun:test";
import { Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Scene, ShaderMaterial, type Material } from "three";

import { applyClaySceneMaterials } from "../src/lib/canvas/director/director-clay-materials";

const geometry = new PlaneGeometry(1, 1);

describe("Director's desk white film material switching", () => {
    test("The standard material mesh is replaced with clay, and restored to the original material after restoration.", () => {
        const scene = new Scene();
        const original = new MeshStandardMaterial({ color: "#ff0000" });
        const mesh = new Mesh(geometry, original);
        scene.add(mesh);
        const restore = applyClaySceneMaterials(scene);
        expect(mesh.material).not.toBe(original);
        expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
        restore();
        expect(mesh.material).toBe(original);
    });

    test("Shader materials with uniforms remain intact (Grid collapses back frame by frame)", () => {
        const scene = new Scene();
        const shader = new ShaderMaterial({ uniforms: { worldCamProjPosition: { value: null } } });
        const grid = new Mesh(geometry, shader);
        scene.add(grid);
        const restore = applyClaySceneMaterials(scene);
        expect(grid.material).toBe(shader);
        restore();
        expect(grid.material).toBe(shader);
    });

    test("directorActor mesh and non-Mesh objects are not affected", () => {
        const scene = new Scene();
        const actorMaterial = new MeshBasicMaterial();
        const actor = new Mesh(geometry, actorMaterial);
        actor.userData.directorActor = true;
        const line = new Line(geometry, new LineBasicMaterial());
        scene.add(actor, line);
        const restore = applyClaySceneMaterials(scene);
        expect(actor.material).toBe(actorMaterial);
        expect(line.material).toBeInstanceOf(LineBasicMaterial);
        restore();
        expect(actor.material).toBe(actorMaterial);
    });

    test("The white film output retains the director's desk floor material and does not dye the environment floor white.", () => {
        const scene = new Scene();
        const groundMaterial = new MeshStandardMaterial({ color: "#151820" });
        const ground = new Mesh(geometry, groundMaterial);
        ground.userData.directorStageGround = true;
        const propMaterial = new MeshStandardMaterial({ color: "#cc3344" });
        const prop = new Mesh(geometry, propMaterial);
        scene.add(ground, prop);

        const restore = applyClaySceneMaterials(scene);

        expect(ground.material).toBe(groundMaterial);
        expect(prop.material).not.toBe(propMaterial);
        restore();
        expect(ground.material).toBe(groundMaterial);
    });

    test("When the material array is mixed into the uniforms material, the entire group is skipped", () => {
        const scene = new Scene();
        const materials: Material[] = [new MeshStandardMaterial(), new ShaderMaterial({ uniforms: {} })];
        const mesh = new Mesh(geometry, materials);
        scene.add(mesh);
        const restore = applyClaySceneMaterials(scene);
        expect(mesh.material).toBe(materials);
        restore();
        expect(mesh.material).toBe(materials);
    });
});
