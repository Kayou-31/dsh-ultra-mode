# 可重试付款服务接口与业务规则

货币单位均为整数分。一个账户由非空 `tenantId` 与 `accountId` 共同确定。tenantId/accountId 是不透明字符串，可以包含冒号、空格及非 ASCII 字符。不同租户可使用相同 accountId。

`src/service.mjs` 必须继续导出 `createPaymentService(options?)`、`createStore(initialBalances?)` 和 `createCache()`。`initialBalances` 是 `{tenantId, accountId, balanceCents}` 数组。可向 service 注入符合现有接口的 store 和 cache，不能丢弃注入对象或改用旁路状态。

service 保留以下接口：

- `await process(event)`：event 为 `{tenantId, accountId, eventId, requestId, kind, amountCents}`，kind 为 payment/refund，amountCents 为正的安全整数；payment 减余额，refund 加余额。余额不能为负，所有余额运算必须仍为安全整数。
- `await getBalance(tenantId, accountId)`：返回当前已提交的整数分余额；未知账户余额为 0。
- `store`、`cache`：返回实际使用的注入对象。

同租户内 `eventId` 是稳定业务事件标识，不同传输重试可使用不同 requestId。完全相同事件的再次投递应成功返回 `{status:'duplicate', balanceCents}`，不再记账；不同 eventId 即使 requestId 相同仍是不同业务事件。同一 eventId 的账户、kind 或金额变动应以 `EVENT_CONFLICT` 拒绝。不同租户的事件空间互不影响。成功首次应用返回 `{status:'applied', balanceCents}`。

store 的 `failNextCommit()` 会令下一次实际提交以 `COMMIT_FAILED` 失败。失败应原样上抛，不留下余额、账本条目或已处理事件；之后可重试同一事件。失败前后所有正常读均只反映已提交状态。

store 保留 `readBalance()`、`begin()`、`snapshot()`、`failNextCommit()`。snapshot 返回 `{balances, ledger, eventCount}`：balances 是账户余额数组；ledger 按应用顺序记录 `{tenantId, accountId, eventId, kind, amountCents, balanceCents}`，每个成功业务事件恰好一条。transactions 按本项目已有接口工作。评分仅执行串行业务序列，不要求实现并发数据库。

cache 保留同步 `get(key)`/`set(key, value)` 接口；未命中返回 undefined，0 也是可缓存余额。必须继续使用缓存，且连续读取同一未变账户不应反复查询 store。事务和重试不能通过禁用缓存、拒绝重投递、删除账本或吞掉提交异常规避。不能把评分数据、账户或事件标识硬编码为业务判断。

验证错误的 `code` 为 `INVALID_EVENT`/`INSUFFICIENT_FUNDS`/`EVENT_CONFLICT`/`COMMIT_FAILED` 中的对应项。拒绝操作不产生业务变更。正常退款、零余额、同名账户和正常重复查询都应继续工作。
