# 退款模块：更新前冻结规则

这是现有业务规则的快照。后续用户明确发出的规则更新优先于这份旧文档；不得自行推测更新内容。

接口为 `src/refund.mjs` 的具名导出 `calculateRefund(input)`，返回 `{eligible, refundCents, reason}`。金额一律以整数美分表示，不能返回浮点金额。不得修改输入。

输入字段：

- `customerType`：`consumer` 或 `enterprise`。
- `paidCents`：0 至 1,000,000,000 的安全整数。
- `purchasedAt`：带 `Z` 或明确时区偏移的时间字符串。
- `requestedAt`：可选；省略时使用固定业务时钟 `2026-01-15T12:00:00.000Z`，不得读取系统当前日期。
- `totalUnits`：1 至 1,000,000 的整数；`consumedUnits`：0 至 totalUnits 的整数。
- `contractRefundCents`：企业必填，0 至 paidCents 的整数。

时间格式为 `20YY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)`；必须是真实日历日期，秒数 0–59，偏移最多 ±14:00。按绝对时间差计算连续天数，1 天为 86,400,000 毫秒。请求早于购买时间是异常输入。

更新前：消费者购买后 7×24 小时内（含恰好第 7 天）全额退款，消费数量不参与扣除，返回 `eligible:true, reason:'consumer-window'`。超期返回 `eligible:false, refundCents:0, reason:'consumer-expired'`。企业不受消费者窗口限制，始终按合同金额返回 `eligible:true, reason:'contract'`。

无效类型、缺失字段、非整数金额/数量、越界数量和金额应抛 TypeError 或 RangeError，不能默默修正。企业的合同分支也必须验证输入与时间顺序。
