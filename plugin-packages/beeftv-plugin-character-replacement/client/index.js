// AI 角色替换工作室客户端入口：
// 1. 挂载 character-replacement 画布节点（支持配置原人物位置/特征、目标角色、5 档替换范围、定位模式与上下游节点 ID，实时持久化至 pluginData，一键编排「关键帧换人 -> 视频元素替换」双阶段节点管线）
// 2. 挂载替换工作室独立页（/p/beeftv-plugin-character-replacement）与画布侧栏（支持目标画布绑定、多镜头配置、定位框 SVG 预览、一键推送画布与全片时间线区间无损回插）
// 3. 挂载助手工具卡片（character_replacement_arrange 与 character_replacement_splice_timeline）

import {
  GENDER_HINTS,
  PERSON_POSITIONS,
  PROMPT_MODES,
  REPLACEMENT_SCOPES,
  buildCharacterReplacementPackage,
  buildLocationGuideSvgDataUrl,
  buildTimelineRangeReplacement,
  compileCharacterReplacementPrompt,
  compileVideoReplacementPrompt,
  normalizeGenderHint,
  normalizePosition,
  normalizePromptMode,
  normalizeReplacementScope,
  uniqueNodeTitle,
} from "./compiler.js";

export {
  GENDER_HINTS,
  PERSON_POSITIONS,
  PROMPT_MODES,
  REPLACEMENT_SCOPES,
  buildCharacterReplacementPackage,
  buildLocationGuideSvgDataUrl,
  buildTimelineRangeReplacement,
  compileCharacterReplacementPrompt,
  compileVideoReplacementPrompt,
  normalizeGenderHint,
  normalizePosition,
  normalizePromptMode,
  normalizeReplacementScope,
  uniqueNodeTitle,
};

let lastKnownCanvasId = "";

function rememberCanvasId(host, canvasId) {
  const clean = String(canvasId || "").trim();
  if (!clean || clean === "[object Promise]") return;
  lastKnownCanvasId = clean;
  host?.storage?.set?.("lastCanvasId", clean);
}

function resolveActiveCanvasId(host, explicitCanvasId) {
  const explicit = String(explicitCanvasId || "").trim();
  if (explicit && explicit !== "[object Promise]") return explicit;
  const fromContext = String(host?.context?.getCanvasId?.() || "").trim();
  if (fromContext && fromContext !== "[object Promise]") {
    rememberCanvasId(host, fromContext);
    return fromContext;
  }
  if (typeof host?.storage?.get === "function") {
    const rawStorage = host.storage.get("lastCanvasId");
    if (typeof rawStorage === "string") {
      const clean = rawStorage.trim();
      if (clean && clean !== "[object Promise]") {
        lastKnownCanvasId = clean;
        return clean;
      }
    }
    return "";
  }
  return lastKnownCanvasId;
}

async function resolveActiveCanvasIdAsync(host, explicitCanvasId) {
  const syncId = resolveActiveCanvasId(host, explicitCanvasId);
  if (syncId) return syncId;
  try {
    const stored = await host?.storage?.get?.("lastCanvasId");
    if (typeof stored === "string") {
      const clean = stored.trim();
      if (clean && clean !== "[object Promise]") {
        lastKnownCanvasId = clean;
        return clean;
      }
    }
  } catch {
    // ignore storage read error
  }
  return "";
}

async function createInitialCanvasDocument(host, canvasId, title) {
  const now = new Date().toISOString();
  const doc = {
    id: canvasId,
    title,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "grid",
    showImageInfo: true,
    viewport: { x: 120, y: 120, zoom: 1 },
    directorScenes: [],
  };
  return host.ops.call("canvas.document.commit", {
    canvasId,
    expectedRevision: 0,
    document: doc,
  });
}

