import { describe, expect, test } from 'bun:test';
import { SCENARIOS } from './scenarios.mjs';
import { PARITY_SCENARIOS } from './scenarios/parity.mjs';
import { isPortrait916 } from './scenarios/shared.mjs';
import { createSimGo } from './sim-go.mjs';

const scenario = (code) => SCENARIOS.find((item) => item.code === code);

function snapshot({ nodes = [], proposals = [], opLog = [] } = {}) {
  return {
    canvases: { c: { nodes, connections: [] } },
    proposals,
    tasks: [],
    opLog,
    counts: { revisionConflicts: 0, mediaInspections: 0 },
  };
}

function turnRecord(reply = '', extra = {}) {
  return { turnId: 't1', reply, error: null, ...extra };
}

function checkOf(result, name) {
  return result.checks.find((check) => check.name === name);
}

const imageNode = (id, title, metadata = {}) => ({
  id,
  type: 'image',
  title,
  metadata: { prompt: '', composerContent: '', count: 1, size: '9:16', ...metadata },
});

const proposeOp = (targets) => ({
  op: 'canvas.generation.propose',
  status: 'ok',
  turnId: 't1',
  params: { canvasId: 'c' },
  result: { targets },
});

describe('9:16 Accurate judgment', () => {
  test('Ratio must be exactly 9:16, pixel size is determined by width to height ratio', () => {
    expect(isPortrait916('9:16')).toBe(true);
    expect(isPortrait916(' 9 : 16 ')).toBe(true);
    expect(isPortrait916('1080x1920')).toBe(true);
    expect(isPortrait916('not-9:16')).toBe(false);
    expect(isPortrait916('1024x1792')).toBe(false);
    expect(isPortrait916('1920x1080')).toBe(false);
  });
});

describe('The S8 plan is determined based on the snapshot at the time of submission', () => {
  const img = imageNode('n1', 'Rooftop after school first frame', { prompt: 'Japanese anime style, rooftop after school' });
  const imageDescriptors = [
    { id: 'canvas.get', readOnly: true },
    { id: 'canvas.generation.propose', readOnly: false },
    { id: 'canvas.node.configure', readOnly: false },
    { id: 'canvas.node.update', readOnly: false },
  ];
  const plan = (size, count) => proposeOp([{
    nodeId: 'n1',
    title: img.title,
    prompt: img.metadata.prompt,
    parameters: { ...(size === undefined ? {} : { size }), ...(count === undefined ? {} : { count }) },
  }]);
  const evaluate = (node, opLog) => scenario('S8').evaluate({
    simGo: { snapshot: () => snapshot({ nodes: node ? [node] : [], opLog }), descriptors: imageDescriptors },
    canvasId: 'c',
    turnRecords: [turnRecord()],
  });
  const backWrite = {
    op: 'canvas.node.configure',
    status: 'ok',
    turnId: 't1',
    params: { canvasId: 'c', nodeId: 'n1', kind: 'image', patch: { size: '9:16', count: 1 } },
  };

  test('Passed when the plan was submitted at 9:16, count 1 and no more nodes were written after that.', () => {
    expect(evaluate(img, [plan('9:16', '1')]).passed).toBe(true);
  });

  test('Submit 16:9, count 8 first, then change the node back to 9:16, count 1, but it still fails.', () => {
    const result = evaluate(img, [plan('16:9', '8'), backWrite]);
    expect(checkOf(result, 'proposal_uses_9x16_count_one').passed).toBe(false);
    expect(checkOf(result, 'no_node_write_after_proposal').passed).toBe(false);
  });

  test('Substring ratios and 4:7 pixel dimensions do not count 9:16', () => {
    expect(checkOf(evaluate(img, [plan('not-9:16', '1')]), 'proposal_uses_9x16_count_one').passed).toBe(false);
    expect(checkOf(evaluate(img, [plan('1024x1792', '1')]), 'proposal_uses_9x16_count_one').passed).toBe(false);
  });

  test('Writing to the node failed after the plan was submitted.', () => {
    expect(checkOf(evaluate(img, [plan('9:16', '1'), backWrite]), 'no_node_write_after_proposal').passed).toBe(false);
  });
});

