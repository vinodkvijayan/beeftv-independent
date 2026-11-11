// AI 角色替换工作室核心编译器：
// 1. 关键帧换人提示词编译器（支持常规描述定位、SVG 定位框辅助、手动模式，以及 5 档替换范围）
// 2. 多人定位图 SVG 生成器（供多人物同框防串脸定位参考）
// 3. 第二阶段视频角色替换（replace_element）提示词编译器
// 4. 全片时间线无损区间回插（Timeline v2 切片、原声保留与已有字幕/音轨合并）构建器

export const REPLACEMENT_SCOPES = [
  { value: "full-person", label: "Complete character (appearance + clothing)", phrase: "complete character" },
  { value: "visible-part", label: "currently visible part", phrase: "currently visible part" },
  { value: "face-hair", label: "face and hair", phrase: "face and hair" },
  { value: "clothing", label: "Clothing only", phrase: "clothing" },
  { value: "arm-hand", label: "arms and hands", phrase: "arms and hands" },
];

export const PERSON_POSITIONS = [
  { value: "single", label: "Single player screen (sole protagonist)" },
  { value: "left", label: "The person on the left (two people/multiple people on the left)" },
  { value: "center", label: "Middle figure (three people/multiple people in the middle)" },
  { value: "right", label: "The person on the right (double/multiple people on the right)" },
];

export const GENDER_HINTS = [
  { value: "person", label: "Character (regardless of gender)", noun: "people" },
  { value: "male", label: "male role", noun: "man" },
  { value: "female", label: "female characters", noun: "woman" },
];

export const PROMPT_MODES = [
  { value: "regular", label: "General location description (recommended)" },
  { value: "positioning", label: "SVG positioning frame assistance (multiple people in the same frame)" },
  { value: "manual", label: "Custom prompt words" },
];

export const MARKER_HEX_COLORS = [
  "#ef4444",
  "#06b6d4",
  "#eab308",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ec4899",
  "#3b82f6",
];

const SCOPE_MAP = new Map(REPLACEMENT_SCOPES.map((item) => [item.value, item.phrase]));
const SAFE_HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function cleanText(value) {
  return String(value ?? "").trim();
}

export function uniqueNodeTitle(baseTitle, existingTitles) {
  const clean = cleanText(baseTitle) || "node";
  const set = existingTitles instanceof Set ? existingTitles : new Set();
  if (!set.has(clean)) {
    set.add(clean);
    return clean;
  }
  let suffix = 2;
  while (set.has(`${clean} #${suffix}`)) {
    suffix += 1;
  }
  const candidate = `${clean} #${suffix}`;
  set.add(candidate);
  return candidate;
}

export function normalizeReplacementScope(scope) {
  const normalized = cleanText(scope).toLowerCase();
  return SCOPE_MAP.has(normalized) ? normalized : "full-person";
}

export function normalizePosition(position) {
  const normalized = cleanText(position).toLowerCase();
  if (normalized === "left" || normalized === "center" || normalized === "right" || normalized === "single") {
    return normalized;
  }
  return "single";
}

export function normalizeGenderHint(genderHint) {
  const raw = cleanText(genderHint).toLowerCase();
  if (["male", "man", "male", "male", "man"].includes(raw)) return "male";
  if (["female", "woman", "female", "women", "woman"].includes(raw)) return "female";
  return "person";
}

export function normalizePromptMode(mode) {
  const raw = cleanText(mode).toLowerCase();
  if (raw === "positioning" || raw === "manual") return raw;
  return "regular";
}

function genderNounFor(genderHint) {
  const normalized = normalizeGenderHint(genderHint);
  if (normalized === "male") return "man";
  if (normalized === "female") return "woman";
  return "people";
}

function positionPrefixFor(position) {
  const normalized = normalizePosition(position);
  if (normalized === "left") return "left";
  if (normalized === "center") return "middle";
  if (normalized === "right") return "right";
  return "in";
}

