import type { CSSProperties } from "react";
import { AlertCircle, ImageUp, FileText, Film, Music2 } from "lucide-react";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { uploadVeilOpacity } from "@/lib/canvas/canvas-file-upload";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { useCanvasNodeActions } from "./canvas-node-action-context";

export function CanvasFileUploadContent({ node, theme, reduceMotion = false }: { node: CanvasNodeData; theme: CanvasTheme; reduceMotion?: boolean }) {
    const { upload } = useCanvasNodeActions();
    const failed = node.metadata?.fileUpload === "error";
    const percent = node.metadata?.fileUploadProgress;
    const label = node.type === CanvasNodeType.Image ? "pictures" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "Audio" : "text";
    const Icon = failed ? AlertCircle : node.type === CanvasNodeType.Video ? Film : node.type === CanvasNodeType.Audio ? Music2 : node.type === CanvasNodeType.Text ? FileText : ImageUp;
    return (
        <div className="canvas-file-upload" data-static={reduceMotion || failed || undefined} style={{ "--upload-surface": theme.node.fill, "--upload-text": theme.node.text, "--upload-muted": theme.node.muted } as CSSProperties}>
            <div className="canvas-file-upload-glow" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
            <div className="canvas-file-upload-frost" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
            <div className="canvas-file-upload-copy" role="status" aria-live="polite" aria-busy={!failed}>
                <Icon className="size-5" aria-hidden="true" />
                <span className="canvas-file-upload-label">{failed ? `${label}Upload not completed` : `Uploading${label}`}</span>
                <span className="canvas-file-upload-detail">{failed ? node.metadata?.errorDetails || "Please reselect file upload" : percent === 100 ? "The file has been transferred and is being saved and processed" : percent !== undefined ? `Uploaded${percent}%` : "Preparing files"}</span>
                {!failed && <span role="progressbar" aria-label={`${label}Upload progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="sr-only" />}
                {failed && upload ? <button type="button" data-canvas-no-zoom className="canvas-file-upload-retry" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); upload(node); }}>Reselect file</button> : null}
            </div>
        </div>
    );
}
