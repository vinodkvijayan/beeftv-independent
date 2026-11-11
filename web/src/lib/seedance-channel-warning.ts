// Temporary advisory for the two verified WhatsToken routes. Native Ark,
// Fast and Mini retain their own contract.
export function seedanceTaskRetryWarning(inputJson?: string, model?: string) {
    try {
        const input = JSON.parse(inputJson || "{}");
        const p = input.videoParameters;
        if (!p?.affectedChannel) return undefined;
        return seedanceReferenceRatioWarning({ model: p.model || model || "", credentialRef: "beeftv", videoCount: p.videoCount, ratio: p.size, operation: input.metadata?.videoEditOperation });
    } catch { return undefined; }
}

export function seedanceReferenceRatioWarning(input: { model: string; baseUrl?: string; credentialRef?: string; videoCount: number; ratio: string; operation?: string }) {
    if (!input.videoCount || !["seedance-2.0", "seedance-2.0-official2", "seedance-2.5", "seedance-2.5-official"].includes(input.model)) return undefined;
    if (["inpaint", "replace_element", "style_transfer", "extend"].includes(input.operation || "")) return undefined;
    if (!input.ratio || ["adaptive", "auto"].includes(input.ratio)) return undefined;
    let host = "";
    try { host = new URL(input.baseUrl || "").hostname.toLowerCase(); } catch { /* Managed credentials may not expose a URL. */ }
    if (input.credentialRef !== "beeftv" && !["beeftv.app", "whatstoken.ai", "www.whatstoken.ai"].includes(host)) return undefined;
    return {
        title: "The output scale may not be consistent with the settings",
        content: `When the current model is generated with a reference video, it may not be as set.${input.ratio} output. Continuing to generate will still be billed, and there will be no automatic refund if the proportion does not match. You can also change the model, or remove the reference video and generate it again.`,
        okText: "accept risk and generate",
        cancelText: "Return to adjustment",
    };
}
