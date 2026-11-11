export type CanvasShortcutItem = {
    id: string;
    title: string;
    keys: string[][];
};

export const CANVAS_SHORTCUTS: CanvasShortcutItem[] = [
    { id: "search", title: "Search canvas nodes", keys: [["⌘", "F"]] },
    { id: "assistant", title: "Turn assistant on/off", keys: [["⌘", "J"]] },
    { id: "focus", title: "Enter focus mode", keys: [["⌘", "Shift", "F"]] },
    { id: "move-tool", title: "Switch mobile tools", keys: [["V"]] },
    { id: "hand-tool", title: "Switch gripper tool", keys: [["H"]] },
    { id: "select-all", title: "Select all nodes", keys: [["⌘", "A"]] },
    { id: "zoom-in", title: "Enlarge canvas", keys: [["⌘", "+"]] },
    { id: "zoom-out", title: "Reduce canvas", keys: [["⌘", "−"]] },
    { id: "actual-size", title: "Recovery 100%", keys: [["⌘", "1"]] },
    { id: "fit-canvas", title: "Adapt to all nodes", keys: [["⌘", "0"], ["⌘", "2"]] },
    { id: "fit-selection", title: "Adapt to selected node", keys: [["⌘", "3"]] },
    { id: "escape", title: "Turn off node search", keys: [["Esc"]] },
];