export function describeSourceSubject(
  entry = {},
  index = 0,
  total = 1,
  promptMode = "regular",
  hasLocationGuideImage = true,
) {
  const markerLabel = cleanText(entry.markerLabel) || String.fromCharCode(65 + (index % 26));
  const customSource = cleanText(entry.sourceDescription);
  if (promptMode === "positioning") {
    const orderText =
      total > 1
        ? `From left to right${index + 1}items`
        : entry.position === "left"
          ? "left area"
          : entry.position === "right"
            ? "right area"
            : entry.position === "center"
              ? "middle area"
              : "in the screen";
    if (hasLocationGuideImage) {
      const detail = customSource ? `（${customSource}, positioning map${markerLabel}box)` : `(positioning map${markerLabel}box)`;
      return `Medium${orderText}${detail}characters`;
    }
    const detail = customSource ? `（${customSource}）` : "";
    return `Medium${orderText}${detail}characters`;
  }
  const prefix = positionPrefixFor(entry.position);
  const noun = genderNounFor(entry.genderHint);
  if (customSource) {
    if (
      customSource.startsWith("left") ||
      customSource.startsWith("right") ||
      customSource.startsWith("middle") ||
      customSource.startsWith("from left to right")
    ) {
      return `Medium${customSource}`;
    }
    return `${prefix}${customSource}`;
  }
  if (total > 3) {
    return `From left to right${index + 1}items${noun}`;
  }
  return `${prefix}${noun}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sanitizeMarkerColor(rawColor, fallbackIndex = 0) {
  const candidate = cleanText(rawColor);
  if (SAFE_HEX_COLOR_RE.test(candidate)) {
    return candidate;
  }
  const safeIdx = Math.abs(Math.trunc(Number(fallbackIndex) || 0)) % MARKER_HEX_COLORS.length;
  return MARKER_HEX_COLORS[safeIdx];
}

function normalizeBbox(bbox, index = 0, total = 1) {
  if (bbox && typeof bbox === "object") {
    const x = Number(bbox.x);
    const y = Number(bbox.y);
    const width = Number(bbox.width);
    const height = Number(bbox.height);
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return {
        x: Math.max(0, Math.min(0.95, x)),
        y: Math.max(0, Math.min(0.95, y)),
        width: Math.max(0.05, Math.min(1 - Math.max(0, x), width)),
        height: Math.max(0.05, Math.min(1 - Math.max(0, y), height)),
      };
    }
  }
  const slotWidth = Math.min(0.36, 0.78 / Math.max(1, total));
  const gap = (1 - slotWidth * Math.max(1, total)) / (Math.max(1, total) + 1);
  return {
    x: Number((gap + index * (slotWidth + gap)).toFixed(3)),
    y: 0.14,
    width: Number(slotWidth.toFixed(3)),
    height: 0.74,
  };
}

export function buildLocationGuideSvgDataUrl({ frame = {}, people = [] } = {}) {
  const svgWidth = 1200;
  const frameW = Number(frame?.width) > 0 ? Number(frame.width) : 16;
  const frameH = Number(frame?.height) > 0 ? Number(frame.height) : 9;
  const svgHeight = Math.max(1, Math.round((svgWidth * frameH) / frameW));

  const gridPaths = [0.25, 0.5, 0.75]
    .map(
      (ratio) =>
        `<path d="M${Math.round(svgWidth * ratio)} 0V${svgHeight} M0 ${Math.round(svgHeight * ratio)}H${svgWidth}"/>`,
    )
    .join("");

  const normalizedPeople = Array.isArray(people) ? people : [];
  const boxesMarkup = normalizedPeople
    .map((person, index) => {
      const label = cleanText(person?.label || person?.markerLabel) || String.fromCharCode(65 + (index % 26));
      const bbox = normalizeBbox(person?.bbox ?? person?.box, index, normalizedPeople.length);
      const x = Math.round(bbox.x * svgWidth);
      const y = Math.round(bbox.y * svgHeight);
      const w = Math.round(bbox.width * svgWidth);
      const h = Math.round(bbox.height * svgHeight);
      const color = sanitizeMarkerColor(person?.color, person?.markerIndex ?? index);
      return `<g data-person-label="${escapeXml(label)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="8"/><rect x="${x}" y="${y}" width="72" height="72" rx="8" fill="${color}"/><text x="${x + 36}" y="${y + 55}" text-anchor="middle" fill="#0f172a" font-family="Arial, sans-serif" font-size="56" font-weight="800">${escapeXml(label)}</text></g>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}"><rect width="100%" height="100%" fill="#090d16"/><g stroke="#ffffff" stroke-opacity="0.18" stroke-width="2">${gridPaths}</g>${boxesMarkup}</svg>`;
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: svgWidth,
    height: svgHeight,
    personCount: normalizedPeople.length,
  };
}

