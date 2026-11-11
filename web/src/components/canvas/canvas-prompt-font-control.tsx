import { Minus, Plus } from "lucide-react";
import { DEFAULT_PROMPT_FONT_SIZE, MAX_PROMPT_FONT_SIZE, MIN_PROMPT_FONT_SIZE, useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";

export function CanvasPromptFontControl({ defaultFontSize = DEFAULT_PROMPT_FONT_SIZE }: { defaultFontSize?: number }) {
    const fontSize = useCreationPreferencesStore((state) => state.preferences.promptFontSize ?? defaultFontSize);
    const remember = useCreationPreferencesStore((state) => state.rememberPromptFontSize);
    return <div className="canvas-prompt-font-control" role="group" aria-label="Prompt word size" data-canvas-no-zoom>
        <span aria-hidden>Font size</span>
        <button type="button" aria-label="Reduce prompt word size" title="Reduce prompt word size" disabled={fontSize <= MIN_PROMPT_FONT_SIZE} onClick={() => remember(fontSize - 2)}><Minus size={12} /></button>
        <output aria-label="Current prompt word font size">{fontSize}</output>
        <button type="button" aria-label="Enlarge prompt word size" title="Enlarge prompt word size" disabled={fontSize >= MAX_PROMPT_FONT_SIZE} onClick={() => remember(fontSize + 2)}><Plus size={12} /></button>
    </div>;
}