export async function arrangeCharacterReplacementOnCanvas(host, config = {}) {
  let sourceKeyframeNodeId = String(config.sourceKeyframeNodeId || "").trim();
  let targetCharacterNodeId = String(config.targetCharacterNodeId || "").trim();
  let locationGuideNodeId = String(config.locationGuideNodeId || "").trim();
  let sourceVideoNodeId = String(config.sourceVideoNodeId || "").trim();
  const controlNodeId = String(config.controlNodeId || "").trim();

  const missingReferences = [];
  if (!sourceKeyframeNodeId) missingReferences.push("sourceKeyframeNodeId (original keyframe graph node)");
  if (!targetCharacterNodeId) missingReferences.push("targetCharacterNodeId (target character reference graph node)");
  if (!sourceVideoNodeId) missingReferences.push("sourceVideoNodeId (original lens video node)");
  if (config.requireReferences && missingReferences.length > 0) {
    throw new Error(`Required upstream reference node is missing:${missingReferences.join("、")}`);
  }

  const shotTitle = String(config.shotTitle || "Shot 1").trim() || "Shot 1";
  let canvasId = await resolveActiveCanvasIdAsync(host, config.canvasId);
  if (!canvasId && config.autoCreateCanvas) {
    canvasId = `canvas-char-${Date.now().toString(36)}`;
    await createInitialCanvasDocument(host, canvasId, `${shotTitle} · AI character replacement canvas`);
  }
  if (!canvasId) {
    throw new Error("Please open a canvas first or fill in the target canvas ID in the replacement studio before performing role replacement arrangement.");
  }
  rememberCanvasId(host, canvasId);

  let snap;
  try {
    snap = await host.ops.call("canvas.get", { canvasId });
  } catch (err) {
    if (config.autoCreateCanvas) {
      await createInitialCanvasDocument(host, canvasId, `${shotTitle} · AI character replacement canvas`);
      snap = await host.ops.call("canvas.get", { canvasId });
    } else {
      throw err;
    }
  }
  let revision = Number(snap?.revision ?? snap?.canvas?.revision ?? 1);
  const existingNodes = Array.isArray(snap?.nodes)
    ? snap.nodes
    : Array.isArray(snap?.canvas?.nodes)
      ? snap.canvas.nodes
      : [];
  const existingTitles = new Set(
    existingNodes
      .map((item) => String(item?.title || "").trim())
      .filter(Boolean),
  );

  if (config.autoCreateInputNodes) {
    const inputDrafts = [];
    const inputSlotOrder = [];
    if (!sourceKeyframeNodeId) {
      inputSlotOrder.push("sourceKeyframe");
      inputDrafts.push({
        title: uniqueNodeTitle(`${shotTitle} · Original video key frames (Figure 1)`, existingTitles),
        type: "image",
        prompt: `The original video was replaced with character key frames:${String(config.sourceDescription || "Characters in the original shot").trim()}`,
      });
    }
    if (!targetCharacterNodeId) {
      inputSlotOrder.push("targetCharacter");
      inputDrafts.push({
        title: uniqueNodeTitle(`${shotTitle} ·Target character reference picture (Figure 2)`, existingTitles),
        type: "image",
        prompt: `Clear reference picture of the front of the target replacement character:${String(config.targetDescription || "target role").trim()}`,
      });
    }
    if (config.promptMode === "positioning" && !locationGuideNodeId) {
      inputSlotOrder.push("locationGuide");
      inputDrafts.push({
        title: uniqueNodeTitle(`${shotTitle} · Character frame selection bitmap (Figure 3)`, existingTitles),
        type: "image",
        prompt: "Auxiliary diagram of red frame positioning of characters in multi-player scenes (frame A marks the area of the character to be replaced)",
      });
    }
    if (!sourceVideoNodeId) {
      inputSlotOrder.push("sourceVideo");
      inputDrafts.push({
        title: uniqueNodeTitle(`${shotTitle} · Original footage video (Video 1)`, existingTitles),
        type: "video",
        prompt: `Original footage to be replaced:${String(config.sourceDescription || "Character movements and movements in original shots").trim()}`,
      });
    }
    if (inputDrafts.length > 0) {
      const createdInputs = await host.ops.call("canvas.nodes.create", {
        canvasId,
        expectedRevision: revision,
        nodes: inputDrafts,
      });
      revision = Number(createdInputs?.revision ?? revision + 1);
      const createdInputList = Array.isArray(createdInputs?.created) ? createdInputs.created : [];
      inputSlotOrder.forEach((slot, idx) => {
        const createdId = createdInputList[idx]?.id || "";
        if (!createdId) return;
        if (slot === "sourceKeyframe") sourceKeyframeNodeId = createdId;
        if (slot === "targetCharacter") targetCharacterNodeId = createdId;
        if (slot === "locationGuide") locationGuideNodeId = createdId;
        if (slot === "sourceVideo") sourceVideoNodeId = createdId;
      });
      missingReferences.length = 0;
      if (!sourceKeyframeNodeId) missingReferences.push("sourceKeyframeNodeId (original keyframe graph node)");
      if (!targetCharacterNodeId) missingReferences.push("targetCharacterNodeId (target character reference graph node)");
      if (!sourceVideoNodeId) missingReferences.push("sourceVideoNodeId (original lens video node)");
    }
  }

  const hasLocationGuideImage =
    config.hasLocationGuideImage !== undefined
      ? Boolean(config.hasLocationGuideImage)
      : Boolean(locationGuideNodeId);
  const compiled = buildCharacterReplacementPackage({
    ...config,
    hasLocationGuideImage,
  });
  const keyframeTitle = uniqueNodeTitle(`${shotTitle} · Keyframe substitution`, existingTitles);
  const videoTitle = uniqueNodeTitle(`${shotTitle} ·Video character replacement`, existingTitles);

  const created = await host.ops.call("canvas.nodes.create", {
    canvasId,
    expectedRevision: revision,
    nodes: [
      {
        title: keyframeTitle,
        type: "image",
        prompt: compiled.prompt,
      },
      {
        title: videoTitle,
        type: "video",
        prompt: compiled.videoPrompt,
      },
    ],
  });
  revision = Number(created?.revision ?? revision + 1);
  const createdList = Array.isArray(created?.created) ? created.created : [];
  const keyframeNodeId = createdList[0]?.id || "";
  const videoNodeId = createdList[1]?.id || "";

  if (videoNodeId) {
    const configured = await host.ops.call("canvas.node.configure", {
      canvasId,
      nodeId: videoNodeId,
      kind: "video",
      expectedRevision: revision,
      patch: {
        videoEditOperation: "replace_element",
      },
    });
    revision = Number(configured?.revision ?? revision + 1);
  }

  const edgesToCreate = [];

  if (sourceKeyframeNodeId && keyframeNodeId) {
    edgesToCreate.push([sourceKeyframeNodeId, keyframeNodeId]);
  }
  if (targetCharacterNodeId && keyframeNodeId && targetCharacterNodeId !== sourceKeyframeNodeId) {
    edgesToCreate.push([targetCharacterNodeId, keyframeNodeId]);
  }
  if (
    locationGuideNodeId &&
    keyframeNodeId &&
    locationGuideNodeId !== sourceKeyframeNodeId &&
    locationGuideNodeId !== targetCharacterNodeId
  ) {
    edgesToCreate.push([locationGuideNodeId, keyframeNodeId]);
  }
  if (
    controlNodeId &&
    keyframeNodeId &&
    controlNodeId !== sourceKeyframeNodeId &&
    controlNodeId !== targetCharacterNodeId &&
    controlNodeId !== locationGuideNodeId
  ) {
    edgesToCreate.push([controlNodeId, keyframeNodeId]);
  }
  if (sourceVideoNodeId && videoNodeId) {
    edgesToCreate.push([sourceVideoNodeId, videoNodeId]);
  }
  if (keyframeNodeId && videoNodeId) {
    edgesToCreate.push([keyframeNodeId, videoNodeId]);
  }

  for (const [fromNodeId, toNodeId] of edgesToCreate) {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue;
    const edgeRes = await host.ops.call("canvas.edge.create", {
      canvasId,
      fromNodeId,
      toNodeId,
      expectedRevision: revision,
    });
    revision = Number(edgeRes?.revision ?? revision);
  }

  return {
    canvasId,
    revision,
    keyframeNodeId,
    videoNodeId,
    sourceKeyframeNodeId,
    targetCharacterNodeId,
    locationGuideNodeId,
    sourceVideoNodeId,
    keyframePrompt: compiled.prompt,
    videoPrompt: compiled.videoPrompt,
    locationGuide: compiled.locationGuide,
    missingReferences,
  };
}