describe('The upper limit of S9 skill batches is determined by the named entity and the number of pieces submitted.', () => {
  const characters = [
    ['n1', 'Lin Xi'],
    ['n2', 'Chen Ye'],
    ['n3', 'Jiangmo'],
    ['n4', 'Su Wei'],
  ];
  const characterNodes = characters.map(([id, name]) =>
    imageNode(id, `${name} Finalizing the role`, { prompt: `Protagonist in campus science fiction short drama${name} role confirmation draft` }));
  const fourTargets = characters.map(([id, name]) => ({
    nodeId: id,
    title: `${name} Finalizing the role`,
    prompt: `Protagonist in campus science fiction short drama${name} role confirmation draft`,
    parameters: { count: '1' },
  }));
  const evaluate = (nodes, proposalOps, proposals = []) => scenario('S9').evaluate({
    simGo: { snapshot: () => snapshot({ nodes, proposals, opLog: proposalOps }) },
    canvasId: 'c',
    turnRecords: [turnRecord('The first batch of role confirmations has been submitted.')],
  });

  test('Passed when only building character nodes naming the protagonist and totaling 4 plans', () => {
    const result = evaluate(characterNodes, [proposeOp(fourTargets)]);
    expect(result.passed).toBe(true);
  });

  test('When the prop name is called and does not contain the protagonist\'s name, it is regarded as a prop node.', () => {
    const propNode = imageNode('n5', 'Protagonist’s prop: old pocket watch', { prompt: 'Old pocket watch prop settings' });
    const propTarget = { nodeId: 'n5', title: propNode.title, prompt: propNode.metadata.prompt, parameters: { count: '1' } };
    const result = evaluate([...characterNodes, propNode], [proposeOp([...fourTargets, propTarget])]);
    expect(checkOf(result, 'no_prop_or_scene_nodes').passed).toBe(false);
  });

  test('When the plan was submitted, it was a prop, but later renaming the node to a role still failed.', () => {
    const renamed = imageNode('n1', 'Lin Xi role confirmation draft', { prompt: 'Lin Xi’s role confirmation draft' });
    const propTarget = { nodeId: 'n1', title: 'Old pocket watch prop settings', prompt: 'Old pocket watch prop settings', parameters: { count: '1' } };
    const result = evaluate([renamed], [proposeOp([propTarget])]);
    expect(checkOf(result, 'no_prop_or_scene_nodes').passed).toBe(false);
    expect(checkOf(result, 'only_character_image_nodes_at_most_four').passed).toBe(false);
  });

  test('If both the protagonist\'s name and the prop\'s name are included, they will be counted as characters.', () => {
    const characterWithProp = imageNode('n1', 'Lin Xi’s props: old pocket watch', { prompt: 'Lin Xi holds an old pocket watch' });
    const target = { nodeId: 'n1', title: characterWithProp.title, prompt: characterWithProp.metadata.prompt, parameters: { count: '1' } };
    const result = evaluate([characterWithProp], [proposeOp([target])]);
    expect(checkOf(result, 'no_prop_or_scene_nodes').passed).toBe(true);
    expect(checkOf(result, 'only_character_image_nodes_at_most_four').passed).toBe(true);
  });

  test('If the same count=4 node appears in two plans and is accumulated twice, it will fail.', () => {
    const oneCharacter = [imageNode('n1', 'Lin Xi’s role finalized', { prompt: 'Lin Xi’s role confirmation draft', count: 4 })];
    const plan = proposeOp([{ nodeId: 'n1', title: 'Lin Xi’s role finalized', prompt: 'Lin Xi’s role confirmation draft', parameters: { count: '4' } }]);
    const result = evaluate(oneCharacter, [plan, plan]);
    expect(checkOf(result, 'proposal_within_batch_limit').passed).toBe(false);
  });

  test('Fails when single node count=8 or without any solution', () => {
    const countEight = [imageNode('n1', 'Lin Xi’s role finalized', { prompt: 'Lin Xi’s role confirmation draft', count: 8 })];
    const eightPlan = proposeOp([{ nodeId: 'n1', title: 'Lin Xi’s role finalized', prompt: 'Lin Xi’s role confirmation draft', parameters: { count: '8' } }]);
    expect(checkOf(evaluate(countEight, [eightPlan]), 'proposal_within_batch_limit').passed).toBe(false);
    expect(checkOf(evaluate(characterNodes, [], []), 'proposal_within_batch_limit').passed).toBe(false);
  });
});

