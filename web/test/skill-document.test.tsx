import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { skillMarkdownBody } from "../src/pages/skills/skill-document";

test("skill preview renders the body without turning frontmatter into a heading", () => {
    const source = "---\nname: material-inventory\ndescription: |\n  Organize materials\n  keep source\n---\n# Material list organization\n\nText\n\n---\n\n## Output";
    const body = skillMarkdownBody(source);
    const html = renderToStaticMarkup(<ReactMarkdown>{body}</ReactMarkdown>);
    expect(html).toContain("<h1>Material list organization</h1>");
    expect(html).toContain("<h2>Output</h2>");
    expect(html).toContain("<hr/>");
    expect(html).not.toContain("name:");
    expect(html).not.toContain("description:");
    expect(source).toStartWith("---\nname:");
});

test("frontmatter supports BOM, Windows newlines, and the YAML end marker", () => {
    expect(skillMarkdownBody("﻿---\r\nname: test\r\n...\r\n# Text\r")).toBe("# Text\r");
    expect(skillMarkdownBody("---\nname: test\n---")).toBe("");
    expect(skillMarkdownBody("---\nname:\n---\nText")).toBe("Text");
});

test("ordinary Markdown and incomplete metadata are preserved verbatim", () => {
    for (const source of ["", "# title\n\nname: text", "---\nOrdinary opening\n---\nText", "---\nname: unfinished\n# Text", "```yaml\n---\nname: example\n---\n```", "# Text\n\n---\nname: example\n---"]) {
        expect(skillMarkdownBody(source)).toBe(source);
    }
});
