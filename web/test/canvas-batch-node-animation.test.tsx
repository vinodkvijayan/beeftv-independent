import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNode } from "../src/components/canvas/canvas-node";
import { CanvasNodeType } from "../src/types/canvas";

const noop = () => {};

function renderChild(options: { selected?: boolean; opening?: boolean; closing?: boolean } = {}) {
    return renderToStaticMarkup(
        <CanvasNode
            data={{ id: "child", type: CanvasNodeType.Image, title: "subplot", position: { x: 600, y: 100 }, width: 340, height: 240, metadata: { batchRootId: "root", status: "idle" } }}
            scale={1}
            isSelected={Boolean(options.selected)}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            showImageInfo={false}
            batchOpening={options.opening}
            batchClosing={options.closing}
            batchMotion={{ x: -566, y: -86, index: 0 }}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResize={noop}
            onContentChange={noop}
            onContextMenu={noop}
        />,
    );
}

describe("Picture group sub-picture animation", () => {
    test("The expansion animation will not be played for normal mounting or selected sub-images.", () => {
        for (const selected of [false, true]) {
            const markup = renderChild({ selected });
            expect(markup).not.toContain("canvas-batch-child-in");
            expect(markup).not.toContain("canvas-batch-child-out");
        }
    });

    test("Only play the corresponding animation during the expansion or collapse of the image group", () => {
        expect(renderChild({ opening: true })).toContain("canvas-batch-child-in");
        expect(renderChild({ closing: true })).toContain("canvas-batch-child-out");
    });
});