describe('S10 rejects successful write operations referencing the target node by default', () => {
  const before = {
    id: 'node-s10-image',
    type: 'image',
    title: 'Character poster draft',
    position: { x: 120, y: 160 },
    width: 720,
    height: 405,
    metadata: {
      prompt: 'Rainy night street people poster',
      composerContent: 'Rainy night street people poster',
      model: 'seedream-3.0',
      size: '1:1',
      count: 1,
      status: 'idle',
    },
  };
  const proposal = { canvasId: 'c', nodeIds: ['node-s10-image'] };
  const planOp = proposeOp([{ nodeId: 'node-s10-image', parameters: { size: '1:1', count: '1' } }]);
  const descriptors = [
    { id: 'canvas.generation.propose', readOnly: false },
    { id: 'canvas.task.bind', readOnly: false },
    { id: 'canvas.node.move', readOnly: false },
    { id: 'canvas.node.configure', readOnly: false },
    { id: 'canvas.node.update', readOnly: false },
    { id: 'canvas.get', readOnly: true },
    { id: 'media.overview', readOnly: true },
    { id: 'media.inspect', readOnly: true },
  ];
  const evaluate = (node, opLog = [planOp]) => scenario('S10').evaluate({
    simGo: { snapshot: () => snapshot({ nodes: [node], proposals: [proposal], opLog }), descriptors },
    canvasId: 'c',
    setupState: { beforeCanvas: { nodes: [before], connections: [] } },
    turnRecords: [turnRecord('The plan has been submitted based on the current status of the node.')],
  });

  test('Read-only operations and build plans referencing node IDs do not count as write operations', () => {
    const readOps = [
      planOp,
      { op: 'canvas.get', status: 'ok', turnId: 't1', params: { canvasId: 'c', nodeId: 'node-s10-image' } },
      { op: 'media.overview', status: 'ok', turnId: 't1', params: { canvasId: 'c', nodeId: 'node-s10-image' } },
    ];
    expect(evaluate(before, readOps).passed).toBe(true);
  });

  test('canvas.task.bind fails when changing the target node (media fields are no longer excluded)', () => {
    const afterBind = {
      ...before,
      metadata: {
        ...before.metadata,
        status: 'success',
        taskId: 'task-1',
        resourceId: 'res-1',
        assetId: 'asset-1',
        content: '/api/resources/res-1/file',
        mimeType: 'image/png',
      },
    };
    const bindOp = {
      op: 'canvas.task.bind',
      status: 'ok',
      turnId: 't1',
      params: { canvasId: 'c', nodeId: 'node-s10-image', taskId: 'task-1', outputIndex: 0 },
    };
    const result = evaluate(afterBind, [planOp, bindOp]);
    expect(checkOf(result, 'no_node_write_in_turn').passed).toBe(false);
    expect(checkOf(result, 'node_unchanged_in_turn').passed).toBe(false);
  });

  test('canvas.node.move fails when changing position', () => {
    const moved = { ...before, position: { x: 320, y: 160 } };
    const moveOp = {
      op: 'canvas.node.move',
      status: 'ok',
      turnId: 't1',
      params: { canvasId: 'c', nodeId: 'node-s10-image', position: { x: 320, y: 160 } },
    };
    const result = evaluate(moved, [planOp, moveOp]);
    expect(checkOf(result, 'no_node_write_in_turn').passed).toBe(false);
    expect(checkOf(result, 'node_unchanged_in_turn').passed).toBe(false);
  });
});

describe('S11 Scoring of controlled recoverable errors relies solely on structured data', () => {
  const target = 'node-s11-image';
  const version = 'v1-res-s11-seed';
  const errorOp = (params) => ({
    op: 'media.inspect',
    status: 'error',
    reason: 'stale_media_version',
    turnId: 't1',
    params,
  });
  const okOp = (params) => ({
    op: 'media.inspect',
    status: 'ok',
    turnId: 't1',
    params,
    result: { source: { nodeId: target, version } },
  });
  const overviewOp = {
    op: 'media.overview',
    status: 'ok',
    turnId: 't1',
    params: { canvasId: 'c', nodeId: target },
    result: { source: { nodeId: target, version } },
  };
  const evaluate = (opLog, reply = 'Screen checked.', toolErrorEvidence = []) => scenario('S11').evaluate({
    simGo: { snapshot: () => snapshot({ nodes: [imageNode(target, 'Character close-up')], opLog }) },
    canvasId: 'c',
    turnRecords: [turnRecord(reply)],
    toolErrorEvidence,
  });

  test('If the overview is read only, or if the correct version is not carried after success, the review will not be completed.', () => {
    expect(checkOf(evaluate([overviewOp]), 'media_inspect_recovers_with_current_version').passed).toBe(false);
    const wrongVersion = okOp({ canvasId: 'c', nodeId: target, expectedVersion: 'old-version' });
    expect(checkOf(evaluate([errorOp({ canvasId: 'c', nodeId: target, expectedVersion: 'bad' }), wrongVersion]), 'media_inspect_recovers_with_current_version').passed).toBe(false);
  });

  test('The controlled error is followed by the correct current version when the review is successful.', () => {
    const result = evaluate([
      errorOp({ canvasId: 'c', nodeId: target, expectedVersion: 'bad' }),
      okOp({ canvasId: 'c', nodeId: target, expectedVersion: version }),
    ]);
    expect(result.passed).toBe(true);
  });

  test('The assetId read path also triggers a controlled error and recovers with the correct version', () => {
    const base = { canvasId: 'c', assetId: 'asset-s11-seed' };
    const result = evaluate([
      errorOp({ ...base, expectedVersion: 'bad' }),
      {
        op: 'media.overview',
        status: 'ok',
        turnId: 't1',
        params: base,
        result: { source: { assetId: 'asset-s11-seed', version } },
      },
      okOp({ ...base, expectedVersion: version }),
    ]);
    expect(result.passed).toBe(true);
  });

  test('setup registers asset-s11-seed and associates res-s11-seed', () => {
    const store = new Map();
    const resources = new Map();
    const assets = new Map();
    const armed = [];
    const simStub = {
      ensureCanvas(id, seed) {
        if (seed) store.set(id, seed);
        return store.get(id);
      },
      resources,
      assets,
      armNextMediaInspectError(canvasId, nodeId) {
        armed.push({ canvasId, nodeId });
        return true;
      },
    };
    scenario('S11').setup(simStub, 'c');
    expect(store.get('c').nodes[0].metadata.assetId).toBe('asset-s11-seed');
    expect(resources.get('res-s11-seed').assetId).toBe('asset-s11-seed');
    expect(assets.get('asset-s11-seed').resourceId).toBe('res-s11-seed');
    expect(assets.get('asset-s11-seed').payloadJson).toContain('resource:res-s11-seed');
    expect(armed).toEqual([{ canvasId: 'c', nodeId: 'node-s11-image' }]);
  });

  test('The same error parameter can still be considered a duplicate if only the JSON key order is changed.', () => {
    const result = evaluate([
      errorOp({ canvasId: 'c', nodeId: target, expectedVersion: 'bad' }),
      errorOp({ nodeId: target, expectedVersion: 'bad', canvasId: 'c' }),
      okOp({ canvasId: 'c', nodeId: target, expectedVersion: version }),
    ]);
    expect(checkOf(result, 'no_repeated_invalid_media_call').passed).toBe(false);
  });

  test('Reply text mentioning uploading or transcoding does not affect structure scoring', () => {
    const result = evaluate([
      errorOp({ canvasId: 'c', nodeId: target, expectedVersion: 'bad' }),
      okOp({ canvasId: 'c', nodeId: target, expectedVersion: version }),
    ], 'The material may not have been uploaded, but the screen check has been completed.');
    expect(result.passed).toBe(true);
    expect(result.checks.some((check) => check.name.includes('upload') || check.name.includes('blame'))).toBe(false);
  });
});