export function buildCharacterReplacementPackage(input = {}) {
  const promptMode = normalizePromptMode(input.promptMode);
  const removeSubtitlesAndLogo = input.removeSubtitlesAndLogo !== false;
  const hasLocationGuideImage =
    promptMode === "positioning" &&
    (input.hasLocationGuideImage === undefined
      ? true
      : Boolean(input.hasLocationGuideImage));

  const rawPeople =
    Array.isArray(input.people) && input.people.length > 0
      ? input.people
      : [
          {
            id: cleanText(input.personId) || "person-1",
            position: input.position ?? input.personPosition,
            genderHint: input.genderHint,
            sourceDescription: input.sourceDescription,
            targetDescription: input.targetDescription,
            replacementScope: input.replacementScope,
            bbox: input.bbox ?? input.box,
          },
        ];

  const bindings = rawPeople.slice(0, 8).map((person, index) => {
    const scope = normalizeReplacementScope(person?.replacementScope ?? input.replacementScope);
    const scopePhrase = SCOPE_MAP.get(scope) || "complete character";
    const position = normalizePosition(
      person?.position ?? person?.personPosition ?? input.position ?? input.personPosition,
    );
    const genderHint = normalizeGenderHint(person?.genderHint ?? input.genderHint);
    const markerLabel = cleanText(person?.markerLabel) || String.fromCharCode(65 + (index % 26));
    const referenceSlot = Number(person?.referenceSlot) > 1 ? Number(person.referenceSlot) : index + 2;
    const referenceLabel = `Figure${referenceSlot}`;
    const targetDescription = cleanText(person?.targetDescription ?? input.targetDescription);
    const sourceDescription = cleanText(person?.sourceDescription ?? input.sourceDescription);
    const bbox = normalizeBbox(person?.bbox ?? person?.box ?? input.bbox ?? input.box, index, rawPeople.length);

    return {
      personId: cleanText(person?.id) || `person-${index + 1}`,
      position,
      genderHint,
      markerLabel,
      referenceSlot,
      referenceLabel,
      replacementScope: scope,
      scopePhrase,
      sourceDescription,
      targetDescription,
      bbox,
    };
  });

  const locationGuideSlot = hasLocationGuideImage ? bindings.length + 2 : 0;
  const locationGuide =
    promptMode === "positioning"
      ? buildLocationGuideSvgDataUrl({
          frame: input.frame,
          people: bindings.map((item, idx) => ({
            label: item.markerLabel,
            markerIndex: idx,
            bbox: item.bbox,
          })),
        })
      : null;

  if (promptMode === "manual" && cleanText(input.manualPrompt)) {
    const manual = cleanText(input.manualPrompt);
    return {
      promptMode,
      prompt: manual,
      videoPrompt: compileVideoReplacementPrompt(input),
      bindings,
      locationGuide,
      locationGuideSlot,
    };
  }

  const lines = [];
  if (hasLocationGuideImage) {
    lines.push(
      `Task: Replace the characters specified in Figure 1 with the characters in the corresponding reference picture. Figure${locationGuideSlot}Positioning map for the character.`,
    );
  } else {
    lines.push("Task: Replace the corresponding characters in Figure 1 with the characters in the reference picture.");
  }

  for (let i = 0; i < bindings.length; i += 1) {
    const item = bindings[i];
    const subjectText = describeSourceSubject(
      item,
      i,
      bindings.length,
      promptMode,
      hasLocationGuideImage,
    );
    const targetDetail = item.targetDescription ? `（${item.targetDescription}）` : "";
    if (item.replacementScope === "full-person") {
      lines.push(`Put Figure 1${subjectText}Replace with${item.referenceLabel}characters in${targetDetail}, including appearance and clothing.`);
    } else {
      lines.push(
        `Put Figure 1${subjectText}of${item.scopePhrase}Replace with${item.referenceLabel}characters${targetDetail}corresponding part.`,
      );
    }
  }

  if (promptMode === "positioning") {
    lines.push(
      "Remove subtitles and LOGO from the screen. The position, size, posture and occlusion relationship of the original character are retained. Except for the subtitles and LOGO, the rest of the character and unspecified parts remain unchanged, and no extra painting or occluded parts are added.",
    );
    lines.push("The background and lighting remain the same.");
  } else {
    lines.push(
      "The position, size, posture and occlusion relationship of the original character are retained. Except for the subtitles and LOGO, the rest of the character and unspecified parts remain unchanged, and no extra painting or occluded parts are added.",
    );
    if (removeSubtitlesAndLogo) {
      lines.push("Remove subtitles and LOGO from the screen.");
    }
  }

  const prompt = lines.filter(Boolean).join("\n");
  return {
    promptMode,
    prompt,
    videoPrompt: compileVideoReplacementPrompt(input),
    bindings,
    locationGuide,
    locationGuideSlot,
  };
}

