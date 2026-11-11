import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function registerSlotTestExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "slot_test_ping",
    label: "Socket test probe",
    description:
      "Echo a test greeting message and optionally create a slot-test-node slot test node in the current canvas.",
    parameters: Type.Object({
      message: Type.String({ description: "test message to echo" }),
      createNode: Type.Optional(
        Type.Boolean({ description: "Whether to create a slot test node on the canvas by the way" }),
      ),
      expectedRevision: Type.Optional(
        Type.Number({ description: "Canvas expected version number (if not passed, it will be read automatically)" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let createdNodeInfo = "";
      if (params.createNode) {
        let revision = params.expectedRevision;
        if (!Number.isSafeInteger(revision)) {
          const read = await ctx.executeTool("canvas_get", {});
          const readText = read.result.content
            .map((part) => ("text" in part ? part.text : ""))
            .join("");
          if (read.isError) {
            throw new Error(`Failed to read canvas:${readText}`);
          }
          revision = Number(/"revision"\s*:\s*(\d+)/.exec(readText)?.[1]);
        }
        if (!Number.isSafeInteger(revision)) {
          throw new Error("Unable to determine current canvas revision");
        }
        const created = await ctx.executeTool("canvas_nodes_create", {
          expectedRevision: revision,
          nodes: [
            {
              type: "slot-test-node",
              title: "Socket test node",
              prompt: params.message,
            },
          ],
        });
        const createdText = created.result.content
          .map((part) => ("text" in part ? part.text : ""))
          .join("");
        if (created.isError) {
          throw new Error(`Failed to create slot test node:${createdText}`);
        }
        createdNodeInfo = ", and the slot-test-node node has been created in the canvas";
      }

      return {
        content: [
          {
            type: "text",
            text: `Slot test response:${params.message}${createdNodeInfo}`,
          },
        ],
        details: {
          echo: params.message,
          createdNode: Boolean(params.createNode),
        },
      };
    },
  });
}
