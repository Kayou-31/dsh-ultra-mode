# 冻结业务规则与交付格式

这是一个小范围、确定性的账务案例，不需要联网或任何依赖。Node.js 24 可直接运行 `node src/cli.mjs`。输入共 96 条：24 个订单、50 条支付来源记录、22 条退款来源记录。

## 输入和身份

- `data/orders.json` 是订单数组，字段 `orderId, customerId, amountCents, currency`。订单号必须按原始字符串匹配，`0007` 与 `7` 是两个订单。相同 customerId 的不同订单不得合并。订单金额是发票信息；部分支付和追加支付允许存在，不以发票金额替换实际账务事件金额。
- `payments-a.csv` 与 `payments-b.csv` 同列：`source,eventId,orderId,currency,amount,occurredAt,status`。CSV 金额是严格十进制字符串，如 `12.34`，不允许小数超过两位、科学计数、正负号、空白或超过 1,000,000,000 美分；支付必须大于 0。
- `refunds.json` 为数组，字段 `source,eventId,orderId,currency,amount,occurredAt,status,representation`。`representation:'positive'` 用无符号正金额表示退回金额；`representation:'signed'` 用严格负金额表示退回金额。**两种表示都减少收入**。金额绝对值适用支付的范围与两位小数规则。
- 每条来源记录的稳定 recordId 是文件名加 `#` 加记录序号。CSV 表头为 1，第一条数据是 `#2`；JSON 数组第一项是 `#1`。序号是记录序号，不是磁盘显示行号。保持原始 source 字段，但去重身份不包含 source。

## 有效事件、去重和时区

只入账 `currency:'USD'`、已知订单、`status:'settled'` 且字段有效的记录。`pending` 不入账，记 `non_settled`；其他未知 status 记 `invalid_status`。

occurredAt 必须是 `20YY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)` 的真实日期。秒数 0–59，偏移最多 ±14:00；没有显式时区或 2 月 30 日等日期记 `invalid_timestamp`。先转换为绝对时刻，再按 **UTC 日期**汇总；输出 occurredAt 使用 `YYYY-MM-DDTHH:mm:ss.sssZ`。

事件唯一身份为 `payment:eventId` 或 `refund:eventId`，两种类型分别去重。若同身份有效记录的订单、金额绝对值或绝对发生时刻不同，整组排除，每条记 `duplicate_conflict`。source 不影响身份；同一退款的 positive/signed 表示在规范化后金额相同，也属于同事件。

同身份内容一致时只计一次。按 recordId 的默认字符串顺序排序，第一条作为保留记录，其余各记 `duplicate`；保留事件的 sourceRecordIds 仍包含全组来源 recordId，不能丢失重复上报的证据。异常顺序按 recordId 默认字符串排序。

单条记录先校验 eventId 为非空字符串（`invalid_event_id`），再按以下顺序校验：USD（`invalid_currency`）、订单（`orphan_order`）、状态、时间、退款 representation（`invalid_representation`）、金额（`invalid_amount`）。不合格记录不参与后续冲突分组。无需推测或补造无法关联的订单。

## 输出

`src/reconcile.mjs` 导出 `reconcile({orders,payments,refunds})`，返回 `{report,rows}`；不可修改输入。CLI 默认读取 `data`，写 `outputs/report.json` 和 `outputs/cleaned.csv`，并接受 `--input-dir PATH --output-dir PATH`。评分使用独立输出目录，不接受旧输出充当本次交付。

report.json **仅含**以下顶层字段；金额、计数均为安全整数：

```json
{
  "schemaVersion": 1,
  "totals": {"paymentCents": 0, "refundCents": 0, "netCents": 0, "keptEvents": 0, "excludedRecords": 0},
  "daily": [{"date": "2026-04-01", "paymentCents": 0, "refundCents": 0, "netCents": 0, "eventCount": 0}],
  "orders": [{"orderId": "0001", "customerId": "C01", "paymentCents": 0, "refundCents": 0, "netCents": 0, "eventCount": 0}],
  "anomalies": [{"recordId": "payments-a.csv#2", "code": "duplicate", "eventId": "p001", "orderId": "0001"}]
}
```

refundCents 为正的退款总额，netCents = paymentCents − refundCents；netCents 可为负数。excludedRecords 是原始支付/退款来源条数减去 keptEvents，包含正常重复及无效记录，不包含订单输入。daily 只列有事件的 UTC 日期，按日期排序；orders 必须包括所有订单并按 orderId 默认字符串排序，不按 customerId 聚合。

cleaned.csv 列顺序固定为：`eventKey,eventId,kind,orderId,customerId,currency,occurredAt,date,deltaCents,sourceRecordIds`。kind 为 payment/refund，支付 deltaCents 为正，退款为负；sourceRecordIds 是 JSON 字符串数组，按标准 CSV 引号转义。行按 eventKey 默认字符串排序。每个经济事件恰好一行，数据来自实际来源，不生成订单级伪事件。输出 UTF-8，结果须可重复生成；不得写系统时间或随机 ID。
