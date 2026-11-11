import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { hasUnconfirmedCanvasEdits, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";

export async function saveCanvasForAssistant(canvasId: string) {
    await flushCanvasStorePersistence();
    await syncLocalCanvasProjectToBackend(canvasId);
    if (hasUnconfirmedCanvasEdits(canvasId)) throw new Error("There are still unsaved modifications to the canvas. Please save successfully before sending the message.");
}
