export type CameraMovePreset = {
    id: string;
    label: string;
    prompt: string;
};

export type TimeSequencePreset = {
    id: string;
    label: string;
    seconds: string;
    prompt: string;
};

export const CAMERA_MOVE_PRESETS: CameraMovePreset[] = [
    { id: "push_in", label: "Slowly push closer", prompt: "The lens slowly zooms in from the mid-ground to the close-up of the subject, gradually compressing the background space and strengthening emotional focus." },
    { id: "pull_out", label: "Pull back slowly", prompt: "The camera slowly pulls back from the close-up shot of the subject to the mid-shot of the environment, gradually revealing the spatial relationship and the situation of the characters." },
    { id: "pan_left", label: "Pan left", prompt: "The camera pans smoothly to the left horizontally, following the subject's line of sight or action direction to unfold scene information." },
    { id: "pan_right", label: "Pan right", prompt: "The lens pans smoothly to the right horizontally to bring out the relationship between the subject and the surrounding environment." },
    { id: "tilt_up", label: "Upward shot", prompt: "The lens slowly tilts upward from a low position to highlight the subject's height, pressure or sacredness." },
    { id: "tilt_down", label: "Looking down", prompt: "The camera slowly tilts downward from a high position to reveal the subject's position and the layout of the environment." },
    { id: "truck_left", label: "Move left to follow the shot", prompt: "The lens moves to the left in the horizontal direction, maintaining a stable distance from the subject, forming a horizontal tracking shot." },
    { id: "truck_right", label: "Move right to follow the shot", prompt: "The lens moves horizontally to the right, maintaining a stable distance from the subject, resulting in smooth sideways movement." },
    { id: "dolly_forward", label: "forward penetration", prompt: "The camera moves forward and penetrates the scene, passing through the foreground level and then approaching the subject, creating an immersive sense of entry." },
    { id: "dolly_backward", label: "retreat and evacuate", prompt: "The camera moves back and away from the subject, and the space gradually expands, creating alienation or revealing the bigger picture." },
    { id: "crane_up", label: "rise and look down", prompt: "The camera slowly rises from the height of the characters to a bird's-eye view, showing the scale of the environment." },
    { id: "crane_down", label: "drop close", prompt: "The camera slowly descends from a high position to the height of the subject, gradually entering the character's emotional space." },
    { id: "orbit_left", label: "Surround left", prompt: "The camera moves half-circle around the subject to the left, keeping the subject centered and showing the outline and spatial hierarchy." },
    { id: "orbit_right", label: "right wrap", prompt: "The camera moves semi-circularly to the right around the subject to keep the subject clear and enhance dramatic tension." },
    { id: "handheld", label: "Hand shaking slightly", prompt: "The lens has a slight hand-held shake, retaining the unstable breathing feeling of real photography, but the subject is always clear." },
    { id: "steadicam", label: "Stable follow", prompt: "The lens follows the movement of the subject in a stabilizer manner, and the movement is smooth and continuous, maintaining a cinematic rhythm." },
    { id: "tracking_forward", label: "Frontal follow-up shot", prompt: "The camera moves back and follows the subject directly in front of the subject. The subject moves towards the camera, and the expression and movements remain stable and visible." },
    { id: "tracking_behind", label: "Follow behind", prompt: "The camera follows behind the subject, and the audience enters the scene in the same direction as the subject." },
    { id: "whip_pan", label: "Scene transition", prompt: "The camera pans quickly horizontally creating motion blur, before settling back into a new composition at the end of the action." },
    { id: "rack_focus", label: "focus shift", prompt: "The focus of the lens slowly shifts from the foreground to the subject, or from the subject to key props, and the depth of field changes naturally." },
    { id: "zoom_in", label: "Optical zoom boost", prompt: "The lens is slightly optically zoomed forward, and the image compression is enhanced, but the camera position remains stable." },
    { id: "zoom_out", label: "Optical zoom back", prompt: "The lens performs a slight optical zoom and retreats, gradually revealing more environmental information." },
    { id: "low_angle_push", label: "low angle zoom", prompt: "The low camera slowly zooms in on the subject, enhancing the sense of power, pressure and drama." },
    { id: "top_down_reveal", label: "overhead shot reveals", prompt: "The camera slowly moves or drops from a vertical angle to reveal characters and scene layout." },
    { id: "foreground_pass", label: "foreground passing", prompt: "When the camera moves, foreground objects pass from the edge of the frame, adding spatial depth and a sense of cinematic occlusion." },
    { id: "static_hold", label: "fixed gaze", prompt: "The camera remains stable and does not move, allowing only the subject's movements and environmental details to change, creating a sense of gaze." },
];

export const TIME_SEQUENCE_PRESETS: TimeSequencePreset[] = [
    {
        id: "short_6s",
        label: "6 seconds",
        seconds: "6",
        prompt: `[0s] The subject is in the starting screen, describing actions, sceneries and spatial relationships.
[2s] Obvious changes in camera movement or subject action
[4s] Emotion, action or composition enters the result stage
[6s] Action placement, keeping characters, costumes and scenes consistent`,
    },
    {
        id: "short_9s",
        label: "9 seconds",
        seconds: "9",
        prompt: `[0s] Starting screen, clarifying the relationship between subject, scene and environment
[3s] The main action unfolds and the camera remains continuous
[6s] The action or emotion enters the turning and ending stage
[9s] End the scene with the action falling naturally and keeping the character consistent with the scene.`,
    },
    {
        id: "standard_10s",
        label: "10 seconds",
        seconds: "10",
        prompt: `[0s] Starting screen, clarify the subject's position, scene and environment
[2s] The subject begins to move or changes in expression, and the shot remains coherent
[4s] The camera advances, pans, or circles around to show key details
[6s] The action reaches a turning point and the relationship between the characters and the scene changes.
[8s] Emotional or visual focus is focused on the subject
[10s] End the scene, the action stops naturally and maintains consistency`,
    },
    {
        id: "seedance_15s",
        label: "15 seconds",
        seconds: "15",
        prompt: `[0s] Starting screen, explaining the subject, scene, camera position and environmental atmosphere
[3s] The subject begins the main action, and the expression and body posture change
[6s] The camera movement enters the second stage, showing the spatial hierarchy or key props
[9s] There is a turning point in the action, and the interaction between the subject and the scene is enhanced.
[12s] The camera closes to the emotional focus or narrative result
[15s] End scene, the action is completed naturally, the characters, costumes, scenery and lighting are consistent`,
    },
];

export const TIME_SEQUENCE_TEMPLATE = TIME_SEQUENCE_PRESETS[2].prompt;

export function appendPromptSnippet(prompt: string, snippet: string) {
    const base = prompt.trimEnd();
    if (!base) return snippet;
    return `${base}\n${snippet}`;
}
