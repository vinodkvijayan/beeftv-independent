import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

// Evidence for "the default-model dropdown does not open" reports. Each step of
// pressing a picker is written to the client diagnostics buffer, which the
// diagnostics package already exports, so a user's bundle shows whether the
// press reached the select, whether the popup rendered, and what covered it.
// Only structural facts are recorded: counts, timings, element tags/classes.

export type ModelPickerSnapshot = {
    pickerId: string;
    title: string;
    optionCount: number;
    hasValue: boolean;
    unavailable: boolean;
    disabled: boolean;
    buildMs: number;
};

const OPEN_CHECK_DELAY_MS = 600;
const POPUP_SETTLE_MS = 450;
const POPUP_SELECTOR = ".model-default-select-popup";
const openChecks = new Map<string, number>();

type PendingPress = { title: string; startedAt: number; opened: boolean };
let pendingPress: PendingPress | undefined;

export function describeDiagnosticElement(element: Element | null | undefined) {
    if (!element) return "None";
    const tag = element.tagName.toLowerCase();
    const raw = typeof element.className === "string" ? element.className : element.getAttribute("class") || "";
    const classes = raw.split(/\s+/).filter((name) => name.startsWith("ant-") || name.startsWith("model-") || name.startsWith("settings-")).slice(0, 3);
    return classes.length ? `${tag}.${classes.join(".")}` : tag;
}

function visibleOverlayCount(doc: Document, selector: string) {
    return Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter((element) => {
        const style = doc.defaultView?.getComputedStyle(element);
        return style ? style.display !== "none" && style.visibility !== "hidden" : true;
    }).length;
}

function surroundings(doc: Document) {
    const reducedMotion = doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return `Pop-up window${visibleOverlayCount(doc, ".ant-modal-wrap")} individual, focus${describeDiagnosticElement(doc.activeElement)}, reduce dynamic effects${reducedMotion === undefined ? "unknown" : reducedMotion ? "turn on" : "Close"}`;
}

function snapshotText(snapshot: ModelPickerSnapshot) {
    return `Options${snapshot.optionCount} one,${snapshot.unavailable ? "The selected model is not available" : snapshot.hasValue ? "Already selected" : "Not selected"}，${snapshot.disabled ? "Disabled" : "Available"}, option calculation${Math.round(snapshot.buildMs)}ms`;
}

export function recordModelPickerPress(snapshot: ModelPickerSnapshot, point: { x: number; y: number }, doc: Document = document) {
    const press: PendingPress = { title: snapshot.title, startedAt: performance.now(), opened: false };
    pendingPress = press;
    recordDiagnosticEvent({
        level: "info",
        category: "action",
        code: "MODEL_PICKER_PRESS",
        message: `${snapshot.title} was clicked:${snapshotText(snapshot)}，${surroundings(doc)}`,
    });
    window.setTimeout(() => {
        if (press.opened || pendingPress !== press) return;
        const hit = doc.elementFromPoint(point.x, point.y);
        recordDiagnosticEvent({
            level: "warning",
            category: "action",
            code: "MODEL_PICKER_NOT_OPENED",
            message: `${snapshot.title} after click${OPEN_CHECK_DELAY_MS}ms is still not expanded: click on the current element${describeDiagnosticElement(hit)}，${surroundings(doc)}`,
        });
    }, OPEN_CHECK_DELAY_MS);
}

export function recordModelPickerOpenChange(snapshot: ModelPickerSnapshot, open: boolean, doc: Document = document) {
    window.clearTimeout(openChecks.get(snapshot.pickerId));
    openChecks.delete(snapshot.pickerId);
    const press = pendingPress?.title === snapshot.title ? pendingPress : undefined;
    if (!open) {
        recordDiagnosticEvent({ level: "info", category: "action", code: "MODEL_PICKER_CLOSE", message: `${snapshot.title} Collected,${surroundings(doc)}` });
        return;
    }
    if (press) press.opened = true;
    const delay = press ? performance.now() - press.startedAt : undefined;
    // Check after the open animation: the popup fades in from opacity 0.
    const timer = window.setTimeout(
        () => {
            openChecks.delete(snapshot.pickerId);
            const popup = doc.querySelector<HTMLElement>(`${POPUP_SELECTOR}-${snapshot.pickerId}`) ?? undefined;
            const visible = popup && popupVisible(doc, popup);
            const trigger = doc.querySelector<HTMLElement>(`[data-model-picker-id="${snapshot.pickerId}"]`);
            const triggerRect = trigger?.getBoundingClientRect();
            const popupRect = popup?.getBoundingClientRect();
            const gap = triggerRect && popupRect ? Math.min(Math.abs(popupRect.top - triggerRect.bottom), Math.abs(triggerRect.top - popupRect.bottom)) : undefined;
            const misaligned = visible && triggerRect && popupRect && gap !== undefined && (gap > 16 || popupRect.right <= triggerRect.left || popupRect.left >= triggerRect.right);
            recordDiagnosticEvent({
                level: visible && !misaligned ? "info" : "warning",
                category: "action",
                code: !visible ? "MODEL_PICKER_POPUP_HIDDEN" : misaligned ? "MODEL_PICKER_POPUP_MISALIGNED" : "MODEL_PICKER_OPEN",
                message: `${snapshot.title} Expand:${snapshotText(snapshot)}，${describePopup(doc, popup)}${triggerRect && gap !== undefined ? `, the selection box is located at (${Math.round(triggerRect.left)}, ${Math.round(triggerRect.top)}), menu spacing${Math.round(gap)}px${misaligned ? ", the menu position deviates from the selection box" : ""}` : ""}，${surroundings(doc)}`,
                durationMs: delay,
            });
        },
        POPUP_SETTLE_MS,
    );
    openChecks.set(snapshot.pickerId, timer);
}

