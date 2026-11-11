// 替代场景 R1/R3/R6/R7/L1：和 S1–S11 用同一套 setup / turns / evaluate 结构，
// 判分只看画布状态、任务和操作记录，不看具体用了哪个工具名。
// 这些场景不进 'all'，用 `--scenario parity` 或场景码单独选择。
//
// 任务耗时由 simGo.setTaskTiming 按画布设置：
// - R1a 图片 20 秒；
// - R1b 视频超过 2 分钟；
// - R3 两张图 30 秒；
// 其余场景保持默认（5 毫秒）。
// 模拟后端的 task.wait 不在场景里打开：基线测今天的真实工具面，要测新能力时运行器加
// --sim-capabilities task.wait。
import { clone } from './shared.mjs';

const R1_IMAGE_MS = 20_000;
const R1_VIDEO_MS = 135_000;
const R3_IMAGE_MS = 30_000;
const R6_IMAGE_MS = 10;

const IMAGE_PROMPT = 'On the street on a rainy night in the city, the heroine squatted by the water and picked up a silver cufflink, neon reflection, vertical screen 9:16';
const VIDEO_PROMPT = 'The camera moves from the ripples of rain to the silver cufflinks in the heroine\'s hand, her fingers trembling slightly';

function makeNode({ id, type, title, prompt = '', metadata = {}, x = 120 }) {
  const base = {
    id,
    type,
    title,
    position: { x, y: 160 },
    width: type === 'video' || type === 'image' ? 720 : 360,
    height: type === 'video' || type === 'image' ? 405 : 240,
    metadata,
  };
  if (type === 'text') {
    base.metadata = { content: prompt, status: 'idle', fontSize: 14, ...metadata };
  } else if (type === 'image') {
    base.metadata = {
      content: '',
      prompt,
      composerContent: prompt,
      status: 'idle',
      size: '9:16',
      count: 1,
      model: 'seedream-3.0',
      ...metadata,
    };
  } else if (type === 'video') {
    base.metadata = {
      content: '',
      prompt,
      composerContent: prompt,
      status: 'idle',
      size: '9:16',
      seconds: '6',
      model: 'seedance-1.0',
      ...metadata,
    };
  }
  return base;
}

function makeR1Canvas(canvasId) {
  return {
    id: canvasId,
    title: 'R1 single mirror generation',
    revision: 1,
    nodes: [
      makeNode({ id: 'node-r1-image', type: 'image', title: 'Mirror 1 first frame', prompt: IMAGE_PROMPT }),
      makeNode({
        id: 'node-r1-video',
        type: 'video',
        title: 'mirror 1 video',
        prompt: VIDEO_PROMPT,
        x: 900,
        metadata: { videoEditOperation: 'image_to_video', videoStartFrameNodeId: 'node-r1-image' },
      }),
    ],
    connections: [{ id: 'edge-r1-1', fromNodeId: 'node-r1-image', toNodeId: 'node-r1-video' }],
    timeline: null,
    updatedAt: new Date().toISOString(),
  };
}

function canvasOf(snap, canvasId) {
  return snap?.canvases?.[canvasId] || { nodes: [], connections: [] };
}

function tasksForCanvas(snap, canvasId) {
  return (snap?.tasks || []).filter((task) => task.canvasId === canvasId);
}

function tasksForNode(snap, canvasId, nodeId) {
  return tasksForCanvas(snap, canvasId).filter((task) => task.nodeId === nodeId);
}

function isSucceeded(task) {
  return task && task.status === 'succeeded';
}

// 绑定看节点自己的媒体字段：任务完成但没有 resourceId 只是「产物已交付」。
function isBound(node) {
  const metadata = node?.metadata || {};
  return Boolean(metadata.taskId && metadata.resourceId && metadata.assetId);
}

function nodeBoundToItsTask(snap, canvasId, node) {
  if (!isBound(node)) return false;
  const task = tasksForNode(snap, canvasId, node.id).find((item) => item.id === node.metadata.taskId);
  return Boolean(task && task.status === 'succeeded' && task.nodeId === node.id);
}

