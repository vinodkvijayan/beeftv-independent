import { expect, test } from "bun:test";

test("Shot Editor provides delete action with confirmation to the left of the save button", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    const deleteButton = source.indexOf(">Delete lens</Button>");
    const saveButton = source.indexOf(">Save script</Button>");

    expect(source).toContain("deleteProjectShot(projectId, shotId)");
    expect(source).toContain("Script versions, asset references, and build artifacts will all be deleted");
    expect(source).toContain("okButtonProps: { danger: true }");
    expect(deleteButton).toBeGreaterThan(-1);
    expect(saveButton).toBeGreaterThan(deleteButton);
});

test("Shot deletion API uses project and shot dual path scopes", async () => {
    const source = await Bun.file(new URL("../src/services/api/projects.ts", import.meta.url)).text();

    expect(source).toContain("http.delete<{ deleted: boolean }>(`/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}`)");
});
