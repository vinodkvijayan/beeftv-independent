// 制作计划：助手自己维护、用户能看到的步骤清单，存在会话状态文档里。
// 这里只放纯逻辑（校验、渲染、续跑判断）；落盘和工具装配在会话宿主里。

export const PLAN_STATUSES = ['todo', 'doing', 'done', 'needs_user', 'blocked'];
export const PLAN_MAX_ITEMS = 12;
const LABEL = { todo: 'To be done', doing: 'In progress', done: 'Done', needs_user: 'Waiting for your confirmation', blocked: 'stuck' };

export const PLAN_UPDATE_PARAMETERS = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    items: {
      type: 'array', maxItems: PLAN_MAX_ITEMS,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: PLAN_STATUSES },
          note: { type: 'string' },
        },
        required: ['id', 'title', 'status'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const fail = (reason) => Object.assign(new Error(reason), { reason });
const clip = (value, limit) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; };

export const emptyPlan = () => ({ goal: '', items: [], updatedAt: '' });

// 校验并合并：整体替换步骤清单；goal 省略则保留。
export function applyPlanUpdate(current, args, now = new Date().toISOString()) {
  const base = current && typeof current === 'object' ? current : emptyPlan();
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('invalid_plan: Parameter must be an object');
  const next = { goal: base.goal || '', items: base.items || [], updatedAt: now };
  if (args.goal !== undefined) {
    if (typeof args.goal !== 'string') throw fail('invalid_plan: goal must be text');
    next.goal = clip(args.goal, 200);
  }
  if (args.items !== undefined) {
    if (!Array.isArray(args.items) || args.items.length > PLAN_MAX_ITEMS) throw fail(`invalid_plan: most steps${PLAN_MAX_ITEMS} a`);
    const seen = new Set();
    next.items = args.items.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.title !== 'string' || !item.title.trim()) throw fail('invalid_plan: Each step requires id and title');
      if (!PLAN_STATUSES.includes(item.status)) throw fail(`invalid_plan: The status can only be${PLAN_STATUSES.join('/')}`);
      const id = item.id.trim();
      if (seen.has(id)) throw fail(`invalid_plan: Duplicate step number${id}`);
      seen.add(id);
      return { id, title: clip(item.title, 60), status: item.status, ...(item.note ? { note: clip(item.note, 120) } : {}) };
    });
    if (next.items.filter((item) => item.status === 'doing').length > 1) throw fail('invalid_plan: There can only be one step "in progress" at the same time');
  }
  return next;
}

// 系统提示里的计划段落：每轮都是最新状态，压缩后也不会丢。
export function renderPlanSection(plan) {
  if (!plan?.items?.length) return plan?.updatedAt ? 'Current production plan: All steps completed.' : undefined;
  const lines = ['Current production plan (maintained by yourself; updated with plan_update):'];
  if (plan.goal) lines.push(`Goal:${plan.goal}`);
  plan.items.forEach((item, index) => lines.push(`${index + 1}. [${LABEL[item.status]}] ${item.title}${item.note ? `（${item.note}）` : ''}  (${item.id})`));
  lines.push('Method: Update the plan after completing one step; proceed directly to the next step if it does not require user confirmation or payment; mark needs_user and stop explaining when the user needs to confirm, answer or click "Generate". If an error occurs and cannot continue, mark blocked and explain the reason. Steps that are not actually completed cannot be marked done.');
  return lines.join('\n');
}

// 一轮回答结束时是否应该自动接着做下一步。预算和次数上限由调用方给出。
export function planContinuation(plan, { continuations = 0, maxContinuations = 6 } = {}) {
  if (!plan?.items?.length || continuations >= maxContinuations) return undefined;
  if (plan.items.some((item) => item.status === 'needs_user' || item.status === 'blocked')) return undefined;
  const next = plan.items.find((item) => item.status === 'doing') || plan.items.find((item) => item.status === 'todo');
  if (!next) return undefined;
  return `The plan is not finished yet. Keep doing "${next.title}"; Use plan_update to update the status when finished. When you encounter a place where the user needs to confirm, answer, or click "Generate", mark needs_user and stop.`;
}

// 给界面看的计划（不含内部字段）。
export function publicPlan(plan) {
  if (!plan?.items?.length) return null;
  const done = plan.items.filter((item) => item.status === 'done').length;
  return { goal: plan.goal || '', items: plan.items.map(({ id, title, status, note }) => ({ id, title, status, ...(note ? { note } : {}) })),
    done, total: plan.items.length, updatedAt: plan.updatedAt || '' };
}