function hasFailedTask(snap, canvasId) {
  return tasksForCanvas(snap, canvasId).some((task) => task.status === 'failed');
}

// 失败的操作只要同一回合后来同类操作成功，就算已恢复；一直没成功的才算遗留失败。
function unhandledOpErrors(opLog = [], canvasId) {
  const scoped = opLog.filter((op) => op.params?.canvasId === canvasId);
  return scoped.filter((op) => {
    if (op.status !== 'error') return false;
    const laterOk = scoped.some(
      (other) =>
        other.status === 'ok' &&
        other.op === op.op &&
        other.turnId === op.turnId &&
        (other.at || '') >= (op.at || ''),
    );
    return !laterOk;
  });
}

function turnErrorCount(turnRecords = []) {
  return turnRecords.filter((record) => record.error).length;
}

function replyText(turnRecords = []) {
  return turnRecords.map((record) => String(record.reply || '')).filter(Boolean).join('\n');
}

function makeChecks(list) {
  return {
    passed: list.every((check) => check.passed),
    status: list.every((check) => check.passed) ? 'passed' : 'failed',
    checks: list,
  };
}

function r1Setup(imageMs, videoMs) {
  return (simGo, canvasId) => {
    const doc = simGo.ensureCanvas(canvasId, makeR1Canvas(canvasId));
    simGo.setTaskTiming(canvasId, { imageMs, videoMs });
    return { beforeCanvas: clone(doc) };
  };
}

function evaluateR1({ withVideo }) {
  return ({ simGo, canvasId, turnRecords }) => {
    const snap = simGo.snapshot();
    const doc = canvasOf(snap, canvasId);
    const imageNode = (doc.nodes || []).find((node) => node.id === 'node-r1-image');
    const videoNode = (doc.nodes || []).find((node) => node.id === 'node-r1-video');
    const imageTasks = tasksForNode(snap, canvasId, 'node-r1-image');
    const videoTasks = tasksForNode(snap, canvasId, 'node-r1-video');

    const checks = [
      {
        name: 'image_task_succeeded',
        passed: imageTasks.some(isSucceeded),
        detail: `Mirror 1 first frame number of tasks =${imageTasks.length}, success =${imageTasks.filter(isSucceeded).length}`,
      },
      {
        name: 'image_bound_to_node',
        passed: Boolean(imageNode && nodeBoundToItsTask(snap, canvasId, imageNode)),
        detail: `Mirror 1 first frame binding=${Boolean(imageNode && isBound(imageNode))}`,
      },
      {
        name: 'no_duplicate_paid_submit',
        passed: imageTasks.length <= 1 && (!withVideo || videoTasks.length <= 1),
        detail: `First frame submission =${imageTasks.length} times, video submission =${videoTasks.length} times`,
      },
      {
        name: 'single_user_turn_without_error',
        passed: (turnRecords || []).length === 1 && turnErrorCount(turnRecords) === 0,
        detail: `Number of user message rounds =${(turnRecords || []).length}, round error =${turnErrorCount(turnRecords)}`,
      },
      {
        name: 'reply_reports_result',
        passed: /完成|生成好|已生成|已绑定|写到节点|做完/.test(replyText(turnRecords)),
        detail: `Reply=${replyText(turnRecords).slice(0, 120) || 'empty'}`,
      },
    ];

    if (withVideo) {
      checks.splice(2, 0, {
        name: 'video_task_succeeded',
        passed: videoTasks.some(isSucceeded),
        detail: `Mirror 1 Number of video tasks =${videoTasks.length}, success =${videoTasks.filter(isSucceeded).length}`,
      });
      checks.splice(3, 0, {
        name: 'video_bound_to_node',
        passed: Boolean(videoNode && nodeBoundToItsTask(snap, canvasId, videoNode)),
        detail: `Mirror 1 Video Binding =${Boolean(videoNode && isBound(videoNode))}`,
      });
    }

    return makeChecks(checks);
  };
}

const R1A_TURN = {
  id: 'turn-r1a-1',
  message: 'Generate the "First Frame of Mirror 1" and let me know the result after writing it.',
};

