import { ChoiceBrowser } from "./choice-browser";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";

export function ModelProtocolBrowser({
    capability,
    protocols,
    ...props
}: {
    capability?: ProtocolCapability;
    protocols: ModelProtocolDefinition[];
    value?: string;
    onChange?: (value: string) => void;
    loading?: boolean;
    error?: string;
    disabled?: boolean;
    id?: string;
}) {
    const options = protocols
        .filter((protocol) => (!capability || protocol.capability === capability) && protocol.enabled !== false)
        .map((protocol) => ({
            value: protocol.value,
            label: protocol.label,
            subtitle: protocol.create,
            vendor: protocol.vendor,
            searchText: protocol.value,
            details: [
                { label: "Request", value: <code>{protocol.create}</code> },
                { label: "Request body", value: protocol.contentType },
                { label: "response", value: protocol.poll ? "Asynchronous polling" : "Synchronous response" },
                { label: "Source", value: protocol.media },
            ],
        }));

    return <ChoiceBrowser key={capability || "all"} {...props} label="Interface format" placeholder="Search interface name, vendor or request path" options={options} />;
}
