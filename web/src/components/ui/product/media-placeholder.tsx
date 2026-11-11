import { ImageOff, Layers3 } from "lucide-react";

export function MediaPlaceholder({ failed = false, label }: { failed?: boolean; label?: string }) {
    const Icon = failed ? ImageOff : Layers3;
    return <span className="product-media-placeholder" role={failed ? "img" : undefined} aria-label={failed ? "Cover loading failed" : undefined}>
        <span className="product-media-placeholder-icon"><Icon aria-hidden="true" /></span>
        <span>{label || (failed ? "Cover is not available yet" : "start with an idea")}</span>
    </span>;
}
