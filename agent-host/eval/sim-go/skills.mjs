// 技能：载入内置短剧技能、skill.* 操作、按画布和会话记录的活动技能上下文。

import { clone, sha256Hex, invalidArg, notFound, conflict } from './common.mjs';
import { ensureCanvas } from './canvas-store.mjs';

// 评测专用的短剧技能，产品里没有发布这个技能，评测只用这一份。不从仓库外读文件，
// 否则评测输入会随检出位置变化。改正文会改变 S6、S8 的请求体，要附改动前后对照。
const SHORT_DRAMA_SKILL_MD = `---
name: Short play storyboarded to the first frame
version: "2"
description: Place a short play script or synopsis on the canvas in four steps: "Character Settings → Storyboard → First Frame → Video". After each step, stop and wait for confirmation before moving on to the next step. Suitable for single-episode production of vertical screen short plays and comics.
---

# Storyboard the short play to the first frame

It is suitable for users to choose this skill or explicitly request to produce a short drama. Users only need a single picture, a single video, or when the scope is narrowed down midway, it will be completed according to the latest requirements, without adding pre-steps such as the entire episode script or character confirmation.

There are four steps in total for complete production, follow them in order. Only do this step at each step. After finishing it, tell the user in one or two sentences what is added to the canvas and what needs to be confirmed, and then stop. Only after the user confirms or proposes modifications will they proceed to the next step. When continuing, first read the current canvas and use the existing nodes, storyboard lines and generated results to avoid repeated creation or repeated charges.

## Step 0: Confirm basic information
1. Script or synopsis (required)
2. Frame: portrait 9:16 or landscape 16:9 (default portrait 9:16)
3. Picture style: such as realistic movie feel, Japanese animation, Chinese style ink (default is realistic movie feel)
4. Target duration of this episode (default 60 seconds)

## Step 1: Character Settings
- Create a Markdown node on the canvas with the title "Character Settings".
- This step does not create image nodes and does not mention generation.

## Step 2: Storyboard
- Create a storyboard script node (script type) with the title "Storyboard Script" and add storyboard lines to it.
- Only fill in the core fields for each shot: plot description (plotDescription), first frame picture prompt word (imageGenerationPrompt), video prompt word (videoMotionPrompt), fill in the lines when there is dialogue (dialogue), fill in the duration when there is a clear shot length requirement (durationSeconds, the default is 6 seconds); do not fill in redundant fields such as scene, camera position, emotion, etc. that are not listed in the tool parameters.
- This step does not create image nodes and does not mention generation.

## Step 3: First frame
- Only create picture nodes for the shots that have been confirmed by the user, with the title "shot N first frame" and the content using the first frame picture prompt of the shot.
- The frame of each image node is set to the frame determined in step 0, and the generated quantity is 1.
- After creating the node, use canvas_script_row_update to write the image node ID to the imageNodeId of the corresponding row; use the real node and row ID returned by the create and append operations. The generation plan can only be proposed after the binding is successful.
- Maximum of 4 sheets in one batch. When there are more than 4 shots, do the first 4 first and tell the user to do the rest in the next batch.
- After the construction is completed, a generation proposal will be made for this batch, and the user will be informed that generation and billing will only start after confirmation in the panel.

## Step 4: Video
- Only do this after the corresponding first frame image has been generated and confirmed by the user.
- Create a video node for each confirmed shot, with the title "Screen N Video", use this line of videoMotionPrompt as the content, and connect the first frame graph node of the shot to the video node as a reference.
- Use canvas_script_row_update to write the video node ID to the videoNodeId of the corresponding row; confirm that the first frame and video are bound to the same storyboard row.
- The maximum number of batches is 4. Stop after making a proposal and wait for user confirmation.
`;

function parseSkillMarkdown(raw, skillId = 'short-drama-storyboard', versionId = 'v2') {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  let name = skillId;
  let version = '2';
  let description = '';
  let body = normalized;
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(normalized);
  if (match) {
    const frontmatter = match[1];
    body = match[2].trim();
    for (const line of frontmatter.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'name') name = val;
      if (key === 'version') version = val;
      if (key === 'description') description = val;
    }
  }
  const contentHash = sha256Hex(body);
  return {
    pin: { skillId, versionId, contentHash },
    name,
    version,
    description,
    instruction: body,
    files: [],
    unsupportedCapabilities: [],
  };
}

export function loadBuiltinSkill() {
  return parseSkillMarkdown(SHORT_DRAMA_SKILL_MD, 'short-drama-storyboard', 'v2');
}