export async function spliceReplacedShotsIntoTimeline(host, params = {}) {
  const canvasId = await resolveActiveCanvasIdAsync(host, params.canvasId);
  if (!canvasId) {
    throw new Error("Please open the target canvas first or fill in the target canvas ID in the replacement studio before performing full timeline reinsertion.");
  }
  rememberCanvasId(host, canvasId);

  const snap = await host.ops.call("canvas.get", { canvasId });
  const revision = Number(snap?.revision ?? snap?.canvas?.revision ?? 1);
  const existingNodes = Array.isArray(snap?.nodes)
    ? snap.nodes
    : Array.isArray(snap?.canvas?.nodes)
      ? snap.canvas.nodes
      : [];
  const existingTimeline = snap?.canvas?.timeline ?? snap?.timeline ?? null;

  const nodeDurationMap = new Map();
  for (const node of existingNodes) {
    const id = String(node?.id || "").trim();
    const dur = Number(node?.metadata?.durationMs);
    if (id && Number.isFinite(dur) && dur > 0) {
      nodeDurationMap.set(id, Math.round(dur));
    }
  }

  const fullVideoNodeId = String(params.fullVideoNodeId || "").trim();
  const detectedFullDurationMs = nodeDurationMap.get(fullVideoNodeId);
  const callerFullDurationMs = Number(params.fullDurationMs);
  let resolvedFullDurationMs = callerFullDurationMs;
  if (Number.isFinite(detectedFullDurationMs) && detectedFullDurationMs > 0) {
    if (!Number.isFinite(callerFullDurationMs) || callerFullDurationMs <= 0) {
      resolvedFullDurationMs = detectedFullDurationMs;
    } else if (Math.abs(callerFullDurationMs - detectedFullDurationMs) > 250) {
      throw new Error(
        `Fill in the total duration of the film (${callerFullDurationMs}ms) and the actual duration of the original full-slice node (${detectedFullDurationMs}ms) are inconsistent, please check and try again.`,
      );
    }
  }

  const enrichedReplacements = Array.isArray(params.replacements)
    ? params.replacements.map((item) => {
        const repNodeId = String(item?.nodeId || item?.replacedVideoNodeId || "").trim();
        const detectedRepDur = nodeDurationMap.get(repNodeId);
        return {
          ...item,
          sourceDurationMs: item?.sourceDurationMs ?? detectedRepDur,
        };
      })
    : [];

  const timeline = buildTimelineRangeReplacement({
    ...params,
    fullDurationMs: resolvedFullDurationMs,
    replacements: enrichedReplacements,
    existingTimeline: params.existingTimeline !== undefined ? params.existingTimeline : existingTimeline,
  });

  const updated = await host.ops.call("canvas.timeline.update", {
    canvasId,
    expectedRevision: revision,
    timeline,
  });
  return {
    canvasId,
    revision: Number(updated?.revision ?? revision + 1),
    timeline,
  };
}

const inputStyle = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(15, 23, 42, 0.35)",
  color: "inherit",
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
};

