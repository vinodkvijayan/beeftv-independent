import { expect, test } from "bun:test";
import { canvasWheelIntent, parseCanvasWheelBehavior } from "../src/lib/canvas/canvas-wheel";

const wheel = (deltaY: number, extra = {}) => ({ deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
test("The 60/80/100/120 steps of the ordinary scroll wheel are all scaled, including line units.", () => {
    for (const delta of [60, 80, 100, 120, -120]) expect(canvasWheelIntent(wheel(delta), null, 0)).toBe("zoom");
    expect(canvasWheelIntent(wheel(3, { deltaMode: 1 }), null, 0)).toBe("zoom");
});
test("Continuous gestures maintain motion, small trackpad scrolling and horizontal scrolling still pan", () => {
    expect(canvasWheelIntent(wheel(3), null, 0)).toBe("pan");
    expect(canvasWheelIntent(wheel(100), { intent: "pan", at: 0 }, 50)).toBe("pan");
    expect(canvasWheelIntent(wheel(7), { intent: "zoom", at: 0 }, 50)).toBe("zoom");
    expect(canvasWheelIntent(wheel(120, { deltaX: 2 }), null, 0)).toBe("pan");
    expect(canvasWheelIntent(wheel(120, { shiftKey: true }), null, 0)).toBe("pan");
    expect(canvasWheelIntent(wheel(2, { ctrlKey: true }), { intent: "pan", at: 0 }, 50)).toBe("zoom");
    expect(canvasWheelIntent(wheel(120), { intent: "pan", at: 0 }, 250)).toBe("zoom");
});
test("Fixed zoom/pan no longer relying on device step guessing", () => {
    // 触控板的小步长在固定缩放下也缩放，滚轮的整数步长在固定平移下也平移。
    expect(canvasWheelIntent(wheel(3), null, 0, "zoom")).toBe("zoom");
    expect(canvasWheelIntent(wheel(120), null, 0, "pan")).toBe("pan");
    expect(canvasWheelIntent(wheel(100), { intent: "zoom", at: 0 }, 50, "pan")).toBe("pan");
});
test("Pinch and horizontal gestures still take priority, and the canvas can also be scrolled in fixed mode.", () => {
    expect(canvasWheelIntent(wheel(2, { ctrlKey: true }), null, 0, "pan")).toBe("zoom");
    expect(canvasWheelIntent(wheel(2, { metaKey: true }), null, 0, "pan")).toBe("zoom");
    expect(canvasWheelIntent(wheel(120, { deltaX: 2 }), null, 0, "zoom")).toBe("pan");
    expect(canvasWheelIntent(wheel(120, { shiftKey: true }), null, 0, "zoom")).toBe("pan");
});
test("If it is not set or the value is illegal, it will fall back to automatic.", () => {
    expect(parseCanvasWheelBehavior(null)).toBe("auto");
    expect(parseCanvasWheelBehavior("")).toBe("auto");
    expect(parseCanvasWheelBehavior("pinch")).toBe("auto");
    expect(parseCanvasWheelBehavior("zoom")).toBe("zoom");
    expect(parseCanvasWheelBehavior("pan")).toBe("pan");
});