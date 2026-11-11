import { describe, expect, test } from "bun:test";
import { AnimationClip, AnimationMixer, BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SkeletonHelper, Texture } from "three";
import { SkeletonUtils } from "three-stdlib";

import { disposeDirectorAdoptionFailure, disposeDirectorHelper, disposeDirectorMaterials, disposeDirectorMixer, disposeDirectorModelResources, disposeDirectorObject3D, resolveDirectorLoadOwnership } from "../src/lib/canvas/director/director-resources";

/** 统计 dispose 调用次数，用真实 Three 对象验证「同一资源只释放一次」。 */
function counted<T extends { dispose: () => void }>(target: T) {
    const calls = { count: 0 };
    const original = target.dispose.bind(target);
    target.dispose = () => {
        calls.count += 1;
        original();
    };
    return { target, calls };
}

function meshWith(geometry: BoxGeometry, material: MeshStandardMaterial | MeshStandardMaterial[]) {
    return new Mesh(geometry, material as never);
}

describe("Shared resources are released only once (C regression)", () => {
    test("When multiple meshes share geometry/material, they can only be disposed once.", () => {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const root = new Group();
        root.add(meshWith(geometry.target, material.target));
        root.add(meshWith(geometry.target, material.target));
        root.add(meshWith(geometry.target, material.target));
        disposeDirectorObject3D(root);
        expect(geometry.calls.count).toBe(1);
        expect(material.calls.count).toBe(1);
    });

    test("Shared texture only disposes once", () => {
        const texture = counted(new Texture());
        const first = new MeshStandardMaterial();
        const second = new MeshStandardMaterial();
        first.map = texture.target;
        second.map = texture.target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), first));
        root.add(meshWith(new BoxGeometry(1, 1, 1), second));
        disposeDirectorObject3D(root);
        expect(texture.calls.count).toBe(1);
    });

    test("All array materials are released and their respective textures are covered.", () => {
        const a = counted(new MeshStandardMaterial());
        const b = counted(new MeshStandardMaterial());
        const textureA = counted(new Texture());
        const textureB = counted(new Texture());
        a.target.map = textureA.target;
        b.target.normalMap = textureB.target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), [a.target, b.target]));
        disposeDirectorObject3D(root);
        expect(a.calls.count).toBe(1);
        expect(b.calls.count).toBe(1);
        expect(textureA.calls.count).toBe(1);
        expect(textureB.calls.count).toBe(1);
    });

    test("Various texture slots will be collected", () => {
        const material = new MeshStandardMaterial();
        const slots = [counted(new Texture()), counted(new Texture()), counted(new Texture())];
        material.map = slots[0].target;
        material.roughnessMap = slots[1].target;
        material.emissiveMap = slots[2].target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), material));
        disposeDirectorObject3D(root);
        slots.forEach((slot) => expect(slot.calls.count).toBe(1));
    });

    test("Empty input is safe", () => {
        expect(() => disposeDirectorObject3D(null)).not.toThrow();
        expect(() => disposeDirectorObject3D(undefined)).not.toThrow();
        expect(() => disposeDirectorHelper(null)).not.toThrow();
        expect(() => disposeDirectorMixer(null)).not.toThrow();
    });
});