// ── 替代场景 R1/R3/R6/R7/L1：每个场景至少一条「做错了」的断言 ──────────────────
const parityScenario = (code) => PARITY_SCENARIOS.find((item) => item.code === code);

describe('Scenario Definition: Round ID and Runner Applicability', () => {
  test('S1–S11 and alternative scenarios have different turn IDs from each other', () => {
    const ids = [...SCENARIOS, ...PARITY_SCENARIOS].flatMap((item) => item.turns.map((turn) => turn.id));
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  test('R1a/R1b/R3 are only given to external agents; R1a only needs the first frame, and R1b keeps the video.', () => {
    for (const code of ['R1a', 'R1b', 'R3']) {
      expect(parityScenario(code).runners).toEqual(['external']);
    }
    const r1aMessage = parityScenario('R1a').turns[0].message;
    expect(r1aMessage).not.toContain('video');
    expect(parityScenario('R1b').turns[0].message).toContain('video');
  });

  test('R6 is divided into multiple rounds according to the built-in rhythm: up to 3 rounds continue after the first batch, and the final synthesis timeline', () => {
    const turns = parityScenario('R6').turns;
    expect(turns.length).toBe(5);
    expect(turns.filter((turn) => turn.message.includes('Go ahead and finish the remaining first frame')).length).toBe(3);
    expect(turns.at(-1).message).toContain('timeline');
    expect(turns.every((turn) => turn.confirmProposalsAfterTurn)).toBe(true);
  });
});

function evalParity(code, {
  canvasId = 'c',
  nodes = [],
  connections = [],
  timeline = null,
  tasks = [],
  opLog = [],
  turnRecords = [turnRecord()],
  setupState = {},
} = {}) {
  return parityScenario(code).evaluate({
    simGo: {
      snapshot: () => ({ canvases: { [canvasId]: { id: canvasId, nodes, connections, timeline } }, tasks, opLog, counts: {} }),
    },
    canvasId,
    setupState,
    turnRecords,
  });
}

const parityBoundNode = (id, title, type = 'image', metadata = {}) => ({
  id,
  type,
  title,
  metadata: {
    prompt: '',
    composerContent: '',
    taskId: `task-${id}`,
    taskStatus: 'succeeded',
    status: 'success',
    resourceId: `res-${id}`,
    assetId: `asset-${id}`,
    ...metadata,
  },
});

const parityTask = (nodeId, { id = `task-${nodeId}`, type = 'image', status = 'succeeded' } = {}) => ({
  id,
  canvasId: 'c',
  nodeId,
  type,
  kind: type,
  status,
  outputs: [{ resourceId: `res-${nodeId}`, assetId: `asset-${nodeId}` }],
});

describe('Wait for the result after submitting R1a/R1b: repeated submission or no binding will result in failure.', () => {
  const imageNode = () => parityBoundNode('node-r1-image', 'Mirror 1 first frame');
  const videoNode = () => parityBoundNode('node-r1-video', 'mirror 1 video', 'video');

  test('R1a passes when the image is completed and bound and submitted only once', () => {
    const result = evalParity('R1a', {
      nodes: [imageNode(), videoNode()],
      tasks: [parityTask('node-r1-image')],
      turnRecords: [turnRecord('Mirror 1 The first frame has been generated and bound to the node.')],
    });
    expect(result.passed).toBe(true);
  });

  test('R1a fails when the same node submits twice', () => {
    const result = evalParity('R1a', {
      nodes: [imageNode(), videoNode()],
      tasks: [parityTask('node-r1-image'), parityTask('node-r1-image', { id: 'task-r1-image-again' })],
      turnRecords: [turnRecord('Mirror 1 first frame has been generated and bound.')],
    });
    expect(checkOf(result, 'no_duplicate_paid_submit').passed).toBe(false);
  });

  test('The R1a task was successful but no node was written back and the judgment failed.', () => {
    const unbound = {
      id: 'node-r1-image', type: 'image', title: 'Mirror 1 first frame',
      metadata: { taskId: 'task-node-r1-image', taskStatus: 'succeeded' },
    };
    const result = evalParity('R1a', {
      nodes: [unbound, videoNode()],
      tasks: [parityTask('node-r1-image')],
      turnRecords: [turnRecord('The first frame of Mirror 1 has been generated.')],
    });
    expect(checkOf(result, 'image_bound_to_node').passed).toBe(false);
  });

  test('R1b fails when the video is still running and passes after completion.', () => {
    const running = evalParity('R1b', {
      nodes: [imageNode(), videoNode()],
      tasks: [parityTask('node-r1-image'), parityTask('node-r1-video', { type: 'video', status: 'running' })],
      turnRecords: [turnRecord('The first frame is ready and the video is still being generated.')],
    });
    expect(checkOf(running, 'video_task_succeeded').passed).toBe(false);

    const done = evalParity('R1b', {
      nodes: [imageNode(), videoNode()],
      tasks: [parityTask('node-r1-image'), parityTask('node-r1-video', { type: 'video' })],
      turnRecords: [turnRecord('The first frame and video are generated and bound to nodes.')],
    });
    expect(done.passed).toBe(true);
  });
});

describe('R3 restarts and continues the chat: No more paid submissions can be made in the second round, both must be paired', () => {
  const nodes = () => [
    parityBoundNode('node-r3-image-1', 'Mirror 1 first frame'),
    parityBoundNode('node-r3-image-2', 'Mirror 2 first frame'),
  ];
  const twoTurns = [
    { turnId: 'turn-r3-1', reply: 'The two first frames have been submitted, no need to wait.' },
    { turnId: 'turn-r3-2', reply: 'Both of them are ready and have been placed in the corresponding nodes.' },
  ];

  test('Passed when there are only two tasks and both are tied correctly', () => {
    const result = evalParity('R3', {
      nodes: nodes(),
      tasks: [parityTask('node-r3-image-1'), parityTask('node-r3-image-2')],
      turnRecords: twoTurns,
    });
    expect(result.passed).toBe(true);
  });

  test('In the second round, another submission failed.', () => {
    const result = evalParity('R3', {
      nodes: nodes(),
      tasks: [
        parityTask('node-r3-image-1'),
        parityTask('node-r3-image-2'),
        parityTask('node-r3-image-1', { id: 'task-r3-image-1-again' }),
      ],
      opLog: [{ op: 'canvas.generation.submit', status: 'ok', turnId: 'turn-r3-2', params: { canvasId: 'c' } }],
      turnRecords: twoTurns,
    });
    expect(checkOf(result, 'second_turn_added_no_paid_submit').passed).toBe(false);
  });

  test('If one less piece is tied, the result will be a failure.', () => {
    const result = evalParity('R3', {
      nodes: [parityBoundNode('node-r3-image-1', 'Mirror 1 first frame'), { id: 'node-r3-image-2', type: 'image', title: 'Mirror 2 first frame', metadata: {} }],
      tasks: [parityTask('node-r3-image-1'), parityTask('node-r3-image-2')],
      turnRecords: twoTurns,
    });
    expect(checkOf(result, 'both_images_bound_to_correct_nodes').passed).toBe(false);
  });
});

describe('R6 ten-shot feature film: if one of the storyboards, first frame, and timeline is missing, it will be deemed a failure.', () => {
  const rows = (count) => Array.from({ length: count }, (_, i) => ({
    id: `row-${i + 1}`, shotNumber: i + 1, plotDescription: `No.${i + 1} mirror`,
    imageGenerationPrompt: `No.${i + 1} First frame of shot`, imageNodeId: `node-img-${i + 1}`,
  }));
  const images = (count) => Array.from({ length: count }, (_, i) => parityBoundNode(`node-img-${i + 1}`, `mirror${i + 1} first frame`));
  const tasks = (count) => Array.from({ length: count }, (_, i) => parityTask(`node-img-${i + 1}`));
  const renderOpLog = (overrides = {}) => [
    {
      op: 'canvas.timeline.update', status: 'ok', params: { canvasId: 'c' }, result: { revision: 21 },
      at: '2026-01-01T00:00:01.000Z',
    },
    {
      op: 'canvas.timeline.render', status: 'ok', params: { canvasId: 'c' },
      result: { taskId: 'task-render-1', sourceRevision: 21 }, at: '2026-01-01T00:00:02.000Z',
    },
  ];
  const good = (overrides = {}) => evalParity('R6', {
    nodes: [
      { id: 'node-script', type: 'script', title: 'Storyboard', metadata: { storyboard: { rows: rows(10) } } },
      ...images(10),
    ],
    tasks: [...tasks(10), { id: 'task-render-1', canvasId: 'c', type: 'timeline_render', status: 'succeeded' }],
    timeline: { clips: rows(10).map((row, i) => ({ id: `clip-${i + 1}`, kind: 'image', nodeId: row.imageNodeId })) },
    opLog: renderOpLog(),
    ...overrides,
  });

  test('Passed when 10 lines, 10 first frame bindings, and timeline rendering are successful.', () => {
    expect(good().passed).toBe(true);
  });

  test('10 lines all point to the same bound node and the judgment fails, even though the numbers seem to be correct.', () => {
    const sharedRows = rows(10).map((row) => ({ ...row, imageNodeId: 'node-img-1' }));
    const result = evalParity('R6', {
      nodes: [
        { id: 'node-script', type: 'script', title: 'Storyboard', metadata: { storyboard: { rows: sharedRows } } },
        ...images(10),
      ],
      tasks: [...tasks(10), { id: 'task-render-1', canvasId: 'c', type: 'timeline_render', status: 'succeeded' }],
      timeline: { clips: rows(10).map((row, i) => ({ id: `clip-${i + 1}`, kind: 'image', nodeId: row.imageNodeId })) },
      opLog: renderOpLog(),
    });
    expect(checkOf(result, 'ten_first_frames_bound').passed).toBe(false);
  });

  test('Rendering the old timeline first and then updating the final timeline fails.', () => {
    const result = good({
      opLog: [
        { op: 'canvas.timeline.update', status: 'ok', params: { canvasId: 'c' }, result: { revision: 20 }, at: '2026-01-01T00:00:01.000Z' },
        { op: 'canvas.timeline.render', status: 'ok', params: { canvasId: 'c' }, result: { taskId: 'task-render-1', sourceRevision: 20 }, at: '2026-01-01T00:00:02.000Z' },
        { op: 'canvas.timeline.update', status: 'ok', params: { canvasId: 'c' }, result: { revision: 21 }, at: '2026-01-01T00:00:03.000Z' },
      ],
    });
    expect(checkOf(result, 'timeline_rendered').passed).toBe(false);
  });

  test('Only 9 frames of the first frame failed to bind.', () => {
    const result = evalParity('R6', {
      nodes: [
        { id: 'node-script', type: 'script', title: 'Storyboard', metadata: { storyboard: { rows: rows(10) } } },
        ...images(9),
      ],
      tasks: tasks(9),
      timeline: { clips: rows(9).map((row, i) => ({ id: `clip-${i + 1}`, kind: 'image', nodeId: row.imageNodeId })) },
    });
    expect(checkOf(result, 'ten_first_frames_bound').passed).toBe(false);
    expect(checkOf(result, 'timeline_rendered').passed).toBe(false);
  });

  test('If the storyboard has only 8 lines, it will be judged as failed; if there are failed tasks, it will be judged as failed.', () => {
    const eightRows = evalParity('R6', {
      nodes: [
        { id: 'node-script', type: 'script', title: 'Storyboard', metadata: { storyboard: { rows: rows(8) } } },
        ...images(8),
      ],
      tasks: tasks(8),
      timeline: { clips: [] },
    });
    expect(checkOf(eightRows, 'ten_storyboard_rows').passed).toBe(false);

    const failed = good({ tasks: [...tasks(9), parityTask('node-img-10', { status: 'failed' })] });
    expect(checkOf(failed, 'all_first_frame_tasks_succeeded').passed).toBe(false);
    expect(checkOf(failed, 'no_failed_or_unhandled_calls').passed).toBe(false);
  });
});

describe('R7 changes 4 nodes in a row in the same round: if one change is lost, it will be deemed a failure.', () => {
  const oldNodes = [1, 2, 3, 4].map((n) => ({
    id: `node-r7-text-${n}`, type: 'text', title: `module${n} draft`, metadata: { content: `Draft content${n}` },
  }));
  const expected = [
    ['Plan overview', 'Look at the whole first'], ['Plan storyboard', 'Look at the storyboard again'], ['Project materials', 'All materials are ready'], ['Solution delivery', 'final delivery'],
  ];
  const updated = (skip = -1) => expected.map(([title, content], i) => ({
    id: `node-r7-text-${i + 1}`,
    type: 'text',
    title: i === skip ? `module${i + 1} draft` : title,
    metadata: { content: i === skip ? `Draft content${i + 1}` : content },
  }));

  test('Passed when all 4 corrections are correct, stale_revision only enters the details', () => {
    const result = evalParity('R7', {
      nodes: updated(),
      setupState: { beforeCanvas: { nodes: oldNodes, connections: [] } },
      turnRecords: [turnRecord('All 4 nodes have been modified.')],
      opLog: [
        { op: 'canvas.node.update', status: 'error', reason: 'revision_conflict', params: { canvasId: 'c' } },
        { op: 'canvas.node.update', status: 'ok', params: { canvasId: 'c' } },
      ],
    });
    expect(result.passed).toBe(true);
    expect(checkOf(result, 'all_four_nodes_updated').detail).toContain('stale_revision=1');
  });

  test('One less change will result in failure', () => {
    const result = evalParity('R7', {
      nodes: updated(2),
      setupState: { beforeCanvas: { nodes: oldNodes, connections: [] } },
      turnRecords: [turnRecord('All 4 nodes have been modified.')],
    });
    expect(checkOf(result, 'all_four_nodes_updated').passed).toBe(false);
  });
});

describe('L1 large canvas: Changing to other nodes will also fail.', () => {
  const makeNodes = (count, changedId = '') => Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const id = n === 137 ? 'node-l1-target' : `node-l1-text-${n}`;
    return {
      id, type: 'text', title: `Remarks${n}`,
      metadata: { content: id === changedId ? 'The customer has confirmed this version and will not publish it yet.' : `No.${n} Notes` },
    };
  });
  const before = { nodes: makeNodes(300), connections: [] };

  test('Pass when only changing the target node, and record the number of times the canvas is read and the number of bytes', () => {
    const result = evalParity('L1', {
      nodes: makeNodes(300, 'node-l1-target'),
      setupState: { beforeCanvas: before },
      turnRecords: [turnRecord('Remark 137 has been corrected.')],
      opLog: [
        { op: 'canvas.get', status: 'ok', params: { canvasId: 'c' }, result: { canvas: { nodes: makeNodes(300) } } },
        { op: 'canvas.get', status: 'ok', params: { canvasId: 'c' }, result: { canvas: { nodes: makeNodes(300) } } },
      ],
    });
    expect(result.passed).toBe(true);
    expect(checkOf(result, 'canvas_read_volume_recorded').detail).toContain('Read canvas 2 times');
    expect(checkOf(result, 'canvas_read_volume_recorded').detail).toMatch(/返回 \d+ 字节/);
  });

  test('Failure to modify the second node by mistake', () => {
    const nodes = makeNodes(300, 'node-l1-target');
    nodes[5].metadata.content = 'Changed by the way';
    const result = evalParity('L1', {
      nodes,
      setupState: { beforeCanvas: before },
      turnRecords: [turnRecord('Already corrected.')],
    });
    expect(checkOf(result, 'only_target_changed').passed).toBe(false);
  });
});

