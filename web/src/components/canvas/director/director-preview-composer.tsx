import { Input } from "antd";
import { ArrowUp, ImagePlus } from "lucide-react";

/**
 * 导演画布上的文本意图输入。
 * 只编辑已有 shot.prompt；不展示尚未接入的自然语言场景生成操作。
 */
export function DirectorPreviewComposer({ prompt, onPromptChange, intent = "shot", onAddReference, onSubmit, submitting = false, submitUnavailable = false }: { prompt: string; onPromptChange: (prompt: string) => void; intent?: "shot" | "scene"; onAddReference?: () => void; onSubmit?: () => void; submitting?: boolean; submitUnavailable?: boolean }) {
    const sceneIntent = intent === "scene";
    return (
        <div className={`director-preview-composer${sceneIntent ? " director-scene-composer" : ""}`} role="group" aria-label={sceneIntent ? "scene description" : "shot intention"}>
            <Input.TextArea aria-label={sceneIntent ? "scene description" : "Current shot intent"} data-canvas-no-zoom autoSize={{ minRows: 1, maxRows: 3 }} value={prompt} placeholder={sceneIntent ? "Describe the scene you want to build" : "Select an element or camera position to describe the action and narrative intent of the current shot..."} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={(event) => { if (sceneIntent && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!submitUnavailable) onSubmit?.(); } }} />
            {sceneIntent ? <div className="director-scene-composer-actions">
                <button type="button" data-canvas-no-zoom aria-label="Add scene reference pictures" title="Upload a picture and add it as a scene reference sign" disabled={submitting} onMouseDown={(event) => event.preventDefault()} onClick={onAddReference}><ImagePlus aria-hidden /></button>
                <button type="button" data-canvas-no-zoom data-unavailable={submitUnavailable || undefined} aria-label="Send the current scene to the canvas" title={submitUnavailable ? "AI automatic construction is not yet open" : "Apply current 3D composition and description to canvas"} disabled={submitting || submitUnavailable} onMouseDown={(event) => event.preventDefault()} onClick={onSubmit}>{submitting ? <span className="director-composer-submit-spinner" aria-hidden /> : <ArrowUp aria-hidden />}</button>
            </div> : null}
        </div>
    );
}
