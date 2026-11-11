import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSimGo } from './sim-go.mjs';
import { confirmPendingProposals } from './run-external-eval.mjs';
import { SCENARIOS, resolveScenarioList, buildS3SeedCanvas } from './scenarios.mjs';
import {
  parseCliArgs,
  validateEvalConfig,
  redactSecrets,
  extractModelRequestTrace,
  createCostMeter,
  computeScenarioMetrics,
  buildEvalSummary,
  renderMarkdownReport,
  runEval,
  requestSessionKey,
  elideDataUrls,
  waitForCanvasIdle,
  createRequestTracker,
  runOwnRequestHooks,
} from './run-eval.mjs';
import http from 'node:http';

describe('sim-go memory version Go business authoritative simulator test', () => {
  test('Supports /api/ops, canvas CRUD, CAS revision conflict detection and opId idempotent replay', async () => {
    const sim = createSimGo({ hostToken: 'secret-token' });
    await sim.listen(0);
    try {
      // 未授权 token 应被拒绝
      const unauth = await fetch(`${sim.opsUrl}/ops`, {
        headers: { 'X-Beeftv-Agent-Token': 'wrong-token' },
      });
      expect(unauth.status).toBe(403);

      // 正常获取描述符
      const opsRes = await fetch(`${sim.opsUrl}/ops`, {
        headers: { 'X-Beeftv-Agent-Token': 'secret-token' },
      });
      expect(opsRes.status).toBe(200);
      const opsJson = await opsRes.json();
      expect(opsJson.code).toBe(0);
      expect(opsJson.data.ops.length).toBeGreaterThan(10);

      // 读取初始画布 revision=1
      const get1 = sim.executeOp('canvas.get', { canvasId: 'canvas-1' });
      expect(get1.result.canvas.revision).toBe(1);

      // 创建节点成功推进到 revision=2，且相同 opId 重放不重复创建
      const create1 = sim.executeOp(
        'canvas.nodes.create',
        {
          canvasId: 'canvas-1',
          expectedRevision: 1,
          nodes: [
            { type: 'script', title: 'Storyboard' },
            { type: 'image', title: 'Mirror 1 first frame', prompt: 'Neon street on rainy night' },
            { type: 'video', title: 'mirror 1 video', prompt: 'Camera slowly zooms in' },
          ],
        },
        'op-create-1',
        'turn-1',
      );
      expect(create1.replayed).toBe(false);
      expect(create1.result.revision).toBe(2);
      expect(create1.result.created.length).toBe(3);

      const replay1 = sim.executeOp(
        'canvas.nodes.create',
        {
          canvasId: 'canvas-1',
          expectedRevision: 1,
          nodes: [
            { type: 'script', title: 'Storyboard' },
            { type: 'image', title: 'Mirror 1 first frame', prompt: 'Neon street on rainy night' },
            { type: 'video', title: 'mirror 1 video', prompt: 'Camera slowly zooms in' },
          ],
        },
        'op-create-1',
        'turn-1',
      );
      expect(replay1.replayed).toBe(true);
      expect(replay1.result.revision).toBe(2);

      // 过期 expectedRevision=1 写操作触发 CAS revision_conflict
      expect(() =>
        sim.executeOp(
          'canvas.node.update',
          {
            canvasId: 'canvas-1',
            nodeId: create1.result.created[1].id,
            expectedRevision: 1,
            patch: { content: 'new prompt word' },
          },
          'op-stale-1',
        ),
      ).toThrow(/画布已变化/);
      expect(sim.counts.revisionConflicts).toBe(1);

      // 用户手动编辑模拟推进 revision，随后旧版本写入被拒
      const afterUserEdit = sim.userEditNode(create1.result.created[1].id, { content: 'User manually changes the prompt word' }, 'canvas-1');
      expect(afterUserEdit.revision).toBe(3);
      expect(sim.counts.userEdits).toBe(1);
    } finally {
      await sim.close();
    }
  });

  test('The addition, deletion and modification of storyboard rows are consistent with the binding of imageNodeId/videoNodeId output connections.', () => {
    const sim = createSimGo();
    const created = sim.executeOp(
      'canvas.nodes.create',
      {
        canvasId: 'canvas-1',
        expectedRevision: 1,
        nodes: [
          { type: 'script', title: 'Storyboard' },
          { type: 'image', title: 'Mirror 1 first frame', prompt: 'First frame A' },
          { type: 'image', title: 'Mirror 1 alternative first frame', prompt: 'First frame B' },
          { type: 'video', title: 'mirror 1 video', prompt: 'Video A' },
        ],
      },
      'op-init',
    ).result.created;

    const [scriptNode, img1, img2, vid1] = created;

    const appended = sim.executeOp(
      'canvas.script.rows.append',
      {
        canvasId: 'canvas-1',
        nodeId: scriptNode.id,
        expectedRevision: 2,
        rows: [
          { durationSeconds: 5, plotDescription: 'first shot', dialogue: 'Line 1' },
          { durationSeconds: 5, plotDescription: 'second shot', dialogue: 'Line 2' },
        ],
      },
      'op-append',
    ).result;
    expect(appended.rowCount).toBe(2);
    const row1Id = appended.created[0].id;
    const row2Id = appended.created[1].id;

    // 绑定 row1 -> img1 与 vid1，应自动创建两条 storyboard-output 连线
    const update1 = sim.executeOp(
      'canvas.script.row.update',
      {
        canvasId: 'canvas-1',
        nodeId: scriptNode.id,
        expectedRevision: 3,
        patches: [{ rowId: row1Id, imageNodeId: img1.id, videoNodeId: vid1.id }],
      },
      'op-row-bind-1',
    ).result;
    expect(update1.createdEdgeIds.length).toBe(2);

    // 改绑 row1 -> img2，旧 img1 连线应被自动替换删除
    const update2 = sim.executeOp(
      'canvas.script.row.update',
      {
        canvasId: 'canvas-1',
        nodeId: scriptNode.id,
        expectedRevision: 4,
        patches: [{ rowId: row1Id, imageNodeId: img2.id }],
      },
      'op-row-bind-2',
    ).result;
    expect(update2.createdEdgeIds.length).toBe(1);
    expect(update2.deletedEdgeIds.length).toBe(1);

    // 删除 row1，其关联的产出连线也一并清除，剩余行重新编号为 1
    const removed = sim.executeOp(
      'canvas.script.row.remove',
      {
        canvasId: 'canvas-1',
        nodeId: scriptNode.id,
        expectedRevision: 5,
        rowIds: [row1Id],
      },
      'op-row-remove',
    ).result;
    expect(removed.rowCount).toBe(1);
    expect(removed.deletedEdgeIds.length).toBe(2);

    const doc = sim.executeOp('canvas.get', { canvasId: 'canvas-1' }).result.canvas;
    const remainingRows = doc.nodes.find((n) => n.id === scriptNode.id).metadata.storyboard.rows;
    expect(remainingRows.length).toBe(1);
    expect(remainingRows[0].id).toBe(row2Id);
    expect(remainingRows[0].shotNumber).toBe(1);
  });

  test('The storyboard prompt word synchronization receipt lists the associated nodes and fields, and the manually modified nodes are not listed.', () => {
    const sim = createSimGo();
    const canvasId = 'canvas-sync-receipt';
    sim.ensureCanvas(canvasId, {
      id: canvasId,
      revision: 1,
      nodes: [
        {
          id: 'script', type: 'script', title: 'Storyboard',
          metadata: { storyboard: { rows: [
            { id: 'r1', shotNumber: 1, imageGenerationPrompt: 'old first frame', imageNodeId: 'img-1' },
            { id: 'r2', shotNumber: 2, videoMotionPrompt: 'old videos', videoNodeId: 'vid-1' },
          ] } },
        },
        { id: 'img-1', type: 'image', title: 'first frame', metadata: { composerContent: 'old first frame', prompt: 'old first frame', status: 'idle' } },
        { id: 'vid-1', type: 'video', title: 'video', metadata: { composerContent: 'User manual modification', prompt: 'User manual modification', status: 'idle' } },
      ],
      connections: [],
    });
    const result = sim.executeOp('canvas.script.row.update', {
      canvasId, nodeId: 'script', expectedRevision: 1,
      patches: [
        { rowId: 'r1', imageGenerationPrompt: 'new first frame' },
        { rowId: 'r2', videoMotionPrompt: 'new video' },
      ],
    }, 'op-sync-receipt').result;
    expect(result.syncedNodeIds).toEqual(['img-1']);
    expect(result.skippedNodeIds).toEqual(['vid-1']);
    expect(result.alsoChanged).toEqual([
      { nodeId: 'img-1', title: 'first frame', fields: ['composerContent', 'prompt'] },
    ]);
  });

  test('When the binding product recycles the assetId of other nodes, the receipt lists the associated nodes.', () => {
    const sim = createSimGo();
    sim.assets.set('asset-ref', {
      id: 'asset-ref', resourceId: 'res-ref',
      payloadJson: JSON.stringify({ data: { storageKey: 'resource:res-ref' } }),
    });
    sim.ensureCanvas('canvas-bind-receipt', {
      id: 'canvas-bind-receipt', revision: 1,
      nodes: [
        { id: 'slot', type: 'image', metadata: { storageKey: 'resource:res-ref', content: '/api/resources/res-ref/file' } },
        { id: 'root', type: 'image', metadata: { isBatchRoot: true, primaryImageId: 'slot', storageKey: 'resource:res-ref' } },
        { id: 'video', type: 'video', metadata: { taskId: 'task-1' } },
      ],
      connections: [],
    });
    sim.tasks.set('task-1', {
      id: 'task-1', type: 'video', status: 'succeeded', progress: 100, canvasId: 'canvas-bind-receipt',
      outputs: [{ index: 0, assetId: 'asset-video', resourceId: 'res-video', storageKey: 'resource:res-video', mimeType: 'video/mp4' }],
    });
    const result = sim.executeOp('canvas.task.bind', {
      canvasId: 'canvas-bind-receipt', taskId: 'task-1', nodeId: 'video', outputIndex: 0,
    }, 'op-bind-receipt').result;
    expect(result.alsoChanged).toEqual([
      { nodeId: 'slot', fields: ['assetId'] },
      { nodeId: 'root', fields: ['assetId'] },
    ]);
    expect(result.alsoChanged.some((item) => item.nodeId === 'video')).toBe(false);
  });

  test('When there is no main resource in the material body, the assetId will not be backfilled and changes will not be reported.', () => {
    const sim = createSimGo();
    sim.assets.set('asset-empty', { id: 'asset-empty', resourceId: 'res-ref', payloadJson: '{}' });
    sim.ensureCanvas('canvas-empty-asset', {
      id: 'canvas-empty-asset', revision: 1,
      nodes: [
        { id: 'slot', type: 'image', title: 'missing binding', metadata: {
          storageKey: 'resource:res-ref',
          content: '/api/resources/res-ref/file',
        } },
        { id: 'video', type: 'video', metadata: { taskId: 'task-1' } },
      ],
      connections: [],
    });
    sim.tasks.set('task-1', {
      id: 'task-1', type: 'video', status: 'succeeded', progress: 100, canvasId: 'canvas-empty-asset',
      outputs: [{ index: 0, assetId: 'asset-video', resourceId: 'res-video', storageKey: 'resource:res-video', mimeType: 'video/mp4' }],
    });
    const result = sim.executeOp('canvas.task.bind', {
      canvasId: 'canvas-empty-asset', taskId: 'task-1', nodeId: 'video', outputIndex: 0,
    }, 'op-empty-asset').result;
    expect(result.alsoChanged).toBeUndefined();
    const doc = sim.ensureCanvas('canvas-empty-asset');
    expect(doc.nodes.find((node) => node.id === 'slot').metadata.assetId).toBeUndefined();
  });

  test('Resource backfill analyzes storageKey and content item by item, and old paths do not obscure valid resources.', () => {
    const sim = createSimGo();
    sim.assets.set('asset-legacy', {
      id: 'asset-legacy', resourceId: 'res-legacy',
      payloadJson: JSON.stringify({ data: { storageKey: 'resource:res-legacy' } }),
    });
    sim.ensureCanvas('canvas-legacy-resource', {
      id: 'canvas-legacy-resource', revision: 1,
      nodes: [
        { id: 'legacy', type: 'image', title: 'old path node', metadata: {
          storageKey: 'legacy/path/not-a-resource',
          content: '/api/resources/res-legacy/file?token=1',
        } },
        { id: 'video', type: 'video', metadata: { taskId: 'task-1' } },
      ],
      connections: [],
    });
    sim.tasks.set('task-1', {
      id: 'task-1', type: 'video', status: 'succeeded', progress: 100, canvasId: 'canvas-legacy-resource',
      outputs: [{ index: 0, assetId: 'asset-video', resourceId: 'res-video', storageKey: 'resource:res-video', mimeType: 'video/mp4' }],
    });
    const result = sim.executeOp('canvas.task.bind', {
      canvasId: 'canvas-legacy-resource', taskId: 'task-1', nodeId: 'video', outputIndex: 0,
    }, 'op-legacy-resource').result;
    expect(result.alsoChanged).toEqual([
      { nodeId: 'legacy', title: 'old path node', fields: ['assetId'] },
    ]);
    const doc = sim.ensureCanvas('canvas-legacy-resource');
    expect(doc.nodes.find((node) => node.id === 'legacy').metadata.assetId).toBe('asset-legacy');
  });

  test('Timeline Media also parses resource sources one by one and backfills the assetId.', () => {
    const sim = createSimGo();
    sim.assets.set('asset-timeline', {
      id: 'asset-timeline', resourceId: 'res-timeline',
      payloadJson: JSON.stringify({ data: { storageKey: 'resource:res-timeline' } }),
    });
    sim.ensureCanvas('canvas-legacy-timeline', {
      id: 'canvas-legacy-timeline', revision: 1,
      nodes: [{ id: 'video', type: 'video', metadata: { taskId: 'task-1' } }],
      connections: [],
      timeline: {
        version: 2, durationMs: 1000, tracks: [{ id: 'track-1', kind: 'video' }],
        clips: [{ id: 'clip-1', kind: 'video', trackId: 'track-1', startMs: 0, durationMs: 1000,
          directMedia: { kind: 'video', storageKey: 'legacy/path', url: '/api/resources/res-timeline/file?x=1' } }],
      },
    });
    sim.tasks.set('task-1', {
      id: 'task-1', type: 'video', status: 'succeeded', progress: 100, canvasId: 'canvas-legacy-timeline',
      outputs: [{ index: 0, assetId: 'asset-video', resourceId: 'res-video', storageKey: 'resource:res-video', mimeType: 'video/mp4' }],
    });
    sim.executeOp('canvas.task.bind', {
      canvasId: 'canvas-legacy-timeline', taskId: 'task-1', nodeId: 'video', outputIndex: 0,
    }, 'op-legacy-timeline');
    const doc = sim.ensureCanvas('canvas-legacy-timeline');
    expect(doc.timeline.clips[0].directMedia.assetId).toBe('asset-timeline');
  });

  test('Existing material text that legally references secondary resources will not be replaced and will not enter alsoChanged.', () => {
    const sim = createSimGo();
    sim.assets.set('asset-declared', {
      id: 'asset-declared', resourceId: 'res-main',
      payloadJson: JSON.stringify({
        data: { storageKey: 'resource:res-main' },
        metadata: { referenceUrl: '/api/resources/res-secondary/file' },
      }),
    });
    sim.assets.set('asset-primary', {
      id: 'asset-primary', resourceId: 'res-secondary',
      payloadJson: JSON.stringify({ data: { storageKey: 'resource:res-secondary' } }),
    });
    sim.assets.set('asset-other', {
      id: 'asset-other', resourceId: 'res-other',
      payloadJson: JSON.stringify({ data: { storageKey: 'resource:res-other' } }),
    });
    sim.ensureCanvas('canvas-secondary-ref', {
      id: 'canvas-secondary-ref', revision: 1,
      nodes: [
        { id: 'slot', type: 'image', title: 'Legal secondary reference', metadata: {
          assetId: 'asset-declared',
          storageKey: 'resource:res-secondary',
          content: '/api/resources/res-secondary/file',
        } },
        { id: 'missing', type: 'image', title: 'To be backfilled', metadata: {
          storageKey: 'resource:res-other',
          content: '/api/resources/res-other/file',
        } },
        { id: 'video', type: 'video', metadata: { taskId: 'task-1' } },
      ],
      connections: [],
    });
    sim.tasks.set('task-1', {
      id: 'task-1', type: 'video', status: 'succeeded', progress: 100, canvasId: 'canvas-secondary-ref',
      outputs: [{ index: 0, assetId: 'asset-video', resourceId: 'res-video', storageKey: 'resource:res-video', mimeType: 'video/mp4' }],
    });
    const result = sim.executeOp('canvas.task.bind', {
      canvasId: 'canvas-secondary-ref', taskId: 'task-1', nodeId: 'video', outputIndex: 0,
    }, 'op-secondary-ref').result;
    expect(result.alsoChanged).toEqual([
      { nodeId: 'missing', title: 'To be backfilled', fields: ['assetId'] },
    ]);
    const doc = sim.ensureCanvas('canvas-secondary-ref');
    expect(doc.nodes.find((node) => node.id === 'slot').metadata.assetId).toBe('asset-declared');
  });

  test('Bind and unbind the action demo board connection of the same storyboard line in the first frame.', () => {
    const sim = createSimGo();
    const canvasId = 'canvas-action-board';
    sim.ensureCanvas(canvasId, {
      id: canvasId, revision: 1,
      nodes: [
        { id: 'script', type: 'script', metadata: { storyboard: { rows: [{ id: 'row-1' }] } } },
        { id: 'board', type: 'image', metadata: { workflowKind: 'action_board' } },
        { id: 'frame', type: 'image', metadata: {} },
      ],
      connections: [{ id: 'board-edge', fromNodeId: 'script', toNodeId: 'board', fromHandleId: 'row:row-1' }],
    });
    for (const [index, imageNodeId] of ['frame', ''].entries()) {
      const result = sim.executeOp('canvas.script.row.update', {
        canvasId, nodeId: 'script', expectedRevision: index + 1,
        patches: [{ rowId: 'row-1', imageNodeId }],
      }, `bind-frame-${index}`).result;
      expect(result.deletedEdgeIds).not.toContain('board-edge');
      const doc = sim.ensureCanvas(canvasId);
      expect(doc.connections.some((edge) => edge.id === 'board-edge')).toBe(true);
      expect(doc.connections.filter((edge) => edge.toNodeId === 'frame').length).toBe(imageNodeId ? 1 : 0);
    }
  });

  test('Generate proposal confirmation, failure simulation, defect screen media.inspect and round undo', async () => {
    const sim = createSimGo({ taskDelayMs: 5 });
    await sim.listen(0);
    try {
      sim.beginTurn({ turnId: 'turn-gen-1', canvasId: 'canvas-1' });
      const created = sim.executeOp(
        'canvas.nodes.create',
        {
          canvasId: 'canvas-1',
          expectedRevision: 1,
          nodes: [
            { type: 'image', title: 'Mirror 1 first frame', prompt: 'Rainy night detective close-up' },
            { type: 'image', title: 'Mirror 2 first frame', prompt: 'Dark alley chase' },
          ],
        },
        'op-c1',
        'turn-gen-1',
      ).result.created;

      // 拒绝未经确认的直接生成任务请求
      const unconfirmedRes = await fetch(`${sim.baseUrl}/api/generation-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasId: 'canvas-1', nodeId: created[0].id, ConfirmedByUser: false }),
      });
      expect(unconfirmedRes.status).toBe(403);
      expect(sim.counts.unconfirmedTasks).toBe(1);

      // 发起生成提议
      const prop = sim.executeOp(
        'canvas.generation.propose',
        {
          canvasId: 'canvas-1',
          kind: 'image',
          nodeIds: [created[0].id, created[1].id],
          note: 'Test proposal',
        },
        'op-prop-1',
        'turn-gen-1',
      ).result;
      expect(prop.proposalId).toBeTruthy();

      // 预设第 1 个节点生成画面带六指缺陷，第 2 个节点生成失败
      sim.flagNextTaskDefect('Six-finger deformity of the right hand', created[0].id);
      sim.failNextTask('upstream_timeout', created[1].id);

      const tasks = await sim.confirmProposals(prop.proposalId, { delayMs: 5 });
      expect(tasks.length).toBe(2);
      expect(tasks[0].status).toBe('succeeded');
      expect(tasks[1].status).toBe('failed');

      // media.inspect 必须先读 overview 取得版本；缺版本按真实后端的 media_version_required 拒绝
      const overviewRes = sim.executeOp('media.overview', {
        canvasId: 'canvas-1',
        nodeId: created[0].id,
      }).result;
      expect(() => sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        nodeId: created[0].id,
      })).toThrow(/expectedVersion/);
      expect(() => sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        nodeId: created[0].id,
        expectedVersion: 'stale-version',
      })).toThrow(/素材内容已变化/);
      const inspectRes = sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        nodeId: created[0].id,
        expectedVersion: overviewRes.source.version,
      }).result;
      expect(inspectRes.note).toContain('Six-finger deformity of the right hand');
      expect(inspectRes.content.length).toBe(1);

      // 受控可恢复错误：即使这次也漏了 expectedVersion，第一次针对目标节点的 inspect 仍返回 stale_media_version
      sim.armNextMediaInspectError('canvas-1', created[0].id);
      expect(() => sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        nodeId: created[0].id,
      })).toThrow(/素材内容已变化/);
      const inspectAfterRecovery = sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        nodeId: created[0].id,
        expectedVersion: overviewRes.source.version,
      }).result;
      expect(inspectAfterRecovery.content.length).toBe(1);

      // 用素材 ID 读取同样能命中受控错误并恢复；节点声明的 assetId 与素材表必须一致。
      const assetId = tasks[0].outputs[0].assetId;
      sim.armNextMediaInspectError('canvas-1', created[0].id);
      const assetOverview = sim.executeOp('media.overview', {
        canvasId: 'canvas-1',
        assetId,
      }).result;
      expect(assetOverview.source.version).toBe(overviewRes.source.version);
      expect(() => sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        assetId,
      })).toThrow(/素材内容已变化/);
      const assetInspect = sim.executeOp('media.inspect', {
        canvasId: 'canvas-1',
        assetId,
        expectedVersion: assetOverview.source.version,
      }).result;
      expect(assetInspect.content.length).toBe(1);

      const pngBytes = Buffer.from(inspectRes.content[0].data, 'base64');
      const sha = crypto.createHash('sha256').update(pngBytes).digest('hex');
      expect(sha).toBe(inspectRes.content[0].sha256);

      // 撤销回合 turn-gen-1，画布节点回到初始空状态，且再次确认该回合提议会被拒绝
      const undone = sim.undoTurn('turn-gen-1', 'canvas-1');
      expect(undone.undone).toBe(true);
      expect(undone.canvas.nodes.length).toBe(0);
      await expect(sim.confirmProposals(prop.proposalId)).rejects.toThrow(/已撤销/);
    } finally {
      await sim.close();
    }
  });
});

describe('Budget access control, key desensitization and evaluation configuration verification testing', () => {
  test('--model real refuses to start when the unit price is missing or the unit price is 0', () => {
    const args = parseCliArgs(['--model', 'real', '--scenario', 'S1', '--budget-cny', '10']);
    expect(() => validateEvalConfig(args, {})).toThrow(/real_mode_price_missing/);
    expect(() =>
      validateEvalConfig(args, {
        BEEFTV_EVAL_PRICE_IN: '0',
        BEEFTV_EVAL_PRICE_OUT: '15',
      }),
    ).toThrow(/real_mode_price_missing/);
    expect(() =>
      validateEvalConfig(args, {
        BEEFTV_EVAL_PRICE_IN: '2',
        BEEFTV_EVAL_PRICE_OUT: '8',
      }),
    ).toThrow(/real_mode_credentials_missing/);

    const valid = validateEvalConfig(args, {
      BEEFTV_EVAL_PRICE_IN: '2.5',
      BEEFTV_EVAL_PRICE_OUT: '10',
      BEEFTV_AGENT_BASE_URL: 'https://example.invalid/v1',
      BEEFTV_AGENT_API_KEY: 'sk-test-secret-123456',
      BEEFTV_AGENT_MODEL: 'gpt-test',
    });
    expect(valid.modelMode).toBe('real');
    expect(valid.priceInPerMillion).toBe(2.5);
    expect(valid.priceOutPerMillion).toBe(10);
  });

  test('When the accumulated expenses exceed the upper limit of the budget, the aborted_budget circuit breaker is immediately triggered and recorded in ledger.jsonl', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beeftv-meter-test-'));
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    try {
      const meter = createCostMeter({
        mode: 'fake',
        budgetCny: 0.05,
        priceInPerMillion: 100, // 每万 token 1 元
        priceOutPerMillion: 200,
        ledgerPath,
      });
      meter.setContext({ runIndex: 1, scenarioId: 'shortdrama-2shot', turnId: 't1' });

      // 第 1 笔请求花费 0.03 元，未超 0.05 元
      const e1 = meter.recordRequest({ inputTokens: 100, outputTokens: 100, durationMs: 10 });
      expect(e1.costCny).toBeCloseTo(0.03, 5);
      expect(e1.abortedBudget).toBe(false);

      // 第 2 笔请求再花 0.03 元，累计 0.06 元 > 0.05 元，立即抛 aborted_budget
      expect(() => meter.recordRequest({ inputTokens: 100, outputTokens: 100, durationMs: 10 })).toThrow(
        /aborted_budget/,
      );
      expect(meter.getState().abortedBudget).toBe(true);

      // 后续派发前检查也直接拒绝
      expect(() => meter.checkBudgetBeforeDispatch()).toThrow(/aborted_budget/);

      const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[1]).abortedBudget).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('redactSecrets completely desensitizes environment variable keys, sk-* and Bearer Token', () => {
    const raw = {
      apiKey: 'sk-live-9876543210abcdef',
      nested: {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        note: 'Call failed: Bearer secret_token_xyz123 and key=sk-abcdef1234567890 and custom-sec-9999',
      },
    };
    const cleaned = redactSecrets(raw, ['custom-sec-9999']);
    const serialized = JSON.stringify(cleaned);
    expect(serialized).not.toContain('sk-live-9876543210abcdef');
    expect(serialized).not.toContain('sk-abcdef1234567890');
    expect(serialized).not.toContain('secret_token_xyz123');
    expect(serialized).not.toContain('custom-sec-9999');
    expect(cleaned.apiKey).toBe('[REDACTED]');
    expect(cleaned.nested.Authorization).toBe('[REDACTED]');
  });

  test('Scene selector and end-to-end single scene fake evaluation passed', async () => {
    expect(resolveScenarioList('all').length).toBe(11);
    expect(resolveScenarioList('S1,S3').map((s) => s.code)).toEqual(['S1', 'S3']);
    expect(buildS3SeedCanvas('c-s3').nodes.length).toBe(9);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beeftv-eval-e2e-'));
    try {
      const res = await runEval({
        scenario: 'S2',
        model: 'fake',
        runs: 1,
        maxRequests: 15,
        budgetCny: 10,
        outDir,
      });
      expect(res.report.status).toBe('passed');
      expect(res.report.scenarios.length).toBe(1);
      expect(res.report.scenarios[0].metrics.passed).toBe(true);
      expect(res.report.scenarios[0].metrics.eliminableRequests).toBeGreaterThanOrEqual(1);
      const td = res.report.scenarios[0].turnDiagnostics[0];
      expect(td.requestCount).toBe(5);
      expect(td.eliminableRequestCount).toBe(3);
      expect(td.toolSequence).toEqual([
        'R1:canvas_get[can be omitted]',
        'R2:canvas_nodes_create',
        'R3:canvas_script_rows_append[can be omitted]',
        'R4:canvas_script_row_update[can be omitted]',
        'R5:<reply>',
      ]);
      expect(Array.isArray(td.requests)).toBe(true);
      expect(td.requests.length).toBe(5);
      expect(fs.existsSync(res.jsonPath)).toBe(true);
      expect(fs.existsSync(res.mdPath)).toBe(true);
      expect(fs.existsSync(res.ledgerPath)).toBe(true);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('extractModelRequestTrace identification tool error retry, empty canvas canvas_get, separate plan_update and serial step-by-step canvas change', () => {
    const sseWithTool = (name, argsObj) =>
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { name, arguments: JSON.stringify(argsObj) } }],
            },
          },
        ],
      })}\n\ndata: [DONE]\n`;

    // 1) 空画布已有 <beeftv_studio> 仍调用 canvas_get -> 可省往返
    const tEmptyGet = extractModelRequestTrace(
      {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'Help me do a two-shot skit' },
          { role: 'user', content: '<beeftv_studio>\n[Production scene｜Canvas version 1]\nOverview: The canvas is empty.\n</beeftv_studio>' },
        ],
      },
      sseWithTool('canvas_get', { canvasId: 'c1' }),
      [],
    );
    expect(tEmptyGet.trigger).toBe('user_message');
    expect(tEmptyGet.responseTools).toEqual(['canvas_get']);
    expect(tEmptyGet.eliminable).toBe(true);
    expect(tEmptyGet.eliminableReason).toContain('The empty canvas already has <beeftv_studio>');

    // 2) 工具报错触发的下一跳重试 -> 可省往返
    const tErrRetry = extractModelRequestTrace(
      {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'Help me create storyboards' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'tc-1', function: { name: 'canvas_script_prepare', arguments: '{}' } }],
          },
          { role: 'tool', tool_call_id: 'tc-1', content: '{"error":"模拟器未实现操作: canvas.script.prepare"}' },
          { role: 'user', content: '<beeftv_studio>\nOverview: The canvas is empty.\n</beeftv_studio>' },
        ],
      },
      sseWithTool('canvas_nodes_create', { nodes: [{ type: 'script', title: 'Storyboard' }] }),
      [],
    );
    expect(tErrRetry.trigger).toBe('tool_error_result');
    expect(tErrRetry.eliminable).toBe(true);
    expect(tErrRetry.eliminableReason).toContain('canvas_script_prepare:unsupported_operation');

    // 3) 单独调用 plan_update -> 可省往返
    const tPlanOnly = extractModelRequestTrace(
      {
        messages: [{ role: 'user', content: 'start' }],
      },
      sseWithTool('plan_update', { steps: [{ title: 'Step 1', status: 'in_progress' }] }),
      [],
    );
    expect(tPlanOnly.eliminable).toBe(true);
    expect(tPlanOnly.eliminableReason).toContain('Call plan_update alone');

    // 4) 同轮第二次串行写画布 -> 可省往返
    const tSerialWrite = extractModelRequestTrace(
      {
        messages: [
          { role: 'user', content: 'storyboard' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'tc-2', function: { name: 'canvas_nodes_create', arguments: '{}' } }],
          },
          { role: 'tool', tool_call_id: 'tc-2', content: '{"revision":2}' },
        ],
      },
      sseWithTool('canvas_script_rows_append', { nodeId: 'n1', rows: [{ plotDescription: 'Mirror 1' }] }),
      [{ responseTools: ['canvas_nodes_create'] }],
    );
    expect(tSerialWrite.eliminable).toBe(true);
    expect(tSerialWrite.eliminableReason).toContain('Serial step-by-step canvas modification');

    // 5) 真实宿主格式识别：planContinuation、supplementMarker (/steer) 与 <canvas_event>
    const tPlanCont = extractModelRequestTrace(
      {
        messages: [
          {
            role: 'user',
            content: 'The plan is not finished yet. Continue to "Create the first frame node"; when finished, use plan_update to update the status.',
          },
        ],
      },
      sseWithTool('canvas_nodes_create', { nodes: [] }),
      [],
    );
    expect(tPlanCont.trigger).toBe('plan_continue');
    expect(tPlanCont.eliminable).toBe(true);
    expect(tPlanCont.eliminableReason).toContain('planContinuation');

    const tSteer = extractModelRequestTrace(
      {
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'tc-s1', function: { name: 'canvas_nodes_create', arguments: '{}' } }],
          },
          { role: 'tool', tool_call_id: 'tc-s1', content: '{"revision":2}' },
          {
            role: 'user',
            content: [{ type: 'text', text: '[BEEFTV_INPUT:1]' }, { type: 'text', text: 'Change to Cyberpunk 2 Mirror' }],
          },
        ],
      },
      sseWithTool('canvas_nodes_create', { nodes: [] }),
      [{ responseTools: ['canvas_nodes_create'] }],
    );
    expect(tSteer.trigger).toBe('user_steer');
    expect(tSteer.prevTools.map((t) => t.name)).toEqual(['canvas_nodes_create']);
    // user_steer 触发的重写不计为可省串行写
    expect(tSteer.eliminable).toBe(false);

    const tWake = extractModelRequestTrace(
      {
        messages: [{ role: 'user', content: '<canvas_event kind="generation_finished">\nOK\n</canvas_event>' }],
      },
      sseWithTool('media_overview', { nodeId: 'n1' }),
      [],
    );
    expect(tWake.trigger).toBe('auto_wake');

    // 6) plan_update 与 canvas_generation_propose 同批调用导致多一次总结请求
    const tPostProposeReply = extractModelRequestTrace(
      {
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'tc-p1', function: { name: 'plan_update', arguments: '{}' } },
              { id: 'tc-p2', function: { name: 'canvas_generation_propose', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'tc-p1', content: '{"ok":true}' },
          { role: 'tool', tool_call_id: 'tc-p2', content: '{"proposalId":"prop-1"}' },
        ],
      },
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Proposal generation initiated' } }] })}\n\ndata: [DONE]\n`,
      [],
    );
    expect(tPostProposeReply.eliminable).toBe(true);
    expect(tPostProposeReply.eliminableReason).toContain('terminate is not effective');
  });

  test('It is known that automatic wake-up notch cannot cover up first-round failure or completion event delivery failure.', () => {
    const scenario = SCENARIOS.find((item) => item.code === 'S5');
    const simGo = createSimGo();
    scenario.setup(simGo, 'canvas-s5');
    const result = scenario.evaluate({ simGo, canvasId: 'canvas-s5', wakeResult: { eventAccepted: true, autoWoken: false } });
    expect(result.status).toBe('failed');
    const rejectedEvent = scenario.evaluate({ simGo, canvasId: 'canvas-s5', wakeResult: { eventAccepted: false, autoWoken: false } });
    expect(rejectedEvent.status).toBe('failed');
    expect(rejectedEvent.capabilityGap).toBeNull();
    const summaryWithUnexpectedGap = buildEvalSummary(
      [
        {
          scenarioId: 'post-generation-review',
          expectedBaselinePass: true,
          metrics: {
            status: 'baseline_gap',
            passed: false,
            structuralCompletenessRate: 0.4,
            unconfirmedGenerationCount: 0,
            duplicateNodeCount: 0,
            duplicateProposalCount: 0,
            revisionConflicts: 0,
            unrecoveredConflicts: 0,
            turnCount: 1,
          },
        },
      ],
      { scenario: 'S5', modelMode: 'fake', runs: 1, maxRequests: 20, budgetCny: 10 },
      { totalRequests: 1, totalInputTokens: 100, totalOutputTokens: 20, totalTokens: 120, totalCostCny: 0.001, abortedBudget: false },
    );
    expect(summaryWithUnexpectedGap.status).toBe('failed');
  });

  test('When all scenarios are not applicable, the overall report will not be reported as passed, and N/A and the reason will be displayed in detail.', () => {
    const reason = 'This scenario only applies to external Agents (the built-in assistant must wait for user confirmation on the interface before submitting)';
    const run = {
      runIndex: 1,
      scenarioId: 'submit-wait-image',
      scenarioCode: 'R1a',
      expectedBaselinePass: true,
      reason,
      checks: [{ name: 'runner_applicability', passed: true, detail: 'This scenario only applies to external Agents' }],
      metrics: {
        status: 'not_applicable',
        scenarioId: 'submit-wait-image',
        scenarioCode: 'R1a',
        passed: false,
        structuralCompletenessRate: 0,
        passedChecks: 1,
        totalChecks: 1,
        turnCount: 0,
        modelRequests: 0,
        eliminableRequests: 0,
        readOps: 0,
        writeOps: 0,
        inputTokens: 0,
        cachedTokenRatio: 0,
        outputTokens: 0,
        costCny: 0,
        durationMs: 0,
        unconfirmedGenerationCount: 0,
        duplicateNodeCount: 0,
        duplicateProposalCount: 0,
        revisionConflicts: 0,
        unrecoveredConflicts: 0,
      },
    };
    const report = buildEvalSummary(
      [run],
      { scenario: 'R1a', modelMode: 'fake', runs: 1, maxRequests: 20, budgetCny: 10 },
      { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCostCny: 0, abortedBudget: false },
    );
    expect(report.status).toBe('not_applicable');
    expect(report.summary.notApplicableRuns).toBe(1);
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain('| N/A |');
    expect(markdown).toContain('Number of unapplicable scenarios | 1');
    expect(markdown).toContain('Applies to external agents only');
    expect(markdown).not.toContain('| FAIL |');
  });

  test('Automatic event awakening and user review are scored separately. Skills only enter subsequent requests after the first round of activation.', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beeftv-eval-truth-'));
    try {
      const { report, markdown } = await runEval({
        scenario: 'S5,S6,S7', model: 'fake', runs: 1, maxRequests: 20, budgetCny: 10, outDir,
      });
      expect(report.status).toBe('passed');
      const [auto, skill, userReview] = report.scenarios;
      expect(auto.expectedBaselinePass).toBe(true);
      expect(auto.wakeResult).toEqual({ autoWoken: true, eventAccepted: true });
      expect(auto.metrics.status).toBe('passed');
      expect(auto.metrics.turnCount).toBe(1);
      expect(auto.metrics.mediaInspections).toBe(2);
      expect(skill.scenarioId).toBe('skill-across-turns');
      expect(skill.metrics.passed).toBe(true);
      expect(skill.requestEvidence.every((entry) => entry.activeSkillPresent)).toBe(true);
      expect(SCENARIOS.find((scenario) => scenario.code === 'S6').turns.filter((turn) => turn.useActiveSkillPins).length).toBe(1);
      expect(userReview.metrics.passed).toBe(true);
      expect(userReview.metrics.turnCount).toBe(2);
      expect(userReview.metrics.mediaInspections).toBe(2); // overview + versioned inspect
      expect(userReview.metrics.unconfirmedGenerationCount).toBe(0);
      expect(markdown).not.toContain('Skill rule retention rate after multiple rounds of compression');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('Request attribution, original text placement and scene closing', () => {
  test('Identify the session to which a request belongs by cache affinity key', () => {
    expect(requestSessionKey({ prompt_cache_key: 'durable:a' })).toBe('durable:a');
    expect(requestSessionKey({ metadata: { user_id: 'durable:b' } })).toBe('durable:b');
    expect(requestSessionKey({ messages: [] })).toBe('');
  });

  test('Only long inline images are removed from the original text.', () => {
    const long = `data:image/png;base64,${'A'.repeat(400)}`;
    const out = elideDataUrls({ messages: [{ content: [{ image_url: { url: long } }, { text: 'data:short' }] }] });
    expect(out.messages[0].content[0].image_url.url).toBe(`data:image/png;base64,<${long.length} chars elided>`);
    expect(out.messages[0].content[1].text).toBe('data:short');
  });

  test('The assistant stops and the conditions are met before it ends. Otherwise, it returns to the upper limit without stopping.', async () => {
    let polls = 0;
    const server = http.createServer((req, res) => {
      polls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ active: polls <= 2 ? { turnId: 't' } : null, turns: [] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const hostBaseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const settled = await waitForCanvasIdle({ hostBaseUrl, hostToken: 'x', canvasId: 'c', timeoutMs: 5000 });
      expect(settled.idle).toBe(true);
      expect(polls).toBeGreaterThanOrEqual(4);
      const waiting = await waitForCanvasIdle({ hostBaseUrl, hostToken: 'x', canvasId: 'c', timeoutMs: 600, until: () => false });
      expect(waiting.idle).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('When the host does not respond, the wait will return within the upper limit.', async () => {
    const server = http.createServer(() => {}); // 接受连接但永不响应
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const startedAt = Date.now();
    try {
      const result = await waitForCanvasIdle({ hostBaseUrl: `http://127.0.0.1:${server.address().port}`, hostToken: 'x', canvasId: 'c', timeoutMs: 500 });
      expect(result.idle).toBe(false);
      expect(Date.now() - startedAt).toBeLessThan(2000);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Request registration: Late return to the original scene, unknown sessions in single queue, accurate in-transit counting, desensitization of placement', () => {
    const requestsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beeftv-tracker-'));
    let context = { runIndex: 1, scenarioId: 'S5', turnId: 's5-1' };
    const tracker = createRequestTracker({ requestsDir, getContext: () => context, secrets: ['sk-secret-value-123'] });
    try {
      tracker.register('durable:s5', { runIndex: 1, scenarioId: 'S5', turnId: 's5-1' });
      context = { runIndex: 1, scenarioId: 'S6', turnId: 's6-1' };
      tracker.register('durable:s6', context);
      const late = tracker.begin({ prompt_cache_key: 'durable:s5', messages: [{ content: 'key sk-secret-value-123' }] });
      const own = tracker.begin({ prompt_cache_key: 'durable:s6' });
      const unknown = tracker.begin({ messages: [] });
      expect(late).toMatchObject({ scenarioId: 'S5', turnId: 's5-1', attribution: 'session', late: true, seq: 1 });
      expect(own).toMatchObject({ scenarioId: 'S6', attribution: 'session', late: false, seq: 2 });
      expect(unknown).toMatchObject({ scenarioId: 'S6', attribution: 'unknown', late: false, seq: 3 });
      expect(tracker.inflight).toBe(3);
      tracker.end(late);
      tracker.end(late);
      tracker.end(null);
      expect(tracker.inflight).toBe(2);
      tracker.end(own);
      tracker.end(unknown);
      expect(tracker.inflight).toBe(0);
      const dumped = fs.readFileSync(path.join(requestsDir, '0001.json'), 'utf8');
      expect(dumped).not.toContain('sk-secret-value-123');
      expect(tracker.dispatchOf({})).toBeUndefined();
    } finally {
      fs.rmSync(requestsDir, { recursive: true, force: true });
    }
    const broken = createRequestTracker({ requestsDir: path.join(os.tmpdir(), `missing-${crypto.randomUUID()}`), getContext: () => context });
    expect(() => broken.begin({ prompt_cache_key: 'durable:x' })).toThrow();
    expect(broken.inflight).toBe(0);
  });

  test('Late requests do not enter the current scene evidence and do not consume the redirection hook of the next scene.', async () => {
    const observed = [];
    const steered = [];
    let hook = async ({ reqIndex }) => { steered.push(reqIndex); };
    const hooks = {
      observe: (_body, dispatch) => observed.push(dispatch.seq),
      takeSteerHook: () => { const taken = hook; hook = null; return taken; },
    };
    await runOwnRequestHooks({}, { seq: 1, late: true }, 1, hooks);
    expect(observed).toEqual([]);
    expect(steered).toEqual([]);
    expect(hook).not.toBeNull();
    await runOwnRequestHooks({}, { seq: 2, late: false }, 2, hooks);
    await runOwnRequestHooks({}, { seq: 3, late: false }, 3, hooks);
    expect(observed).toEqual([2, 3]);
    expect(steered).toEqual([2]);
  });

  test('S7 Using the node configuration to change the prompt word is also considered a correction, but only changing other parameters does not count.', () => {
    const s7 = SCENARIOS.find((scenario) => scenario.code === 'S7');
    const turnRecords = [{ turnId: 't1' }, { turnId: 't2' }];
    const evaluateWith = (correction) => s7.evaluate({
      canvasId: 'c',
      turnRecords,
      simGo: { snapshot: () => ({
        proposals: [{ canvasId: 'c', confirmed: true }, { canvasId: 'c', confirmed: false }],
        tasks: [{ canvasId: 'c', status: 'succeeded' }],
        canvases: { c: { nodes: [{ id: 'n1' }] } },
        opLog: [
          { op: 'media.inspect', status: 'ok', turnId: 't2', params: { canvasId: 'c' } },
          { op: 'canvas.node.configure', status: 'ok', turnId: 't2', params: { canvasId: 'c', nodeId: 'n1', patch: correction } },
          { op: 'canvas.generation.propose', status: 'ok', turnId: 't2', params: { canvasId: 'c' } },
        ],
      }) },
    }).checks.find((check) => check.name === 'result_inspected_and_prompt_corrected').passed;
    expect(evaluateWith({ prompt: 'Natural hands, five fingers' })).toBe(true);
    expect(evaluateWith({ size: '1024x1024' })).toBe(false);
  });
});

describe('The title template prepared by the simulator storyboard is consistent with the real backend', () => {
  const prepare = (simGo, canvasId, extra) => simGo.executeOp('canvas.script.prepare', {
    canvasId,
    expectedRevision: simGo.ensureCanvas(canvasId).revision,
    script: { title: `Storyboard-${crypto.randomUUID()}`, rows: [
      { plotDescription: 'one', imageGenerationPrompt: 'one', videoMotionPrompt: 'one', durationSeconds: 5 },
      { plotDescription: 'two', imageGenerationPrompt: 'two', videoMotionPrompt: 'two', durationSeconds: 5 },
    ] },
    ...extra,
  }, crypto.randomUUID(), 'turn-t');

  test('Name according to the template, illegal templates and duplicate names will be rejected in batches', () => {
    const simGo = createSimGo({ hostToken: 't' });
    const canvasId = 'c-title';
    simGo.ensureCanvas(canvasId);
    prepare(simGo, canvasId, { image: { model: 'seedream-3.0', title: 'Mirror {n} first frame' } });
    const imageTitles = simGo.ensureCanvas(canvasId).nodes.filter((node) => node.type === 'image').map((node) => node.title);
    expect(imageTitles).toEqual(['Mirror 1 first frame', 'Mirror 2 first frame']);
    for (const title of [null, 'mirror first frame', `${'mirror'.repeat(38)}{n}`]) {
      expect(() => prepare(simGo, canvasId, { image: { model: 'seedream-3.0', title } })).toThrow();
    }
    const nodesBefore = simGo.ensureCanvas(canvasId).nodes.length;
    expect(() => prepare(simGo, canvasId, { image: { model: 'seedream-3.0', title: 'Mirror {n} first frame' } })).toThrow();
    expect(() => prepare(simGo, canvasId, {
      image: { model: 'seedream-3.0', title: 'Mirror {n}' }, video: { model: 'seedance-1.0', generateAudio: 'false', title: 'Mirror {n}' },
    })).toThrow();
    for (const [image, video] of [
      [{ model: 'seedream-3.0' }, { model: 'seedance-1.0', generateAudio: 'false', title: 'Lens {n} · First frame' }],
      [{ model: 'seedream-3.0', title: 'Lens {n} · Video' }, { model: 'seedance-1.0', generateAudio: 'false' }],
    ]) {
      expect(() => prepare(simGo, canvasId, { image, video })).toThrow();
    }
    expect(simGo.ensureCanvas(canvasId).nodes.length).toBe(nodesBefore);
  });
});

describe('Simulator task time consumption and external submission (replacing the pre-capability of scenario R1/R3)', () => {
  const seedParityCanvas = (simGo, canvasId) => simGo.ensureCanvas(canvasId, {
    id: canvasId,
    title: 'Task time-consuming test',
    revision: 1,
    nodes: [
      {
        id: 'node-image', type: 'image', title: 'Mirror 1 first frame', position: { x: 120, y: 160 }, width: 720, height: 405,
        metadata: { content: '', prompt: 'rainy night street', composerContent: 'rainy night street', status: 'idle', size: '9:16', count: 1, model: 'seedream-3.0' },
      },
      {
        id: 'node-video', type: 'video', title: 'mirror 1 video', position: { x: 900, y: 160 }, width: 720, height: 405,
        metadata: { content: '', prompt: 'Camera slowly zooms in', composerContent: 'Camera slowly zooms in', status: 'idle', size: '9:16', seconds: '6', model: 'seedance-1.0' },
      },
    ],
    connections: [],
    timeline: null,
  });

  test('setTaskTiming allows the built-in confirmation path to be completed asynchronously, and will be automatically written back to the node after completion.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-timing';
    seedParityCanvas(simGo, canvasId);
    simGo.beginTurn({ turnId: 'turn-timing', canvasId, permissionMode: 'canvas' });
    simGo.setTaskTiming(canvasId, { imageMs: 80, videoMs: 160 });
    const proposal = simGo.executeOp('canvas.generation.propose', {
      canvasId, kind: 'image', nodeIds: ['node-image'],
    }, 'propose-timing', 'turn-timing').result;

    const startedAt = Date.now();
    const created = await simGo.confirmProposals(proposal.proposalId, { delayMs: 5 });
    expect(Date.now() - startedAt).toBeLessThan(60);
    expect(created[0].status).toBe('running');
    expect(simGo.ensureCanvas(canvasId).nodes[0].metadata.taskStatus).toBe('running');

    const early = await simGo.waitForTasks([created[0].id], 20);
    expect(early.pending).toBe(true);

    const settled = await simGo.waitForTasks([created[0].id], 1000);
    expect(settled.pending).toBe(false);
    expect(settled.tasks[0].status).toBe('succeeded');
    expect(simGo.ensureCanvas(canvasId).nodes[0].metadata.resourceId).toBeTruthy();
    await simGo.close();
  });

  test('External caller propose + submit: Return to running immediately. Bind again after product delivery. Repeated operationId will not be billed again.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-external';
    seedParityCanvas(simGo, canvasId);
    // 默认不外露 task.wait，避免改变 S1–S11 的工具定义体积；替代场景 setup 才打开。
    expect(simGo.descriptors.some((descriptor) => descriptor.id === 'task.wait')).toBe(false);
    simGo.enableTaskWait();
    expect(simGo.descriptors.some((descriptor) => descriptor.id === 'task.wait')).toBe(true);
    await simGo.listen(0);
    simGo.beginTurn({ turnId: 'turn-external', canvasId, permissionMode: 'canvas' });
    simGo.setTaskTiming(canvasId, { imageMs: 80 });
    const proposal = simGo.executeOp('canvas.generation.propose', {
      canvasId, kind: 'image', nodeIds: ['node-image'],
    }, '', 'turn-external').result;

    const submitted = simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      proposalId: proposal.proposalId,
      expectedRevision: proposal.source.canvasRevision,
      expectedModelConfigRevision: proposal.source.modelConfigRevision,
    }, 'external-op-1', 'turn-external').result;
    expect(submitted.status).toBe('submitted');
    expect(submitted.approvalMode).toBe('caller');
    expect(submitted.taskIds.length).toBe(1);

    const early = await simGo.waitForTasks(submitted.taskIds, 20);
    expect(early.pending).toBe(true);
    const settled = await simGo.waitForTasks(submitted.taskIds, 1000);
    expect(settled.tasks[0].status).toBe('succeeded');

    // 外部任务只交付产物：没调用 canvas.task.bind 前节点没有媒体字段。
    const unbound = simGo.ensureCanvas(canvasId).nodes[0];
    expect(unbound.metadata.resourceId).toBeUndefined();
    const bound = simGo.executeOp('canvas.task.bind', {
      canvasId, taskId: submitted.taskIds[0], nodeId: 'node-image',
    }, 'external-bind-1', 'turn-external').result;
    expect(bound.bindingStatus).toBe('bound');
    expect(simGo.ensureCanvas(canvasId).nodes[0].metadata.resourceId).toBeTruthy();

    // 同一个 operationId 重试回读原任务，不新建第二个付费任务。
    const replay = simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      proposalId: proposal.proposalId,
      expectedRevision: proposal.source.canvasRevision,
      expectedModelConfigRevision: proposal.source.modelConfigRevision,
    }, 'external-op-1', 'turn-external');
    expect(replay.replayed).toBe(true);
    expect(replay.result.taskIds).toEqual(submitted.taskIds);
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);

    // 换一个 operationId 再提交同一节点：真实后端按节点任务回执拒绝，不会回读也不会再买一份。
    expect(() => simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      proposalId: proposal.proposalId,
      expectedRevision: simGo.ensureCanvas(canvasId).revision,
      expectedModelConfigRevision: proposal.source.modelConfigRevision,
    }, 'external-op-2', 'turn-external')).toThrow(/已关联生成任务/);
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);

    // task.wait 的 HTTP 入口会等任务结束，并回报节点是否已绑定。
    const waitRes = await fetch(`${simGo.baseUrl}/ops/task.wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-beeftv-agent-turn': 'turn-external' },
      body: JSON.stringify({ opId: 'wait-op-1', params: { taskId: submitted.taskIds[0], canvasId, nodeId: 'node-image', timeoutMs: 50 } }),
    });
    const waitBody = await waitRes.json();
    expect(waitRes.status).toBe(200);
    expect(waitBody.data.pending).toBe(false);
    expect(waitBody.data.bound).toBe(true);
    await simGo.close();
  });

  test('External caller: After success, the retrieval to the same node will be rejected, but after failure, it can be retrieval.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-external-regen';
    seedParityCanvas(simGo, canvasId);
    simGo.beginTurn({ turnId: 'turn-external-regen', canvasId, permissionMode: 'canvas' });
    const submit = (opId, nodeId, kind) => simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: [nodeId],
      kind,
      expectedRevision: simGo.ensureCanvas(canvasId).revision,
      expectedModelConfigRevision: 1,
    }, opId, 'turn-external-regen').result;

    const first = submit('regen-op-1', 'node-image', 'image');
    const firstSettled = await simGo.waitForTasks(first.taskIds, 500);
    expect(firstSettled.tasks[0].status).toBe('succeeded');
    // 已成功的节点不能由外部调用方原地重提，和真实后端一致；需要另做一份时新建节点。
    expect(() => submit('regen-op-2', 'node-image', 'image')).toThrow(/已关联生成任务/);
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);

    // 失败任务可以重提：同一节点换新的 operationId 会新建任务。
    simGo.failNextTask('upstream_timeout', 'node-video');
    const failed = submit('regen-video-1', 'node-video', 'video');
    const failedSettled = await simGo.waitForTasks(failed.taskIds, 500);
    expect(failedSettled.tasks[0].status).toBe('failed');
    const retried = submit('regen-video-2', 'node-video', 'video');
    const retriedSettled = await simGo.waitForTasks(retried.taskIds, 500);
    expect(retriedSettled.tasks[0].status).toBe('succeeded');
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(3);
    await simGo.close();
  });

  test('When an external proposal points to a node that already has a successful task, it is confirmed that no new task will be created.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-external-confirm-blocked';
    seedParityCanvas(simGo, canvasId);
    simGo.beginTurn({ turnId: 'turn-external-confirm-blocked', canvasId, permissionMode: 'canvas' });
    const submitted = simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      expectedRevision: 1,
      expectedModelConfigRevision: 1,
    }, 'blocked-submit-1', 'turn-external-confirm-blocked').result;
    await simGo.waitForTasks(submitted.taskIds, 500);

    // 外部 Agent 在已成功的节点上再提议；提案记录调用方类型，确认时走和外部 submit 相同的检查。
    const proposal = simGo.executeOp('canvas.generation.propose', {
      canvasId, kind: 'image', nodeIds: ['node-image'],
    }, '', 'turn-external-confirm-blocked').result;
    expect(simGo.proposals.get(proposal.proposalId).callerKind).toBe('caller');
    await expect(simGo.confirmProposals(proposal.proposalId, { delayMs: 1 })).rejects.toThrow(/已关联生成任务/);
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);

    // 运行器自动确认同样不能绕过；被拒绝的提案保持未确认。
    expect(await confirmPendingProposals(simGo, canvasId)).toBe(0);
    expect(simGo.proposals.get(proposal.proposalId).confirmed).toBe(false);
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);
    await simGo.close();
  });

  test('External submissions on the canvas that are not allocated with time-consuming tasks will also be completed and will not run forever.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-no-timing';
    seedParityCanvas(simGo, canvasId);
    simGo.beginTurn({ turnId: 'turn-no-timing', canvasId, permissionMode: 'canvas' });
    // 这张画布没有 setTaskTiming，走默认 5 毫秒完成路径。
    const submitted = simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      expectedRevision: 1,
      expectedModelConfigRevision: 1,
    }, 'no-timing-submit', 'turn-no-timing').result;
    const settled = await simGo.waitForTasks(submitted.taskIds, 500);
    expect(settled.pending).toBe(false);
    expect(settled.tasks[0].status).toBe('succeeded');
    await simGo.close();
  });

  test('When subsequent node verification fails in batch submission, no running tasks will be left in front.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-batch-fail';
    seedParityCanvas(simGo, canvasId);
    simGo.beginTurn({ turnId: 'turn-batch-fail', canvasId, permissionMode: 'canvas' });
    expect(() => simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image', 'node-video'],
      kind: 'image',
      expectedRevision: 1,
      expectedModelConfigRevision: 1,
    }, 'batch-submit', 'turn-batch-fail')).toThrow();
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(0);
    await simGo.close();
  });

  test('After the external caller is submitted, the proposal is confirmed and the task is recorded, and the runner confirms that no second task will be generated.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-caller-confirm';
    seedParityCanvas(simGo, canvasId);
    simGo.beginTurn({ turnId: 'turn-caller-confirm', canvasId, permissionMode: 'canvas' });
    const proposal = simGo.executeOp('canvas.generation.propose', {
      canvasId, kind: 'image', nodeIds: ['node-image'],
    }, '', 'turn-caller-confirm').result;
    const submitted = simGo.executeOp('canvas.generation.submit', {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      proposalId: proposal.proposalId,
      expectedRevision: proposal.source.canvasRevision,
      expectedModelConfigRevision: proposal.source.modelConfigRevision,
    }, 'caller-submit', 'turn-caller-confirm').result;
    expect(submitted.taskIds.length).toBe(1);
    expect(simGo.proposals.get(proposal.proposalId).confirmed).toBe(true);
    expect(simGo.proposals.get(proposal.proposalId).taskIds).toEqual(submitted.taskIds);

    // 直接调用确认接口也必须幂等：已确认/已有任务的提案不再建第二批付费任务。
    expect(await simGo.confirmProposals(proposal.proposalId, { delayMs: 1 })).toEqual([]);

    const confirmed = await confirmPendingProposals(simGo, canvasId);
    expect(confirmed).toBe(0);
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);
    await simGo.close();
  });

  test('The built-in host submission must have a confirmed proposal; repeated submission after confirmation will only read back the original task', async () => {
    const simGo = createSimGo({ hostToken: 'host-token' });
    const canvasId = 'canvas-host-submit';
    seedParityCanvas(simGo, canvasId);
    await simGo.listen(0);
    simGo.beginTurn({ turnId: 'turn-host-submit', canvasId, permissionMode: 'canvas' });
    const proposal = simGo.executeOp('canvas.generation.propose', {
      canvasId, kind: 'image', nodeIds: ['node-image'],
    }, '', 'turn-host-submit').result;
    const submitParams = {
      canvasId,
      nodeIds: ['node-image'],
      kind: 'image',
      proposalId: proposal.proposalId,
      expectedRevision: proposal.source.canvasRevision,
      expectedModelConfigRevision: proposal.source.modelConfigRevision,
    };
    const rejected = await fetch(`${simGo.baseUrl}/api/ops/canvas.generation.submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Beeftv-Agent-Token': 'host-token', 'x-beeftv-agent-turn': 'turn-host-submit' },
      body: JSON.stringify({ opId: 'host-submit-1', params: submitParams }),
    });
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).reason).toBe('generation_confirmation_required');
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(0);

    const tasks = await simGo.confirmProposals(proposal.proposalId, { delayMs: 1 });
    // 确认后任务完成会写回节点并推进画布版本，重提时带当前版本。
    const replay = await fetch(`${simGo.baseUrl}/api/ops/canvas.generation.submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Beeftv-Agent-Token': 'host-token', 'x-beeftv-agent-turn': 'turn-host-submit' },
      body: JSON.stringify({ opId: 'host-submit-2', params: { ...submitParams, expectedRevision: simGo.ensureCanvas(canvasId).revision } }),
    });
    const replayBody = await replay.json();
    expect(replay.status).toBe(200);
    expect(replayBody.data.result.taskIds).toEqual(tasks.map((task) => task.id));
    expect(simGo.snapshot().tasks.filter((task) => task.canvasId === canvasId).length).toBe(1);
    await simGo.close();
  });

  test('When task.wait is not enabled, direct HTTP calls are also rejected as unknown operations.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-wait-hidden';
    seedParityCanvas(simGo, canvasId);
    await simGo.listen(0);
    simGo.beginTurn({ turnId: 'turn-wait-hidden', canvasId, permissionMode: 'canvas' });
    const hidden = await fetch(`${simGo.baseUrl}/api/ops/task.wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-beeftv-agent-turn': 'turn-wait-hidden' },
      body: JSON.stringify({ opId: 'wait-hidden', params: { taskId: 'task-1', timeoutMs: 1 } }),
    });
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).reason).toBe('unknown_operation');
    simGo.enableTaskWait();
    const exposed = await fetch(`${simGo.baseUrl}/api/ops/task.wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-beeftv-agent-turn': 'turn-wait-hidden' },
      body: JSON.stringify({ opId: 'wait-exposed', params: { taskId: 'task-1', timeoutMs: 1 } }),
    });
    expect(exposed.status).toBe(200);
    expect((await exposed.json()).data.tasks).toEqual([]);
    await simGo.close();
  });

  test('canvas.script.prepare can contain up to 8 rows at a time. Rows.append must be used to append rows from the 9th row onwards.', async () => {
    const simGo = createSimGo({});
    const canvasId = 'canvas-rows-limit';
    simGo.ensureCanvas(canvasId);
    simGo.beginTurn({ turnId: 'turn-rows', canvasId, permissionMode: 'canvas' });
    const row = (n) => ({ plotDescription: `No.${n} mirror`, imageGenerationPrompt: `No.${n} First frame of shot`, videoMotionPrompt: `No.${n} mirror mirror`, durationSeconds: 5 });
    const prepare = (rows, key) => simGo.executeOp('canvas.script.prepare', {
      canvasId,
      expectedRevision: simGo.ensureCanvas(canvasId).revision,
      script: { title: `Storyboard-${key}`, rows },
    }, `prepare-${key}`, 'turn-rows').result;

    expect(() => prepare(Array.from({ length: 9 }, (_, i) => row(i + 1)), 'nine')).toThrow(/1至8行|1\.\.8/);
    const prepared = prepare(Array.from({ length: 8 }, (_, i) => row(i + 1)), 'eight');
    expect(prepared.created.filter((item) => item.type === 'script').length).toBe(1);
    const appended = simGo.executeOp('canvas.script.rows.append', {
      canvasId,
      nodeId: prepared.nodeId,
      expectedRevision: simGo.ensureCanvas(canvasId).revision,
      rows: [row(9), row(10)],
    }, 'append-two', 'turn-rows').result;
    expect(appended.rowCount).toBe(10);
    await simGo.close();
  });
});