// 尺子自检：按正确路径驱动真实 sim-go，确认 6 个替代场景都能判通过。
// 场景里的大时长在测试里缩短到几十毫秒，验证的是判分与任务状态，不是真实等待。
describe('Alternative scenarios use sim-go self-test: all should pass when executed correctly', () => {
  const runScenario = async (code, drive) => {
    const simGo = createSimGo({});
    const canvasId = `canvas-${code.toLowerCase()}-selftest`;
    const scenario = parityScenario(code);
    const setupState = scenario.setup(simGo, canvasId);
    simGo.setTaskTiming(canvasId, { imageMs: 10, videoMs: 20 });
    simGo.beginTurn({ turnId: `turn-${code}-1`, canvasId, permissionMode: 'canvas' });
    const turnRecords = [{ turnId: `turn-${code}-1`, reply: 'Completed and bound to the node.', error: null, durationMs: 1 }];
    try {
      await drive({ simGo, canvasId, setupState, turnRecords });
      return scenario.evaluate({ simGo, canvasId, setupState, turnRecords });
    } finally {
      await simGo.close();
    }
  };

  const imageNodes = (simGo, canvasId) => simGo.ensureCanvas(canvasId).nodes.filter((node) => node.type === 'image');

  test('R1a: After confirmation, the task is completed asynchronously and automatically written back to the node', async () => {
    const result = await runScenario('R1a', async ({ simGo, canvasId }) => {
      const proposal = simGo.executeOp('canvas.generation.propose', {
        canvasId, kind: 'image', nodeIds: ['node-r1-image'],
      }, '', `turn-R1a-1`).result;
      const tasks = await simGo.confirmProposals(proposal.proposalId, { delayMs: 1 });
      await simGo.waitForTasks(tasks.map((task) => task.id), 500);
    });
    expect(result.checks.map((check) => check.name)).toContain('image_task_succeeded');
    expect(result.passed, JSON.stringify(result.checks)).toBe(true);
  });

  test('R1b: Passed only after the first frame and 135 seconds of video are completed', async () => {
    const result = await runScenario('R1b', async ({ simGo, canvasId }) => {
      for (const [kind, nodeIds] of [['image', ['node-r1-image']], ['video', ['node-r1-video']]]) {
        const proposal = simGo.executeOp('canvas.generation.propose', { canvasId, kind, nodeIds }, '', 'turn-R1b-1').result;
        const tasks = await simGo.confirmProposals(proposal.proposalId, { delayMs: 1 });
        await simGo.waitForTasks(tasks.map((task) => task.id), 500);
      }
    });
    expect(result.passed, JSON.stringify(result.checks)).toBe(true);
  });

  test('R3: Wait for the task to be completed between two rounds. In the second round, only the results will be collected without mentioning again.', async () => {
    const result = await runScenario('R3', async ({ simGo, canvasId, turnRecords }) => {
      const first = simGo.executeOp('canvas.generation.propose', {
        canvasId, kind: 'image', nodeIds: ['node-r3-image-1', 'node-r3-image-2'],
      }, '', 'turn-R3-1').result;
      const tasks = await simGo.confirmProposals(first.proposalId, { delayMs: 1 });
      await simGo.waitForTasks(tasks.map((task) => task.id), 500);
      turnRecords.push({ turnId: 'turn-R3-2', reply: 'Both of them are ready and have been placed in the corresponding nodes.', error: null, durationMs: 1 });
    });
    expect(result.passed, JSON.stringify(result.checks)).toBe(true);
  });

  test('R6: 8 lines of preparation + 2 lines of append + 10 first frames + timeline rendering', async () => {
    const result = await runScenario('R6', async ({ simGo, canvasId }) => {
      const row = (n) => ({
        plotDescription: `No.${n} mirror plot`,
        imageGenerationPrompt: `No.${n} First frame prompt word`,
        videoMotionPrompt: `No.${n} mirror mirror`,
        durationSeconds: 5,
      });
      const revision = () => simGo.ensureCanvas(canvasId).revision;
      const prepared = simGo.executeOp('canvas.script.prepare', {
        canvasId,
        expectedRevision: revision(),
        script: { title: '10 mirror storyboards', rows: Array.from({ length: 8 }, (_, i) => row(i + 1)) },
        image: { model: 'seedream-3.0' },
      }, 'prepare-8', 'turn-R6-1').result;
      const scriptNodeId = prepared.nodeId;
      const appended = simGo.executeOp('canvas.script.rows.append', {
        canvasId,
        nodeId: scriptNodeId,
        expectedRevision: revision(),
        rows: [row(9), row(10)],
      }, 'append-2', 'turn-R6-1').result;
      simGo.executeOp('canvas.script.prepare', {
        canvasId,
        nodeId: scriptNodeId,
        expectedRevision: revision(),
        rowIds: appended.created.map((item) => item.id),
        image: { model: 'seedream-3.0' },
      }, 'prepare-2-more', 'turn-R6-1');

      const images = imageNodes(simGo, canvasId);
      for (let start = 0; start < images.length; start += 8) {
        const proposal = simGo.executeOp('canvas.generation.propose', {
          canvasId, kind: 'image', nodeIds: images.slice(start, start + 8).map((node) => node.id),
        }, '', 'turn-R6-1').result;
        const tasks = await simGo.confirmProposals(proposal.proposalId, { delayMs: 1 });
        await simGo.waitForTasks(tasks.map((task) => task.id), 1000);
      }

      const clips = images.map((node, index) => ({
        id: `clip-${index + 1}`, kind: 'image', trackId: 'track-1', nodeId: node.id,
        startMs: index * 3000, durationMs: 3000,
      }));
      simGo.executeOp('canvas.timeline.update', {
        canvasId,
        expectedRevision: revision(),
        timeline: { version: 2, tracks: [{ id: 'track-1', kind: 'image' }], clips, durationMs: clips.length * 3000 },
      }, 'timeline-update', 'turn-R6-1');
      simGo.executeOp('canvas.timeline.render', {
        canvasId, expectedRevision: revision(),
      }, 'timeline-render', 'turn-R6-1');
    });
    expect(result.passed, JSON.stringify(result.checks)).toBe(true);
  });

  test('R7: Change 4 text nodes continuously in the same round', async () => {
    const result = await runScenario('R7', async ({ simGo, canvasId }) => {
      const expected = [
        ['Plan overview', 'Look at the whole first'], ['Plan storyboard', 'Look at the storyboard again'], ['Project materials', 'All materials are ready'], ['Solution delivery', 'final delivery'],
      ];
      for (let i = 0; i < 4; i++) {
        simGo.executeOp('canvas.node.update', {
          canvasId,
          nodeId: `node-r7-text-${i + 1}`,
          expectedRevision: simGo.ensureCanvas(canvasId).revision,
          patch: { title: expected[i][0], content: expected[i][1] },
        }, `update-${i + 1}`, 'turn-R7-1');
      }
    });
    expect(result.passed, JSON.stringify(result.checks)).toBe(true);
  });

  test('L1: 300 node canvas only changes one after positioning by title', async () => {
    const result = await runScenario('L1', async ({ simGo, canvasId }) => {
      simGo.executeOp('canvas.node.update', {
        canvasId,
        nodeId: 'node-l1-target',
        expectedRevision: simGo.ensureCanvas(canvasId).revision,
        patch: { content: 'The customer has confirmed this version and will not publish it yet.' },
      }, 'update-target', 'turn-L1-1');
    });
    expect(result.passed, JSON.stringify(result.checks)).toBe(true);
  });
});
