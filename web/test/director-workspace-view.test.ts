import { afterEach, describe, expect, test } from "bun:test";

import { useDirectorWorkbenchStore } from "../src/stores/canvas/use-director-workbench-store";

describe("Director's desk workspace view", () => {
    afterEach(() => useDirectorWorkbenchStore.getState().reset());

    test("The final preview uses the current shot and displays the timeline, and restores the original view state when returning to scene scheduling.", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("camera");
        store.getState().setRenderMode("depth");
        store.getState().setViewMode("top");
        store.getState().setSequencerVisible(false);

        store.getState().setWorkspaceView("preview");
        expect(store.getState().workspaceView).toBe("preview");
        expect(store.getState().viewMode).toBe("camera");
        expect(store.getState().sequencerVisible).toBe(true);
        expect(store.getState().renderMode).toBe("beauty");

        store.getState().setWorkspaceView("scene");
        expect(store.getState().workspaceView).toBe("scene");
        expect(store.getState().viewMode).toBe("top");
        expect(store.getState().sequencerVisible).toBe(false);
        expect(store.getState().renderMode).toBe("depth");
    });

    test("Switching from scene scheduling to preview will not change the persistent scene or historical status fields.", () => {
        const before = useDirectorWorkbenchStore.getState();
        before.setWorkspaceView("preview");
        const after = useDirectorWorkbenchStore.getState();

        expect(after.mode).toBe(before.mode);
        expect(after.selectedObjectId).toBe(before.selectedObjectId);
        expect(after.renderMode).toBe(before.renderMode);
    });
});
