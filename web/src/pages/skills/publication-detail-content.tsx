import type { ReactNode } from "react";
import type { SkillMetadata } from "@/services/api/skill-market";
import { publicationStatus, requirementLabel } from "./market-copy";

export function PublicationDetailContent({ metadata, status, author, notices, children }: {
    metadata: SkillMetadata;
    status: string;
    author?: string;
    notices?: ReactNode;
    children: ReactNode;
}) {
    return <article className="skill-market-preview" tabIndex={0} role="region" aria-label="Submission details">
        <div className="skill-release-overview">
            <dl className="skill-release-metadata">
                <div><dt>Version</dt><dd>{metadata.versionLabel}</dd></div>
                {author ? <div><dt>Author</dt><dd>{author}</dd></div> : null}
                <div><dt>permission</dt><dd>{metadata.license}</dd></div>
                <div><dt>Status</dt><dd>{publicationStatus(status)}</dd></div>
            </dl>
            <p className="skill-release-description">{metadata.description}</p>
        </div>
        {notices ? <div className="skill-publish-notices">{notices}</div> : null}
        <div className="skill-release-sections">
            <section className="skill-release-section">
                <details><summary>Conditions of use</summary>
                    <p>{(metadata.requirements || []).map(requirementLabel).join("、") || "No additional tools required"}</p>
                    {metadata.requirementNotes ? <p>{metadata.requirementNotes}</p> : null}
                </details>
            </section>
            {children}
        </div>
    </article>;
}
