// S8–S11：来自真实用户会话的四类失败场景定义与检查项。
// 计分只使用画布节点字段、生成方案、opLog 与回合记录；回复原文只作 detail 诊断。
// 假模型脚本仍在 ../scenarios.mjs 的 createFakeModelServer 内，按场景文本分支。

import { clone, isPortrait916 } from './shared.mjs';

// S9 用用户点名的资产实体判定节点主体，不再从自由文本里猜关键词。
const CHARACTER_NAMES = ['Lin Xi', 'Chen Ye', 'Jiangmo', 'Su Wei'];
const PROP_NAMES = ['old pocket watch', 'energy bracelet'];
const SCENE_NAMES = ['rooftop', 'laboratory', 'playground'];

function nodeAssetText(node) {
  return `${node?.title || ''} ${node?.metadata?.prompt || ''} ${node?.metadata?.composerContent || ''}`;
}
function nodeHasName(node, names) {
  const text = nodeAssetText(node);
  return names.some((name) => text.includes(name));
}
// 含主角名按角色算（角色设定图可以带道具）；只含道具/场景名才算道具或场景。
function namedAssetKind(node) {
  if (nodeHasName(node, CHARACTER_NAMES)) return 'character';
  if (nodeHasName(node, PROP_NAMES)) return 'prop';
  if (nodeHasName(node, SCENE_NAMES)) return 'scene';
  return 'unknown';
}
function targetAssetKind(target) {
  return namedAssetKind({ title: target?.title, metadata: { prompt: target?.prompt || '' } });
}

// 规范化参数键：对象键排序后再序列化，避免只换键顺序就绕过同参数重试判断。
function canonicalParamJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalParamJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalParamJson(value[key])}`)
      .join(',')}}`;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}
function paramSignature(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return canonicalParamJson(JSON.parse(trimmed));
    } catch {
      return `raw:${trimmed}`;
    }
  }
  return canonicalParamJson(value);
}

// 判断参数里是否引用了目标节点 ID；用于「没动节点」类检查，不手工维护写操作白名单。
function paramsReferenceNode(value, nodeId) {
  if (typeof value === 'string') return value === nodeId;
  if (Array.isArray(value)) return value.some((item) => paramsReferenceNode(item, nodeId));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => paramsReferenceNode(item, nodeId));
  }
  return false;
}

function readOnlyOpIds(simGo) {
  return new Set((simGo.descriptors || [])
    .filter((descriptor) => descriptor.readOnly)
    .map((descriptor) => descriptor.id));
}

// 草稿节点本轮不应被任何任务交付改写，因此快照比较不排除任何字段。
function nodeSnapshot(node) {
  return node ? canonicalParamJson(node) : null;
}

// 测评专用技能：第 1 批只做角色确认稿，每批最多 4 张，做完停下等确认。
const ASSET_BATCHING_SKILL_MD = `---
name: Asset production in batches
version: "1"
description: The assets of the campus science fiction short drama are produced in batches. The first batch only contains character confirmation drafts, with a maximum of 4 pictures per batch, and no props or scenes are mixed in.
---

# Assets are produced in batches

Produce them in batches in the order of characters, props, and scenes, and do not mix different types of assets in the same batch.

## Batch 1: Character Confirmation Draft
- Only characters, no props, scenes or storyboards.
- Maximum of 4 sheets per batch.
- Create a picture node for each character, and the title indicates that this is the character.
- Stop after finishing this batch, submit a generation plan of no more than 4 pictures, and wait for user confirmation.
- The next batch will start only after the user confirms.`;