const R1B_TURN = {
  id: 'turn-r1b-1',
  message: 'Generate the "first frame of mirror 1" and make the corresponding video. Let me know the result after writing it.',
};

function makeR3Canvas(canvasId) {
  return {
    id: canvasId,
    title: 'R3 restart and continue chatting',
    revision: 1,
    nodes: [
      makeNode({ id: 'node-r3-image-1', type: 'image', title: 'Mirror 1 first frame', prompt: IMAGE_PROMPT }),
      makeNode({ id: 'node-r3-image-2', type: 'image', title: 'Mirror 2 first frame', prompt: 'The heroine looked up at the dark alley at the corner of the street. Black shadows flashed past in the distance, and the rain was like weaving. Vertical screen 9:16', x: 900 }),
    ],
    connections: [],
    timeline: null,
    updatedAt: new Date().toISOString(),
  };
}

function buildR6Canvas(canvasId) {
  return {
    id: canvasId,
    title: 'R6 ten-shot feature film',
    revision: 1,
    nodes: [],
    connections: [],
    timeline: null,
    updatedAt: new Date().toISOString(),
  };
}

function buildR7Canvas(canvasId) {
  const nodes = Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    return makeNode({
      id: `node-r7-text-${n}`,
      type: 'text',
      title: `module${n} draft`,
      prompt: `Draft content${n}`,
      x: 120 + index * 420,
    });
  });
  return {
    id: canvasId,
    title: 'R7 continuous changes in the same round',
    revision: 1,
    nodes,
    connections: [],
    timeline: null,
    updatedAt: new Date().toISOString(),
  };
}

const R7_EXPECTED = [
  { id: 'node-r7-text-1', title: 'Plan overview', content: 'Look at the whole first' },
  { id: 'node-r7-text-2', title: 'Plan storyboard', content: 'Look at the storyboard again' },
  { id: 'node-r7-text-3', title: 'Project materials', content: 'All materials are ready' },
  { id: 'node-r7-text-4', title: 'Solution delivery', content: 'final delivery' },
];

function buildL1Canvas(canvasId) {
  const nodes = Array.from({ length: 300 }, (_, index) => {
    const n = index + 1;
    const isTarget = n === 137;
    return makeNode({
      id: isTarget ? 'node-l1-target' : `node-l1-text-${n}`,
      type: 'text',
      title: `Remarks${n}`,
      prompt: `No.${n} Notes`,
      x: 120 + (index % 20) * 420,
      metadata: { fontSize: 14 },
    });
  });
  return {
    id: canvasId,
    title: 'L1 large canvas',
    revision: 1,
    nodes,
    connections: [],
    timeline: null,
    updatedAt: new Date().toISOString(),
  };
}

function nodeSignature(node) {
  return JSON.stringify(node);
}

