import assert from "node:assert/strict";
import test from "node:test";
import { markdownPlainText } from "./markdown-plain-text";

test("markdownPlainText strips titles, bold and list marks", () => {
    assert.equal(markdownPlainText("## Conclusion first\n\n**No nodes created**\n- The first point\n- Second point"), "Conclusion first No nodes are created First point Second point");
});

test("markdownPlainText fence code blocks replaced with placeholders, including unclosed fences", () => {
    assert.equal(markdownPlainText("Look at this:\n```json\n{\"a\":1}\n```"), "Look at this: code block");
    assert.equal(markdownPlainText("Start with ```js\nconst a = 1;"), "Start code block");
});

test("markdownPlainText links retain the copy and images retain alt", () => {
    assert.equal(markdownPlainText("[Document](https://example.com) and ![Storyboard](a.png)"), "Documentation and storyboards");
});

test("markdownPlainText compresses the table into cell text", () => {
    assert.equal(markdownPlainText("| Shot | Duration |\n| --- | --- |\n| 1 | 3s |"), "Shot duration 1 3s");
});

test("markdownPlainText inline code and quote blocks only retain content", () => {
    assert.equal(markdownPlainText("> Reference `generate_media` tool"), "Quoting the generate_media tool");
});
