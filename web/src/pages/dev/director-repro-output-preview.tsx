/** Local-only preview of the exact blobs sent through the real workbench output callback. */
export function DirectorReproOutputPreview({ beautyUrl, clayVideoUrl }: { beautyUrl: string; clayVideoUrl: string | null }) {
    return (
        <section aria-label="Recently generated reference material" className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-3 text-sm font-medium">Recently generated reference material</h2>
            <div className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0">
                    <img src={beautyUrl} alt="Reference composition of event camera positions" className="max-h-72 w-full rounded-lg bg-black object-contain" />
                    <a href={beautyUrl} download="Director's desk reference picture.png" className="mt-2 inline-block text-xs text-blue-400">Download reference image</a>
                </div>
                {clayVideoUrl ? <div className="min-w-0">
                    <video src={clayVideoUrl} controls playsInline preload="metadata" aria-label="White film reference video" className="max-h-72 w-full rounded-lg bg-black" />
                    <a href={clayVideoUrl} download="Director's white film video.webm" className="mt-2 inline-block text-xs text-blue-400">Download white film video</a>
                </div> : null}
            </div>
        </section>
    );
}
