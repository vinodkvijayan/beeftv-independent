// 画布操作：canvas.* 的读取与搜索、节点和连线增改删、素材绑定、时间线和整份文档提交。

import { clone, invalidArg, notFound, conflict, preconditionFailed } from './common.mjs';
import { NODE_CAPABILITIES } from './fixtures.mjs';
import { ensureCanvas, saveCanvas, buildDefaultMetadata } from './canvas-store.mjs';
import { resolveGenerationModel } from './generation.mjs';

export const CANVAS_OPS = {
  'canvas.get': (state, rawParams) => {
    const canvasId = String(rawParams.canvasId || '').trim();
    if (!canvasId) throw invalidArg('invalid_params', 'canvasId required');
    const doc = state.canvases.get(canvasId);
    if (!doc) throw notFound('canvas_not_found', `Canvas does not exist:${canvasId}`);
    return { canvasId, canvas: clone(doc) };
  },
  'canvas.search': (state, rawParams) => {
    const query = String(rawParams.query || '').trim().toLowerCase();
    const page = Math.max(1, Number(rawParams.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(rawParams.pageSize || 20)));
    const all = [...state.canvases.values()].filter((c) => !query || String(c.title || '').toLowerCase().includes(query) || c.id.toLowerCase().includes(query));
    const items = all.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
      id: c.id, title: c.title, revision: c.revision, nodeCount: (c.nodes || []).length, updatedAt: c.updatedAt,
    }));
    return { items, total: all.length, page, pageSize };
  },
  'canvas.nodes.create': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    const drafts = Array.isArray(rawParams.nodes) ? rawParams.nodes : [];
    if (!canvasId) throw invalidArg('invalid_params', 'canvasId required');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
      throw invalidArg('invalid_params', 'The write operation must carry the expectedRevision when reading');
    }
    if (drafts.length === 0 || drafts.length > 8) {
      throw invalidArg('invalid_batch', 'nodes must be an array of 1..8 items');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const existingTitles = new Set((doc.nodes || []).map((n) => String(n.title || '').trim()).filter(Boolean));
    const batchTitles = new Set();
    for (const draft of drafts) {
      const title = String(draft?.title || '').trim();
      const type = String(draft?.type || '').trim();
      if (!title) throw invalidArg('invalid_params', 'Each node needs a title');
      if (batchTitles.has(title)) {
        state.counts.duplicateNodeAttempts += 1;
        throw invalidArg('duplicate_node_title', `Duplicate titles within the same batch:${title}`);
      }
      batchTitles.add(title);
      if (existingTitles.has(title)) {
        state.counts.duplicateNodeAttempts += 1;
        throw conflict('duplicate_node_title', `Title already exists:${title}`);
      }
      if (!NODE_CAPABILITIES[type]) {
        throw invalidArg('unsupported_node_type', `Unsupported node types:${type}`);
      }
    }
    let cursorX = 120;
    for (const node of doc.nodes || []) {
      const x = Number(node.position?.x || 0);
      const w = Number(node.width || NODE_CAPABILITIES[node.type]?.defaultWidth || 320);
      if (x + w + 60 > cursorX) cursorX = x + w + 60;
    }
    const created = [];
    for (const draft of drafts) {
      state.seq.node += 1;
      const id = `node-${state.seq.node}`;
      const cap = NODE_CAPABILITIES[draft.type];
      const prompt = String(draft.prompt || '');
      const normTitle = `${canvasId}::${String(draft.title).trim()}`;
      state.counts.createdNodeTitles[normTitle] = (state.counts.createdNodeTitles[normTitle] || 0) + 1;
      doc.nodes.push({
        id,
        type: draft.type,
        title: draft.title,
        position: { x: cursorX, y: 160 },
        width: cap.defaultWidth,
        height: cap.defaultHeight,
        metadata: buildDefaultMetadata(draft.type, prompt),
      });
      created.push({ id, title: draft.title, type: draft.type });
      cursorX += cap.defaultWidth + 60;
    }
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.nodes.create', turnId);
    return { canvasId, revision: saved.revision, created };
  },
  'canvas.node.update': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const nodeId = String(rawParams.nodeId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    const patch = rawParams.patch;
    if (!canvasId || !nodeId) throw invalidArg('invalid_params', 'canvasId and nodeId are required');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
      throw invalidArg('invalid_params', 'The write operation must carry the expectedRevision when reading');
    }
    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      throw invalidArg('empty_patch', 'patch must have at least one field');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const node = (doc.nodes || []).find((n) => n.id === nodeId);
    if (!node) throw notFound('node_not_found', `The target node does not exist:${nodeId}`);
    const cap = NODE_CAPABILITIES[node.type] || NODE_CAPABILITIES.text;
    node.metadata ||= {};
    if (patch.prompt !== undefined && patch.content !== undefined && patch.prompt !== patch.content) {
      throw invalidArg('conflicting_patch_fields', 'patch.prompt and patch.content cannot submit different content at the same time');
    }
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'title') {
        if (typeof v !== 'string') throw invalidArg('invalid_params', 'title must be a string');
        node.title = v;
      } else if (k === 'prompt' || k === 'content') {
        if (!cap.patchFields.has(k)) {
          throw invalidArg('unsupported_field', `${node.type} Node does not support update fields${k}`);
        }
        if (typeof v !== 'string') throw invalidArg('invalid_params', `${k} Must be a string`);
        if (['image', 'video', 'audio'].includes(node.type)) {
          node.metadata.composerContent = v;
          delete node.metadata.promptTemplateOperation;
          delete node.metadata.promptTemplateVariables;
        } else {
          node.metadata.content = v;
        }
      } else {
        throw invalidArg('unsupported_field', `${node.type} Node does not support update fields${k}`);
      }
    }
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.node.update', turnId);
    return { canvasId, nodeId, revision: saved.revision, node: clone(node) };
  },
  'canvas.node.configure': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const nodeId = String(rawParams.nodeId || '').trim();
    const kind = String(rawParams.kind || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    const patch = rawParams.patch;
    if (!canvasId || !nodeId || !kind || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0 || !patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      throw invalidArg('invalid_params', 'Requires canvas, node, type, current version and parameters');
    }
    if (!['image', 'video', 'audio'].includes(kind)) {
      throw invalidArg('unsupported_node_kind', 'Only media generation nodes support parameter configuration');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const node = (doc.nodes || []).find((n) => n.id === nodeId);
    if (!node) throw notFound('node_not_found', 'The node is not in the current canvas');
    if (node.type !== kind) throw invalidArg('node_kind_mismatch', 'The parameter type is inconsistent with the target node');
    const cap = NODE_CAPABILITIES[kind];
    node.metadata ||= {};
    for (const [name, val] of Object.entries(patch)) {
      if (!cap.patchFields.has(name) || name === 'title' || name === 'content') {
        throw invalidArg('unsupported_field', `This type does not support parameters${name}`);
      }
      if (name === 'count') {
        const count = Number(val);
        if (!Number.isSafeInteger(count) || count < 1 || count > 8) {
          throw invalidArg('invalid_parameter', 'count must be an integer from 1..8');
        }
        node.metadata.count = count;
        continue;
      }
      if (name === 'prompt') {
        if (typeof val !== 'string') {
          throw invalidArg('invalid_parameter', 'prompt must be a string');
        }
        node.metadata.composerContent = val;
        delete node.metadata.promptTemplateOperation;
        delete node.metadata.promptTemplateVariables;
        continue;
      }
      if (typeof val !== 'string' || !val.trim()) {
        throw invalidArg('invalid_parameter', `${name} Must be a valid string`);
      }
      if (name === 'model') {
        const choice = resolveGenerationModel(state, kind, val);
        if (choice.kindMismatch) throw invalidArg('generation_model_kind_mismatch', 'The selected model does not support the media type');
        if (!choice.modelKey) throw preconditionFailed('generation_model_unavailable', 'The selected model is currently unavailable');
        node.metadata.model = choice.modelKey;
        continue;
      }
      node.metadata[name] = val;
    }
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.node.configure', turnId);
    return { canvasId, nodeId, revision: saved.revision, node: clone(node), draftConfigured: true };
  },
  'canvas.node.move': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const nodeId = String(rawParams.nodeId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    const pos = rawParams.position;
    if (!canvasId || !nodeId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw invalidArg('invalid_params', 'canvasId, nodeId and valid expectedRevision are required');
    }
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      throw invalidArg('invalid_position', 'position.x and position.y must be valid coordinates');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const node = (doc.nodes || []).find((n) => n.id === nodeId);
    if (!node) throw notFound('node_not_in_canvas', 'The node does not belong to this canvas');
    node.position = { x: pos.x, y: pos.y };
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.node.move', turnId);
    return { canvasId, nodeId, revision: saved.revision };
  },
  'canvas.node.delete': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const nodeId = String(rawParams.nodeId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    if (!canvasId || !nodeId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw invalidArg('invalid_params', 'canvasId, nodeId and valid expectedRevision are required');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const idx = (doc.nodes || []).findIndex((n) => n.id === nodeId);
    if (idx < 0) throw notFound('node_not_in_canvas', 'The node does not belong to this canvas');
    doc.nodes.splice(idx, 1);
    const deletedEdgeIds = [];
    doc.connections = (doc.connections || []).filter((edge) => {
      if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
        deletedEdgeIds.push(edge.id);
        return false;
      }
      return true;
    });
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.node.delete', turnId);
    return { canvasId, revision: saved.revision, deletedNodeIds: [nodeId], deletedEdgeIds };
  },
  'canvas.node.bind_asset': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const nodeId = String(rawParams.nodeId || '').trim();
    const assetId = String(rawParams.assetId || '').trim();
    let resourceId = String(rawParams.resourceId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    if (!canvasId || !nodeId || !assetId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw invalidArg('invalid_params', 'Canvas, node, material and current version are required');
    }
    const asset = state.assets.get(assetId);
    if (!asset) throw notFound('asset_not_found', 'Material does not exist');
    if (!resourceId) resourceId = asset.resourceId;
    const resource = state.resources.get(resourceId);
    if (!resource) throw notFound('resource_not_found', 'The asset does not exist');
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const node = (doc.nodes || []).find((n) => n.id === nodeId);
    if (!node) throw notFound('node_not_found', 'Node does not belong to the specified canvas');
    if (node.type !== asset.kind) throw invalidArg('node_kind_mismatch', 'The material and reference node types are inconsistent');
    node.metadata ||= {};
    if (node.metadata.taskId) throw preconditionFailed('node_has_task', 'Please use independent reference nodes and do not overwrite existing task nodes.');
    Object.assign(node.metadata, {
      assetId: asset.id,
      resourceId: resource.id,
      storageKey: `resource:${resource.id}`,
      content: `/api/resources/${resource.id}/file`,
      nodeRole: 'result',
      resultOrigin: 'library',
      status: 'success',
      mimeType: resource.mimeType,
      bytes: resource.size,
      width: resource.width,
      height: resource.height,
    });
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.node.bind_asset', turnId);
    return { canvasId, nodeId, assetId: asset.id, resourceId: resource.id, node: clone(node), revision: saved.revision, referenceBound: true };
  },
  'canvas.edge.create': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const fromNodeId = String(rawParams.fromNodeId || '').trim();
    const toNodeId = String(rawParams.toNodeId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    if (!canvasId || !fromNodeId || !toNodeId) {
      throw invalidArg('invalid_params', 'canvasId, fromNodeId, toNodeId required');
    }
    if (fromNodeId === toNodeId) throw invalidArg('self_loop', 'Cannot connect node to itself');
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const fromNode = (doc.nodes || []).find((n) => n.id === fromNodeId);
    if (!fromNode) throw notFound('node_not_found', `The starting node does not exist:${fromNodeId}`);
    const toNode = (doc.nodes || []).find((n) => n.id === toNodeId);
    if (!toNode) throw notFound('node_not_found', `The end node does not exist:${toNodeId}`);
    const fromCap = NODE_CAPABILITIES[fromNode.type];
    const toCap = NODE_CAPABILITIES[toNode.type];
    if (!fromCap?.canSource || !toCap?.canTarget || !toCap.acceptedInputKinds.includes(fromCap.inputKind)) {
      throw invalidArg('invalid_connection', `Not supported from${fromNode.type} Connect to${toNode.type}`);
    }
    const existingEdge = (doc.connections || []).find((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId);
    if (existingEdge) {
      return { canvasId, duplicate: true, revision: doc.revision, edgeId: existingEdge.id, created: false };
    }
    state.seq.edge += 1;
    const edgeId = `edge-${state.seq.edge}`;
    doc.connections.push({ id: edgeId, fromNodeId, toNodeId });
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.edge.create', turnId);
    return { canvasId, duplicate: false, revision: saved.revision, edgeId, created: true };
  },
  'canvas.edge.delete': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const edgeId = String(rawParams.edgeId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    if (!canvasId || !edgeId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw invalidArg('invalid_params', 'canvasId, edgeId and valid expectedRevision are required');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const idx = (doc.connections || []).findIndex((e) => e.id === edgeId);
    if (idx < 0) throw notFound('edge_not_found', 'The connection does not belong to this canvas');
    doc.connections.splice(idx, 1);
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.edge.delete', turnId);
    return { canvasId, revision: saved.revision, deletedEdgeIds: [edgeId] };
  },
  'canvas.timeline.update': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    const timeline = rawParams.timeline;
    if (!canvasId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !timeline) {
      throw invalidArg('invalid_params', 'canvasId, expectedRevision and timeline are required');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    doc.timeline = clone(timeline);
    const saved = saveCanvas(state, canvasId, doc, expectedRevision, 'canvas.timeline.update', turnId);
    return { canvasId, revision: saved.revision, timelineUpdated: true };
  },
  'canvas.timeline.render': (state, rawParams) => {
    const canvasId = String(rawParams.canvasId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    if (!canvasId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw invalidArg('invalid_params', 'canvasId and expectedRevision are required');
    }
    const doc = ensureCanvas(state, canvasId);
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    if (!doc.timeline) throw invalidArg('invalid_timeline', 'There is no valid timeline in the canvas');
    state.seq.task += 1;
    const taskId = `task-render-${state.seq.task}`;
    const task = {
      id: taskId,
      type: 'timeline_render',
      canvasId,
      status: 'succeeded',
      progress: 100,
      local: true,
      charged: false,
      confirmedByUser: true,
      outputs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.tasks.set(taskId, task);
    return { canvasId, taskId, status: 'succeeded', local: true, charged: false, sourceRevision: expectedRevision };
  },
  'canvas.document.commit': (state, rawParams, ctx) => {
    const { turnId } = ctx;
    const canvasId = String(rawParams.canvasId || '').trim();
    const expectedRevision = Number(rawParams.expectedRevision);
    const document = rawParams.document;
    if (!canvasId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !document || typeof document !== 'object') {
      throw invalidArg('invalid_params', 'canvasId, expectedRevision and document are required');
    }
    const doc = clone(ensureCanvas(state, canvasId));
    if (doc.revision !== expectedRevision) {
      state.counts.revisionConflicts += 1;
      throw conflict('revision_conflict', 'The canvas has changed, please read again', { currentRevision: doc.revision });
    }
    const merged = { ...doc, ...clone(document), id: canvasId };
    const saved = saveCanvas(state, canvasId, merged, expectedRevision, 'canvas.document.commit', turnId);
    return { canvasId, revision: saved.revision, title: saved.title, updatedAt: saved.updatedAt };
  },
};