export const REAL_FAILURE_SCENARIOS = [
  {
    id: 'single-image-against-skill',
    code: 'S8',
    aliases: ['S8', 's8'],
    name: 'The first frame of an S8 single is not biased by storyboard skills',
    description: 'The "Short Play Storyboarding to the First Frame" skill has been selected, but the user only wants the first frame of a vertical screen; the assertion only creates 1 image node, 9:16 and count=1. The plan only contains this node and does not add script/storyboard/character nodes.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      return { beforeCanvas: clone(doc), skillPin: simGo.getSkillPin('short-drama-storyboard') };
    },
    turns: [
      {
        id: 'turn-s8-1',
        useActiveSkillPins: true,
        message:
          'This time I only made the first frame of a vertical screen Japanese anime style picture: on the rooftop after school, the girl looks back. 9:16, only one picture is needed, stop after building the nodes and generating the plan, no need to go through the storyboarding process.',
      },
    ],
    evaluate({ simGo, canvasId, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const imageNodes = nodes.filter((n) => n.type === 'image');
      const nonImageNodes = nodes.filter((n) => n.type !== 'image');
      const turnId = turnRecords?.[0]?.turnId;
      const turnOps = (snap.opLog || []).filter((op) => op.turnId === turnId);
      const proposalOps = turnOps.filter((op) => op.op === 'canvas.generation.propose' && op.status === 'ok');
      // S8 只接受恰好一份成功方案；多份方案不算「以提案结束」。
      const proposalOp = proposalOps.length === 1 ? proposalOps[0] : null;
      const targets = proposalOp?.result?.targets || [];
      const target = targets[0];

      const sizeValue = String(imageNodes[0]?.metadata?.size || '').trim().toLowerCase();
      const countValue = Number(imageNodes[0]?.metadata?.count ?? 1);
      const portrait916 = isPortrait916(sizeValue);
      const onlyNodeProposed =
        targets.length === 1 && target.nodeId === imageNodes[0]?.id;
      const targetCount = Number(target?.parameters?.count ?? 1);
      const proposalUsesPortrait = isPortrait916(target?.parameters?.size) && targetCount === 1;
      // 方案提交后本轮不应再写这个节点，避免先提错方案再改回正确参数。
      const readOnlyOps = readOnlyOpIds(simGo);
      const proposalIndex = proposalOp ? turnOps.indexOf(proposalOp) : -1;
      const laterTargetWrites = proposalIndex >= 0
        ? turnOps.slice(proposalIndex + 1).filter((op) =>
          (op.status === 'ok' || op.status === 'replayed') &&
          op.op !== 'canvas.generation.propose' &&
          !readOnlyOps.has(op.op) &&
          paramsReferenceNode(op.params, imageNodes[0]?.id))
        : [];

      const checks = [
        {
          name: 'exactly_one_image_node',
          passed: nodes.length === 1 && imageNodes.length === 1,
          detail: `Total number of nodes =${nodes.length},image node=${imageNodes.length}(Expect 1)`,
        },
        {
          name: 'portrait_9x16_count_one',
          passed: portrait916 && countValue === 1,
          detail: `Node final size=${imageNodes[0]?.metadata?.size || 'not set'}，count=${imageNodes[0]?.metadata?.count ?? 'not set'}`,
        },
        {
          name: 'proposal_targets_only_that_node',
          passed: onlyNodeProposed,
          detail: `Solution targets=${JSON.stringify(targets.map((item) => item.nodeId))}(Expect only${imageNodes[0]?.id || 'The image node'}）`,
        },
        {
          name: 'proposal_uses_9x16_count_one',
          passed: proposalUsesPortrait,
          detail: `The node size= when the plan is submitted${target?.parameters?.size ?? 'Not recorded'}，count=${target?.parameters?.count ?? 'Not recorded (press 1)'}`,
        },
        {
          name: 'no_node_write_after_proposal',
          passed: Boolean(proposalOp) && laterTargetWrites.length === 0,
          detail: `Successful non-read-only operations referencing the node after the plan is submitted =${laterTargetWrites.map((op) => op.op).join(', ') || 'None'}`,
        },
        {
          name: 'no_storyboard_or_text_nodes_added',
          passed: nonImageNodes.length === 0,
          detail: `non-image node=${nonImageNodes.map((n) => `${n.type}:${n.title}`).join(', ') || 'None'}`,
        },
      ];

      return { passed: checks.every((check) => check.passed), status: checks.every((check) => check.passed) ? 'passed' : 'failed', checks };
    },
  },

  {
    id: 'skill-batch-limit',
    code: 'S9',
    aliases: ['S9', 's9'],
    name: 'S9 skill batch upper limit: only a maximum of 4 characters can be made in the first batch',
    description: 'After selecting the "Asset Batch Production" skill, name the protagonists Lin Xi, Chen Ye, Jiang Mo, and Su Wei, the props old pocket watch, energy bracelet, scene rooftop, laboratory, and playground; assert that only character image nodes will be built in this round and no more than 4, and no props/scenes will be mixed in. The total target and count of each plan at the time of submission shall not exceed 4.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId);
      const skill = simGo.registerSkill({
        skillId: 'asset-batching',
        versionId: 'v1',
        name: 'Assets are produced in batches',
        version: '1',
        description: 'Campus science fiction short drama assets are produced in batches: the first batch only contains character confirmation drafts, with a maximum of 4 photos per batch, and no props or scenes are mixed in.',
        instruction: ASSET_BATCHING_SKILL_MD,
        // 只按 pin 选择并加载，不进入技能目录；目录属于系统头部预算，测评技能不应把它撑大。
        catalogVisible: false,
      });
      return { beforeCanvas: clone(doc), skillPin: skill.pin };
    },
    turns: [
      {
        id: 'turn-s9-1',
        useActiveSkillPins: true,
        message:
          'I chose the asset batch production skill. Help me create the assets for the campus science fiction short drama: the protagonists Lin Xi, Chen Ye, Jiang Mo, and Su Wei; props old pocket watches and energy bracelets; scene rooftops, laboratories, and playgrounds.',
      },
    ],
    evaluate({ simGo, canvasId, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const imageNodes = nodes.filter((n) => n.type === 'image');
      const nonImageNodes = nodes.filter((n) => n.type !== 'image');
      // 只用用户点名的资产实体判定：含主角名算角色，只含道具/场景名算道具或场景。
      const nonCharacterNodes = imageNodes.filter((n) => namedAssetKind(n) !== 'character');
      const propOrSceneNodes = nodes.filter((n) => ['prop', 'scene'].includes(namedAssetKind(n)));
      const proposals = snap.proposals.filter((p) => p.canvasId === canvasId);
      const turnId = turnRecords?.[0]?.turnId;
      const proposalOps = (snap.opLog || []).filter((op) =>
        op.turnId === turnId && op.op === 'canvas.generation.propose' && op.status === 'ok');
      // 方案对错看提交时的 targets 标题与提示词，不能只看节点最终被改成什么。
      const submittedTargets = proposalOps.flatMap((op) => op.result?.targets || []);
      const submittedNonCharacterTargets = submittedTargets.filter((target) => targetAssetKind(target) !== 'character');
      const submittedPropOrSceneTargets = submittedTargets.filter((target) =>
        ['prop', 'scene'].includes(targetAssetKind(target)));
      // 每份方案按提交时的 targets 与 count 累加；同一节点出现在两份方案里就算两次。
      const submittedPlanImageCounts = proposalOps.length
        ? proposalOps.map((op) => (op.result?.targets || []).reduce(
          (sum, target) => sum + Number(target.parameters?.count ?? 1),
          0,
        ))
        : proposals.map((proposal) => proposal.nodeIds.reduce((sum, id) => {
          const node = nodes.find((n) => n.id === id);
          return sum + Number(node?.metadata?.count ?? 1);
        }, 0));
      const totalPlannedImages = submittedPlanImageCounts.reduce((sum, count) => sum + count, 0);
      const proposalsWithinLimit = submittedPlanImageCounts.length >= 1 && totalPlannedImages <= 4;

      const checks = [
        {
          name: 'only_character_image_nodes_at_most_four',
          // 最终节点和方案提交时的 targets 都必须是点名主角。
          passed: imageNodes.length >= 1 && imageNodes.length <= 4 && nonImageNodes.length === 0 &&
            nonCharacterNodes.length === 0 && submittedNonCharacterTargets.length === 0,
          detail: `image node=${imageNodes.length}(expected 1..4), non-image nodes=${nonImageNodes.length}, the final non-role subject =${nonCharacterNodes.map((n) => n.title).join(', ') || 'None'}, non-role target = when submitting the plan${submittedNonCharacterTargets.map((t) => t.title).join(', ') || 'None'}`,
        },
        {
          name: 'no_prop_or_scene_nodes',
          passed: propOrSceneNodes.length === 0 && submittedPropOrSceneTargets.length === 0,
          detail: `Final props/scene body =${propOrSceneNodes.map((n) => n.title).join(', ') || 'None'}, props/scene target = when submitting the plan${submittedPropOrSceneTargets.map((t) => t.title).join(', ') || 'None'}`,
        },
        {
          name: 'proposal_within_batch_limit',
          passed: proposalsWithinLimit,
          detail: `Number of plans =${submittedPlanImageCounts.length}(Expect at least 1), the total number of pictures of each plan according to count when submitted =${totalPlannedImages}(Expect no more than 4)`,
        },
        {
          name: 'stopped_after_first_batch',
          passed: turnRecords?.length === 1 && !turnRecords[0]?.error,
          detail: `Number of rounds=${turnRecords?.length || 0},reply=${String(turnRecords?.[0]?.reply || '').slice(0, 120)}`,
        },
      ];

      return { passed: checks.every((check) => check.passed), status: checks.every((check) => check.passed) ? 'passed' : 'failed', checks };
    },
  },

  {
    id: 'proposal-follows-node-settings',
    code: 'S10',
    aliases: ['S10', 's10'],
    name: 'S10 generation plan parameters are subject to the current value of the node',
    description: 'The user requested to resubmit the plan after changing the size of the draft diagram from 16:9 to 1:1 in the interface; in this round, except for read-only operations and generating plans, any successful operation that references the node ID will fail. The node snapshot (including the media field) must be consistent with the setup, and the plan parameters must be consistent with the current value of the node.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const seed = {
        id: canvasId,
        title: 'Square revision canvas',
        revision: 3,
        nodes: [
          {
            id: 'node-s10-image',
            type: 'image',
            title: 'Character poster draft',
            position: { x: 120, y: 160 },
            width: 720,
            height: 405,
            metadata: {
              content: '',
              prompt: 'Poster of people on the street on a rainy night, cinematic and realistic',
              composerContent: 'Poster of people on the street on a rainy night, cinematic and realistic',
              status: 'idle',
              model: 'seedream-3.0',
              size: '16:9',
              count: 1,
            },
          },
        ],
        connections: [],
        timeline: null,
      };
      const doc = simGo.ensureCanvas(canvasId, seed);
      // 模拟用户在界面里把尺寸改成 1:1，节点版本随之前进。
      doc.nodes[0].metadata.size = '1:1';
      doc.revision += 1;
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s10-1',
        message: 'I changed the picture to a square on the canvas, and regenerated the plan for me according to the current settings of the nodes, leaving the nodes untouched.',
      },
    ],
    evaluate({ simGo, canvasId, setupState, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = snap.canvases[canvasId] || { nodes: [], connections: [] };
      const nodes = doc.nodes || [];
      const node = nodes.find((n) => n.id === 'node-s10-image');
      const beforeNode = setupState?.beforeCanvas?.nodes?.find((n) => n.id === 'node-s10-image');
      const turnId = turnRecords?.[0]?.turnId;
      const turnOps = (snap.opLog || []).filter((op) => op.turnId === turnId);
      // 默认拒绝：凡是 params 引用了目标节点 ID 的成功操作，只要不是描述符里的只读操作，
      // 且不是生成方案，就判为动了节点。不手工维护写操作白名单。
      const readOnlyOps = readOnlyOpIds(simGo);
      const successfulTargetOps = turnOps.filter((op) =>
        (op.status === 'ok' || op.status === 'replayed') &&
        op.op !== 'canvas.generation.propose' &&
        !readOnlyOps.has(op.op) &&
        paramsReferenceNode(op.params, node?.id));
      const proposals = snap.proposals.filter((p) => p.canvasId === canvasId);
      const proposalOp = turnOps.find((op) => op.op === 'canvas.generation.propose' && op.status === 'ok');
      const targets = proposalOp?.result?.targets || [];
      const parametersMatchNode =
        targets.length === 1 &&
        targets[0].nodeId === node?.id &&
        (targets[0].parameters?.size === undefined || targets[0].parameters.size === String(node?.metadata?.size)) &&
        (targets[0].parameters?.count === undefined || targets[0].parameters.count === String(node?.metadata?.count));
      const nodeUnchanged = Boolean(beforeNode) && nodeSnapshot(beforeNode) === nodeSnapshot(node);

      const checks = [
        {
          name: 'no_node_write_in_turn',
          passed: successfulTargetOps.length === 0,
          detail: `Successful non-read-only operations referencing the target node this round =${successfulTargetOps.map((op) => op.op).join(', ') || 'None'}(The read-only determination comes from the operation descriptor)`,
        },
        {
          name: 'single_proposal_only_existing_node',
          passed: proposals.length === 1 &&
            proposals[0].nodeIds.length === 1 &&
            proposals[0].nodeIds[0] === node?.id &&
            nodes.length === 1,
          detail: `Number of proposals=${proposals.length}, node=${JSON.stringify(proposals[0]?.nodeIds || [])}, number of canvas nodes =${nodes.length}`,
        },
        {
          name: 'proposal_parameters_match_node',
          passed: parametersMatchNode,
          detail: `Plan parameters=${JSON.stringify(targets[0]?.parameters || null)}, node current value=size:${node?.metadata?.size}/count:${node?.metadata?.count}`,
        },
        {
          name: 'node_unchanged_in_turn',
          // 草稿节点本轮不应被任何任务交付改写，因此整份节点快照（含媒体字段）都必须与 setup 时一致。
          passed: nodeUnchanged && node?.metadata?.size === '1:1' && Number(node?.metadata?.count) === 1,
          detail: `Same node as setup time=${nodeUnchanged}，size=${node?.metadata?.size || 'Missing'}，count=${node?.metadata?.count ?? 'Missing'}`,
        },
      ];

      return { passed: checks.every((check) => check.passed), status: checks.every((check) => check.passed) ? 'passed' : 'failed', checks };
    },
  },

  {
    id: 'recover-from-tool-error',
    code: 'S11',
    aliases: ['S11', 's11'],
    name: 'Correct recovery after S11 tool missing parameters error',
    description: 'There is a generated image on the canvas; media.inspect for the image for the first time in this round returns a recoverable stale_media_version. It is required that the review with the correct current version is successful (overview is not considered completed), the same set of normalized error parameters is not repeated, and the round is completed without errors.',
    capabilities: [],
    expectedBaselinePass: true,
    setup(simGo, canvasId) {
      const seed = {
        id: canvasId,
        title: 'hand inspection canvas',
        revision: 2,
        nodes: [
          {
            id: 'node-s11-image',
            type: 'image',
            title: 'Character close-up',
            position: { x: 120, y: 160 },
            width: 720,
            height: 405,
            metadata: {
              content: '/api/resources/res-s11-seed/file',
              prompt: 'Realistic portrait close-up, with hands naturally placed in front of the body',
              composerContent: 'Realistic portrait close-up, with hands naturally placed in front of the body',
              status: 'success',
              size: '9:16',
              count: 1,
              resourceId: 'res-s11-seed',
              assetId: 'asset-s11-seed',
              mimeType: 'image/png',
              taskStatus: 'succeeded',
            },
          },
        ],
        connections: [],
        timeline: null,
      };
      const doc = simGo.ensureCanvas(canvasId, seed);
      simGo.resources.set('res-s11-seed', {
        id: 'res-s11-seed',
        assetId: 'asset-s11-seed',
        kind: 'image',
        mimeType: 'image/png',
        width: 720,
        height: 1280,
        durationMs: 0,
        version: 'v1-res-s11-seed',
        prompt: 'Realistic portrait close-up, with hands naturally placed in front of the body',
        reviewNote: '',
      });
      // 节点声明了 assetId，素材表也必须能按素材 ID 读取；结构照 sim-go 任务交付时建 asset 的写法。
      simGo.assets.set('asset-s11-seed', {
        id: 'asset-s11-seed',
        name: doc.nodes[0].title,
        kind: 'image',
        resourceId: 'res-s11-seed',
        mimeType: 'image/png',
        width: 720,
        height: 1280,
        prompt: 'Realistic portrait close-up, with hands naturally placed in front of the body',
        reviewNote: '',
        generated: true,
        payloadJson: JSON.stringify({ resourceId: 'res-s11-seed', storageKey: 'resource:res-s11-seed' }),
        createdAt: new Date().toISOString(),
      });
      // 受控可恢复错误：本轮第一次针对该图片的 media.inspect 返回 stale_media_version，
      // 并提示先重新读取 overview 取得当前版本；之后的复查必须带正确版本。
      simGo.armNextMediaInspectError(canvasId, 'node-s11-image', {
        reason: 'stale_media_version',
        message: 'The material content has changed, please re-read the overview to get the current version',
      });
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-s11-1',
        message: 'Please help me see if there is anything wrong with the hands of the character in this picture.',
      },
    ],
    evaluate({ simGo, canvasId, turnRecords, toolErrorEvidence = [] }) {
      const snap = simGo.snapshot();
      const turnId = turnRecords?.[0]?.turnId;
      const targetNodeId = 'node-s11-image';
      const targetAssetId = 'asset-s11-seed';
      const isTargetInspect = (op) =>
        op.op === 'media.inspect' &&
        (op.params?.nodeId === targetNodeId || op.params?.assetId === targetAssetId);
      const turnOps = (snap.opLog || []).filter((op) => op.turnId === turnId);
      const inspectOps = turnOps.filter(isTargetInspect);
      // 受控错误必须真的发生过，且之后有一次针对同一图片、带正确当前版本的 inspect 成功；overview 不算完成复查。
      const recoveredError = inspectOps.find((op) =>
        op.status === 'error' && op.reason === 'stale_media_version');
      const successWithCurrentVersion = inspectOps.find((op) =>
        op.status === 'ok' &&
        op.params?.expectedVersion &&
        op.params.expectedVersion === op.result?.source?.version);
      const failedInspects = inspectOps.filter((op) => op.status === 'error');
      const modelSideFailures = toolErrorEvidence.filter((entry) =>
        entry.turnId === turnId && entry.tool === 'media_inspect');
      const sameInvalidParams = new Map();
      // 先解析参数、按键排序再统计；只换 JSON 键顺序不能绕过同参数重试检查。
      for (const op of failedInspects) {
        const key = `sim:${paramSignature(op.params || {})}`;
        sameInvalidParams.set(key, (sameInvalidParams.get(key) || 0) + 1);
      }
      for (const entry of modelSideFailures) {
        const key = `model:${paramSignature(entry.args || '')}`;
        sameInvalidParams.set(key, (sameInvalidParams.get(key) || 0) + 1);
      }
      const maxSameInvalidCalls = Math.max(0, ...sameInvalidParams.values());
      const reply = String(turnRecords?.[0]?.reply || '');

      const checks = [
        {
          name: 'media_inspect_recovers_with_current_version',
          passed: Boolean(recoveredError) && Boolean(successWithCurrentVersion),
          detail: `controlled stale_media_version error=${Boolean(recoveredError)}, inspect succeeds with the correct current version =${Boolean(successWithCurrentVersion)}(overview is not included in the review completion)`,
        },
        {
          name: 'no_repeated_invalid_media_call',
          passed: maxSameInvalidCalls <= 1,
          detail: `Number of media.inspect failures =${failedInspects.length}, model side parameter verification failed =${modelSideFailures.length}, the same error parameter can be repeated at most =${maxSameInvalidCalls}`,
        },
        {
          name: 'turn_completed_without_error',
          passed: turnRecords?.length === 1 && !turnRecords[0]?.error,
          // 回复原文只作诊断信息，不参与关键词计分。
          detail: `Number of rounds=${turnRecords?.length || 0}, error =${turnRecords?.[0]?.error || 'None'},reply=${reply.slice(0, 140)}`,
        },
      ];

      return { passed: checks.every((check) => check.passed), status: checks.every((check) => check.passed) ? 'passed' : 'failed', checks };
    },
  },
];
