import { expect, test } from "bun:test";

import { createDirectorMotionPresetKeyframes } from "@/lib/canvas/director/director-camera-paths";
import { compileDirectorPrompt } from "@/lib/canvas/director/director-prompt-compiler";
import { createDirectorReproScene } from "@/lib/canvas/director/director-repro-fixture";

test("When the actual camera position is in motion, a prompt word is output to describe the key frame, and it is not mistakenly called a fixed camera position.", () => {
    const scene = createDirectorReproScene();
    const camera = scene.cameras[0];
    const shot = scene.shots[0];
    const { keyframes } = createDirectorMotionPresetKeyframes("push_in", "replace", camera, shot.duration);
    const prompt = compileDirectorPrompt({ ...scene, cameras: [{ ...camera, keyframes }] }, shot);
    expect(prompt).toContain("2 keyframes");
    expect(prompt).toContain("0 seconds");
    expect(prompt).toContain("2 seconds");
    expect(prompt).not.toContain("Fixed position");
});

test("Two camera keyframes with the same pose will not be mistakenly called camera movements.", () => {
    const scene = createDirectorReproScene();
    const camera = scene.cameras[0];
    const keys = [0, 2].map((time) => ({ id: `same-${time}`, time, transform: camera.transform }));
    const prompt = compileDirectorPrompt({ ...scene, cameras: [{ ...camera, keyframes: keys }] }, scene.shots[0]);
    expect(prompt).toContain("Fixed position");
    expect(prompt).not.toContain("Execution position trajectory");
});
