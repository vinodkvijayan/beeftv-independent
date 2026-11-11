import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorSequencer } from "../src/components/canvas/director/director-sequencer";
import { createDirectorReproActorScene, createDirectorReproScene } from "../src/lib/canvas/director/director-repro-fixture";
import { createDirectorActorPath } from "../src/lib/canvas/director/director-actor-paths";
import { createDirectorCameraPathKeyframes } from "../src/lib/canvas/director/director-camera-paths";

describe("Director’s desk timeline narrow window layout", () => {
    test("Both characters and host positions in unbuilt routes are provided with clickable drawing entrances on the first-level track.", () => {
        const scene = createDirectorReproActorScene();
        const shot = scene.shots[0];
        const html = renderToStaticMarkup(createElement(DirectorSequencer, {
            scene, shot, camera: scene.cameras[0], objects: scene.objects,
            selectedObjectId: null, selectedBone: null, playhead: 0, playing: false, autoKey: false, height: 300, visible: true,
            onPlayToggle: () => {}, onPlayheadChange: () => {}, onAutoKeyChange: () => {}, onHeightChange: () => {}, onVisibilityChange: () => {},
            onSelectObject: () => {}, onSelectBone: () => {}, onRecordKeyframe: () => {}, onAddShot: () => {}, onDeleteKeyframe: () => {}, onSetKeyframeEasing: () => {}, onSelectShot: () => {},
        }));
        expect(html).toContain('aria-label="Draw actor 1 trajectory"');
        expect(html).toContain('aria-label="Draw host bit trajectory"');
        expect(html).toContain('aria-label="Expand actor 1 attribute"');
        expect(html).not.toContain('data-director-object-channel="position"');
        expect(html).not.toContain("director-sequencer-channel-label");
    });

    test("After the route is completed, the characters and camera will unfold the secondary track, and each control frame has optional anchor points.", () => {
        const scene = createDirectorReproActorScene();
        const shot = scene.shots[0];
        const actor = createDirectorActorPath(scene.objects[0], "line", shot.duration);
        const camera = { ...scene.cameras[0], keyframes: createDirectorCameraPathKeyframes("line", scene.cameras[0], shot.duration) };
        const html = renderToStaticMarkup(createElement(DirectorSequencer, {
            scene, shot, camera, objects: [actor], selectedObjectId: null, selectedBone: null,
            playhead: 0, playing: false, autoKey: false, height: 300, visible: true,
            onPlayToggle: () => {}, onPlayheadChange: () => {}, onAutoKeyChange: () => {}, onHeightChange: () => {}, onVisibilityChange: () => {},
            onSelectObject: () => {}, onSelectBone: () => {}, onRecordKeyframe: () => {}, onAddShot: () => {}, onDeleteKeyframe: () => {}, onSetKeyframeEasing: () => {}, onSelectShot: () => {},
        }));
        expect(html).toContain('aria-label="Collapse actor 1 attribute"');
        expect(html).toContain('aria-label="Collapse host bit attribute"');
        expect(html).toContain('data-director-object-channel="position"');
        expect(html).toContain("focus");
        expect(html).toContain("perspective");
        expect(html).toContain('aria-label="Select the keyframe of actor 1 position 0.00s"');
        expect(html).toContain('aria-label="Select the keyframe of camera 1 position 0.00s"');
    });
    test("Compact timeline retains all built object tracks, no random bit selection disappears", () => {
        const scene = createDirectorReproScene();
        const shot = scene.shots.find((item) => item.id === scene.activeShotId)!;
        const actor = scene.objects[0];
        const objects = [
            { ...actor, id: "track-actor-a", name: "Orbital character A", animationTrackEnabled: true },
            { ...actor, id: "track-actor-b", name: "Orbital role B", animationTrackEnabled: true },
        ];
        const html = renderToStaticMarkup(createElement(DirectorSequencer, {
            scene, shot, camera: scene.cameras.find((item) => item.id === shot.cameraId) || null,
            objects, selectedObjectId: null, selectedBone: null,
            playhead: 0, playing: false, autoKey: false, height: 130, visible: true,
            onPlayToggle: () => {}, onPlayheadChange: () => {}, onAutoKeyChange: () => {},
            onHeightChange: () => {}, onVisibilityChange: () => {}, onSelectObject: () => {}, onSelectBone: () => {},
            onRecordKeyframe: () => {}, onAddShot: () => {}, onDeleteKeyframe: () => {}, onSetKeyframeEasing: () => {}, onSelectShot: () => {},
        }));
        expect(html).toContain("Orbital character A");
        expect(html).toContain("Orbital role B");
        expect(html).toContain("Host bit");
    });

    test("Expanding the timeline only increases the visible height and is constrained by the viewport height", () => {
        const scene = createDirectorReproScene();
        const shot = scene.shots.find((item) => item.id === scene.activeShotId)!;
        const html = renderToStaticMarkup(createElement(DirectorSequencer, {
            scene, shot, camera: scene.cameras.find((item) => item.id === shot.cameraId) || null,
            objects: scene.objects, selectedObjectId: null, selectedBone: null,
            playhead: 0, playing: false, autoKey: false, height: 300, visible: true,
            onPlayToggle: () => {}, onPlayheadChange: () => {}, onAutoKeyChange: () => {},
            onHeightChange: () => {}, onVisibilityChange: () => {}, onSelectObject: () => {}, onSelectBone: () => {},
            onRecordKeyframe: () => {}, onAddShot: () => {}, onDeleteKeyframe: () => {}, onSetKeyframeEasing: () => {}, onSelectShot: () => {},
        }));
        expect(html).toContain("height:300px");
        expect(html).toContain("max-height:60vh");
        expect(html).toContain('data-presentation="compact"');
        expect(html).toContain('aria-label="Collapse timeline"');
    });

    test("The host uses the same overview style and track operations in the thumbnail and expanded timelines", () => {
        const scene = createDirectorReproScene();
        const shot = scene.shots.find((item) => item.id === scene.activeShotId)!;
        const camera = scene.cameras.find((item) => item.id === shot.cameraId)!;
        const render = (height: number) => renderToStaticMarkup(createElement(DirectorSequencer, {
            scene, shot, camera, objects: scene.objects, selectedObjectId: null, selectedBone: null,
            playhead: 0, playing: false, autoKey: false, height, visible: true,
            onPlayToggle: () => {}, onPlayheadChange: () => {}, onAutoKeyChange: () => {},
            onHeightChange: () => {}, onVisibilityChange: () => {}, onSelectObject: () => {}, onSelectBone: () => {},
            onRecordKeyframe: () => {}, onAddShot: () => {}, onDeleteKeyframe: () => {}, onSetKeyframeEasing: () => {}, onSelectShot: () => {},
        }));
        const compact = render(130);
        const expanded = render(300);

        expect(compact).toContain('data-presentation="compact"');
        expect(compact).toContain('aria-label="Expand timeline"');
        expect(expanded).toContain('data-presentation="compact"');
        expect(expanded).toContain('aria-label="Collapse timeline"');
        for (const markup of [compact, expanded]) {
            expect(markup).toContain("director-sequencer-compact-grid");
            expect(markup).toContain("director-sequencer-main-label is-camera");
            expect(markup).toContain('aria-label="Draw host bit trajectory"');
            expect(markup).not.toContain("Lens rail");
            expect(markup).not.toContain("Camera Cut");
            expect(markup).not.toContain('aria-label="Current lens"');
        }
    });

    test("Finished film preview shows compact playback bottom bar and single clip track, hiding animation editing tools", () => {
        const scene = createDirectorReproScene();
        const shot = scene.shots.find((item) => item.id === scene.activeShotId)!;
        const html = renderToStaticMarkup(createElement(DirectorSequencer, {
            scene, shot, camera: scene.cameras.find((item) => item.id === shot.cameraId) || null,
            objects: scene.objects, selectedObjectId: null, selectedBone: null,
            playhead: 0, playing: false, autoKey: false, height: 300, visible: true, presentation: "preview",
            onPlayToggle: () => {}, onPlayheadChange: () => {}, onAutoKeyChange: () => {},
            onHeightChange: () => {}, onVisibilityChange: () => {}, onSelectObject: () => {}, onSelectBone: () => {},
            onRecordKeyframe: () => {}, onAddShot: () => {}, onDeleteKeyframe: () => {}, onSetKeyframeEasing: () => {}, onSelectShot: () => {},
        }));

        expect(html).toContain("director-sequencer-preview-time");
        expect(html).toContain('aria-label="Timeline zoom"');
        expect(html).toContain('aria-label="Rehearsal Timeline"');
        expect(html).toContain('aria-label="Add new lens"');
        expect(html).not.toContain('title="Auto keyframe"');
        expect(html).not.toContain('title="Snap to frame"');
        expect(html).not.toContain('title="Record current keyframe"');
        expect(html).not.toContain('aria-label="Show sub-tracks"');
        expect(html).not.toContain('class="director-sequencer-resizer"');
    });
});