export const SKILL_OPS = {
  'skill.catalog': (state, rawParams) => {
    const idFilter = String(rawParams.id || '').trim();
    const qFilter = String(rawParams.q || '').trim().toLowerCase();
    const offset = Math.max(0, Number(rawParams.offset || 0));
    const limit = Math.min(50, Math.max(1, Number(rawParams.limit || 50)));
    const allItems = [...state.skills.values()]
      .filter((s) => s.catalogVisible !== false)
      .filter((s) => (!idFilter || s.pin.skillId === idFilter) && (!qFilter || `${s.name}\n${s.description}`.toLowerCase().includes(qFilter)))
      .map((s) => ({
        pin: clone(s.pin),
        name: s.name,
        version: s.version,
        description: s.description,
      }));
    return {
      skills: allItems.slice(offset, offset + limit),
      total: allItems.length,
      offset,
      limit,
    };
  },
  'skill.get': (state, rawParams) => {
    if (rawParams.path) throw invalidArg('unexpected_path', 'Text read does not accept file path');
    const skill = state.skills.get(String(rawParams.skillId || ''));
    if (!skill || skill.pin.versionId !== rawParams.versionId || skill.pin.contentHash !== rawParams.contentHash) {
      throw notFound('skill_version_unavailable', 'The skill version does not exist or has expired');
    }
    return clone(skill);
  },
  'skill.file': (state, rawParams) => {
    const filePath = String(rawParams.path || '').trim();
    if (!filePath) throw invalidArg('skill_path_required', 'Auxiliary file reading requires the path within the package');
    const skill = state.skills.get(String(rawParams.skillId || ''));
    if (!skill || skill.pin.versionId !== rawParams.versionId || skill.pin.contentHash !== rawParams.contentHash) {
      throw notFound('skill_version_unavailable', 'The skill version does not exist or has expired');
    }
    const file = (skill.files || []).find((f) => f.path === filePath);
    if (!file) throw notFound('skill_file_unavailable', `Skill file does not exist:${filePath}`);
    return {
      pin: clone(skill.pin),
      file: { path: file.path, size: Buffer.byteLength(file.content || '', 'utf8') },
      content: file.content || '',
      executionSupported: false,
    };
  },
};

export function getOrInitSkillContext(state, canvasId, sessionId = 'default') {
  ensureCanvas(state, canvasId);
  const key = `${canvasId}::${sessionId || 'default'}`;
  if (!state.skillContexts.has(key)) {
    state.seq.scope += 1;
    state.skillContexts.set(key, {
      canvasId,
      sessionId: sessionId || 'default',
      scopeId: `scope-${state.seq.scope.toString(16).padStart(8, '0')}`,
      revision: 0,
      activePins: [],
      lifecycle: 'active',
    });
  }
  return state.skillContexts.get(key);
}

export function changeSkillContext(state, canvasId, body = {}) {
  const sessionId = String(body.sessionId || 'default');
  const ctx = getOrInitSkillContext(state, canvasId, sessionId);
  const action = String(body.action || 'activate');
  const expectedRevision = body.expectedRevision !== undefined ? Number(body.expectedRevision) : ctx.revision;
  const requestId = String(body.requestId || `req-${Date.now()}`);

  if (action === 'ack_reset') {
    if (ctx.revision !== expectedRevision || (body.scopeId && ctx.scopeId !== body.scopeId)) {
      throw conflict('skill_context_revision_conflict', 'Independent task status has changed');
    }
    ctx.lifecycle = 'active';
    return clone(ctx);
  }

  const receiptKey = `${canvasId}::${sessionId}::${requestId}`;
  const digest = sha256Hex(JSON.stringify({ action, pins: body.pins || [] }));
  if (state.skillContextReceipts.has(receiptKey)) {
    const prior = state.skillContextReceipts.get(receiptKey);
    if (prior.digest !== digest) {
      throw conflict('skill_context_request_conflict', 'The same request ID has been used for different skill operations');
    }
    return clone(prior.result);
  }

  if (ctx.lifecycle !== 'active') {
    throw conflict('skill_scope_reset_pending', 'The independent task is being prepared, please retry the original request.');
  }
  if (expectedRevision !== ctx.revision) {
    throw conflict('skill_context_revision_conflict', 'The skill status has changed, please refresh and try again.');
  }

  const incomingPins = Array.isArray(body.pins) ? body.pins : [];
  if (incomingPins.length > 4) {
    throw invalidArg('skill_selection_limit', 'Use up to 4 skills');
  }
  if (action === 'activate') {
    ctx.activePins = clone(incomingPins);
  } else if (action === 'clear') {
    ctx.activePins = [];
  } else if (action === 'new_scope') {
    state.seq.scope += 1;
    ctx.scopeId = `scope-${state.seq.scope.toString(16).padStart(8, '0')}`;
    ctx.activePins = clone(incomingPins);
    ctx.lifecycle = 'reset_pending';
  } else if (action !== 'refresh') {
    throw invalidArg('invalid_skill_context_action', 'Skill operation is invalid');
  }
  ctx.revision += 1;
  const snapshot = clone(ctx);
  state.skillContextReceipts.set(receiptKey, { digest, result: snapshot });
  return snapshot;
}

export function registerSkill(state, skillDef) {
  const pin = skillDef.pin || {
    skillId: skillDef.skillId || skillDef.id,
    versionId: skillDef.versionId || 'v1',
    contentHash: skillDef.contentHash || sha256Hex(skillDef.instruction || ''),
  };
  const record = {
    pin,
    name: skillDef.name || pin.skillId,
    version: String(skillDef.version || '1'),
    description: String(skillDef.description || ''),
    instruction: String(skillDef.instruction || ''),
    files: Array.isArray(skillDef.files) ? clone(skillDef.files) : [],
    unsupportedCapabilities: Array.isArray(skillDef.unsupportedCapabilities) ? clone(skillDef.unsupportedCapabilities) : [],
    // 测评专用技能可以只按 pin 加载正文、不进入系统提示词的技能目录，避免撑大普通会话的头部预算。
    catalogVisible: skillDef.catalogVisible !== false,
  };
  state.skills.set(pin.skillId, record);
  return clone(record);
}

export function getSkillPin(state, skillId = 'short-drama-storyboard') {
  const s = state.skills.get(skillId);
  return s ? clone(s.pin) : null;
}
