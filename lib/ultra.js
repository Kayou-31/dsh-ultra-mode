/**
 * Pure ULTRA policy helpers — no Cordis, no I/O.
 *
 * Everything here is deterministic and unit-tested (`test/ultra.test.mjs`).
 * The plugin's host half imports these; keeping the policy separate from the
 * Cordis wiring is what makes the fallback/degradation matrix testable.
 *
 * @module dsh-ultra-mode/ultra
 */
/** Concurrency bounds advertised to the model and the UI. */
export const MIN_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 5;
/** Clamp an arbitrary value into the supported concurrency range. */
export function clampConcurrency(value, fallback = 3) {
    const asInt = (candidate) => {
        if (typeof candidate === 'number' && Number.isInteger(candidate))
            return candidate;
        if (typeof candidate === 'string' && candidate.trim() !== '') {
            const parsed = Number(candidate);
            if (Number.isInteger(parsed))
                return parsed;
        }
        return undefined;
    };
    // 非数字、null、布尔、空串、小数、NaN 一律回退。
    // 注意 `Number(null) === 0`：若先做 Number() 会把 null 静默当成 0。
    const resolved = asInt(value) ?? asInt(fallback) ?? 3;
    return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, resolved));
}
/**
 * Canonical session key. An absent/blank/non-string candidate is *rejected*
 * (`undefined`) rather than folded into a shared bucket — silent sharing is
 * how two sessions end up driving one another's mode.
 */
export function resolveSessionKey(candidate) {
    if (typeof candidate !== 'string')
        return undefined;
    const key = candidate.trim();
    return key === '' ? undefined : key;
}
/** A run is "burning" while at least one invocation is in flight. */
export function isRunning(state) {
    return state.activeRuns > 0;
}
/** Detached snapshot for the client (no live objects cross the RPC boundary). */
export function snapshotOf(state) {
    return {
        enabled: state.enabled,
        concurrency: state.concurrency,
        running: isRunning(state),
        activeRuns: state.activeRuns,
        lastRun: state.lastRun === null ? null : { at: state.lastRun.at, ms: state.lastRun.ms },
    };
}
/**
 * A worker counts only when it completed *and* produced non-empty text.
 * "completed with empty output" must never be counted as a sample.
 */
export function countUsable(outcomes) {
    return outcomes.filter((o) => o.ok && typeof o.text === 'string' && o.text.trim() !== '').length;
}
/** Decide the conclusion strategy for one run. */
export function planMerge(outcomes, requested) {
    const succeeded = countUsable(outcomes);
    const failed = outcomes.length - succeeded;
    const strategy = succeeded < 2 ? 'insufficient' : succeeded < requested ? 'degraded' : 'full';
    return { requested, succeeded, failed, strategy };
}
/** Human-readable banner describing a partial run, prepended to the answer. */
export function runBanner(plan) {
    if (plan.strategy === 'full')
        return '';
    return `[ULTRA] 本次启动 ${plan.requested} 路，成功 ${plan.succeeded} 路，失败 ${plan.failed} 路（降级合并，可靠性低于完整 ${plan.requested} 路）。`;
}
/** Per-worker text budget inside the merge prompt (characters). */
export const WORKER_TEXT_LIMIT = 20000;
/**
 * Build the merger brief. The merger is told the *requested vs succeeded*
 * counts so it cannot silently present a 1-of-5 result as a 5-way consensus.
 */
export function buildMergePrompt(task, outcomes, plan) {
    const usable = outcomes.filter((o) => o.ok && typeof o.text === 'string' && o.text.trim() !== '');
    const parts = usable
        .map((w, i) => `【结果 ${i + 1}】\n${w.text.slice(0, WORKER_TEXT_LIMIT)}`)
        .join('\n\n');
    const reliability = plan.strategy === 'degraded'
        ? `注意：本次请求 ${plan.requested} 路，实际只有 ${plan.succeeded} 路成功（${plan.failed} 路失败）。合并时请按“样本偏少”处理，并在答案中保留这一事实。`
        : `本次 ${plan.succeeded} 路全部成功。`;
    return [
        `你是 ULTRA 合并者。下面是 ${plan.succeeded} 个独立 agent 对同一个任务的完成结果。`,
        reliability,
        '',
        '【任务】' + task,
        '',
        parts,
        '',
        '请：',
        '1. 交叉核对：找出共识点、分歧点和遗漏点；对分歧给出你的判断与理由。',
        '2. 整合出一份最终答案（中文，除非任务另有要求）：结构清晰、完整、可直接使用，宁全勿缺。',
        '3. 若某些分歧无法调和，在答案中注明。',
        '4. 最终回复即最终答案本身；不要附上流程说明。',
    ].join('\n');
}
/** Fallback when the merger itself fails: keep every usable sample, labelled. */
export function fallbackJoin(outcomes) {
    return outcomes
        .filter((o) => o.ok && typeof o.text === 'string' && o.text.trim() !== '')
        .map((w, i) => `【分支 ${i + 1}】\n${w.text}`)
        .join('\n\n');
}
/** The worker brief. Self-contained: workers never see the parent conversation. */
export function buildWorkerBrief(task) {
    return [
        '你是 ULTRA 并发工作流的一个分支（独立 agent，看不到主对话）。',
        '【任务】' + task,
        '要求：',
        '1. 独立、完整地处理该任务；你的最终回复就是交付物（完成态最终结果，不是草稿或过程汇报）。',
        '2. 需要时可使用可用工具（读文件、执行命令、搜索等）取得事实后再下结论。',
        '3. 最终回复用中文（除非任务另有要求），结构清晰、可直接使用。',
        '4. 不要提及“分支、并发、ULTRA”等机制性内容。',
    ].join('\n');
}
/**
 * Prompt section text for one assembly. Returns an empty string when the
 * session has no ULTRA state at all (nothing to say, no prompt churn).
 *
 * The section is evaluated on every assembly, so the model is told the
 * *current* switch position instead of guessing it from a static sentence.
 */
export function renderUltraSection(state, toolName) {
    if (state === undefined)
        return '';
    if (!state.enabled) {
        return `${toolName} 可用：并发多个独立 agent 处理同一任务并合并结果。当前 ULTRA 开关为关闭；仅在用户明确要求“ultra/并发处理”时使用。`;
    }
    const running = isRunning(state) ? `（另有 ${state.activeRuns} 次 ULTRA 正在执行中）` : '';
    return [
        `ULTRA 当前状态：已开启${running}`,
        `并发数：${state.concurrency}`,
        `本轮必须先调用 ${toolName}（task 参数 = 用户请求全文），且仅调用一次；随后基于合并结果直接答复用户，不要重新执行整个任务。`,
    ].join('\n');
}
//# sourceMappingURL=ultra.js.map