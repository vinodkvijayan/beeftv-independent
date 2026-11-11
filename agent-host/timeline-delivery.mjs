// Deterministic composition inside one official Durable tool. Every side effect
// remains an existing Go operation, with its own receipt and nested task key.
export function timelineDeliveryTool(tools) {
  const required = ['canvas.get', 'canvas.timeline.update', 'canvas.timeline.render', 'canvas.nodes.create', 'canvas.task.bind', 'canvas.project.export'];
  const byOperation = new Map(tools.map(tool => [tool.label, tool]));
  if (!required.every(name => byOperation.has(name))) return null;
  const render = byOperation.get('canvas.timeline.render');
  const updateTool = byOperation.get('canvas.timeline.update');
  const timelineSchema = structuredClone(updateTool.parameters.properties.timeline);
  updateTool.parameters = {
    ...updateTool.parameters,
    properties: {
      ...updateTool.parameters.properties,
      timeline: { type: 'object', description: 'Same as canvas_timeline_deliver.timeline' },
    },
  };
  timelineSchema.properties.clips.items.properties.lines = {
    type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' },
    description: 'Multi-line subtitle array (priority over text)',
  };
  return {
    name: 'canvas_timeline_deliver', label: 'canvas.timeline.deliver', readOnly: false, replay: 'safe',
    description: 'Complete timeline saving, local rendering, creation of slice node binding and export of project ZIP in one go; partial regeneration and upload of refreshNodeIds',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        expectedRevision: render.parameters.properties.expectedRevision,
        timeline: timelineSchema,
        refreshNodeIds: byOperation.get('canvas.timeline.update').parameters.properties.refreshNodeIds,
        options: render.parameters.properties.options,
        title: { type: 'string', maxLength: 120 },
        ...(render.parameters.properties.canvasId ? { canvasId: render.parameters.properties.canvasId } : {}),
      },
      required: ['expectedRevision'],
    },
    execute: async (_id, args, signal, api) => {
      if (args.timeline !== undefined && args.refreshNodeIds !== undefined) throw new Error('invalid_params: Choose one of timeline and refreshNodeIds');
      const receipts = {};
      const canvas = args.canvasId === undefined ? {} : { canvasId: args.canvasId };
      let step;
      async function call(operation, params, key) {
        signal?.throwIfAborted();
        step = operation;
        const stage = { 'canvas.timeline.update': 'checking', 'canvas.timeline.render': 'rendering',
          'canvas.nodes.create': 'binding', 'canvas.task.bind': 'binding', 'canvas.project.export': 'exporting' }[operation];
        if (stage) await api.reportProgress?.({ stage });
        const reply = await api.executeTool(byOperation.get(operation).name, { ...canvas, ...params }, { key });
        if (reply.isError) {
          const error = new Error(reply.diagnostics?.map(item => item.message || '').filter(Boolean).join('; ') || 'Business step failed');
          error.deliveryStep = true;
          error.details = reply.structuredOutput;
          throw error;
        }
        const value = typeof reply.structuredOutput === 'string' ? JSON.parse(reply.structuredOutput) : reply.structuredOutput;
        if (!value?.result || typeof value.result !== 'object') throw new Error('delivery_receipt_missing');
        receipts[key] = value.result;
        return value.result;
      }
      function response(result, isError = false) {
        return { content: [{ type: 'text', text: JSON.stringify({ result, receipts }) }], ...(isError ? { isError: true } : {}) };
      }
      try {
        let revision = args.expectedRevision;
        if (args.refreshNodeIds !== undefined) {
          const updated = await call('canvas.timeline.update', { expectedRevision: revision, refreshNodeIds: args.refreshNodeIds }, 'timeline');
          revision = updated.revision;
        }
        if (args.timeline !== undefined) {
          const timeline = { ...args.timeline, clips: args.timeline.clips.map(clip => {
            if (clip.kind !== 'subtitle' || !Array.isArray(clip.lines)) return clip;
            const { lines, ...rest } = clip;
            return { ...rest, text: lines.join('\n') };
          }) };
          const updated = await call('canvas.timeline.update', { expectedRevision: revision, timeline }, 'timeline');
          revision = updated.revision;
        }
        const rendered = await call('canvas.timeline.render', { expectedRevision: revision, ...(args.options ? { options: args.options } : {}) }, 'render');
        if (rendered.status !== 'succeeded') {
          return response({ ...rendered, failedStep: 'canvas.timeline.render', note: 'Keep the original task; query the task without re-rendering.' }, ['failed', 'cancelled'].includes(rendered.status));
        }
        // Reading names does not rebase over an edit made while rendering:
        // creation still checks the exact saved revision this render used.
        const names = new Set();
        let offset = 0, namesRevision;
        do {
          const key = `names:${offset}`;
          const current = await call('canvas.get', { readView: { section: 'nodes', offset,
            ...(namesRevision === undefined ? {} : { expectedRevision: namesRevision }) } }, key);
          delete receipts[key]; // Do not expose source prompts in the delivery receipt.
          if (!Array.isArray(current.canvas?.nodeIndex)) throw new Error('delivery_canvas_missing');
          namesRevision = current.canvas.revision;
          for (const node of current.canvas.nodeIndex) {
            if (node.titleComplete !== false) names.add(String(node.title || '').trim());
          }
          offset = current.readView.nodeIndexPage.nextOffset;
        } while (Number.isSafeInteger(offset));
        const requestedTitle = String(args.title || '').trim() || 'Completed film';
        let title = requestedTitle;
        for (let index = 2; names.has(title); index++) {
          const suffix = ` · ${index}`;
          title = requestedTitle.slice(0, 120 - suffix.length) + suffix;
        }
        const created = await call('canvas.nodes.create', { expectedRevision: revision,
          nodes: [{ type: 'video', title }] }, 'node');
        const nodeId = created.created?.[0]?.id;
        if (!nodeId) throw new Error('delivery_node_missing');
        const bound = await call('canvas.task.bind', { taskId: rendered.taskId, nodeId, outputIndex: 0 }, 'bind');
        if (bound.bindingStatus !== 'bound' || !Number.isSafeInteger(bound.revision)) throw new Error('delivery_binding_missing');
        const project = await call('canvas.project.export', { expectedRevision: bound.revision }, 'project');
        return response({ status: 'delivered', canvasId: bound.canvasId, revision: bound.revision, nodeId,
          taskId: rendered.taskId, project, local: true, charged: false,
          note: 'The video and editable projects have been saved; the finished film still needs to be loaded to check the actual images, sounds and subtitles.' });
      } catch (error) {
        if (signal?.aborted || !error.deliveryStep) throw error;
        return response({ status: 'incomplete', failedStep: step, error: error.message, details: error.details,
          taskId: receipts.render?.taskId, nodeId: receipts.node?.created?.[0]?.id,
          note: 'Completed steps and original tasks are retained; only failed steps are continued without repeated generation or rendering.' }, true);
      }
    },
  };
}
