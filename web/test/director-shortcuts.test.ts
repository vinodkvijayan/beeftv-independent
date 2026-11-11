import { describe, expect, test } from "bun:test";

import { DIRECTOR_INTERACTIVE_SELECTOR, blocksDirectorShortcut, isDirectorInteractiveNode, releaseDirectorFocusAfterPointer, resolveDirectorShortcut, type DirectorKeyEvent } from "../src/lib/canvas/director/director-shortcuts";

const press = (overrides: Partial<DirectorKeyEvent> & { key: string }): DirectorKeyEvent => ({ ...overrides });

describe("Change mode shortcut key", () => {
    test("Consistent with LibTV: V/R/F mapped to pan/rotate/zoom", () => {
        expect(resolveDirectorShortcut(press({ key: "v" }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "r" }))).toEqual({ kind: "transform-mode", mode: "rotate" });
        expect(resolveDirectorShortcut(press({ key: "f" }))).toEqual({ kind: "transform-mode", mode: "scale" });
    });

    test("Keep non-conflicting old shortcut keys W/E", () => {
        expect(resolveDirectorShortcut(press({ key: "w" }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "e" }))).toEqual({ kind: "transform-mode", mode: "rotate" });
    });

    test("Uppercase and Shift combinations still work", () => {
        expect(resolveDirectorShortcut(press({ key: "W" }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "E", shiftKey: true }))).toEqual({ kind: "transform-mode", mode: "rotate" });
    });

    test("No longer treated as transformation mode when using Ctrl/Cmd", () => {
        // Ctrl+R 是刷新，绝不能被解析成旋转。
        expect(resolveDirectorShortcut(press({ key: "r", ctrlKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "w", metaKey: true }))).toBeNull();
    });
});

describe("Object operation shortcut keys", () => {
    test("The direction keys are only interpreted as moving in the direction of the selected object and do not hijack input controls or key combinations.", () => {
        expect(resolveDirectorShortcut(press({ key: "ArrowUp" }))).toEqual({ kind: "nudge-selected", direction: "up" });
        expect(resolveDirectorShortcut(press({ key: "ArrowLeft" }))).toEqual({ kind: "nudge-selected", direction: "left" });
        expect(resolveDirectorShortcut(press({ key: "ArrowDown", shiftKey: true }))).toEqual({ kind: "nudge-selected", direction: "down", fine: true });
        expect(resolveDirectorShortcut(press({ key: "ArrowRight", isInteractiveTarget: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "ArrowRight", ctrlKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "ArrowRight", altKey: true }))).toBeNull();
    });

    test("Shift+A opens the add to scene menu, normal A does not trigger", () => {
        expect(resolveDirectorShortcut(press({ key: "A", shiftKey: true }))).toEqual({ kind: "open-add-menu" });
        expect(resolveDirectorShortcut(press({ key: "a" }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "A", shiftKey: true, isInteractiveTarget: true }))).toBeNull();
    });

    test("Delete and Backspace both delete the selected object", () => {
        expect(resolveDirectorShortcut(press({ key: "Delete" }))).toEqual({ kind: "delete-selected" });
        expect(resolveDirectorShortcut(press({ key: "Backspace" }))).toEqual({ kind: "delete-selected" });
    });

    test("H switches visibility, Escape cancels selection", () => {
        expect(resolveDirectorShortcut(press({ key: "h" }))).toEqual({ kind: "toggle-visibility" });
        expect(resolveDirectorShortcut(press({ key: "Escape" }))).toEqual({ kind: "deselect" });
    });

    test("Keys without execution paths are not resolved: F2 rename, Ctrl+D copy", () => {
        expect(resolveDirectorShortcut(press({ key: "F2" }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "d", ctrlKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "d", metaKey: true }))).toBeNull();
    });

    test("Space switch play", () => {
        expect(resolveDirectorShortcut(press({ key: " " }))).toEqual({ kind: "toggle-play" });
        expect(resolveDirectorShortcut(press({ key: "Spacebar" }))).toEqual({ kind: "toggle-play" });
    });
});