export function recordModelPickerChange(snapshot: ModelPickerSnapshot) {
    recordDiagnosticEvent({ level: "info", category: "action", code: "MODEL_PICKER_CHANGE", message: `${snapshot.title} New model selected` });
}

function popupVisible(doc: Document, popup: HTMLElement) {
    const rect = popup.getBoundingClientRect();
    const style = doc.defaultView?.getComputedStyle(popup);
    return rect.width > 0 && rect.height > 0 && popupInViewport(doc, rect) && (!style || (style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0.05));
}

function popupInViewport(doc: Document, rect: DOMRect) {
    const view = doc.defaultView;
    return !view || (rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth);
}

function describePopup(doc: Document, popup: HTMLElement | undefined) {
    if (!popup) return "The elastic layer is not rendered";
    const rect = popup.getBoundingClientRect();
    const style = doc.defaultView?.getComputedStyle(popup);
    const items = popup.querySelectorAll(".ant-select-item-option").length;
    const view = doc.defaultView;
    const inViewport = popupInViewport(doc, rect);
    const left = Math.max(0, rect.left);
    const right = Math.min(view?.innerWidth ?? rect.right, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(view?.innerHeight ?? rect.bottom, rect.bottom);
    const center = inViewport ? doc.elementFromPoint((left + right) / 2, top + Math.min((bottom - top) / 2, 16)) : null;
    const covered = !inViewport ? "Outside the window, occlusion cannot be detected" : !center ? "Unable to detect occlusion" : !popup.contains(center) ? `Be${describeDiagnosticElement(center)} occlusion` : "not obscured";
    return `elastic layer${Math.round(rect.width)}×${Math.round(rect.height)} Located at (${Math.round(rect.left)}, ${Math.round(rect.top)})，${inViewport ? "within window" : "outside the window"}, transparency${style?.opacity ?? "?"}, level${style?.zIndex ?? "?"}, rendered options${items} one,${covered}`;
}

// A layer left above the pickers (a stuck mask, tooltip or popover) takes the
// press before the select sees it, so the picker itself records nothing. Watch
// presses at document level and report the element that actually received a
// press landing inside a picker's box.
export function watchModelPickerBlockers(root: HTMLElement, doc: Document = document) {
    const onPointerDown = (event: PointerEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        for (const picker of Array.from(root.querySelectorAll<HTMLElement>(".model-default-select"))) {
            const rect = picker.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
            if (target && picker.contains(target)) return;
            recordDiagnosticEvent({
                level: "warning",
                category: "action",
                code: "MODEL_PICKER_BLOCKED",
                message: `${picker.getAttribute("aria-label") || picker.querySelector("[aria-label]")?.getAttribute("aria-label") || "Model selection box"} of clicks${describeDiagnosticElement(target)} Pick it up,${surroundings(doc)}`,
            });
            return;
        }
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => doc.removeEventListener("pointerdown", onPointerDown, true);
}

// "Deleting a channel does nothing" reports: record whether the confirm opened,
// whether 删除 was confirmed, and whether the channel actually left the list.
export function recordChannelDeleteConfirmOpen(open: boolean) {
    recordDiagnosticEvent({ level: "info", category: "action", code: open ? "CHANNEL_DELETE_CONFIRM_OPEN" : "CHANNEL_DELETE_CONFIRM_CLOSE", message: open ? "Delete channel confirmation box is open" : "Delete channel confirmation box has been closed" });
}

export function recordChannelDelete(result: { scope?: string; before: number; after: number }) {
    const removed = result.before - result.after;
    recordDiagnosticEvent({
        level: removed === 1 ? "info" : "warning",
        category: "action",
        code: removed === 1 ? "CHANNEL_DELETED" : "CHANNEL_DELETE_NOOP",
        message: `Confirm deletion channel: Scope${result.scope || "personal"}, number of channels${result.before} → ${result.after}`,
    });
}
