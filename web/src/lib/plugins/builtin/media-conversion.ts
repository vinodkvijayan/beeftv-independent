
import { registerPlugin } from "../plugin-registry";
import { PLUGIN_API_VERSION, type PluginManifest, type RegisteredPlugin } from "../plugin-types";

export const MEDIA_CONVERSION_PLUGIN_ID = "media-conversion";

const manifest: PluginManifest = {
    apiVersion: PLUGIN_API_VERSION,
    id: MEDIA_CONVERSION_PLUGIN_ID,
    name: "media conversion node",
    version: "0.1.0",
    publishedAt: "2026-09-08",
    updatedAt: "2026-09-08",
    description: "Provides image and video first frame conversion nodes in the canvas, supporting grayscale, Canny edge, AI line drawing, local Depth Anything V2 depth map and OpenPose pose skeleton.",
    documentation:
        "#Media conversion node\n\nAfter connecting the image to the conversion node, you can select the grayscale image, Canny edge, AI line drawing, depth map or pose skeleton in the node; when connecting the video, the grayscale image and Canny edge will first extract the first frame of the video and then process it. The AI ​​line art uses the native ControlNet Aux preprocessed model, the depth map uses the natively installed Depth Anything V2 Small model, and the pose skeleton is run using ControlNet Aux's OpenPose human preprocessed model; none of these operations load the Stable Diffusion redraw pipeline. Posture conversion only draws the human skeleton, and will skip and prompt when no character is detected. The transparent cutout and video advanced frame-by-frame models are still being verified, and a clear message will be displayed that they are unavailable.\n\nThe plug-in only reads the media input of the current node and saves the results back to the local material storage of the current canvas node.",
    author: "BeefTV Team",
    surfaces: ["node"],
    permissions: ["canvas.read", "canvas.write", "media.read"],
    trusted: true,
    contributes: {},
};

export const mediaConversionPlugin: RegisteredPlugin = { manifest };

registerPlugin(mediaConversionPlugin);
