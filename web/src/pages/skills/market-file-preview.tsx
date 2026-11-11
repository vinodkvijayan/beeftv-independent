import { Alert, Button } from "antd";
import { useEffect, useState } from "react";
import { getMarketFile } from "@/services/api/skill-market";
import { skillFailureMessage } from "./skill-feedback";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { skillMarkdownBody } from "./skill-document";

export function MarketFilePreview({ skillId, releaseId }: { skillId: string; releaseId: string }) {
    const [content, setContent] = useState("");
    const [offset, setOffset] = useState(0);
    const [eof, setEOF] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { setContent(""); setOffset(0); setEOF(false); setError(""); }, [skillId, releaseId]);
    const read = async () => {
        setBusy(true); setError("");
        try { const value = await getMarketFile(skillId, releaseId, "SKILL.md", offset); if (value.encoding !== "utf-8") throw new Error("SKILL.md is not readable text"); setContent(previous => previous + value.content); setOffset(value.nextOffset); setEOF(value.eof); }
        catch (e) { setError(skillFailureMessage(e, "Failed to read skill text", "Please click the Read button to try again, or close the details and reopen them.")); }
        finally { setBusy(false); }
    };
    return <section className="skill-release-section">
        <details className="skill-release-instructions" onToggle={event => {
            if (event.currentTarget.open && !offset && !eof && !busy && !error) void read();
        }}>
            <summary>Instructions for use</summary>
            {busy && !offset ? <p role="status">Reading instructions...</p> : null}
            {content ? <SkillReleaseMarkdown content={content} /> : null}
            {error ? <Alert type="error" title={error} /> : null}
            {!eof && (offset > 0 || error) ? <Button loading={busy} onClick={() => void read()}>{error ? "Retry reading" : "Continue reading instructions"}</Button> : null}
        </details>
    </section>;
}

export function SkillReleaseMarkdown({ content }: { content: string }) {
    return <article className="skill-release-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ children, href }) => href && /^https?:\/\//i.test(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>,
        table: ({ children }) => <div className="skill-release-table"><table>{children}</table></div>,
        img: ({ alt }) => <span>{alt || "pictures"}</span>,
    }}>{skillMarkdownBody(content)}</ReactMarkdown></article>;
}
