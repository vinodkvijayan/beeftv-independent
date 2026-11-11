export function localImageRecoveryMessage(source = "") {
    let otherOrigin = false;
    try {
        otherOrigin = source.startsWith("blob:") && typeof window !== "undefined"
            && new URL(source.slice(5)).origin !== window.location.origin;
    } catch { /* Invalid object URLs cannot be recovered by reloading. */ }
    return otherOrigin
        ? "The image is saved in the browser at another site's address. Please use the original address to open the canvas, or re-upload or redraw this image. localhost and 127.0.0.1 do not share image cache."
        : "The local image is not available and may have been cleaned or belongs to another browser. Please re-upload or redraw this image.";
}

export class LocalImageUnavailableError extends Error {
    readonly code = "local_storage_failed";
    constructor(source = "") {
        super(localImageRecoveryMessage(source));
        this.name = "LocalImageUnavailableError";
    }
}