describe("Undo/Redo", () => {
    test("Ctrl/Cmd+Z Undo", () => {
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true }))).toEqual({ kind: "undo" });
        expect(resolveDirectorShortcut(press({ key: "z", metaKey: true }))).toEqual({ kind: "undo" });
    });

    test("Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y are both redone", () => {
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
        expect(resolveDirectorShortcut(press({ key: "Z", metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
        expect(resolveDirectorShortcut(press({ key: "y", ctrlKey: true }))).toEqual({ kind: "redo" });
    });

    test("Naked Z/Y does not trigger undo and redo", () => {
        for (const key of ["z", "y"]) expect(resolveDirectorShortcut(press({ key }))).toBeNull();
    });
});

describe("Modifier keys and unknown key boundaries", () => {
    test("Alt combinations are never parsed and are left to the system", () => {
        expect(resolveDirectorShortcut(press({ key: "w", altKey: true }))).toBeNull();
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true, altKey: true }))).toBeNull();
    });

    test("Unmapped keys return null", () => {
        for (const key of ["q", "1", "Tab", "", "F5"]) {
            expect(resolveDirectorShortcut(press({ key }))).toBeNull();
        }
    });
});

describe("Interaction control context does not hijack keystrokes", () => {
    test("When isInteractiveTarget is true, all shortcut keys are not parsed.", () => {
        for (const key of ["w", "Delete", "Backspace", "h", "Escape", " "]) {
            expect(resolveDirectorShortcut(press({ key, isInteractiveTarget: true }))).toBeNull();
        }
        expect(resolveDirectorShortcut(press({ key: "z", ctrlKey: true, isInteractiveTarget: true }))).toBeNull();
    });

    test("Text input control is determined as interactive context", () => {
        expect(isDirectorInteractiveNode({ tagName: "INPUT" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "textarea" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "SELECT" })).toBe(true);
        expect(isDirectorInteractiveNode({ isContentEditable: true })).toBe(true);
    });

    test("BUTTON and A are judged as interactive contexts: Space/Delete belongs to the control itself", () => {
        expect(isDirectorInteractiveNode({ tagName: "BUTTON" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "button" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "A" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "OPTION" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "LABEL" })).toBe(true);
        expect(isDirectorInteractiveNode({ tagName: "SUMMARY" })).toBe(true);
    });

    test("Common role-type controls are judged as interactive contexts", () => {
        const roles = ["textbox", "combobox", "spinbutton", "searchbox", "button", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "checkbox", "radio", "link", "listbox", "menu", "radiogroup", "treeitem"];
        for (const role of roles) {
            expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: (name: string) => (name === "role" ? role : null) })).toBe(true);
        }
    });

    test("The contenteditable attribute form is also considered an interactive context", () => {
        for (const value of ["", "true"]) {
            expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: (name: string) => (name === "contenteditable" ? value : null) })).toBe(true);
        }
        expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: (name: string) => (name === "contenteditable" ? "false" : null) })).toBe(false);
    });

    test("Ordinary elements, unknown roles, and illegal targets are not considered interaction contexts.", () => {
        expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: () => null })).toBe(false);
        expect(isDirectorInteractiveNode({ tagName: "SPAN" })).toBe(false);
        expect(isDirectorInteractiveNode({ tagName: "DIV", getAttribute: () => "presentation" })).toBe(false);
        expect(isDirectorInteractiveNode(null)).toBe(false);
        expect(isDirectorInteractiveNode(undefined)).toBe(false);
        expect(isDirectorInteractiveNode("input")).toBe(false);
    });
});

