import type { DirectorCamera, DirectorObject, DirectorScene, DirectorShot } from "@/types/director";
import { directorColorLabel, directorPoseLabel } from "@/lib/canvas/director/director-scene";

const shotSizeLabels: Record<DirectorShot["shotSize"], string> = {
    extreme_wide: "big vision",
    wide: "Vision",
    full: "full view",
    medium: "medium shot",
    close_up: "Close-up",
    extreme_close_up: "close-up",
};

const cameraMoveLabels: Record<DirectorShot["cameraMove"], string> = {
    static: "Fixed position",
    push_in: "The camera advances slowly",
    pull_out: "The camera slowly zooms out",
    pan_left: "The camera pans to the left",
    pan_right: "The camera pans to the right",
    tilt_up: "The camera pans upward",
    tilt_down: "The camera pans down",
    orbit_left: "The camera wraps around the subject to the left",
    orbit_right: "The camera wraps around the subject to the right",
    handheld: "Restrained handheld camera movements",
};

export function compileDirectorPrompt(scene: DirectorScene, shot: DirectorShot) {
    const camera = scene.cameras.find((item) => item.id === shot.cameraId) || scene.cameras[0];
    const cameraKeys = camera?.keyframes.filter((key) => Number.isFinite(key.time) && key.transform.position.every(Number.isFinite)).sort((a, b) => a.time - b.time) || [];
    const hasKeyframedMotion = cameraKeys.slice(1).some((key, index) => {
        const previous = cameraKeys[index].transform;
        return key.transform.position.some((value, axis) => Math.abs(value - previous.position[axis]) > 1e-4)
            || key.transform.rotation.some((value, axis) => Math.abs(value - previous.rotation[axis]) > 1e-4);
    });
    const cameraMove = hasKeyframedMotion
        ? `press${cameraKeys.length} Keyframes execute the camera trajectory,${formatNumber(cameraKeys[0].time)} seconds at${formatPosition(cameraKeys[0].transform.position)}，${formatNumber(cameraKeys.at(-1)!.time)} seconds at${formatPosition(cameraKeys.at(-1)!.transform.position)}`
        : cameraMoveLabels[shot.cameraMove];
    const visibleObjects = scene.objects.filter((item) => item.visible);
    const actors = visibleObjects.filter((item) => item.kind === "actor" || item.primitive === "character");
    return [
        shot.prompt.trim(),
        `Lens design:${shotSizeLabels[shot.shotSize]}，${cameraMove}, duration${formatNumber(shot.duration)} seconds.`,
        camera ? cameraPrompt(camera) : "",
        actors.length ? `Character color mapping:${actors.map((actor) => `${directorColorLabel(actor.color)}Doll (${actor.color}) represents${actor.name}`).join("；")}. When generating videos, characters are strictly identified by color and the identities of the characters are not exchanged.` : "",
        visibleObjects.length ? `Space scheduling:${visibleObjects.map(objectPrompt).join("；")}。` : "",
        `Lighting:${scene.lights.map((light) => `${light.name}${formatNumber(light.intensity)}intensity${light.color}`).join("，")}。`,
        "Keep the characters, props, spatial direction, light direction and lens axis continuous, and follow the real camera perspective and physical occlusion.",
    ]
        .filter(Boolean)
        .join("\n");
}

function cameraPrompt(camera: DirectorCamera) {
    const [x, y, z] = camera.transform.position;
    const [tx, ty, tz] = camera.target;
    const height = y < ty - 0.4 ? "low position" : y > ty + 1.2 ? "High camera position" : "Head-up camera position";
    const side = x < tx - 0.8 ? "Main left front side" : x > tx + 0.8 ? "Main right front side" : "Main body front";
    const distance = Math.hypot(x - tx, y - ty, z - tz);
    return `Camera:${formatNumber(camera.focalLength)}mm focal length, f/${formatNumber(camera.aperture)} aperture, focal distance${formatNumber(camera.focusDistance)} meters,${height}, located at${side}, the distance between the aircraft and the aircraft is approximately${formatNumber(distance)} m, focus points to (${formatNumber(tx)}, ${formatNumber(ty)}, ${formatNumber(tz)}), the depth of field follows real lens optics.`;
}

function objectPrompt(object: DirectorObject) {
    const [x, y, z] = object.transform.position;
    const pose = object.pose ? `, posture${directorPoseLabel(object.pose)}` : "";
    const color = object.kind === "actor" || object.primitive === "character" ? `，${directorColorLabel(object.color)}Reference puppet` : "";
    return `${object.name}${color}Located at (${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)})${pose}`;
}

function formatNumber(value: number) {
    return Number(value.toFixed(2));
}

function formatPosition(position: [number, number, number]) {
    return `(${position.map(formatNumber).join(", ")})`;
}
