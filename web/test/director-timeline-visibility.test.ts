import { describe, expect, test } from "bun:test";

import { useDirectorWorkbenchStore } from "../src/stores/canvas/use-director-workbench-store";

describe("Director's desk timeline display status", () => {
    test("A new session opens the timeline with the reference page's compact height of about 130px, which can also be expanded to an advanced track", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().reset();
        expect(store.getState().sequencerHeight).toBe(130);
        store.getState().setSequencerHeight(300);
        expect(store.getState().sequencerHeight).toBe(300);
        store.getState().setSequencerHeight(130);
        expect(store.getState().sequencerHeight).toBe(130);
    });
    test("By default, new sessions are staged and the timeline is collapsed; stage mode can also be expanded and collapsed independently.", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().reset();
        expect(store.getState().mode).toBe("layout");
        expect(store.getState().sequencerVisible).toBe(false);
        store.getState().setMode("layout");
        store.getState().setSequencerVisible(true);
        expect(store.getState().sequencerVisible).toBe(true);
        expect(store.getState().mode).toBe("layout");
        store.getState().setSequencerVisible(false);
        expect(store.getState().sequencerVisible).toBe(false);
    });

    test("The top animation mode still automatically opens the timeline, and after switching back to the swing scene, it is controlled by the bottom button to close it.", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().reset();
        store.getState().setMode("animate");
        expect(store.getState().sequencerVisible).toBe(true);
        store.getState().setMode("layout");
        expect(store.getState().sequencerVisible).toBe(true);
        store.getState().setSequencerVisible(false);
        expect(store.getState().sequencerVisible).toBe(false);
        store.getState().reset();
    });
});