describe("blocksDirectorShortcut: Interactive ancestors also block global shortcuts", () => {
    test("When there is closest, use the selector to search upwards. If the ancestor is hit, it will be blocked.", () => {
        // 按钮里的 <svg>/<span>：event.target 是子元素，只判自身会漏掉整个控件。
        const queried: string[] = [];
        const nestedChild = {
            tagName: "svg",
            closest: (selector: string) => {
                queried.push(selector);
                return { tagName: "BUTTON" };
            },
        };
        expect(blocksDirectorShortcut(nestedChild)).toBe(true);
        expect(queried).toEqual([DIRECTOR_INTERACTIVE_SELECTOR]);
    });

    test("closest is released when the interactive ancestor is not hit.", () => {
        const plainChild = { tagName: "SPAN", closest: () => null };
        expect(blocksDirectorShortcut(plainChild)).toBe(false);
    });

    test("The selector covers three categories: label, role and contenteditable", () => {
        for (const fragment of ["button", "a", "input", "textarea", "select", "option", "label", "summary"]) {
            expect(DIRECTOR_INTERACTIVE_SELECTOR.split(",")).toContain(fragment);
        }
        for (const role of ["button", "switch", "tab", "menuitem", "option", "slider", "checkbox", "radio"]) {
            expect(DIRECTOR_INTERACTIVE_SELECTOR).toContain(`[role="${role}"]`);
        }
        expect(DIRECTOR_INTERACTIVE_SELECTOR).toContain('[contenteditable="true"]');
    });

    test("The goal without closest degenerates into a single node decision.", () => {
        expect(blocksDirectorShortcut({ tagName: "BUTTON" })).toBe(true);
        expect(blocksDirectorShortcut({ tagName: "DIV", getAttribute: () => null })).toBe(false);
        expect(blocksDirectorShortcut(null)).toBe(false);
        expect(blocksDirectorShortcut("button")).toBe(false);
    });

    test("Ordinary DIV containers still allow global shortcut keys: pressing W/Delete in the blank space of the viewport must take effect", () => {
        const viewportBackdrop = { tagName: "DIV", closest: () => null };
        expect(blocksDirectorShortcut(viewportBackdrop)).toBe(false);
        expect(resolveDirectorShortcut(press({ key: "w", isInteractiveTarget: blocksDirectorShortcut(viewportBackdrop) }))).toEqual({ kind: "transform-mode", mode: "translate" });
        expect(resolveDirectorShortcut(press({ key: "Delete", isInteractiveTarget: blocksDirectorShortcut(viewportBackdrop) }))).toEqual({ kind: "delete-selected" });
    });
});

describe("releaseDirectorFocusAfterPointer: The shortcut key must be available immediately after clicking the tool button", () => {
    const fakeButton = () => {
        let blurred = 0;
        return {
            blur: () => {
                blurred += 1;
            },
            blurCount: () => blurred,
        };
    };

    test("Mouse activation (detail > 0) releases focus", () => {
        const target = fakeButton();
        releaseDirectorFocusAfterPointer({ detail: 1, currentTarget: target });
        expect(target.blurCount()).toBe(1);
    });

    test("Keyboard activation (detail === 0) retains focus and the Tab sequence continues", () => {
        const target = fakeButton();
        releaseDirectorFocusAfterPointer({ detail: 0, currentTarget: target });
        expect(target.blurCount()).toBe(0);
    });

    test("Double-click or multiple clicks still release focus", () => {
        const target = fakeButton();
        releaseDirectorFocusAfterPointer({ detail: 2, currentTarget: target });
        expect(target.blurCount()).toBe(1);
    });

    test("No exception will be thrown when the target does not have a blur method", () => {
        expect(() => releaseDirectorFocusAfterPointer({ detail: 1, currentTarget: {} })).not.toThrow();
    });

    test("Guards no longer intercept after releasing focus: this is exactly the behavior that was fixed", () => {
        // 焦点在按钮上 -> 拦截；释放到视口容器 -> 放行。
        const button = { tagName: "BUTTON", closest: () => ({ tagName: "BUTTON" }) };
        expect(resolveDirectorShortcut(press({ key: "Delete", isInteractiveTarget: blocksDirectorShortcut(button) }))).toBeNull();

        const bodyAfterBlur = { tagName: "BODY", closest: () => null };
        expect(resolveDirectorShortcut(press({ key: "Delete", isInteractiveTarget: blocksDirectorShortcut(bodyAfterBlur) }))).toEqual({ kind: "delete-selected" });
    });
});
