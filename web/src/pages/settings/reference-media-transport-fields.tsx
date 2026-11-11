import { Select } from "antd";
import type { ReferenceMediaTransport } from "@/stores/use-config-store";

export function ReferenceMediaTransportFields({ value, onChange }: { value?: ReferenceMediaTransport; onChange: (value: ReferenceMediaTransport) => void }) {
    return <section className="space-y-3">
        <div className="text-xs font-medium">Reference material transfer</div>
        <p className="text-xs leading-5 text-foreground/58">By default, it is processed according to the interface format. Third-party interface requirements are different, and the transmission methods of pictures, videos, and audio can be adjusted separately.</p>
        {(["image", "video", "audio"] as const).map((kind) => <label key={kind} className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
            <span className="w-12 shrink-0">{{ image: "pictures", video: "video", audio: "Audio" }[kind]}</span>
            <Select
                aria-label={`${{ image: "pictures", video: "video", audio: "Audio" }[kind]}Transmission method`}
                className="min-w-0 flex-1"
                value={value?.[kind] || "auto"}
                options={[{ value: "auto", label: "Automatically, processed according to protocol" }, { value: "inline", label: "Directly upload materials" }, { value: "url", label: "Upload to my object storage" }, { value: "link", label: "Manually fill in the HTTPS link" }]}
                onChange={(transport) => onChange({ ...value, [kind]: transport })}
            />
        </label>)}
        <p className="text-xs leading-5 text-foreground/58">To directly transfer materials, use the file of the current protocol or Base64 format, which requires the support of the service provider. When a link is required, the enabled object storage is automatically used; if it is not configured, it can be filled in manually.</p>
    </section>;
}