export function compileCharacterReplacementPrompt(input = {}) {
  return buildCharacterReplacementPackage(input).prompt;
}

export function compileVideoReplacementPrompt(input = {}) {
  const customVideoPrompt = cleanText(input.videoPrompt);
  if (customVideoPrompt) return customVideoPrompt;

  const position = normalizePosition(input.position ?? input.personPosition);
  const genderHint = normalizeGenderHint(input.genderHint);
  const sourceDesc = cleanText(input.sourceDescription);
  const targetDesc = cleanText(input.targetDescription);
  const extraNotes = cleanText(input.extraNotes);
  const scope = normalizeReplacementScope(input.replacementScope);
  const scopePhrase = SCOPE_MAP.get(scope) || "complete character";

  const subject = describeSourceSubject(
    { position, genderHint, sourceDescription: sourceDesc },
    0,
    1,
    "regular",
  ).replace(/^中/, "");

  const targetClause = targetDesc ? `Refer to the target person in the picture (${targetDesc}）` : "Refer to the corresponding person in the picture";
  const scopeClause =
    scope === "full-person"
      ? `Replace the original video${subject}Completely replace with${targetClause}`
      : `Replace the original video${subject}of${scopePhrase}Replace with${targetClause}corresponding part of`;
  const extraClause = extraNotes ? `，${extraNotes}` : "";

  return `${scopeClause}${extraClause}, strictly keeping the original video's camera movements, character action rhythm, hand-held props, scene lighting and shadows, and other characters in the picture completely unchanged.`;
}

