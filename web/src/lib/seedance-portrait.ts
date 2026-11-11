export type VideoPriceQuote = {
    currency: "CNY";
    mode: "tokens" | "seconds";
    rates: Record<string, { output: number; reference_video: number }>;
    reference_image?: number;
    free_reference_images?: number;
    reference_invoice?: {usd_cny:number;reserve_usd:number};
};

export function seedancePortraitModel(value: string): string {
    const id = value.split("::").at(-1) || "";
    return id === "seedance-2.0-portrait" || id === "seedance-2.5-portrait" ? id : "";
}

export function seedancePortraitLabel(value: string): string {
    const id = value.split("::").at(-1) || "";
    return /^(seedance-2\.[05])(-portrait)?$/.test(id) ? `Seedance ${id.includes("2.5") ? "2.5" : "2.0"}` : "";
}

export function portraitTaskRetryError(inputJson?: string, model?: string): string {
    let input: { videoParameters?: { model?: string }; config?: { model?: string } } = {};
    try { input = inputJson ? JSON.parse(inputJson) || {} : {}; } catch { /* The task model can still identify the tier. */ }
    const portrait = [model, input.videoParameters?.model, input.config?.model].some((value) => typeof value === "string" && seedancePortraitModel(value));
    // Sanitized task detail contains no unique provider or account identity.
    // A current channel with the same bare model ID cannot establish its price.
    return portrait ? "Please go back to the original canvas and reselect the video model, confirm the current price and then regenerate it." : "";
}

export function sanitizeVideoPriceQuote(value: unknown): VideoPriceQuote | null {
    const quote = value as VideoPriceQuote | undefined;
    if (!quote || quote.currency !== "CNY" || !["tokens", "seconds"].includes(quote.mode) || !quote.rates || typeof quote.rates !== "object" || !Object.keys(quote.rates).length) return null;
    const entries = Object.entries(quote.rates);
    if (!entries.every(([resolution, rate]) => ["480p", "720p", "768p", "1080p", "2k", "4k"].includes(resolution) && Number.isFinite(rate?.output) && rate.output > 0 && Number.isFinite(rate?.reference_video) && (quote.mode === "seconds" ? rate.reference_video === 0 : rate.reference_video > 0))) return null;
    const referencePrice = quote.reference_image !== undefined || quote.free_reference_images !== undefined;
    if (referencePrice && (quote.mode !== "seconds" || !Number.isFinite(quote.reference_image) || quote.reference_image! < 0 || !Number.isInteger(quote.free_reference_images) || quote.free_reference_images! < 0 || quote.free_reference_images! > 12)) return null;
    const invoice=quote.reference_invoice;
    if(invoice && (quote.mode!=="seconds"||!Number.isFinite(invoice.usd_cny)||invoice.usd_cny<5||invoice.usd_cny>10||!Number.isFinite(invoice.reserve_usd)||invoice.reserve_usd<=0||invoice.reserve_usd>100))return null;
    return { currency: "CNY", mode: quote.mode, rates: Object.fromEntries(entries.map(([resolution, rate]) => [resolution, { output: rate.output, reference_video: rate.reference_video }])), ...(referencePrice ? {reference_image: quote.reference_image, free_reference_images: quote.free_reference_images} : {}),...(invoice?{reference_invoice:{usd_cny:invoice.usd_cny,reserve_usd:invoice.reserve_usd}}:{}) };
}

export function portraitPriceLines(value: unknown): string[] {
    const quote = sanitizeVideoPriceQuote(value);
    if (!quote) return [];
    if (quote.mode === "seconds") return [...Object.entries(quote.rates).map(([resolution, rate]) => `${resolution}：${quote.reference_invoice?"Normal generation":""}¥${Number(rate.output.toFixed(4))} /sec`), ...(quote.reference_image ? [`before${quote.free_reference_images} Reference pictures for free, then ¥${Number(quote.reference_image.toFixed(4))} / Zhang`] : []),...(quote.reference_invoice?[`Reference Generation: Actual USD Bill ×${quote.reference_invoice.usd_cny} × 1.5; Reserved ¥${Number((quote.reference_invoice.reserve_usd*quote.reference_invoice.usd_cny*1.5).toFixed(4))}, settle after payment`]:[])];
    return Object.entries(quote.rates)
        .map(([resolution, rate]) => `${resolution}: No video input ¥${rate.output}, including video input ¥${rate.reference_video} / Million Video Token`);
}
