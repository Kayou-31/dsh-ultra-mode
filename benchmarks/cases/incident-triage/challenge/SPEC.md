# 网关规则、证据与交付接口

场景：新增第二个客户后 `/checkout` 出现 429，数据库 session 读取量同时上升；同一时间附近还部署了连接池配置。诊断必须区分最初触发原因、放大机制和只有时间相关性的线索，不能凭部署时间直接归因。

软件接口：

- `src/service.mjs` 导出 `createGateway({limit=2,windowMs=1000,maxAttempts=3}={})`。
- `await gateway.request({tenantId,route='/checkout',atMs,requestId,upstreamStatuses?})` 返回 `{status,attempts,retryStatuses,...}`。atMs 是从 0 开始的确定性毫秒时钟，窗口为 `floor(atMs/windowMs)`。tenantId/route 是非空不透明字符串，可包含冒号和 Unicode。
- 同一个租户、路由、窗口至多接纳 limit 次尝试；不同租户或路由预算互不影响。窗口切换重新获得额度。不得取消限流、提高传入额度、删除计数或把每次请求放入独立预算。
- 一次尝试先读取数据库 session，再检查预算；此顺序是本场景的既定行为。`metrics()` 返回 `{gatewayAttempts,dbSessionReads,accepted,rejected}`，每尝试计一次读取。一次 HTTP 请求不得在同一窗口内部重试 429；400 等非瞬时失败也不重试。500/502/503/504 可重试，最多 maxAttempts 次（含第一次），仍保留既有重试能力。
- `upstreamStatuses` 只用于项目内测试：第 n 次尝试返回第 n 个状态；用完后默认 200。无需联网。每次被预算接纳的尝试仍占用一次额度。
- `src/limiter.mjs` 继续导出 `createLimiter()`，实例保留 `take({tenantId,route,atMs})` 与 `inspect()`。take 返回 `{allowed,remaining,retryAfterMs}`。`src/retry.mjs` 继续导出 `shouldRetry({status,attempt,maxAttempts})` 与 `runWithRetry(operation,{maxAttempts}?)`，operation 接收 `{attempt}` 并返回 `{status,...}`，结果保留 attempts/retryStatuses。

证据索引见 `data/evidence-index.json`。证据包的“故障前回放”是未修复版本的冻结观测；修复后无需重新制造错误实现。对照请求序列为：limit=2，windowMs=1000，maxAttempts=3；red/red/blue/blue，各自 `/checkout`，atMs=100/110/120/130，四个不同 requestId。任何补丁都须正确处理该序列及其他同规则输入，不得针对具体 tenantId 或证据内容硬编码。

交付 `outputs/diagnosis.json`，严格采用以下顶层字段，不能追加字段：

```json
{
  "schemaVersion": 1,
  "summary": "非空诊断摘要",
  "rootCause": {"code": "一个根因代码", "evidenceIds": ["证据ID"]},
  "causalChain": ["因果节点代码，按发生顺序"],
  "rejectedHypotheses": [{"code": "排除的假设代码", "evidenceIds": ["证据ID"], "reason": "非空原因"}],
  "beforeReplay": {"httpStatuses": [200], "gatewayAttempts": 1, "dbSessionReads": 1},
  "afterReplay": {"httpStatuses": [200], "gatewayAttempts": 1, "dbSessionReads": 1},
  "fixes": ["修复措施代码"],
  "limitations": ["明确的未覆盖边界"]
}
```

根因/假设代码词表：`LIMITER_SCOPE`、`DATABASE_POOL`、`UPSTREAM_CAPACITY`、`CLIENT_RETRY`、`OTHER`。因果节点词表：`SHARED_BUDGET`、`HTTP_429`、`RETRY_429`、`EXTRA_DB_SESSION_READS`、`POOL_EXHAUSTION`、`UPSTREAM_503`。措施词表：`TENANT_SCOPED_BUDGET`、`NO_RETRY_429`、`INCREASE_POOL`、`DISABLE_LIMITER`、`DISABLE_ALL_RETRIES`。词表是候选假设，不表示这些全部正确。证据 ID 只能引用 evidence-index 中实际存在的条目。beforeReplay/afterReplay 对应上面的同一固定四请求序列；必须报告真实观测/正确补丁结果，不能把缺失的运行结果伪装成已执行。

初始 outputs/diagnosis.json 只是待校正的现有事件结论，不应被当成可信答案。最终应保留限流、修复因果链，并明确冻结内存场景的边界。
