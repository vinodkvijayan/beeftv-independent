import { Select } from "antd";
import { assistantModelOptions, resolveAssistantModel } from "@/lib/assistant-model";
import { modelDisplayName, resolveModelChannel, useConfigStore } from "@/stores/use-config-store";

export function CanvasAssistantModelPicker({ busy }: { busy: boolean }) {
    const config = useConfigStore((state) => state.config);
    const selected = resolveAssistantModel(config);
    const options = assistantModelOptions(config).map((value) => ({
        value,
        label: modelDisplayName(config, value),
        title: `${modelDisplayName(config, value)} · ${resolveModelChannel(config, value).name}`,
    }));
    return (
        <Select
            className="canvas-assistant-model"
            aria-label="helper model"
            size="small"
            variant="borderless"
            value={selected || undefined}
            placeholder={options.length ? "Select helper model" : "No models available yet"}
            options={options}
            disabled={busy || options.length === 0}
            placement="topLeft"
            popupMatchSelectWidth={false}
            onChange={(value) => {
                if (!busy && assistantModelOptions(useConfigStore.getState().config).includes(value)) {
                    useConfigStore.getState().updateConfig("assistantModel", value);
                }
            }}
        />
    );
}
