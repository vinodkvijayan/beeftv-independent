import { expect, test } from "bun:test";
import { assertCanvasImageReferenceTable } from "../src/lib/canvas/canvas-reference-table";

test("only rejects an unambiguous explicit IMAGE table binding", () => {
    const images = [{ title: "A", label: "Picture 1" }, { title: "B", label: "Picture 2" }];
    for (const prompt of ["| IMAGE 1 | `@乙` |", "| IMAGE 1 | @image2 |", "| image 1 | @乙 |"])
        expect(() => assertCanvasImageReferenceTable(prompt, images)).toThrow("IMAGE 1 corresponds to picture 2");
    for (const prompt of ["| IMAGE 2 | `@乙` |", "| IMAGE 1 | @image1 |", "IMAGE 1 On the left side of the screen, 2 people", "| IMAGE 1 | Unbound name |", "| IMAGE 1 | @unknown |"])
        expect(() => assertCanvasImageReferenceTable(prompt, images)).not.toThrow();
    expect(() => assertCanvasImageReferenceTable("| IMAGE 1 | @same name |", [{ title: "Same name", label: "Picture 1" }, { title: "Same name", label: "Picture 2" }])).not.toThrow();
});

test("drawing labels resolve to their final image upload slot", () => {
    const images = [{ title: "Sketch", label: "Drawing 1" }, { title: "Corridor", label: "Picture 1" }];
    expect(() => assertCanvasImageReferenceTable("| IMAGE 1 | @image1 |", images)).toThrow("IMAGE 1 corresponds to picture 2");
    expect(() => assertCanvasImageReferenceTable("| IMAGE 2 | @image1 |\n| IMAGE 1 | @drawing1 |", images)).not.toThrow();
    expect(() => assertCanvasImageReferenceTable("| IMAGE 2 | @drawing1 |", images)).toThrow("IMAGE 2 corresponds to picture 1");
});
