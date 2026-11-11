import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasDirectorNodePanel } from "@/components/canvas/director/canvas-director-node-panel";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const scene = createDirectorScene("Shot 1");
const node: CanvasNodeData = {
    id: "director-1",
    type: CanvasNodeType.Director,
    title: "Director's desk",
    position: { x: 0, y: 0 },
    width: 560,
    height: 560,
    metadata: { workflowKind: "shot", directorSceneId: scene.id, directorShotId: scene.shots[0].id },
};

function render(readNodeContent: (id: string | undefined) => string | undefined = () => undefined) {
    return renderToStaticMarkup(<CanvasDirectorNodePanel node={node} scene={scene} readNodeContent={readNodeContent} onOpen={() => {}} />);
}

describe("Director's desk canvas node", () => {
    test("The empty director's desk only displays the scene preview and clear open button, and does not display the generated prompt box within the node.", () => {
        const markup = render();
        expect(markup).not.toContain("Director's desk</div>");
        expect(markup).toContain("Open the director's desk");
        expect(markup).not.toContain('aria-label="Scene description"');
        expect(markup).not.toContain("Describe the scene you want to build");
        expect(markup).not.toContain("Using descriptions in the Director's Desk");
        expect(markup).not.toContain("Object</span>");
    });

    test("The cover has been cropped and covered with nodes, and the director's console is opened through an independent button.", () => {
        const withPreview = { ...node, metadata: { ...node.metadata, directorPreviewNodeId: "image-1" } };
        const markup = renderToStaticMarkup(<CanvasDirectorNodePanel node={withPreview} scene={scene} readNodeContent={() => "https://example.test/cover.png"} onOpen={() => {}} />);
        expect(markup).toContain('src="https://example.test/cover.png"');
        expect(markup).toContain("object-cover");
        expect(markup).toContain("Open the director's desk");
        expect(markup).toContain('data-director-open="preview"');
        expect(markup).toContain('aria-label="Open director\'s desk"');
        expect(markup).toContain('class="absolute left-1/2 top-1/2');
        expect(markup).toContain("-translate-y-1/2");
        expect(markup).toContain("px-6 py-4 text-base font-semibold");
        expect(markup).toContain("size-8");
        expect(markup).not.toContain("scale(var(--canvas-live-inverse-scale");
        expect(markup).not.toContain("aspect-square");
    });

    test("The default director's desk canvas size is moderately enlarged", () => {
        expect(NODE_DEFAULT_SIZE[CanvasNodeType.Director]).toMatchObject({ width: 640, height: 640 });
    });

    test("The empty state can open the entrance with keyboard focus and provide button semantics.", () => {
        const markup = render();
        expect(markup).toContain('data-director-open="empty"');
        expect(markup).toContain("focus-visible:ring-2");
        expect(markup).toContain('aria-label="Open director\'s desk"');
    });

    test("Persistent covers take precedence over old previews and old items are still retained", () => {
        const withCover = { ...node, metadata: { ...node.metadata, directorCoverUrl: "https://assets.example/cover.png", directorPreviewNodeId: "legacy" } };
        const markup = renderToStaticMarkup(<CanvasDirectorNodePanel node={withCover} scene={scene} readNodeContent={() => "https://assets.example/legacy.png"} onOpen={() => {}} />);
        expect(markup).toContain('src="https://assets.example/cover.png"');
        expect(markup).not.toContain('src="https://assets.example/legacy.png"');
    });

    test("Director node is not wrapped into a second gray card by the universal video node shell", () => {
        const markup = renderToStaticMarkup(<CanvasNode
            data={{ ...node, width: 720 }} scale={1} isSelected={false} isRelated={false} isFocusRelated={false}
            isConnectionTarget={false} showImageInfo={false}
            onMouseDown={() => {}} onHoverStart={() => {}} onHoverEnd={() => {}}
            onConnectStart={() => {}} onResize={() => {}} onContentChange={() => {}}
            onContextMenu={() => {}} renderNodeContent={() => <CanvasDirectorNodePanel node={node} scene={scene} readNodeContent={() => undefined} onOpen={() => {}} />}
        />);
        const shell = markup.match(/class="canvas-node-shell[^\"]*"[^>]*style="([^"]*)"/)?.[1];
        expect(shell).toBeDefined();
        expect(shell).toContain("background:transparent");
        expect(shell).toContain("border:0");
        expect(shell).toContain("box-shadow:none");
        const header = markup.match(/class="canvas-node-external-header[^\"]*"[^>]*style="([^"]*)"/)?.[1];
        expect(header).toContain("--canvas-node-width:720px;");
        expect(header).not.toContain("left:");
        expect(markup).toContain('data-node-header-icon="director"');
    });
});