export const PARITY_SCENARIOS = [
  {
    id: 'submit-wait-image',
    code: 'R1a',
    aliases: ['R1a', 'r1a', 'submit-wait-image', 'R1'],
    name: 'R1a Wait for image results after submission (about 20 seconds)',
    description: 'The external agent requires one sentence to generate the first frame of mirror 1; the picture task takes about 20 seconds, and checks that the first frame is completed and bound when the user no longer sends messages, there is no repeated payment submission, and the reply explains the result. The built-in assistant must wait for the user to confirm on the interface before submitting. This scenario is only run by external agents.',
    capabilities: [],
    // 内置助手提交前必须等用户确认，这个场景为「完全权限」的外部 Agent 写的。
    runners: ['external'],
    setup: r1Setup(R1_IMAGE_MS, 5_000),
    turns: [R1A_TURN],
    evaluate: evaluateR1({ withVideo: false }),
  },

  {
    id: 'submit-wait-video',
    code: 'R1b',
    aliases: ['R1b', 'r1b', 'submit-wait-video'],
    name: 'R1b Videos longer than 2 minutes are submitted and awaiting results.',
    description: 'The external agent requires the first frame and video in one sentence; the picture is completed quickly, and the video task takes about 135 seconds. It checks that the first frame and video are finally completed and bound, that the same node does not have repeated paid submissions, and the reply explains the result. This scenario is only run by external agents.',
    capabilities: [],
    runners: ['external'],
    setup: r1Setup(5_000, R1_VIDEO_MS),
    turns: [R1B_TURN],
    evaluate: evaluateR1({ withVideo: true }),
  },

  {
    id: 'restart-resume',
    code: 'R3',
    aliases: ['R3', 'r3', 'restart-resume'],
    name: 'R3 restarts the follow-up chat and collects the results',
    description: 'The external agent only submitted two first frames in the first round (about 30 seconds, the user said there was no need to wait). After the task was completed, in the second round (the new process continued the chat), it asked "Are those two frames ready?"; it checked that there were no new paid submissions in the second round and that both frames were tied to the correct nodes. The built-in assistant must wait for the user to confirm on the interface before submitting. This scenario is only run by external agents.',
    capabilities: [],
    runners: ['external'],
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId, makeR3Canvas(canvasId));
      simGo.setTaskTiming(canvasId, { imageMs: R3_IMAGE_MS });
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-r3-1',
        message: 'Generate one image each of "Mirror 1 First Frame" and "Mirror 2 First Frame". Just submit, no need to wait for the results.',
        confirmProposalsAfterTurn: true,
      },
      {
        id: 'turn-r3-2',
        message: 'Are those two just now ready? Once done, place it on the corresponding node.',
        // 运行器需要在开始这一轮前等上一轮的任务完成；见 README「替代场景」的接口说明。
        waitForTasksBeforeTurnMs: R3_IMAGE_MS + 15_000,
      },
    ],
    evaluate({ simGo, canvasId, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = canvasOf(snap, canvasId);
      const node1 = (doc.nodes || []).find((node) => node.id === 'node-r3-image-1');
      const node2 = (doc.nodes || []).find((node) => node.id === 'node-r3-image-2');
      const tasks = tasksForCanvas(snap, canvasId).filter((task) => task.type === 'image');
      const secondTurnId = turnRecords?.[1]?.turnId || '';
      const secondTurnSubmits = (snap.opLog || []).filter(
        (op) => op.turnId === secondTurnId && op.op === 'canvas.generation.submit' && op.status === 'ok',
      ).length;

      return makeChecks([
        {
          name: 'only_two_paid_tasks',
          passed: tasks.length === 2 && tasks.every(isSucceeded),
          detail: `Number of picture tasks =${tasks.length}, success =${tasks.filter(isSucceeded).length}`,
        },
        {
          name: 'second_turn_added_no_paid_submit',
          passed: secondTurnSubmits === 0 && tasks.length === 2,
          detail: `Round 2 external commits=${secondTurnSubmits} times, total number of tasks =${tasks.length}`,
        },
        {
          name: 'both_images_bound_to_correct_nodes',
          passed: Boolean(node1 && node2 && nodeBoundToItsTask(snap, canvasId, node1) && nodeBoundToItsTask(snap, canvasId, node2)),
          detail: `mirror 1 binding =${Boolean(node1 && isBound(node1))}, mirror 2 binding=${Boolean(node2 && isBound(node2))}`,
        },
        {
          name: 'both_turns_completed_without_error',
          passed: (turnRecords || []).length === 2 && turnErrorCount(turnRecords) === 0,
          detail: `Number of rounds =${(turnRecords || []).length}, round error =${turnErrorCount(turnRecords)}`,
        },
      ]);
    },
  },

  {
    id: 'long-film-10shot',
    code: 'R6',
    aliases: ['R6', 'r6', 'long-film-10shot'],
    name: 'R6 10-lens feature films batched to timeline',
    description: 'Divide into multiple rounds according to the work rhythm of the built-in assistant: in the first round, write a 10-shot storyboard and start the first batch of first frames, followed by up to 3 rounds of "continue" to complete the first frame, and finally synthesize and render the timeline. Check that the 10 lines and the 10 first frame nodes correspond one to one and are all bound, and that the rendering is successful after the last timeline update.',
    capabilities: [],
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId, buildR6Canvas(canvasId));
      // 首帧生成只验证流程，不需要真实等待；保持 10 毫秒让 10 个任务尽快完成。
      simGo.setTaskTiming(canvasId, { imageMs: R6_IMAGE_MS });
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-r6-1',
        message: 'Make a 10-shot short trailer: First write out the 10-shot storyboard completely, and start making the first batch of first frames (maximum 4 in a batch). Let me know when you finish this batch.',
        // 内置宿主路径里，用户在面板确认生成；外部 Agent 用自己的提交入口，不看这个字段。
        confirmProposalsAfterTurn: true,
      },
      {
        id: 'turn-r6-2',
        message: 'Go ahead and finish the rest of the first frame.',
        confirmProposalsAfterTurn: true,
        waitForTasksBeforeTurnMs: 2_000,
      },
      {
        id: 'turn-r6-3',
        message: 'Go ahead and finish the rest of the first frame.',
        confirmProposalsAfterTurn: true,
        waitForTasksBeforeTurnMs: 2_000,
      },
      {
        id: 'turn-r6-4',
        message: 'Go ahead and finish the rest of the first frame.',
        confirmProposalsAfterTurn: true,
        waitForTasksBeforeTurnMs: 2_000,
      },
      {
        id: 'turn-r6-5',
        message: 'Synthesize the timeline.',
        confirmProposalsAfterTurn: true,
        waitForTasksBeforeTurnMs: 2_000,
      },
    ],
    // 只有内置运行器在打分前等任务结束；外部 Agent 必须自己等，不能由运行器代劳。
    waitForTasksBeforeEvaluateMs: 5_000,
    evaluate({ simGo, canvasId, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = canvasOf(snap, canvasId);
      const nodes = doc.nodes || [];
      const scriptNode = nodes.find((node) => node.type === 'script');
      const rows = scriptNode?.metadata?.storyboard?.rows || [];
      const imageNodes = nodes.filter((node) => node.type === 'image');
      const imageNodeIds = new Set(imageNodes.map((node) => node.id));
      const rowImageIds = rows.map((row) => String(row.imageNodeId || ''));
      const rowImageSet = new Set(rowImageIds.filter(Boolean));
      // 10 行的 imageNodeId 必须和 10 个首帧节点一一对应，不能 10 行都指向同一个节点。
      const rowsMapOneToOne = rows.length === 10 &&
        rowImageIds.every(Boolean) &&
        rowImageSet.size === 10 &&
        imageNodeIds.size === 10 &&
        [...rowImageSet].every((id) => imageNodeIds.has(id));
      const rowsBound = rows.every((row) => {
        const node = imageNodes.find((item) => item.id === row.imageNodeId);
        return Boolean(node && nodeBoundToItsTask(snap, canvasId, node));
      });
      const boundImages = imageNodes.filter((node) => nodeBoundToItsTask(snap, canvasId, node));
      const succeededImages = imageNodes.filter((node) => tasksForNode(snap, canvasId, node.id).some(isSucceeded));
      const clips = Array.isArray(doc.timeline?.clips) ? doc.timeline.clips : [];
      const imageClipNodeIds = new Set(clips.filter((clip) => clip.kind === 'image' || clip.kind === 'video').map((clip) => clip.nodeId));
      const renderTasks = tasksForCanvas(snap, canvasId).filter((task) => task.type === 'timeline_render');
      const opLog = snap.opLog || [];
      const timelineUpdates = opLog.filter(
        (op) => op.op === 'canvas.timeline.update' && op.status === 'ok' && op.params?.canvasId === canvasId,
      );
      const lastUpdate = timelineUpdates.at(-1);
      const lastUpdateRevision = Number(lastUpdate?.result?.revision);
      // 成功的渲染必须发生在最后一次时间线更新之后，且渲染的是那次更新后的版本。
      const renderAfterFinalTimeline = opLog.filter(
        (op) => op.op === 'canvas.timeline.render' && op.status === 'ok' && op.params?.canvasId === canvasId,
      ).filter((op) => {
        const sourceRevision = Number(op.result?.sourceRevision);
        return Number.isSafeInteger(lastUpdateRevision) &&
          Number.isSafeInteger(sourceRevision) &&
          sourceRevision >= lastUpdateRevision &&
          (op.at || '') >= (lastUpdate?.at || '') &&
          renderTasks.some((task) => task.id === op.result?.taskId && task.status === 'succeeded');
      }).length;
      const opErrors = unhandledOpErrors(opLog, canvasId);

      return makeChecks([
        {
          name: 'ten_storyboard_rows',
          passed: rows.length === 10 && rows.every((row) => String(row.plotDescription || '').trim() && String(row.imageGenerationPrompt || '').trim()),
          detail: `Number of storyboard lines =${rows.length},field complete=${rows.every((row) => String(row.plotDescription || '').trim() && String(row.imageGenerationPrompt || '').trim())}`,
        },
        {
          name: 'ten_first_frames_bound',
          passed: imageNodes.length === 10 && boundImages.length === 10 && rowsMapOneToOne && rowsBound,
          detail: `First frame node =${imageNodes.length}, bound =${boundImages.length}, row mapping one-to-one correspondence =${rowsMapOneToOne}, the row points to the bound node =${rowsBound}`,
        },
        {
          name: 'all_first_frame_tasks_succeeded',
          passed: succeededImages.length === 10 && !hasFailedTask(snap, canvasId),
          detail: `First frame task successful =${succeededImages.length}/10, failed task=${tasksForCanvas(snap, canvasId).filter((task) => task.status === 'failed').length}`,
        },
        {
          name: 'timeline_rendered',
          passed:
            clips.length >= 10 &&
            imageNodes.every((node) => imageClipNodeIds.has(node.id)) &&
            renderTasks.some((task) => task.status === 'succeeded') &&
            renderAfterFinalTimeline > 0,
          detail: `timeline clip =${clips.length}, rendering task =${renderTasks.filter((task) => task.status === 'succeeded').length}, successfully rendered after the last timeline update=${renderAfterFinalTimeline}`,
        },
        {
          name: 'no_failed_or_unhandled_calls',
          passed: !hasFailedTask(snap, canvasId) && opErrors.length === 0 && turnErrorCount(turnRecords) === 0,
          detail: `Legacy failed operations =${opErrors.length}, round error =${turnErrorCount(turnRecords)}`,
        },
      ]);
    },
  },

  {
    id: 'same-turn-multi-edit',
    code: 'R7',
    aliases: ['R7', 'r7', 'same-turn-multi-edit'],
    name: 'R7 Continuously modify 4 text nodes in the same round',
    description: 'One sentence requires changing the title and body of 4 text nodes; check that all 4 are correct and no changes are lost. The number of stale_revisions is only recorded in detail and is not used as a failure condition.',
    capabilities: [],
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId, buildR7Canvas(canvasId));
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-r7-1',
        message: 'Change all four text nodes on the canvas: Module 1\'s title is changed to "Proposal Overview" and the text is changed to "Look at the whole first"; Module 2 is changed to "Proposal Storyboards" and "Look at the Storyboards Again"; Module 3 is changed to "Proposal Materials" and "Materials are ready"; Module 4 is changed to "Proposal Delivery" and "Final Delivery". Don\'t miss any of them.',
      },
    ],
    evaluate({ simGo, canvasId, setupState, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = canvasOf(snap, canvasId);
      const textNodes = (doc.nodes || []).filter((node) => node.type === 'text');
      const staleRevisionCount = (snap.opLog || []).filter(
        (op) => op.params?.canvasId === canvasId && op.status === 'error' && op.reason === 'revision_conflict',
      ).length;
      const beforeNodes = (setupState?.beforeCanvas?.nodes || []).filter((node) => node.type === 'text');
      const results = R7_EXPECTED.map((expected) => {
        const node = textNodes.find((item) => item.id === expected.id);
        return {
          id: expected.id,
          title: node?.title || '',
          content: String(node?.metadata?.content || ''),
          ok: Boolean(node && node.title === expected.title && String(node.metadata?.content || '') === expected.content),
        };
      });
      const allUpdated = results.every((item) => item.ok);

      return makeChecks([
        {
          name: 'all_four_nodes_updated',
          passed: allUpdated,
          detail: `Correct =${results.filter((item) => item.ok).length}/4；stale_revision=${staleRevisionCount};Details =${results.map((item) => `${item.id}:${item.ok ? 'ok' : `${item.title}/${item.content}`}`).join('，')}`,
        },
        {
          name: 'no_lost_edits_or_duplicate_nodes',
          passed: textNodes.length === 4 && beforeNodes.length === 4 && allUpdated,
          detail: `text node =${textNodes.length}(Before the change${beforeNodes.length}），stale_revision=${staleRevisionCount}`,
        },
        {
          name: 'turn_completed_without_error',
          passed: turnErrorCount(turnRecords) === 0,
          detail: `round error =${turnErrorCount(turnRecords)}，stale_revision=${staleRevisionCount}`,
        },
      ]);
    },
  },

  {
    id: 'large-canvas-locate',
    code: 'L1',
    aliases: ['L1', 'l1', 'large-canvas-locate'],
    name: 'L1 large canvas is positioned according to the title and only changes one node',
    description: 'On a canvas with about 300 nodes, find "Remark 137" by title and correct the text; check to only change this one, and record the number of times the canvas is read and the number of bytes returned in detail.',
    capabilities: [],
    setup(simGo, canvasId) {
      const doc = simGo.ensureCanvas(canvasId, buildL1Canvas(canvasId));
      return { beforeCanvas: clone(doc) };
    },
    turns: [
      {
        id: 'turn-l1-1',
        message: 'Change the body of the text node titled "Remark 137" to "Customer confirms this version, not publishing it yet", and leave other nodes untouched.',
      },
    ],
    evaluate({ simGo, canvasId, setupState, turnRecords }) {
      const snap = simGo.snapshot();
      const doc = canvasOf(snap, canvasId);
      const before = setupState?.beforeCanvas || { nodes: [], connections: [] };
      const target = (doc.nodes || []).find((node) => node.id === 'node-l1-target');
      const expectedContent = 'The customer has confirmed this version and will not publish it yet.';
      const otherNodes = (doc.nodes || []).filter((node) => node.id !== 'node-l1-target');
      const beforeOthers = new Map((before.nodes || []).filter((node) => node.id !== 'node-l1-target').map((node) => [node.id, node]));
      const unchangedOthers = otherNodes.length === beforeOthers.size && otherNodes.every((node) => {
        const original = beforeOthers.get(node.id);
        return Boolean(original) && nodeSignature(original) === nodeSignature(node);
      });
      const connectionsUnchanged = JSON.stringify(before.connections || []) === JSON.stringify(doc.connections || []);
      const canvasReads = (snap.opLog || []).filter(
        (op) => op.op === 'canvas.get' && op.params?.canvasId === canvasId && op.status === 'ok',
      );
      const readBytes = canvasReads.reduce((sum, op) => sum + Buffer.byteLength(JSON.stringify(op.result || {})), 0);

      return makeChecks([
        {
          name: 'target_node_updated',
          passed: Boolean(target && String(target.metadata?.content || '') === expectedContent && target.title === 'Remarks 137'),
          detail: `Text =${target ? String(target.metadata?.content || '').slice(0, 60) : 'Node does not exist'}`,
        },
        {
          name: 'only_target_changed',
          passed: unchangedOthers && (doc.nodes || []).length === (before.nodes || []).length && connectionsUnchanged,
          detail: `The remaining nodes remain unchanged =${unchangedOthers}, total number of nodes =${(doc.nodes || []).length}(Before the change${(before.nodes || []).length}), the connection remains unchanged =${connectionsUnchanged}`,
        },
        {
          name: 'canvas_read_volume_recorded',
          passed: true,
          detail: `read canvas${canvasReads.length} times, return${readBytes} Bytes`,
        },
        {
          name: 'turn_completed_without_error',
          passed: turnErrorCount(turnRecords) === 0,
          detail: `round error =${turnErrorCount(turnRecords)}`,
        },
      ]);
    },
  },
];