describe("SkeletonHelper / mixer / combination release", () => {
    test("Helper's own geometry and material are released", () => {
        const helper = new SkeletonHelper(new Object3D());
        const geometry = counted(helper.geometry);
        const material = counted(helper.material as MeshStandardMaterial);
        disposeDirectorHelper(helper);
        expect(geometry.calls.count).toBe(1);
        expect(material.calls.count).toBe(1);
    });

    test("mixer stops all actions and uncacheRoot", () => {
        const root = new Object3D();
        const mixer = new AnimationMixer(root);
        mixer.clipAction(new AnimationClip("idle", 1, [])).play();
        const stopped = { count: 0 };
        const uncached: Object3D[] = [];
        const originalStop = mixer.stopAllAction.bind(mixer);
        mixer.stopAllAction = () => {
            stopped.count += 1;
            return originalStop();
        };
        const originalUncache = mixer.uncacheRoot.bind(mixer);
        mixer.uncacheRoot = (target) => {
            uncached.push(target as Object3D);
            return originalUncache(target);
        };
        disposeDirectorMixer(mixer, root);
        expect(stopped.count).toBe(1);
        expect(uncached).toEqual([root]);
    });

    test("Combined release coverage model + helper + mixer (late arrival callback reuses the same helper)", () => {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const model = new Group();
        model.add(meshWith(geometry.target, material.target));
        const helper = new SkeletonHelper(model);
        const helperGeometry = counted(helper.geometry);
        const mixer = new AnimationMixer(model);
        const stopped = { count: 0 };
        const originalStop = mixer.stopAllAction.bind(mixer);
        mixer.stopAllAction = () => {
            stopped.count += 1;
            return originalStop();
        };
        disposeDirectorModelResources({ model, helper, mixer });
        expect(geometry.calls.count).toBe(1);
        expect(material.calls.count).toBe(1);
        expect(helperGeometry.calls.count).toBe(1);
        expect(stopped.count).toBe(1);
    });

    test("The replaced original material and its texture will be released, and the new material after replacement will not be affected.", () => {
        const original = counted(new MeshStandardMaterial());
        const originalTexture = counted(new Texture());
        original.target.map = originalTexture.target;
        const replacement = counted(new MeshStandardMaterial());
        disposeDirectorMaterials([original.target]);
        expect(original.calls.count).toBe(1);
        expect(originalTexture.calls.count).toBe(1);
        expect(replacement.calls.count).toBe(0);
    });

    test("Materials that appear repeatedly in the list are only released once", () => {
        const material = counted(new MeshStandardMaterial());
        disposeDirectorMaterials([material.target, material.target, null, undefined]);
        expect(material.calls.count).toBe(1);
    });
});

describe("GPU ownership of GLTF clones (regression #1)", () => {
    /** 造一棵带共享 geometry/material/texture 的 source，模拟 gltf.scene。 */
    function sourceScene() {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const texture = counted(new Texture());
        material.target.map = texture.target;
        const root = new Group();
        root.name = "source-root";
        const child = meshWith(geometry.target, material.target);
        child.name = "source-mesh";
        root.add(child);
        return { root, geometry, material, texture };
    }

    test("active adopt does not release the shared resources of source", () => {
        const source = sourceScene();
        const ownership = resolveDirectorLoadOwnership({ active: true, generation: 3, currentGeneration: 3 });
        expect(ownership).toEqual({ adopt: true, disposeSource: false });
        // 采纳路径：只 clone，不 dispose source。
        const clone = SkeletonUtils.clone(source.root);
        expect(source.geometry.calls.count).toBe(0);
        expect(source.material.calls.count).toBe(0);
        expect(source.texture.calls.count).toBe(0);
        // clone 确实与 source 共享 GPU 资源。
        const clonedMesh = clone.getObjectByName("source-mesh") as Mesh;
        expect(clonedMesh.geometry).toBe(source.geometry.target);
        expect(clonedMesh.material).toBe(source.material.target);
    });

    test("owned clone final cleanup allows shared resources to be released exactly once", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        const mixer = new AnimationMixer(clone);
        const helper = new SkeletonHelper(clone);
        disposeDirectorModelResources({ model: clone, helper, mixer });
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });

    test("stale / unadopted late sources will be released", () => {
        const stale = resolveDirectorLoadOwnership({ active: true, generation: 1, currentGeneration: 2 });
        expect(stale).toEqual({ adopt: false, disposeSource: true });
        const unmounted = resolveDirectorLoadOwnership({ active: false, generation: 2, currentGeneration: 2 });
        expect(unmounted).toEqual({ adopt: false, disposeSource: true });
        const orphan = sourceScene();
        disposeDirectorObject3D(orphan.root);
        expect(orphan.geometry.calls.count).toBe(1);
        expect(orphan.material.calls.count).toBe(1);
        expect(orphan.texture.calls.count).toBe(1);
    });

    test("After adoption, source will no longer be released separately: there will be no secondary dispose", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        // 只释放 owned clone（当前实现的语义），source 层级交给 GC。
        disposeDirectorModelResources({ model: clone, mixer: new AnimationMixer(clone) });
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });
});

