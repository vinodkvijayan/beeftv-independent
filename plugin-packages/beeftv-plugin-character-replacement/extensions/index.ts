import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  buildCharacterReplacementPackage,
  buildTimelineRangeReplacement,
  normalizeGenderHint,
  normalizePosition,
  normalizePromptMode,
  normalizeReplacementScope,
  uniqueNodeTitle,
} from "../client/compiler.js";

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

function parseCanvasSnapshot(readRes: {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  result?: {
    content?: Array<{ text?: string }>;
    structuredContent?: Record<string, unknown>;
  };
}): {
  revision: number | undefined;
  nodes: Array<Record<string, unknown>>;
  timeline: Record<string, unknown> | null;
} {
  const readText = extractText(readRes?.result || {});
  if (readRes?.isError) {
    throw new Error(`Failed to read canvas:${readText}`);
  }
  const structured =
    (readRes?.result?.structuredContent as Record<string, unknown> | undefined) ||
    (readRes?.structuredContent as Record<string, unknown> | undefined) ||
    parseJsonObject(readText) ||
    {};
  const canvasObj =
    structured.canvas && typeof structured.canvas === "object"
      ? (structured.canvas as Record<string, unknown>)
      : structured;

  const rawRev = canvasObj.revision ?? structured.revision;
  const revision = Number.isSafeInteger(Number(rawRev))
    ? Number(rawRev)
    : Number(/"revision"\s*:\s*(\d+)/.exec(readText)?.[1]);
  const nodes = Array.isArray(canvasObj.nodes)
    ? (canvasObj.nodes as Array<Record<string, unknown>>)
    : [];
  const timeline =
    canvasObj.timeline && typeof canvasObj.timeline === "object"
      ? (canvasObj.timeline as Record<string, unknown>)
      : null;

  return { revision, nodes, timeline };
}