export function buildTimelineRangeReplacement({
  fullVideoNodeId,
  fullDurationMs,
  replacements = [],
  keepOriginalAudio = false,
  existingTimeline = null,
  output = undefined,
} = {}) {
  const sourceNodeId = cleanText(fullVideoNodeId);
  const totalMs = Math.round(Number(fullDurationMs));
  if (!sourceNodeId) {
    throw new Error("The original full video node ID (fullVideoNodeId) is missing");
  }
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new Error("The total duration of the original full video (fullDurationMs) must be an integer of milliseconds greater than 0");
  }
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error("At least 1 replacement lens interval (replacements) needs to be provided");
  }

  const normalized = replacements
    .map((item, idx) => {
      const nodeId = cleanText(item?.nodeId || item?.replacedVideoNodeId);
      const startMs = Math.round(Number(item?.startMs));
      const endMs = Math.round(Number(item?.endMs));
      const sourceDurationMs = Math.round(Number(item?.sourceDurationMs));
      if (!nodeId) {
        throw new Error(`No.${idx + 1} Replacement intervals are missing replacement video node IDs`);
      }
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
        throw new Error(`No.${idx + 1} replacement interval time range is invalid (${startMs}ms ~ ${endMs}ms）`);
      }
      if (endMs > totalMs) {
        throw new Error(`No.${idx + 1} replacement interval end time (${endMs}ms) exceeds the total duration of the film (${totalMs}ms）`);
      }
      const durationMs = endMs - startMs;
      return {
        nodeId,
        startMs,
        endMs,
        durationMs,
        sourceDurationMs:
          Number.isFinite(sourceDurationMs) && sourceDurationMs >= durationMs ? sourceDurationMs : durationMs,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].startMs < normalized[i - 1].endMs) {
      throw new Error(
        `Replacement intervals cannot overlap: interval${i}（${normalized[i - 1].startMs}~${normalized[i - 1].endMs}ms) and interval${i + 1}（${normalized[i].startMs}~${normalized[i].endMs}ms) conflict`,
      );
    }
  }

  const videoTrackId = "track-video-main";
  const audioTrackId = "track-audio-original";
  const managedTrackIds = new Set([videoTrackId, audioTrackId]);

  const tracks = [
    {
      id: videoTrackId,
      kind: "video",
      label: "Video main track",
      order: 0,
      visible: true,
      muted: Boolean(keepOriginalAudio),
    },
  ];

  const clips = [];
  let cursorMs = 0;
  let clipIndex = 1;

  for (const rep of normalized) {
    if (rep.startMs > cursorMs) {
      const gapMs = rep.startMs - cursorMs;
      clips.push({
        id: `clip-orig-${clipIndex++}`,
        kind: "video",
        trackId: videoTrackId,
        nodeId: sourceNodeId,
        startMs: cursorMs,
        durationMs: gapMs,
        sourceStartMs: cursorMs,
        sourceDurationMs: totalMs,
      });
    }
    clips.push({
      id: `clip-rep-${clipIndex++}`,
      kind: "video",
      trackId: videoTrackId,
      nodeId: rep.nodeId,
      startMs: rep.startMs,
      durationMs: rep.durationMs,
      sourceStartMs: 0,
      sourceDurationMs: rep.sourceDurationMs,
    });
    cursorMs = rep.endMs;
  }

  if (cursorMs < totalMs) {
    clips.push({
      id: `clip-orig-${clipIndex++}`,
      kind: "video",
      trackId: videoTrackId,
      nodeId: sourceNodeId,
      startMs: cursorMs,
      durationMs: totalMs - cursorMs,
      sourceStartMs: cursorMs,
      sourceDurationMs: totalMs,
    });
  }

  if (keepOriginalAudio) {
    tracks.push({
      id: audioTrackId,
      kind: "audio",
      label: "original film soundtrack",
      order: 1,
      visible: true,
      muted: false,
    });
    clips.push({
      id: "clip-orig-full-audio",
      kind: "audio",
      trackId: audioTrackId,
      nodeId: sourceNodeId,
      startMs: 0,
      durationMs: totalMs,
      sourceStartMs: 0,
      sourceDurationMs: totalMs,
    });
  }

  // Merge preserved non-video tracks (subtitles, extra BGM/audio, text overlays) from existingTimeline
  if (existingTimeline && typeof existingTimeline === "object") {
    const prevTracks = Array.isArray(existingTimeline.tracks) ? existingTimeline.tracks : [];
    const prevClips = Array.isArray(existingTimeline.clips) ? existingTimeline.clips : [];
    const preservedTrackIds = new Set();

    for (const track of prevTracks) {
      if (!track || typeof track !== "object") continue;
      const trackId = cleanText(track.id);
      if (!trackId || managedTrackIds.has(trackId) || track.kind === "video") continue;
      preservedTrackIds.add(trackId);
      tracks.push({
        ...track,
        order: typeof track.order === "number" ? Math.max(tracks.length, track.order) : tracks.length,
      });
    }

    for (const clip of prevClips) {
      if (!clip || typeof clip !== "object") continue;
      if (preservedTrackIds.has(cleanText(clip.trackId))) {
        clips.push({ ...clip });
      }
    }
  }

  const timeline = {
    version: 2,
    durationMs: totalMs,
    tracks,
    clips,
  };
  const resolvedOutput = output !== undefined ? output : existingTimeline?.output;
  if (resolvedOutput !== undefined) {
    timeline.output = resolvedOutput;
  }
  return timeline;
}
