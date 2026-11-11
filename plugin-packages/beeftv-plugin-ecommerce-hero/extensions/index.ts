import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SCENE_TEMPLATES = [
  {
    suffix: "Minimalist studio photo shoot",
    buildPrompt: (title: string, points: string) =>
      `The main image of the minimalist studio shoot for e-commerce with high conversion, the subject is "${title}”, highlighting the selling points:${points}. Commercial-grade softbox lighting, three-dimensional shadows, clear and centered subject, sharp details, and high-end pure background.`,
  },
  {
    suffix: "Real life scene pictures",
    buildPrompt: (title: string, points: string) =>
      `The main picture of the real life scene of e-commerce, the subject is "${title}", core selling points:${points}. Natural and soft sunlight fits the real usage situation, and the picture is full of quality of life and sense of substitution.`,
  },
  {
    suffix: "Detailed close-up selling point picture",
    buildPrompt: (title: string, points: string) =>
      `Close-up of e-commerce macro materials and details, showing "${title}"The core craftsmanship and selling points:${points}. Shallow depth of field, high-quality texture, clearly showing material details and quality luster.`,
  },
  {
    suffix: "Atmosphere poster main image",
    buildPrompt: (title: string, points: string) =>
      `The main image of the e-commerce visual atmosphere poster revolves around "${title}"And core selling points"${points}"The composition is rich in light and shadow levels, the brand's visual tension is strong, and it leaves room for comfortable visual breathing.`,
  },
];

function extractText(result: { content?: Array<{ text?: string }> }): string {
  return (result?.content || [])
    .map((part) => ("text" in part && part.text ? part.text : ""))
    .join("");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function registerEcommerceHeroExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ecommerce_hero_arrange",
    label: "Arrange product main images with one click",
    description:
      "Create a \"One-click product main image\" node and a specified number (1~4) of e-commerce scene main image nodes on the current canvas, automatically establish a connection, and you can choose to directly initiate an image generation proposal.",
    parameters: Type.Object({
      productTitle: Type.String({ description: "Product name, such as \"Wireless Noise Canceling Headphones\"" }),
      sellingPoints: Type.String({
        description: "Description of core selling points, such as \"48dB deep noise reduction, metal matte cavity, 40 hours of battery life\"",
      }),
      sceneStyle: Type.Optional(
        Type.String({
          description: "Scene style: studio (studio shooting texture) | lifestyle (life scene) | festival (festival promotion)",
        }),
      ),
      sceneCount: Type.Optional(
        Type.Number({
          description: "Number of scene graphs to be generated (1 to 4, default 2)",
          minimum: 1,
          maximum: 4,
          default: 2,
        }),
      ),
      expectedRevision: Type.Optional(
        Type.Number({ description: "Current canvas version number (automatically read if not transmitted)" }),
      ),
      proposeGeneration: Type.Optional(
        Type.Boolean({
          description: "Whether to initiate image generation proposal (canvas_generation_propose) immediately after creation and connection",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const count = Math.max(1, Math.min(4, Math.trunc(params.sceneCount ?? 2)));
      const sceneStyle = String(params.sceneStyle || "studio").trim() || "studio";
      let revision = params.expectedRevision;
      if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
        const read = await ctx.executeTool("canvas_get", {});
        const readText = extractText(read.result);
        if (read.isError) {
          throw new Error(`Failed to read canvas:${readText}`);
        }
        revision = Number(/"revision"\s*:\s*(\d+)/.exec(readText)?.[1]);
      }
      if (!Number.isSafeInteger(revision)) {
        throw new Error("Unable to determine current canvas revision");
      }

      const selectedScenes = SCENE_TEMPLATES.slice(0, count);
      const nodesToCreate = [
        {
          type: "ecommerce-hero",
          title: `${params.productTitle} · Product main image configuration`,
          prompt: `Product:${params.productTitle}Selling Points:${params.sellingPoints}Number of scenes:${count} Zhang`,
          pluginData: {
            productTitle: params.productTitle,
            sellingPoints: params.sellingPoints,
            sceneStyle,
            sceneCount: count,
          },
        },
        ...selectedScenes.map((scene, index) => ({
          type: "image",
          title: `${params.productTitle} · Main picture${index + 1}（${scene.suffix}）`,
          prompt: scene.buildPrompt(params.productTitle, params.sellingPoints),
        })),
      ];

      const createdRes = await ctx.executeTool("canvas_nodes_create", {
        expectedRevision: revision,
        nodes: nodesToCreate,
      });
      const createdText = extractText(createdRes.result);
      if (createdRes.isError) {
        throw new Error(`Failed to create product main image node:${createdText}`);
      }

      const parsedCreated =
        (createdRes.result.structuredContent as Record<string, unknown> | undefined) ||
        parseJsonObject(createdText) ||
        {};
      const createdList = Array.isArray(parsedCreated.created)
        ? (parsedCreated.created as Array<{ id?: string; type?: string }>)
        : [];
      let currentRevision = Number(parsedCreated.revision ?? (revision as number) + 1);

      const heroNodeId = createdList[0]?.id || "";
      const createdImageNodeIds = createdList
        .slice(1)
        .map((item) => item?.id || "")
        .filter(Boolean);

      if (heroNodeId && createdImageNodeIds.length > 0) {
        for (const imageNodeId of createdImageNodeIds) {
          const edgeRes = await ctx.executeTool("canvas_edge_create", {
            fromNodeId: heroNodeId,
            toNodeId: imageNodeId,
            expectedRevision: currentRevision,
          });
          if (!edgeRes.isError) {
            const edgeText = extractText(edgeRes.result);
            const parsedEdge =
              (edgeRes.result.structuredContent as Record<string, unknown> | undefined) ||
              parseJsonObject(edgeText);
            if (Number.isSafeInteger( Number(parsedEdge?.revision))) {
              currentRevision = Number(parsedEdge?.revision);
            }
          }
        }
      }

      let proposalId: string | undefined;
      if (params.proposeGeneration && createdImageNodeIds.length > 0) {
        const proposeRes = await ctx.executeTool("canvas_generation_propose", {
          nodeIds: createdImageNodeIds,
          kind: "image",
          note: "One-click product main image generation proposal",
        });
        const proposeText = extractText(proposeRes.result);
        if (proposeRes.isError) {
          throw new Error(`Failed to initiate product main image generation proposal:${proposeText}`);
        }
        const parsedPropose =
          (proposeRes.result.structuredContent as Record<string, unknown> | undefined) ||
          parseJsonObject(proposeText);
        proposalId =
          typeof parsedPropose?.proposalId === "string"
            ? parsedPropose.proposalId
            : undefined;
      }

      return {
        content: [
          {
            type: "text",
            text: `has been "${params.productTitle}"Organize 1 product main image node and${createdImageNodeIds.length} Scene main picture node${proposalId ? `, and has registered to generate proposals (${proposalId}）` : ""}。`,
          },
        ],
        details: {
          productTitle: params.productTitle,
          sellingPoints: params.sellingPoints,
          sceneCount: count,
          heroNodeId,
          createdImageNodeIds,
          revision: currentRevision,
          proposalId,
        },
      };
    },
  });
}