export default function registerCharacterReplacementExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "character_replacement_arrange",
    label: "One-click orchestration of AI character replacement two-stage pipeline",
    description:
      "Create the \"AI character replacement\" configuration node, Step 2 keyframe character replacement image node, and Step 3 video element replacement (replace_element) node on the current canvas, automatically connect the original keyframes, target character reference map, optional positioning map, and original video, and optionally initiate generation of proposals directly.",
    parameters: Type.Object({
      shotTitle: Type.String({
        description: "Shot name, such as \"Shot 1\" or \"Close-up of drawing a sword on a rainy night\"",
      }),
      sourceDescription: Type.String({
        description: "A description of the characteristics of the replaced character in the original scene, such as \"a man in a black suit\" or \"a male swordsman in silver armor\"",
      }),
      targetDescription: Type.String({
        description: "The target replacement character's appearance and clothing description, such as \"a young boss wearing silver-rimmed glasses and a burgundy velvet suit\"",
      }),
      position: Type.Optional(
        Type.String({
          description: "The position of the target character in the screen: single (single) | left (left) | center (middle) | right (right)",
          default: "single",
        }),
      ),
      genderHint: Type.Optional(
        Type.String({
          description: "Character gender prompt: person (no limit) | male (male) | female (female)",
          default: "person",
        }),
      ),
      replacementScope: Type.Optional(
        Type.String({
          description:
            "Replacement range: full-person (full character) | visible-part (currently visible part) | face-hair (face and hair) | clothing (clothing only) | arm-hand (arm and hand)",
          default: "full-person",
        }),
      ),
      promptMode: Type.Optional(
        Type.String({
          description:
            "Prompt word mode: regular (regular position description) | positioning (SVG positioning box assistance) | manual (custom prompt word)",
          default: "regular",
        }),
      ),
      manualPrompt: Type.Optional(
        Type.String({
          description: "Custom keyframe substitution prompt words when promptMode is manual",
        }),
      ),
      sourceKeyframeNodeId: Type.Optional(
        Type.String({
          description: "The ID of the original video keyframe image node already on the canvas (will be automatically connected to the keyframe substitution node as Figure 1)",
        }),
      ),
      targetCharacterNodeId: Type.Optional(
        Type.String({
          description: "The reference graph node ID of the target character already on the canvas (will be automatically connected to the keyframe substitution node as graph 2)",
        }),
      ),
      locationGuideNodeId: Type.Optional(
        Type.String({
          description: "The ID of the character positioning block diagram node already on the canvas (in positioning mode, it will be connected to the keyframe substitution node as Figure 3)",
        }),
      ),
      sourceVideoNodeId: Type.Optional(
        Type.String({
          description: "The ID of the original shot video node already on the canvas (will be automatically connected to the Step 3 video character replacement node)",
        }),
      ),
      expectedRevision: Type.Optional(
        Type.Number({ description: "Current canvas version number (automatically read if not transmitted)" }),
      ),
      proposeGeneration: Type.Optional(
        Type.Boolean({
          description: "Whether to initiate keyframe substitution generation proposal (canvas_generation_propose) immediately after creation and connection",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const shotTitle = String(params.shotTitle || "Shot 1").trim() || "Shot 1";
      const position = normalizePosition(params.position || "single");
      const genderHint = normalizeGenderHint(params.genderHint || "person");
      const replacementScope = normalizeReplacementScope(params.replacementScope || "full-person");
      const promptMode = normalizePromptMode(params.promptMode || "regular");
      const manualPrompt = String(params.manualPrompt || "").trim();
      const sourceDescription = String(params.sourceDescription || "").trim();
      const targetDescription = String(params.targetDescription || "").trim();

      const srcKeyframeId = String(params.sourceKeyframeNodeId || "").trim();
      const targetCharId = String(params.targetCharacterNodeId || "").trim();
      const locationGuideId = String(params.locationGuideNodeId || "").trim();
      const srcVideoId = String(params.sourceVideoNodeId || "").trim();

      const missingReferences: string[] = [];
      if (!srcKeyframeId) missingReferences.push("sourceKeyframeNodeId");
      if (!targetCharId) missingReferences.push("targetCharacterNodeId");
      if (!srcVideoId) missingReferences.push("sourceVideoNodeId");

      if (params.proposeGeneration && (!srcKeyframeId || !targetCharId)) {
        throw new Error(
          "SourceKeyframeNodeId and targetCharacterNodeId must be provided when initiating a keyframe substitution generation proposal (proposeGeneration=true)",
        );
      }

      const read = await ctx.executeTool("canvas_get", {});
      const snap = parseCanvasSnapshot(read);
      const revision =
        Number.isSafeInteger(params.expectedRevision) && (params.expectedRevision as number) >= 0
          ? (params.expectedRevision as number)
          : snap.revision;
      if (!Number.isSafeInteger(revision)) {
        throw new Error("Unable to determine current canvas revision");
      }

      const existingTitles = new Set(
        snap.nodes
          .map((item) => String(item?.title || "").trim())
          .filter(Boolean),
      );

      const compiled = buildCharacterReplacementPackage({
        position,
        genderHint,
        sourceDescription,
        targetDescription,
        replacementScope,
        promptMode,
        manualPrompt,
        hasLocationGuideImage: Boolean(locationGuideId),
      });

      const controlTitle = uniqueNodeTitle(`${shotTitle} · Role replacement configuration`, existingTitles);
      const keyframeTitle = uniqueNodeTitle(`${shotTitle} · Keyframe substitution`, existingTitles);
      const videoTitle = uniqueNodeTitle(`${shotTitle} ·Video character replacement`, existingTitles);

      const nodesToCreate = [
        {
          type: "character-replacement",
          title: controlTitle,
          prompt: `Lens:${shotTitle}Original character:${sourceDescription || position}Target role:${targetDescription}Scope:${replacementScope}`,
          pluginData: {
            shotTitle,
            position,
            genderHint,
            sourceDescription,
            targetDescription,
            replacementScope,
            promptMode,
            manualPrompt,
            sourceKeyframeNodeId: srcKeyframeId,
            targetCharacterNodeId: targetCharId,
            locationGuideNodeId: locationGuideId,
            sourceVideoNodeId: srcVideoId,
          },
        },
        {
          type: "image",
          title: keyframeTitle,
          prompt: compiled.prompt,
        },
        {
          type: "video",
          title: videoTitle,
          prompt: compiled.videoPrompt,
        },
      ];

      const createdRes = await ctx.executeTool("canvas_nodes_create", {
        expectedRevision: revision,
        nodes: nodesToCreate,
      });
      const createdText = extractText(createdRes.result);
      if (createdRes.isError) {
        throw new Error(`Failed to create role replacement node:${createdText}`);
      }

      const parsedCreated =
        (createdRes.result.structuredContent as Record<string, unknown> | undefined) ||
        parseJsonObject(createdText) ||
        {};
      const createdList = Array.isArray(parsedCreated.created)
        ? (parsedCreated.created as Array<{ id?: string; type?: string }>)
        : [];
      let currentRevision = Number(parsedCreated.revision ?? (revision as number) + 1);

      const controlNodeId = createdList[0]?.id || "";
      const keyframeNodeId = createdList[1]?.id || "";
      const videoNodeId = createdList[2]?.id || "";

      if (videoNodeId) {
        const configureRes = await ctx.executeTool("canvas_node_configure", {
          nodeId: videoNodeId,
          kind: "video",
          expectedRevision: currentRevision,
          patch: {
            videoEditOperation: "replace_element",
          },
        });
        if (!configureRes.isError) {
          const cfgText = extractText(configureRes.result);
          const parsedCfg =
            (configureRes.result.structuredContent as Record<string, unknown> | undefined) ||
            parseJsonObject(cfgText);
          if (Number.isSafeInteger(Number(parsedCfg?.revision))) {
            currentRevision = Number(parsedCfg?.revision);
          }
        }
      }

      const edges: Array<[string, string]> = [];

      if (srcKeyframeId && keyframeNodeId) {
        edges.push([srcKeyframeId, keyframeNodeId]);
      }
      if (targetCharId && keyframeNodeId && targetCharId !== srcKeyframeId) {
        edges.push([targetCharId, keyframeNodeId]);
      }
      if (
        locationGuideId &&
        keyframeNodeId &&
        locationGuideId !== srcKeyframeId &&
        locationGuideId !== targetCharId
      ) {
        edges.push([locationGuideId, keyframeNodeId]);
      }
      if (controlNodeId && keyframeNodeId) {
        edges.push([controlNodeId, keyframeNodeId]);
      }
      if (srcVideoId && videoNodeId) {
        edges.push([srcVideoId, videoNodeId]);
      }
      if (keyframeNodeId && videoNodeId) {
        edges.push([keyframeNodeId, videoNodeId]);
      }

      for (const [fromNodeId, toNodeId] of edges) {
        if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue;
        const edgeRes = await ctx.executeTool("canvas_edge_create", {
          fromNodeId,
          toNodeId,
          expectedRevision: currentRevision,
        });
        if (!edgeRes.isError) {
          const edgeText = extractText(edgeRes.result);
          const parsedEdge =
            (edgeRes.result.structuredContent as Record<string, unknown> | undefined) ||
            parseJsonObject(edgeText);
          if (Number.isSafeInteger(Number(parsedEdge?.revision))) {
            currentRevision = Number(parsedEdge?.revision);
          }
        }
      }

      let proposalId: string | undefined;
      if (params.proposeGeneration && keyframeNodeId) {
        const proposeRes = await ctx.executeTool("canvas_generation_propose", {
          nodeIds: [keyframeNodeId],
          kind: "image",
          ...(srcVideoId && videoNodeId
            ? { productionNodeIds: [keyframeNodeId, videoNodeId] }
            : {}),
          note: `AI role replacement (${shotTitle}): First generate substitution key frames, and then perform video element substitution`,
        });
        const proposeText = extractText(proposeRes.result);
        if (proposeRes.isError) {
          throw new Error(`Failed to initiate role replacement generation proposal:${proposeText}`);
        }
        const parsedPropose =
          (proposeRes.result.structuredContent as Record<string, unknown> | undefined) ||
          parseJsonObject(proposeText);
        proposalId =
          typeof parsedPropose?.proposalId === "string"
            ? parsedPropose.proposalId
            : undefined;
      }

      const missingNote =
        missingReferences.length > 0
          ? `(Tip: Not yet bound${missingReferences.join("、")}, please connect the corresponding reference node before generating)`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `has been "${shotTitle}》Arrange AI character replacement two-stage pipeline: key frame substitution node (${keyframeNodeId}) → video element replacement node (${videoNodeId}，videoEditOperation=replace_element）${proposalId ? `, and has registered to generate proposals (${proposalId}）` : ""}${missingNote}。`,
          },
        ],
        details: {
          shotTitle,
          position,
          replacementScope,
          controlNodeId,
          keyframeNodeId,
          videoNodeId,
          keyframePrompt: compiled.prompt,
          videoPrompt: compiled.videoPrompt,
          missingReferences,
          revision: currentRevision,
          proposalId,
        },
      };
    },
  });

  pi.registerTool({
    name: "character_replacement_splice_timeline",
    label: "Insert the scene video after character replacement into the full film timeline without loss",
    description:
      "Based on the original full-film video node, the total duration of the full film, and one or more replaced shot video intervals (startMs~endMs), a lossless Timeline v2 of \"original film front → replacement shot → original film back\" is constructed and written to the canvas timeline (retaining the existing subtitles/BGM track on the canvas).",
    parameters: Type.Object({
      fullVideoNodeId: Type.String({
        description: "Original full video node ID",
      }),
      fullDurationMs: Type.Optional(
        Type.Number({
          description: "The total duration of the original full video (milliseconds, such as 15000; the durationMs of the original full video node is automatically read when not transmitted)",
          minimum: 100,
        }),
      ),
      replacements: Type.Array(
        Type.Object({
          nodeId: Type.String({ description: "Lens video node ID after replacement" }),
          startMs: Type.Number({ description: "The starting millisecond in the original full movie (e.g. 3000)", minimum: 0 }),
          endMs: Type.Number({ description: "Ending milliseconds in the original full movie (e.g. 8000)", minimum: 100 }),
        }),
        { minItems: 1, description: "List of replacement lens intervals that need to be inserted back" },
      ),
      keepOriginalAudio: Type.Optional(
        Type.Boolean({
          description: "Whether to retain the complete and continuous audio track of the original film (default true, mute the video clip track and superimpose the complete audio track of the original film)",
          default: true,
        }),
      ),
      expectedRevision: Type.Optional(
        Type.Number({ description: "Current canvas version number (automatically read if not transmitted)" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const read = await ctx.executeTool("canvas_get", {});
      const snap = parseCanvasSnapshot(read);
      const revision =
        Number.isSafeInteger(params.expectedRevision) && (params.expectedRevision as number) >= 0
          ? (params.expectedRevision as number)
          : snap.revision;
      if (!Number.isSafeInteger(revision)) {
        throw new Error("Unable to determine current canvas revision");
      }

      const nodeDurationMap = new Map<string, number>();
      for (const node of snap.nodes) {
        const id = String(node?.id || "").trim();
        const metadata =
          node?.metadata && typeof node.metadata === "object"
            ? (node.metadata as Record<string, unknown>)
            : {};
        const dur = Number(metadata.durationMs);
        if (id && Number.isFinite(dur) && dur > 0) {
          nodeDurationMap.set(id, Math.round(dur));
        }
      }

      const fullVideoNodeId = String(params.fullVideoNodeId || "").trim();
      const detectedFullDurationMs = nodeDurationMap.get(fullVideoNodeId);
      const callerFullDurationMs = Number(params.fullDurationMs);
      let resolvedFullDurationMs = callerFullDurationMs;
      if (Number.isFinite(detectedFullDurationMs) && (detectedFullDurationMs as number) > 0) {
        if (!Number.isFinite(callerFullDurationMs) || callerFullDurationMs <= 0) {
          resolvedFullDurationMs = detectedFullDurationMs as number;
        } else if (Math.abs(callerFullDurationMs - (detectedFullDurationMs as number)) > 250) {
          throw new Error(
            `The total duration of the entire movie passed in (${callerFullDurationMs}ms) and the actual duration of the original full-slice node (${detectedFullDurationMs}ms) inconsistent`,
          );
        }
      }

      const enrichedReplacements = params.replacements.map((item) => ({
        ...item,
        sourceDurationMs: nodeDurationMap.get(String(item.nodeId || "").trim()),
      }));

      const timeline = buildTimelineRangeReplacement({
        fullVideoNodeId,
        fullDurationMs: resolvedFullDurationMs,
        replacements: enrichedReplacements,
        keepOriginalAudio: params.keepOriginalAudio !== false,
        existingTimeline: snap.timeline,
      });

      const updateRes = await ctx.executeTool("canvas_timeline_update", {
        expectedRevision: revision,
        timeline,
      });
      const updateText = extractText(updateRes.result);
      if (updateRes.isError) {
        throw new Error(`Failed to update full movie timeline:${updateText}`);
      }

      const parsedUpdate =
        (updateRes.result.structuredContent as Record<string, unknown> | undefined) ||
        parseJsonObject(updateText);
      const nextRevision = Number(parsedUpdate?.revision ?? (revision as number) + 1);

      return {
        content: [
          {
            type: "text",
            text: `Already${params.replacements.length} Replacement shots are losslessly inserted back into the full film timeline (a total of${timeline.clips.length} fragments, canvas version r${nextRevision}）。`,
          },
        ],
        details: {
          fullVideoNodeId,
          fullDurationMs: resolvedFullDurationMs,
          clipCount: timeline.clips.length,
          revision: nextRevision,
          timeline,
        },
      };
    },
  });
}
