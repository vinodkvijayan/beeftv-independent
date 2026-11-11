import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Film, Layers3, PackageCheck } from "lucide-react";
import { Link } from "react-router";

import { ASSET_CATEGORIES } from "@/lib/asset-category";
import { listProjectAssetsPage, type ProjectDetail } from "@/services/api/projects";

import { assetCategoryLabel, formatDuration, MetricCard, StageHeading } from "./workflow-shared";

export function StoryStage({ detail, projectId, unitId }: { detail: ProjectDetail; projectId: string; unitId: string }) {
    const unit = detail.units.find((item) => item.id === unitId)!;
    return <section className="mx-auto max-w-5xl"><StageHeading eyebrow="01 / Plot and Chapters" title={unit.title} description="Chapter text is your single source for asset splits, storyboards, and build tips." /><div className="mt-6 rounded-xl border border-border/70 bg-surface p-5"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-foreground/55">Chapter original text</span><Link to={`/projects/${projectId}/chapters/${unit.id}`}><Button size="small">Edit chapter</Button></Link></div><div className="max-h-[60vh] whitespace-pre-wrap text-sm leading-7 text-foreground/78">{unit.sourceText || "There is no text for the current chapter. Please upload novels or add content in the plot chapter first."}</div></div></section>;
}

export function AssetsStage({ detail, projectId, unitId }: { detail: ProjectDetail; projectId: string; unitId: string }) {
    const candidates = detail.assetCandidates.filter((item) => !item.unitId || item.unitId === unitId);
    const assetCountsQuery = useQuery({ queryKey: ["project", projectId, "assets", "workflow-counts"], queryFn: () => listProjectAssetsPage(projectId, { page: 1, pageSize: 1 }) });
    const confirmedCounts = assetCountsQuery.data?.categoryCounts || {};
    return <section className="mx-auto max-w-6xl"><StageHeading eyebrow="02 / Asset split" title="Confirm the assets that the shot will actually use" description="Stable versions of characters, scenes, props, materials and other assets are first created, and the shots are then bound to specific versions." /><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{ASSET_CATEGORIES.map((category) => { const confirmed = confirmedCounts[category] || 0; const pending = candidates.filter((item) => item.category === category && item.status === "pending_confirmation").length; return <div key={category} className="border-t border-border/70 py-4"><div className="text-xs font-medium text-foreground/55">{assetCategoryLabel(category)}</div><div className="mt-3 text-2xl font-semibold">{assetCountsQuery.isLoading ? "—" : confirmed}</div><div className="mt-1 text-[var(--fs-micro)] text-foreground/42">Confirmed ·{pending}  Pending</div></div>; })}</div><div className="mt-5 flex items-center justify-between border-y border-border/70 py-5"><div><h3 className="text-sm font-semibold">The asset library is responsible for version confirmation and setting maintenance.</h3><p className="mt-1 text-xs text-foreground/48">After confirmation, you can directly bind it to the lens in the left column of the storyboard workbench.</p></div><Link to={`/projects/${projectId}/assets`}><Button type="primary">Open asset library</Button></Link></div></section>;
}

export function DeliveryStage({ detail, unitId }: { detail: ProjectDetail; unitId: string }) {
    const shots = detail.shots.filter((item) => item.unitId === unitId);
    const readyVideos = shots.filter((shot) =>
        detail.shotArtifacts.some((item) => item.shotId === shot.id && item.type === "video" && item.selected && item.status === "ready"),
    );
    const stale = detail.shotArtifacts.filter((item) => item.unitId === unitId && item.status === "stale").length;

    return (
        <section className="mx-auto max-w-5xl">
            <StageHeading
                eyebrow="06 / Delivery and Packing"
                title="Pre-delivery quality gate control"
                description="After all the footage is ready and expired products are cleared, they are packaged into films and production materials."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <MetricCard icon={<Film className="size-5" />} label="Video is ready" value={`${readyVideos.length} / ${shots.length}`} />
                <MetricCard
                    icon={<Clock3 className="size-5" />}
                    label="total duration"
                    value={formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))}
                />
                <MetricCard icon={<Layers3 className="size-5" />} label="Expired products" value={String(stale)} />
            </div>
            <div className="mt-5 border-y border-border/70 py-5">
                <div className="flex items-start gap-3">
                    <PackageCheck className="mt-0.5 size-5 text-[var(--workspace-accent)]" />
                    <div>
                        <h3 className="text-sm font-semibold">Planned deliverables</h3>
                        <p className="mt-1 text-xs leading-5 text-foreground/48">
                                                        Finished movie MP4, subtitles SRT, storyboard JSON/CSV, asset list and build parameters ZIP.
                        </p>
                    </div>
                </div>
                <p className="mt-5 text-xs leading-5 text-foreground/48">
                    The current version only provides pre-delivery inspection and does not provide an entrance to the delivery package generation; the export will be enabled after the back-end packaging tasks, product storage and download permissions are obtained.
                </p>
            </div>
        </section>
    );
}