export function activate(host) {
  const React = host.React;
  const h = React ? React.createElement : () => null;

  function CharacterReplacementNodeCard(props) {
    const node = props?.node || {};
    const pluginData = node?.metadata?.pluginData || {};

    const [shotTitle, setShotTitle] = React.useState(
      () => String(pluginData.shotTitle || node.title || "Shot 1"),
    );
    const [position, setPosition] = React.useState(
      () => normalizePosition(pluginData.position || "left"),
    );
    const [genderHint, setGenderHint] = React.useState(
      () => normalizeGenderHint(pluginData.genderHint || "person"),
    );
    const [sourceDescription, setSourceDescription] = React.useState(
      () => String(pluginData.sourceDescription || ""),
    );
    const [targetDescription, setTargetDescription] = React.useState(
      () => String(pluginData.targetDescription || ""),
    );
    const [replacementScope, setReplacementScope] = React.useState(
      () => normalizeReplacementScope(pluginData.replacementScope || "full-person"),
    );
    const [promptMode, setPromptMode] = React.useState(
      () => normalizePromptMode(pluginData.promptMode || "regular"),
    );
    const [manualPrompt, setManualPrompt] = React.useState(
      () => String(pluginData.manualPrompt || ""),
    );
    const [sourceKeyframeNodeId, setSourceKeyframeNodeId] = React.useState(
      () => String(pluginData.sourceKeyframeNodeId || ""),
    );
    const [targetCharacterNodeId, setTargetCharacterNodeId] = React.useState(
      () => String(pluginData.targetCharacterNodeId || ""),
    );
    const [locationGuideNodeId, setLocationGuideNodeId] = React.useState(
      () => String(pluginData.locationGuideNodeId || ""),
    );
    const [sourceVideoNodeId, setSourceVideoNodeId] = React.useState(
      () => String(pluginData.sourceVideoNodeId || ""),
    );
    const [submitting, setSubmitting] = React.useState(false);
    const [statusText, setStatusText] = React.useState("");

    React.useEffect(() => {
      const currentCanvasId = host.context?.getCanvasId?.();
      if (currentCanvasId) {
        host.storage?.set?.("lastCanvasId", currentCanvasId);
      }
    }, []);

    const syncPluginData = (patch) => {
      props?.updateNodeData?.({
        shotTitle,
        position,
        genderHint,
        sourceDescription,
        targetDescription,
        replacementScope,
        promptMode,
        manualPrompt,
        sourceKeyframeNodeId,
        targetCharacterNodeId,
        locationGuideNodeId,
        sourceVideoNodeId,
        ...patch,
      });
    };

    const compiled = React.useMemo(
      () =>
        buildCharacterReplacementPackage({
          position,
          genderHint,
          sourceDescription,
          targetDescription,
          replacementScope,
          promptMode,
          manualPrompt,
          hasLocationGuideImage: Boolean(locationGuideNodeId),
        }),
      [
        position,
        genderHint,
        sourceDescription,
        targetDescription,
        replacementScope,
        promptMode,
        manualPrompt,
        locationGuideNodeId,
      ],
    );

    const handleArrange = React.useCallback(async () => {
      setSubmitting(true);
      setStatusText("");
      try {
        const res = await arrangeCharacterReplacementOnCanvas(host, {
          controlNodeId: node.id,
          shotTitle,
          position,
          genderHint,
          sourceDescription,
          targetDescription,
          replacementScope,
          promptMode,
          manualPrompt,
          sourceKeyframeNodeId,
          targetCharacterNodeId,
          locationGuideNodeId,
          sourceVideoNodeId,
        });
        const warnSuffix =
          res.missingReferences?.length > 0
            ? `(Tip: Not yet bound${res.missingReferences.join("、")}, please connect manually before generating)`
            : "";
        const msg = `Two-stage substitution node has been created: keyframe (${res.keyframeNodeId}) → video element replacement (${res.videoNodeId})${warnSuffix}`;
        setStatusText(msg);
        host.ui?.notify?.(msg, "success");
      } catch (err) {
        const msg = err?.message || "Creating role replacement pipeline failed";
        setStatusText(msg);
        host.ui?.notify?.(msg, "error");
      } finally {
        setSubmitting(false);
      }
    }, [
      node.id,
      shotTitle,
      position,
      genderHint,
      sourceDescription,
      targetDescription,
      replacementScope,
      promptMode,
      manualPrompt,
      sourceKeyframeNodeId,
      targetCharacterNodeId,
      locationGuideNodeId,
      sourceVideoNodeId,
    ]);

    return h(
      "div",
      {
        "data-testid": "character-replacement-node",
        "data-plugin-node": "character-replacement",
        style: {
          width: "100%",
          height: "100%",
          padding: 14,
          paddingTop: 38,
          borderRadius: 12,
          background:
            "linear-gradient(155deg, rgba(16, 185, 129, 0.14), rgba(59, 130, 246, 0.12))",
          border: "1px solid rgba(16, 185, 129, 0.38)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 8,
          boxSizing: "border-box",
          overflow: "auto",
        },
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 7 } },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            },
          },
          h(
            "span",
            { style: { fontSize: 13, fontWeight: 700 } },
            "🎭 AI character replacement (key frame + video dual stage)",
          ),
          h(
            "button",
            {
              type: "button",
              "data-testid": "character-replacement-open-studio-btn",
              onClick: (e) => {
                e.stopPropagation();
                const currentCanvasId = host.context?.getCanvasId?.();
                if (currentCanvasId) {
                  host.storage?.set?.("lastCanvasId", currentCanvasId);
                }
                host.ui?.navigate?.("/p/beeftv-plugin-character-replacement");
              },
              style: {
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid rgba(16, 185, 129, 0.45)",
                background: "rgba(16, 185, 129, 0.18)",
                color: "inherit",
                cursor: "pointer",
              },
            },
            "Open replacement studio",
          ),
        ),
        h(
          "div",
          { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 } },
          h("input", {
            type: "text",
            "data-testid": "character-replacement-shot-input",
            value: shotTitle,
            placeholder: "Lens name (e.g. Lens 1)",
            onChange: (e) => {
              setShotTitle(e.target.value);
              syncPluginData({ shotTitle: e.target.value });
            },
            onClick: (e) => e.stopPropagation(),
            style: inputStyle,
          }),
          h(
            "select",
            {
              "data-testid": "character-replacement-scope-select",
              value: replacementScope,
              onChange: (e) => {
                setReplacementScope(e.target.value);
                syncPluginData({ replacementScope: e.target.value });
              },
              onClick: (e) => e.stopPropagation(),
              style: inputStyle,
            },
            REPLACEMENT_SCOPES.map((s) =>
              h("option", { key: s.value, value: s.value }, s.label),
            ),
          ),
        ),
        h(
          "div",
          { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 } },
          h(
            "select",
            {
              "data-testid": "character-replacement-position-select",
              value: position,
              onChange: (e) => {
                setPosition(e.target.value);
                syncPluginData({ position: e.target.value });
              },
              onClick: (e) => e.stopPropagation(),
              style: inputStyle,
            },
            PERSON_POSITIONS.map((p) =>
              h("option", { key: p.value, value: p.value }, p.label),
            ),
          ),
          h(
            "select",
            {
              "data-testid": "character-replacement-mode-select",
              value: promptMode,
              onChange: (e) => {
                setPromptMode(e.target.value);
                syncPluginData({ promptMode: e.target.value });
              },
              onClick: (e) => e.stopPropagation(),
              style: inputStyle,
            },
            PROMPT_MODES.map((m) =>
              h("option", { key: m.value, value: m.value }, m.label),
            ),
          ),
        ),
        h("input", {
          type: "text",
          "data-testid": "character-replacement-source-desc-input",
          value: sourceDescription,
          placeholder: "Character features are replaced in the original picture (for example: a man in a black suit)",
          onChange: (e) => {
            setSourceDescription(e.target.value);
            syncPluginData({ sourceDescription: e.target.value });
          },
          onClick: (e) => e.stopPropagation(),
          style: inputStyle,
        }),
        h("input", {
          type: "text",
          "data-testid": "character-replacement-target-desc-input",
          value: targetDescription,
          placeholder: "Target new role description (e.g.: boss wearing silver-rimmed glasses and burgundy suit)",
          onChange: (e) => {
            setTargetDescription(e.target.value);
            syncPluginData({ targetDescription: e.target.value });
          },
          onClick: (e) => e.stopPropagation(),
          style: inputStyle,
        }),
        promptMode === "manual"
          ? h("textarea", {
              "data-testid": "character-replacement-manual-prompt-input",
              value: manualPrompt,
              placeholder: "Enter a custom keyframe substitution prompt word...",
              rows: 2,
              onChange: (e) => {
                setManualPrompt(e.target.value);
                syncPluginData({ manualPrompt: e.target.value });
              },
              onClick: (e) => e.stopPropagation(),
              style: { ...inputStyle, resize: "vertical" },
            })
          : null,
        promptMode === "positioning"
          ? h("input", {
              type: "text",
              "data-testid": "character-replacement-guide-node-input",
              value: locationGuideNodeId,
              placeholder: "Locate graph node ID (connected as Figure 3)",
              onChange: (e) => {
                setLocationGuideNodeId(e.target.value);
                syncPluginData({ locationGuideNodeId: e.target.value });
              },
              onClick: (e) => e.stopPropagation(),
              style: inputStyle,
            })
          : null,
        h(
          "div",
          { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 } },
          h("input", {
            type: "text",
            "data-testid": "character-replacement-keyframe-node-input",
            value: sourceKeyframeNodeId,
            placeholder: "Original keyframe node ID",
            onChange: (e) => {
              setSourceKeyframeNodeId(e.target.value);
              syncPluginData({ sourceKeyframeNodeId: e.target.value });
            },
            onClick: (e) => e.stopPropagation(),
            style: inputStyle,
          }),
          h("input", {
            type: "text",
            "data-testid": "character-replacement-target-node-input",
            value: targetCharacterNodeId,
            placeholder: "Target role graph node ID",
            onChange: (e) => {
              setTargetCharacterNodeId(e.target.value);
              syncPluginData({ targetCharacterNodeId: e.target.value });
            },
            onClick: (e) => e.stopPropagation(),
            style: inputStyle,
          }),
          h("input", {
            type: "text",
            "data-testid": "character-replacement-video-node-input",
            value: sourceVideoNodeId,
            placeholder: "Original video node ID",
            onChange: (e) => {
              setSourceVideoNodeId(e.target.value);
              syncPluginData({ sourceVideoNodeId: e.target.value });
            },
            onClick: (e) => e.stopPropagation(),
            style: inputStyle,
          }),
        ),
        h(
          "div",
          {
            "data-testid": "character-replacement-prompt-preview",
            style: {
              padding: "6px 8px",
              borderRadius: 6,
              background: "rgba(15, 23, 42, 0.45)",
              fontSize: 11,
              lineHeight: 1.4,
              maxHeight: 68,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              opacity: 0.9,
            },
          },
          compiled.prompt,
        ),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        statusText
          ? h(
              "div",
              {
                "data-testid": "character-replacement-status",
                style: { fontSize: 11, opacity: 0.88, lineHeight: 1.35 },
              },
              statusText,
            )
          : null,
        h(
          "button",
          {
            type: "button",
            "data-testid": "character-replacement-submit-btn",
            disabled: submitting,
            onClick: (e) => {
              e.stopPropagation();
              void handleArrange();
            },
            style: {
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              background: "#10b981",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              cursor: submitting ? "wait" : "pointer",
            },
          },
          submitting ? "Orchestrating dual-phase replacement nodes..." : "One-click keyframe arrangement + video replacement pipeline",
        ),
      ),
    );
  }

  function CharacterReplacementStudioWorkbench({ compact = false } = {}) {
    const [targetCanvasId, setTargetCanvasId] = React.useState(() =>
      resolveActiveCanvasId(host, ""),
    );
    React.useEffect(() => {
      let active = true;
      resolveActiveCanvasIdAsync(host, "").then((resolved) => {
        if (active && resolved) {
          setTargetCanvasId((prev) => prev || resolved);
        }
      });
      return () => {
        active = false;
      };
    }, []);
    const [activeStep, setActiveStep] = React.useState(1);
    const [shotTitle, setShotTitle] = React.useState("Shot 1");
    const [position, setPosition] = React.useState("left");
    const [genderHint, setGenderHint] = React.useState("male");
    const [sourceDescription, setSourceDescription] = React.useState("man in black suit");
    const [targetDescription, setTargetDescription] = React.useState(
      "A young boss wearing silver-rimmed glasses and a burgundy velvet suit",
    );
    const [replacementScope, setReplacementScope] = React.useState("full-person");
    const [promptMode, setPromptMode] = React.useState("regular");
    const [manualPrompt, setManualPrompt] = React.useState("");
    const [sourceKeyframeNodeId, setSourceKeyframeNodeId] = React.useState("");
    const [targetCharacterNodeId, setTargetCharacterNodeId] = React.useState("");
    const [locationGuideNodeId, setLocationGuideNodeId] = React.useState("");
    const [sourceVideoNodeId, setSourceVideoNodeId] = React.useState("");

    // Step 4: 全片时间线区间回插状态
    const [fullVideoNodeId, setFullVideoNodeId] = React.useState("");
    const [fullDurationSec, setFullDurationSec] = React.useState("");
    const [replacedVideoNodeId, setReplacedVideoNodeId] = React.useState("");
    const [rangeStartSec, setRangeStartSec] = React.useState("1");
    const [rangeEndSec, setRangeEndSec] = React.useState("3");
    const [keepOriginalAudio, setKeepOriginalAudio] = React.useState(true);
    const [studioMessage, setStudioMessage] = React.useState("");
    const [studioMessageTone, setStudioMessageTone] = React.useState("success");
    const [working, setWorking] = React.useState(false);

    const compiled = React.useMemo(
      () =>
        buildCharacterReplacementPackage({
          position,
          genderHint,
          sourceDescription,
          targetDescription,
          replacementScope,
          promptMode,
          manualPrompt,
          hasLocationGuideImage:
            promptMode === "positioning" && Boolean(locationGuideNodeId),
        }),
      [
        position,
        genderHint,
        sourceDescription,
        targetDescription,
        replacementScope,
        promptMode,
        manualPrompt,
        locationGuideNodeId,
      ],
    );

    const handlePushPipeline = React.useCallback(async () => {
      setWorking(true);
      setStudioMessage("");
      try {
        const res = await arrangeCharacterReplacementOnCanvas(host, {
          canvasId: targetCanvasId,
          shotTitle,
          position,
          genderHint,
          sourceDescription,
          targetDescription,
          replacementScope,
          promptMode,
          manualPrompt,
          sourceKeyframeNodeId,
          targetCharacterNodeId,
          locationGuideNodeId,
          sourceVideoNodeId,
          autoCreateCanvas: true,
          autoCreateInputNodes: true,
        });
        if (res.canvasId) setTargetCanvasId(res.canvasId);
        if (res.sourceKeyframeNodeId) setSourceKeyframeNodeId(res.sourceKeyframeNodeId);
        if (res.targetCharacterNodeId) setTargetCharacterNodeId(res.targetCharacterNodeId);
        if (res.locationGuideNodeId) setLocationGuideNodeId(res.locationGuideNodeId);
        if (res.sourceVideoNodeId) setSourceVideoNodeId(res.sourceVideoNodeId);
        setReplacedVideoNodeId(res.videoNodeId);
        const hasMissing = res.missingReferences?.length > 0;
        const warnText = hasMissing
          ? `(Note: Not yet bound${res.missingReferences.join("、")}, please connect the lines on the canvas before generating)`
          : "";
        const msg = `Already on the canvas (${res.canvasId}) create "${shotTitle}"Two-stage replacement pipeline: keyframe nodes${res.keyframeNodeId} → Video element replacement node${res.videoNodeId}${warnText}`;
        setStudioMessageTone(hasMissing ? "warning" : "success");
        setStudioMessage(msg);
        host.ui?.notify?.(msg, hasMissing ? "warning" : "success");
      } catch (err) {
        const msg = err?.message || "Push canvas pipeline failed";
        setStudioMessageTone("error");
        setStudioMessage(msg);
        host.ui?.notify?.(msg, "error");
      } finally {
        setWorking(false);
      }
    }, [
      targetCanvasId,
      shotTitle,
      position,
      genderHint,
      sourceDescription,
      targetDescription,
      replacementScope,
      promptMode,
      manualPrompt,
      sourceKeyframeNodeId,
      targetCharacterNodeId,
      locationGuideNodeId,
      sourceVideoNodeId,
    ]);

    const handleSpliceTimeline = React.useCallback(async () => {
      setWorking(true);
      setStudioMessage("");
      try {
        const parsedSec = Number(fullDurationSec);
        const fullDurationMs =
          Number.isFinite(parsedSec) && parsedSec > 0
            ? Math.round(parsedSec * 1000)
            : undefined;
        const startMs = Math.round(Number(rangeStartSec) * 1000);
        const endMs = Math.round(Number(rangeEndSec) * 1000);
        const res = await spliceReplacedShotsIntoTimeline(host, {
          canvasId: targetCanvasId,
          fullVideoNodeId,
          fullDurationMs,
          keepOriginalAudio,
          replacements: [
            {
              nodeId: replacedVideoNodeId,
              startMs,
              endMs,
            },
          ],
        });
        const msg = `Replaced video (${replacedVideoNodeId}) Losslessly inserted back to the canvas (${res.canvasId})Full film timeline${rangeStartSec}s ~ ${rangeEndSec}s (total${res.timeline.clips.length} fragments, version r${res.revision}）`;
        setStudioMessageTone("success");
        setStudioMessage(msg);
        host.ui?.notify?.(msg, "success");
      } catch (err) {
        const msg = err?.message || "Failed to insert back the entire film timeline";
        setStudioMessageTone("error");
        setStudioMessage(msg);
        host.ui?.notify?.(msg, "error");
      } finally {
        setWorking(false);
      }
    }, [
      targetCanvasId,
      fullVideoNodeId,
      fullDurationSec,
      replacedVideoNodeId,
      rangeStartSec,
      rangeEndSec,
      keepOriginalAudio,
    ]);

    const bannerColors =
      studioMessageTone === "error"
        ? {
            background: "rgba(239, 68, 68, 0.14)",
            border: "1px solid rgba(239, 68, 68, 0.45)",
            color: "#fca5a5",
          }
        : studioMessageTone === "warning"
          ? {
              background: "rgba(245, 158, 11, 0.14)",
              border: "1px solid rgba(245, 158, 11, 0.45)",
              color: "#fcd34d",
            }
          : {
              background: "rgba(16, 185, 129, 0.14)",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              color: "inherit",
            };

    return h(
      "div",
      {
        "data-testid": compact
          ? "character-replacement-side-panel"
          : "character-replacement-studio-page",
        style: {
          padding: compact ? 12 : 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxWidth: compact ? "100%" : 980,
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          },
        },
        h(
          "div",
          null,
          h(
            "h2",
            { style: { margin: 0, fontSize: compact ? 16 : 20, fontWeight: 700 } },
            "🎭 AI character replacement studio",
          ),
          h(
            "p",
            { style: { margin: "4px 0 0", fontSize: 12, opacity: 0.78 } },
            "Two-stage high-fidelity character replacement: Step 1 Character mapping and range locking → Step 2 Key frame precise substitution → Step 3 Seedance 2.5 video element replacement → Step 4 Lossless reinsertion of the entire film timeline",
          ),
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h("input", {
            type: "text",
            "data-testid": "studio-target-canvas-input",
            value: targetCanvasId,
            onChange: (e) => {
              setTargetCanvasId(e.target.value);
              if (e.target.value.trim()) {
                host.storage?.set?.("lastCanvasId", e.target.value.trim());
              }
            },
            placeholder: "Target canvas ID (leave blank to automatically bind or create a new one)",
            style: { ...inputStyle, width: compact ? 160 : 210 },
          }),
          targetCanvasId
            ? h(
                "button",
                {
                  type: "button",
                  "data-testid": "studio-open-canvas-btn",
                  onClick: () => host.ui?.navigate?.(`/canvas/${encodeURIComponent(targetCanvasId)}`),
                  style: {
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(16, 185, 129, 0.55)",
                    background: "rgba(16, 185, 129, 0.16)",
                    color: "#10b981",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  },
                },
                "Open target canvas →",
              )
            : null,
          [
            { step: 1, label: "1. Role and scope binding" },
            { step: 2, label: "2. Key frame prompt words and positioning boxes" },
            { step: 3, label: "3. Video action replacement pipeline" },
            { step: 4, label: "4. Lossless interpolation across the entire film" },
          ].map((tab) =>
            h(
              "button",
              {
                key: tab.step,
                type: "button",
                "data-testid": `studio-step-tab-${tab.step}`,
                onClick: () => setActiveStep(tab.step),
                style: {
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                  background:
                    activeStep === tab.step
                      ? "rgba(16, 185, 129, 0.22)"
                      : "transparent",
                  color: "inherit",
                  fontSize: 12,
                  fontWeight: activeStep === tab.step ? 600 : 400,
                  cursor: "pointer",
                },
              },
              tab.label,
            ),
          ),
        ),
      ),

      // Step 1 ~ 3 配置与提示词预览卡片
      activeStep !== 4
        ? h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: compact ? "1fr" : "1.1fr 0.9fr",
                gap: 16,
              },
            },
            h(
              "div",
              {
                style: {
                  padding: 16,
                  borderRadius: 12,
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                },
              },
              h(
                "div",
                { style: { fontWeight: 600, fontSize: 14 } },
                "Lens and character binding parameters",
              ),
              h(
                "div",
                { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                h("input", {
                  type: "text",
                  "data-testid": "studio-shot-title-input",
                  value: shotTitle,
                  onChange: (e) => setShotTitle(e.target.value),
                  placeholder: "Lens name",
                  style: inputStyle,
                }),
                h(
                  "select",
                  {
                    "data-testid": "studio-scope-select",
                    value: replacementScope,
                    onChange: (e) => setReplacementScope(e.target.value),
                    style: inputStyle,
                  },
                  REPLACEMENT_SCOPES.map((s) =>
                    h("option", { key: s.value, value: s.value }, s.label),
                  ),
                ),
              ),
              h(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                  },
                },
                h(
                  "select",
                  {
                    "data-testid": "studio-position-select",
                    value: position,
                    onChange: (e) => setPosition(e.target.value),
                    style: inputStyle,
                  },
                  PERSON_POSITIONS.map((p) =>
                    h("option", { key: p.value, value: p.value }, p.label),
                  ),
                ),
                h(
                  "select",
                  {
                    "data-testid": "studio-gender-select",
                    value: genderHint,
                    onChange: (e) => setGenderHint(e.target.value),
                    style: inputStyle,
                  },
                  GENDER_HINTS.map((g) =>
                    h("option", { key: g.value, value: g.value }, g.label),
                  ),
                ),
                h(
                  "select",
                  {
                    "data-testid": "studio-prompt-mode-select",
                    value: promptMode,
                    onChange: (e) => setPromptMode(e.target.value),
                    style: inputStyle,
                  },
                  PROMPT_MODES.map((m) =>
                    h("option", { key: m.value, value: m.value }, m.label),
                  ),
                ),
              ),
              h("input", {
                type: "text",
                "data-testid": "studio-source-desc-input",
                value: sourceDescription,
                onChange: (e) => setSourceDescription(e.target.value),
                placeholder: "The original video has been replaced with a character description (for example: the man in a black suit on the left)",
                style: inputStyle,
              }),
              h("input", {
                type: "text",
                "data-testid": "studio-target-desc-input",
                value: targetDescription,
                onChange: (e) => setTargetDescription(e.target.value),
                placeholder: "Target replacement character description (e.g.: boss wearing silver-rimmed glasses and burgundy velvet suit)",
                style: inputStyle,
              }),
              promptMode === "manual"
                ? h("textarea", {
                    "data-testid": "studio-manual-prompt-input",
                    value: manualPrompt,
                    onChange: (e) => setManualPrompt(e.target.value),
                    placeholder: "Enter a custom keyframe substitution prompt word...",
                    rows: 3,
                    style: { ...inputStyle, resize: "vertical" },
                  })
                : null,
              promptMode === "positioning"
                ? h("input", {
                    type: "text",
                    "data-testid": "studio-guide-node-input",
                    value: locationGuideNodeId,
                    onChange: (e) => setLocationGuideNodeId(e.target.value),
                    placeholder: "Locate graph node ID (connected as Figure 3)",
                    style: inputStyle,
                  })
                : null,
              h(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                  },
                },
                h("input", {
                  type: "text",
                  value: sourceKeyframeNodeId,
                  onChange: (e) => setSourceKeyframeNodeId(e.target.value),
                  placeholder: "Original keyframe node ID (optional)",
                  style: inputStyle,
                }),
                h("input", {
                  type: "text",
                  value: targetCharacterNodeId,
                  onChange: (e) => setTargetCharacterNodeId(e.target.value),
                  placeholder: "Target actor graph node ID (optional)",
                  style: inputStyle,
                }),
                h("input", {
                  type: "text",
                  value: sourceVideoNodeId,
                  onChange: (e) => setSourceVideoNodeId(e.target.value),
                  placeholder: "Original shot video node ID (optional)",
                  style: inputStyle,
                }),
              ),
              h(
                "button",
                {
                  type: "button",
                  "data-testid": "studio-push-canvas-btn",
                  disabled: working,
                  onClick: () => void handlePushPipeline(),
                  style: {
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: "#10b981",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: working ? "wait" : "pointer",
                  },
                },
                working
                  ? "Arranging nodes to target canvas..."
                  : "Generate a two-stage pipeline of \"keyframe substitution + video substitution\" on the target canvas with one click",
              ),
            ),
            h(
              "div",
              {
                style: {
                  padding: 16,
                  borderRadius: 12,
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                },
              },
              h(
                "div",
                { style: { fontWeight: 600, fontSize: 14 } },
                "Dual-stage prompt word preview after compilation",
              ),
              h(
                "div",
                { style: { fontSize: 12, opacity: 0.78 } },
                "Stage 1 (Step 2 Keyframe character replacement prompt words):",
              ),
              h(
                "pre",
                {
                  "data-testid": "studio-compiled-image-prompt",
                  style: {
                    margin: 0,
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(15, 23, 42, 0.55)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  },
                },
                compiled.prompt,
              ),
              h(
                "div",
                { style: { fontSize: 12, opacity: 0.78 } },
                "Stage 2 (Step 3 Seedance 2.5 element replacement replace_element prompt word):",
              ),
              h(
                "pre",
                {
                  "data-testid": "studio-compiled-video-prompt",
                  style: {
                    margin: 0,
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(15, 23, 42, 0.55)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  },
                },
                compiled.videoPrompt,
              ),
              compiled.locationGuide
                ? h(
                    "div",
                    {
                      "data-testid": "studio-location-guide-preview",
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      },
                    },
                    h(
                      "span",
                      { style: { fontSize: 12, opacity: 0.8 } },
                      `Multi-person positioning assistance map (${compiled.locationGuide.width}x${compiled.locationGuide.height}）：`,
                    ),
                    h("img", {
                      src: compiled.locationGuide.dataUrl,
                      alt: "Character positioning map",
                      style: {
                        width: "100%",
                        maxHeight: 160,
                        objectFit: "contain",
                        borderRadius: 8,
                        border: "1px solid rgba(148, 163, 184, 0.3)",
                      },
                    }),
                  )
                : null,
            ),
          )
        : // Step 4: 全片时间线无损区间回插面板
          h(
            "div",
            {
              "data-testid": "studio-step4-timeline-panel",
              style: {
                padding: 16,
                borderRadius: 12,
                border: "1px solid rgba(148, 163, 184, 0.25)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              },
            },
            h(
              "div",
              { style: { fontWeight: 600, fontSize: 15 } },
              "Step 4 · Lossless back-insertion of the entire timeline interval (complete insertion into the entire film)",
            ),
            h(
              "p",
              { style: { margin: 0, fontSize: 12, opacity: 0.8 } },
              "Cut the replaced single-shot video node into the original full-film video according to the precise start and end seconds, and automatically generate a complete timeline of \"original film front part → replacement shot → original film back part\", retain the existing subtitles/BGM track on the canvas, and optionally retain the original film's continuous and simultaneous sound track.",
            ),
            h(
              "div",
              { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
              h("input", {
                type: "text",
                "data-testid": "studio-full-video-node-input",
                value: fullVideoNodeId,
                onChange: (e) => setFullVideoNodeId(e.target.value),
                placeholder: "Original full video node ID (required)",
                style: inputStyle,
              }),
              h("input", {
                type: "number",
                "data-testid": "studio-full-duration-input",
                value: fullDurationSec,
                onChange: (e) => setFullDurationSec(e.target.value),
                placeholder: "The total duration of the original film (seconds, leave blank to automatically read the node duration)",
                style: inputStyle,
              }),
            ),
            h(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                },
              },
              h("input", {
                type: "text",
                "data-testid": "studio-replaced-video-node-input",
                value: replacedVideoNodeId,
                onChange: (e) => setReplacedVideoNodeId(e.target.value),
                placeholder: "Lens video node ID after replacement (required)",
                style: inputStyle,
              }),
              h("input", {
                type: "number",
                "data-testid": "studio-range-start-input",
                value: rangeStartSec,
                onChange: (e) => setRangeStartSec(e.target.value),
                placeholder: "Replace starting point (seconds, e.g. 3)",
                style: inputStyle,
              }),
              h("input", {
                type: "number",
                "data-testid": "studio-range-end-input",
                value: rangeEndSec,
                onChange: (e) => setRangeEndSec(e.target.value),
                placeholder: "Replace endpoint (seconds, e.g. 8)",
                style: inputStyle,
              }),
            ),
            h(
              "label",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  cursor: "pointer",
                },
              },
              h("input", {
                type: "checkbox",
                "data-testid": "studio-keep-audio-checkbox",
                checked: keepOriginalAudio,
                onChange: (e) => setKeepOriginalAudio(e.target.checked),
              }),
              "Retain the continuous original soundtrack of the entire film (mute the video clip track, superimpose the complete original film audio track to prevent seams and interruptions)",
            ),
            h(
              "button",
              {
                type: "button",
                "data-testid": "studio-splice-timeline-btn",
                disabled: working,
                onClick: () => void handleSpliceTimeline(),
                style: {
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: working ? "wait" : "pointer",
                },
              },
              working
                ? "Writing full film timeline..."
                : "Insert replacement footage losslessly back into the entire film timeline with just one click",
            ),
          ),

      studioMessage
        ? h(
            "div",
            {
              "data-testid": "studio-status-banner",
              role: studioMessageTone === "error" ? "alert" : "status",
              style: {
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 12,
                ...bannerColors,
              },
            },
            studioMessage,
          )
        : null,
    );
  }

  // 1. canvas.node — 角色替换画布节点
  host.contribute("canvas.node", {
    id: "character-replacement",
    type: "character-replacement",
    label: "Role replacement",
    title: "AI role replacement",
    defaultTitle: "AI role replacement",
    defaultWidth: 380,
    defaultHeight: 460,
    defaultSize: { width: 380, height: 460 },
    renderer: "client",
    render: CharacterReplacementNodeCard,
    component: CharacterReplacementNodeCard,
  });

  // 2. canvas.addNodeMenu — 添加节点菜单入口
  host.contribute("canvas.addNodeMenu", {
    id: "character-replacement-add",
    label: "AI role replacement",
    title: "AI role replacement",
    nodeType: "character-replacement",
    section: "node",
    defaultOrder: 48,
    onSelect: (ctx) => ctx?.handlers?.onAddExtensionNode?.("character-replacement"),
    run: (ctx) => ctx?.handlers?.onAddExtensionNode?.("character-replacement"),
  });

  // 3. canvas.toolbar.main — 画布主工具栏按钮
  host.contribute("canvas.toolbar.main", {
    id: "character-replacement-toolbar",
    label: "character replacement studio",
    title: "Open the AI character replacement studio",
    category: "create",
    defaultVisible: true,
    defaultOrder: 48,
    onClick: () => {
      const currentCanvasId = host.context?.getCanvasId?.();
      if (currentCanvasId) rememberCanvasId(host, currentCanvasId);
      host.ui?.navigate?.("/p/beeftv-plugin-character-replacement");
    },
    run: () => {
      const currentCanvasId = host.context?.getCanvasId?.();
      if (currentCanvasId) rememberCanvasId(host, currentCanvasId);
      host.ui?.navigate?.("/p/beeftv-plugin-character-replacement");
    },
  });

  // 4. canvas.sidePanel — 画布侧栏面板
  host.contribute("canvas.sidePanel", {
    id: "character-replacement-side-panel",
    label: "Role replacement",
    title: "AI character replacement studio",
    order: 48,
    render: () => h(CharacterReplacementStudioWorkbench, { compact: true }),
    component: () => h(CharacterReplacementStudioWorkbench, { compact: true }),
  });

  // 5. app.page — 独立全屏工作台页面
  host.contribute("app.page", {
    id: "character-replacement-studio-page",
    path: "/p/beeftv-plugin-character-replacement",
    title: "AI character replacement studio",
    label: "AI character replacement studio",
    render: () => h(CharacterReplacementStudioWorkbench, { compact: false }),
    component: () => h(CharacterReplacementStudioWorkbench, { compact: false }),
  });

  // 6. app.sidebar — 全局导航入口
  host.contribute("app.sidebar", {
    id: "character-replacement-sidebar",
    label: "character replacement studio",
    path: "/p/beeftv-plugin-character-replacement",
    order: 48,
  });

  // 7. assistant.toolCard — 角色替换管线编排工具卡片
  host.contribute("assistant.toolCard", {
    id: "character-replacement-tool-card",
    toolName: "character_replacement_arrange",
    label: "AI role replacement pipeline orchestration",
    render: ({ args, result, status }) =>
      h(
        "div",
        {
          "data-testid": "character-replacement-tool-card",
          style: {
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(16, 185, 129, 0.38)",
            background: "rgba(16, 185, 129, 0.1)",
            fontSize: 12,
          },
        },
        h(
          "div",
          { style: { fontWeight: 600 } },
          `🎭 AI character replacement ·${args?.shotTitle || "current shot"}`,
        ),
        h(
          "div",
          { style: { marginTop: 4, opacity: 0.85 } },
          `Scope:${args?.replacementScope || "full-person"} · Location:${args?.position || "single"} · Status:${status || "completed"}`,
        ),
        result
          ? h(
              "div",
              { style: { marginTop: 4, opacity: 0.75 } },
              typeof result === "string" ? result : JSON.stringify(result),
            )
          : null,
      ),
  });

  // 8. assistant.toolCard — 全片时间线区间回插工具卡片
  host.contribute("assistant.toolCard", {
    id: "character-replacement-splice-tool-card",
    toolName: "character_replacement_splice_timeline",
    label: "Interpolation of character replacement intervals throughout the film",
    render: ({ args, result, status }) =>
      h(
        "div",
        {
          "data-testid": "character-replacement-splice-tool-card",
          style: {
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(59, 130, 246, 0.38)",
            background: "rgba(59, 130, 246, 0.1)",
            fontSize: 12,
          },
        },
        h(
          "div",
          { style: { fontWeight: 600 } },
          `🎬 Full slice interval back-insertion · Original slice node${args?.fullVideoNodeId || ""}`,
        ),
        h(
          "div",
          { style: { marginTop: 4, opacity: 0.85 } },
          `Number of replacement lenses:${Array.isArray(args?.replacements) ? args.replacements.length : 0} · Status:${status || "completed"}`,
        ),
        result
          ? h(
              "div",
              { style: { marginTop: 4, opacity: 0.75 } },
              typeof result === "string" ? result : JSON.stringify(result),
            )
          : null,
      ),
  });
}

export default activate;
