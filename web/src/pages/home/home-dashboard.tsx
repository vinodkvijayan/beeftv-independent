import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { isEmbeddedRuntime } from "@/lib/embedded-runtime";
import type { CanvasLibrarySummary } from "@/services/api/workspace-data";
import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { beefTVCapabilityItems } from "./home-data";
function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Just updated";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replaceAll("/", "-");
}

export function HomeDashboard({ projects, loading, error, onRetry }: { projects: CanvasLibrarySummary[]; loading: boolean; error: boolean; onRetry: () => void }) {
    const navigate = useNavigate();
    return (
        <main className="beeftv-home" aria-label="BeefTV Home Page">
            <section className="beeftv-home-hero" aria-label="New canvas">
                <span className="beeftv-home-dot-base" aria-hidden />
                <span className="beeftv-home-dot-flow" aria-hidden />
                <span className="beeftv-home-dot-flow beeftv-home-dot-flow-delay" aria-hidden />
                <button type="button" className="beeftv-home-create" onClick={() => navigate("/canvas?mode=new")}>
                    <span className="beeftv-home-create-icon"><Plus /></span>
                    <span className="beeftv-home-create-title">Create a new canvas</span>
                </button>
            </section>

            <nav className="beeftv-capabilities" aria-label="creative ability">
                {beefTVCapabilityItems.filter((item) => item.id !== "agent" || !isEmbeddedRuntime()).map(({ id, label, detail, to, icon: Icon, disabled }) => (
                    disabled ? (
                        <span key={id} className="beeftv-capability is-disabled" aria-disabled="true" title={`${label}：${detail}`}>
                            <span className="beeftv-capability-icon"><Icon /></span>
                            <strong>{label}</strong>
                        </span>
                    ) : (
                        <Link key={id} to={to} className="beeftv-capability" title={detail}>
                            <span className="beeftv-capability-icon"><Icon /></span>
                            <strong>{label}</strong>
                        </Link>
                    )
                ))}
            </nav>

            <section className="beeftv-home-section beeftv-recents">
                <header className="beeftv-section-heading"><h2>Recent projects</h2><Link to="/project">View all<ArrowRight /></Link></header>
                {error ? (
                    <button className="beeftv-home-error" type="button" onClick={onRetry}><RefreshCw />Canvas reading failed, click to try again</button>
                ) : (
                    <div className="beeftv-recent-grid">
                        {loading ? Array.from({ length: 4 }, (_, index) => <div className="beeftv-recent-card is-loading" key={index} />) : projects.length ? projects.map((project) => {
                            return <Link to={`/canvas/${project.id}`} className="beeftv-recent-card" key={project.id}>
                                <span className="beeftv-recent-preview"><ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} emptyVariant="libtv" /></span>
                                <span className="beeftv-recent-copy"><strong>{project.title || "Unnamed"}</strong><small>{formatDate(project.updatedAt)}</small></span>
                                <ArrowRight className="beeftv-recent-arrow" />
                            </Link>;
                        }) : <button type="button" className="beeftv-recent-card is-empty" onClick={() => navigate("/canvas?mode=new")}><span className="beeftv-recent-preview"><Plus /></span><span className="beeftv-recent-copy"><strong>Create the first canvas</strong><small>Let inspiration have a place to start</small></span></button>}
                    </div>
                )}
            </section>
        </main>
    );
}