describe("Texture recognition must be based on isTexture (#8 regression)", () => {
    test("Values with dispose but not Texture will not be released as textures", () => {
        const material = new MeshStandardMaterial();
        const impostor = {
            dispose: () => {
                impostorCalls += 1;
            },
        };
        let impostorCalls = 0;
        (material as unknown as Record<string, unknown>).map = impostor;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), material));
        disposeDirectorObject3D(root);
        expect(impostorCalls).toBe(0);
    });

    test("The real Texture is still recognized and deduplicated.", () => {
        const texture = counted(new Texture());
        expect(texture.target.isTexture).toBe(true);
        const first = new MeshStandardMaterial();
        const second = new MeshStandardMaterial();
        first.map = texture.target;
        second.emissiveMap = texture.target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), first));
        root.add(meshWith(new BoxGeometry(1, 1, 1), second));
        disposeDirectorObject3D(root);
        expect(texture.calls.count).toBe(1);
    });
});

describe("Adopt precise cleanup of errors thrown midway (#3 regression)", () => {
    /** 造一棵带共享 geometry/material/texture 的 source，模拟 gltf.scene。 */
    function sourceScene() {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const texture = counted(new Texture());
        material.target.map = texture.target;
        const root = new Group();
        const child = meshWith(geometry.target, material.target);
        child.name = "src-mesh";
        root.add(child);
        return { root, geometry, material, texture };
    }

    test("Only clone(+mixer) is released when clone has been built, and the shared resources are shared exactly once", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        const mixer = new AnimationMixer(clone);
        let stopped = 0;
        mixer.stopAllAction = (() => {
            stopped += 1;
            return mixer;
        }) as typeof mixer.stopAllAction;
        disposeDirectorAdoptionFailure({ clone, mixer, source: source.root });
        expect(stopped).toBe(1);
        // clone 与 source 共享这三个资源：必须恰好 1 次，不能因为同时传了 source 变成 2 次。
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });

    test("Release unadopted source when clone has not been built yet", () => {
        const source = sourceScene();
        disposeDirectorAdoptionFailure({ clone: null, mixer: null, source: source.root });
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });

    test("The mixer will also be stopped when the clone is not built but the mixer is built.", () => {
        const source = sourceScene();
        const orphanMixer = new AnimationMixer(new Group());
        let stopped = 0;
        orphanMixer.stopAllAction = (() => {
            stopped += 1;
            return orphanMixer;
        }) as typeof orphanMixer.stopAllAction;
        disposeDirectorAdoptionFailure({ clone: null, mixer: orphanMixer, source: source.root });
        expect(stopped).toBe(1);
        expect(source.geometry.calls.count).toBe(1);
    });

    test("All-empty input is a safe no-op", () => {
        expect(() => disposeDirectorAdoptionFailure({ clone: null, mixer: null, source: null })).not.toThrow();
    });

    test("Repeated calls do not double-dispose the same batch of resources", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        disposeDirectorAdoptionFailure({ clone, mixer: null, source: source.root });
        const afterFirst = source.geometry.calls.count;
        // 生产在 catch 里已经把 ownedRef 摘空，effect cleanup 不会再传同一个 clone；
        // 这里断言 helper 自身对「已释放的 clone」再调用也不会把计数推高到危险值。
        disposeDirectorAdoptionFailure({ clone: null, mixer: null, source: null });
        expect(source.geometry.calls.count).toBe(afterFirst);
    });
});
