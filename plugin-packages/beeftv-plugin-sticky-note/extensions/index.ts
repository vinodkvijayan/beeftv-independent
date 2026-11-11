import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

async function resolveCanvasRevision(
  ctx: {
    executeTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      isError: boolean;
      result: { content: Array<{ text?: string }> };
    }>;
  },
  expectedRevision?: number,
): Promise<number> {
  if (Number.isSafeInteger(expectedRevision) && (expectedRevision as number) >= 0) {
    return expectedRevision as number;
  }
  const read = await ctx.executeTool("canvas_get", {});
  const readText = read.result.content
    .map((part) => ("text" in part && part.text ? part.text : ""))
    .join("");
  if (read.isError) {
    throw new Error(`Failed to read canvas:${readText}`);
  }
  const revision = Number(/"revision"\s*:\s*(\d+)/.exec(readText)?.[1]);
  if (!Number.isSafeInteger(revision)) {
    throw new Error("Didn't get the canvas version number");
  }
  return revision;
}

export default function registerStickyNoteExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "sticky_note_create",
    label: "Create new note",
    description:
      "Create a sticky-note card (sticky-note node) on the current canvas. Use it when users ask to record to-dos, post notes, or organize key points.",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "Note title (4 to 12 words summarizing key points)" })),
      text: Type.Optional(Type.String({ description: "Note text content" })),
      content: Type.Optional(Type.String({ description: "The text content of the note (equivalent to text)" })),
      color: Type.Optional(Type.String({ description: "Note color: amber | mint | sky | rose" })),
      expectedRevision: Type.Optional(
        Type.Number({ description: "Canvas expected version number (automatically read if not passed)" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const revision = await resolveCanvasRevision(ctx, params.expectedRevision);
      const bodyText = String(params.text || params.content || params.title || "Create new note").trim();
      const titleText = String(params.title || bodyText.slice(0, 12) || "Notes").trim();
      const color = String(params.color || "amber").trim() || "amber";
      const created = await ctx.executeTool("canvas_nodes_create", {
        expectedRevision: revision,
        nodes: [
          {
            type: "sticky-note",
            title: titleText,
            prompt: `📌 ${bodyText}`,
            pluginData: {
              content: bodyText,
              color,
            },
          },
        ],
      });
      const createdText = (created?.result?.content || created?.content || [])
        .map((part) => ("text" in part && part.text ? part.text : ""))
        .join("");
      if (created.isError) {
        throw new Error(`Failed to create note:${createdText}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `Note "Created"${titleText}」`,
          },
        ],
        details: {
          title: titleText,
          content: bodyText,
          color,
          revision,
        },
      };
    },
  });

  pi.registerTool({
    name: "sticky_note_update",
    label: "Modify note",
    description: "Update the title or body content of an existing sticky note on the canvas by node ID.",
    parameters: Type.Object({
      nodeId: Type.String({ description: "The ID of the sticky note node to be modified" }),
      title: Type.Optional(Type.String({ description: "New note title" })),
      text: Type.Optional(Type.String({ description: "New note text content" })),
      expectedRevision: Type.Optional(
        Type.Number({ description: "Canvas expected version number (automatically read if not passed)" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const revision = await resolveCanvasRevision(ctx, params.expectedRevision);
      const patch: Record<string, string> = {};
      if (typeof params.title === "string" && params.title.trim()) {
        patch.title = params.title.trim();
      }
      if (typeof params.text === "string") {
        patch.content = `📌 ${params.text}`;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("At least one of title or text needs to be passed in");
      }
      const updated = await ctx.executeTool("canvas_node_update", {
        nodeId: params.nodeId,
        expectedRevision: revision,
        patch,
      });
      const updatedText = updated.result.content
        .map((part) => ("text" in part && part.text ? part.text : ""))
        .join("");
      if (updated.isError) {
        throw new Error(`Failed to update note:${updatedText}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `Note node updated${params.nodeId}`,
          },
        ],
        details: {
          nodeId: params.nodeId,
          revision,
        },
      };
    },
  });
}
