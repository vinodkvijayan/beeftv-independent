import { AudioLines, Bot, Box, Clapperboard, Image, Layers3, Video } from "lucide-react";

export const beefTVCapabilityItems = [
    { id: "canvas", label: "free canvas", detail: "Organize shots and materials", to: "/canvas?mode=new", icon: Layers3, disabled: false },
    { id: "video", label: "video generation", detail: "Create a video node in the canvas", to: "/canvas?mode=new&add=video", icon: Video, disabled: false },
    { id: "image", label: "Image generation", detail: "Create an image node in the canvas", to: "/canvas?mode=new&add=image", icon: Image, disabled: false },
    // Audio generation is a creation entry, not an asset filter. Start a
    // local canvas and let the canvas insert the correctly configured node.
    { id: "audio", label: "audio generation", detail: "Dubbing and sound materials", to: "/canvas?mode=new&add=audio", icon: AudioLines, disabled: false },
    { id: "director", label: "3D director's desk", detail: "Create a new canvas and open the 3D director's desk", to: "/canvas?mode=new&start=director", icon: Box, disabled: false },
    { id: "agent", label: "Beef Agent", detail: "Create a new canvas and open Beef Agent", to: "/canvas?mode=new&start=agent", icon: Bot, disabled: false },
    { id: "projects", label: "Project library", detail: "View existing projects and continue creating", to: "/project", icon: Clapperboard, disabled: false },
] as const;
