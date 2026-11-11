// 单轮预算与可选总预算。
//
// 之前的实现把「历史请求日志的行数」当成本次进程的已用额度，默认上限 250：
// 重启不重置、并发画布互相计数，等于产品被一个越跑越小的终身额度锁死。
// 这里改成两条互不干扰的线：
// 1. 每轮预算——在该轮自己的上下文里计数，轮结束即作废，下一轮从零开始；
// 2. 总预算——只有显式配置才启用，计数存在独立的小文件里，与请求日志无关。

function positiveInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/** 一轮对话的独立预算；max 为 0 表示这一层不限制。 */
export function createTurnBudget({ maxRequests = 0, maxToolSteps = 0 } = {}) {
  return {
    requests: 0,
    toolSteps: 0,
    maxRequests: positiveInt(maxRequests),
    maxToolSteps: positiveInt(maxToolSteps),
  };
}

export function spendModelRequest(budget) {
  if (!budget) return { allowed: true };
  if (budget.maxRequests > 0 && budget.requests >= budget.maxRequests) {
    return {
      allowed: false,
      reason: "turn_request_budget_exhausted",
      message: `The model requests in this round have reached the upper limit (${budget.maxRequests}), has stopped continuing to call; the next round will be counted again`,
    };
  }
  budget.requests += 1;
  return { allowed: true };
}

export function spendToolStep(budget) {
  if (!budget) return { allowed: true };
  if (budget.maxToolSteps > 0 && budget.toolSteps >= budget.maxToolSteps) {
    return {
      allowed: false,
      reason: "turn_tool_step_budget_exhausted",
      message: `This round of tool steps has reached the upper limit (${budget.maxToolSteps}), has stopped continuing to call; the next round will be counted again`,
    };
  }
  budget.toolSteps += 1;
  return { allowed: true };
}

/** 总预算只在 limit > 0 时启用；used 由独立计数文件提供。 */
export function createLifetimeBudget({ limit = 0, used = 0 } = {}) {
  return { limit: positiveInt(limit), used: positiveInt(used) };
}

export function lifetimeBudgetEnabled(budget) {
  return Boolean(budget && budget.limit > 0);
}

export function spendLifetimeRequest(budget) {
  if (!lifetimeBudgetEnabled(budget)) return { allowed: true };
  if (budget.used >= budget.limit) {
    return {
      allowed: false,
      reason: "request_budget_exhausted",
      message: `The total model request budget has been exhausted (${budget.limit}); this is the total upper limit of the explicit configuration`,
    };
  }
  budget.used += 1;
  return { allowed: true };
}

/** 把预算拒绝包成带机器可读 reason 的错误，宿主与后端都靠 reason 分支。 */
export function budgetError(verdict) {
  const error = new Error(verdict.message);
  error.reason = verdict.reason;
  return error;
}
