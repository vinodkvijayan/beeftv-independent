export function parseSpeechAudioEvents(text: string): { url?: string; chunks: ArrayBuffer[] } {
    const chunks: ArrayBuffer[] = [];
    let done = false;
    let url: string | undefined;
    for (const frame of text.split(/\r?\n\r?\n/)) {
        const raw = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
        if (!raw || raw === "[DONE]") continue;
        const event = JSON.parse(raw) as { type?: string; audio?: string; audio_url?: string; error?: unknown };
        if (event.error || event.type === "error") throw new Error("Music generation failed, please check task details");
        if (event.type === "speech.audio.delta") {
            if (done || typeof event.audio !== "string") throw new Error("Audio event is invalid");
            const decoded = atob(event.audio);
            chunks.push(Uint8Array.from(decoded, (char) => char.charCodeAt(0)).buffer);
        }
        if (event.type === "speech.audio.done") {
            if (done) throw new Error("Duplicate audio completion events received");
            done = true;
            if (event.audio_url !== undefined) {
                if (typeof event.audio_url !== "string") throw new Error("Audio result address is invalid");
                const parsed = new URL(event.audio_url);
                if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || chunks.length) throw new Error("Audio result address is invalid");
                url = event.audio_url;
            }
        }
    }
    if (!done) throw new Error("The music generation connection was interrupted and the completion result was not received; please check the original task first to avoid repeated payments.");
    if (!url && !chunks.some((chunk) => chunk.byteLength)) throw new Error("Music generation result is empty");
    return { url, chunks };
}
