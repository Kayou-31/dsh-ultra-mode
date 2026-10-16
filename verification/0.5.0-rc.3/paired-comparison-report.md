# 新原版／候选 A/B 公开对照

extreme-paired-a-review-1；截至2026-10-16T07:35:54.321Z。当前状态：ended-with-failed-or-unverified-conditions。仅纳入launch.finishedAt已结束阶段的结果和用量。没有启动宿主或模型，也未读取private日志或凭据。

| 臂 | 状态 | 实际完成轮 | 请求 | known/unknown | 已知token小计 | 冻结质量 | 阶段墙钟含节流 | 去重prune |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline 0.4.0-rc.3 | failed-preserved | 3/10 | 11 | 10/1 | 3,515,407 | 未判定 | 305.63s | 0 |
| candidate 0.5.0-rc.3 | failed-preserved | 10/10 | 35 | 31/4 | 7,544,126 | 0/12 | 1151.34s | 12 |

原版0.4.0-rc.3启用native auto，候选0.5.0-rc.3启用local30K；配置差异是本次产品条件。native按压力触发，可能不压缩，不能由配置推断实际次数。

共同输入证据：十条实际userPrompt SHA一致=false；逐attempt生成fixture源码SHA符合共同计划=true；实际manifest字节一致的协调器回执=尚无。未提供的manifest字节SHA保持null。

共同完成且提示SHA一致的前缀=3轮。未提供逐请求turn归属；此前缀的可比token和延迟账均保持null。

并发：已结束请求完整时间区间的合计峰值下界=2；缺终止时间0次。两个独立profile各限1，本地取消不证明上游slot释放。

未达到双方完成、共同输入核验、全部评分与完整usage条件；整任务成本、耗时差值及优势保持null。

只适用于各臂下列冻结包SHA。后续修复、新TGZ或不同配置需要单独验证，不能外推本对照结果。

## baseline

包SHA256：7cac5d9ad2bb6c5e0256724f03fe021f035b2c1fbfaeecdd35f97764bf74c2a1。压缩器：native compaction-basic；本地并发1，最小间隔30000ms。

- 同根冷恢复：session一致=false，不同进程=false，native累计轮数=false。
- 最终真实双源读回：尚无完整通过证据。实际约束遗漏=未判定；评估状态=unassessed-no-final-grade；未评所列约束=literal human label、conflict remains unresolved、execution is distinct from verification、latest footer retained。执行哨兵尝试=0。
- input=1,079,312（10请求报告）；cacheRead=2,427,520（9请求报告）；cacheWrite=未报告；output=8,575（10请求报告）；reasoning=未报告。分项不再加到totalTokens。
- 阶段墙钟合计=305.63s，跨重启span=305.63s；已知本地等待=320.36s，包含在耗时中。
- 观察到网络/传输失败=true。网络中止单列运行失败；未完成最终评分不解释成模型能力差。
- 重复阶段=未观察；清理错误=0。

阶段：

- rc3-extreme-paired-a-baseline-long-1792133646178 / baseline-long：failed-launch，本进程完成轮=3，失败项=native model turn completed 4，AssertionError / native model turn completed 4；公开轮终止=error/TRANSPORT

真实请求按角色/会话/effort/cap：

- main / test-session-6556293a95f02e1f：medium / cap=16384，请求8，known/unknown=7/1，已知token=2,699,073
- auxiliary-role-unconfirmed / test-session-bd0d57e1a333feeb：max / cap=16384，请求1，known/unknown=1/0，已知token=2,779
- auxiliary-role-unconfirmed / test-session-338a20804f127c13：max / cap=16384，请求1，known/unknown=1/0，已知token=273,499
- auxiliary-role-unconfirmed / test-session-f0cadd87fa769efb：max / cap=16384，请求1，known/unknown=1/0，已知token=540,056

## candidate

包SHA256：788d17409e227cc88b4d99096f27223c7b7f9fe20c44c3fdda991d01025bba18。压缩器：candidate local Ultra；本地并发1，最小间隔30000ms。

- 同根冷恢复：session一致=true，不同进程=true，native累计轮数=true。
- 最终真实双源读回：通过。实际约束遗漏=未判定；评估状态=strict-format-unparseable；未评所列约束=literal human label、conflict remains unresolved、execution is distinct from verification、latest footer retained。执行哨兵尝试=0。
- input=2,756,783（31请求报告）；cacheRead=4,725,504（28请求报告）；cacheWrite=未报告；output=61,839（31请求报告）；reasoning=未报告。分项不再加到totalTokens。
- 阶段墙钟合计=1151.34s，跨重启span=1151.84s；已知本地等待=1037.09s，包含在耗时中。
- 观察到网络/传输失败=true。网络中止单列运行失败；未完成最终评分不解释成模型能力差。
- 重复阶段=未观察；清理错误=0。

阶段：

- rc3-extreme-paired-a-long-1792133646201 / long：passed，本进程完成轮=7，失败项=无/尚未判定
- rc3-extreme-paired-a-resume-1792134481521 / resume：failed-launch，本进程完成轮=3，失败项=final structured JSON；literal human label；tail batch exact；tail checksum exact；both conflicting values preserved；conflict remains unresolved；conflict left exact source quote；conflict right exact source quote；execution is distinct from verification；latest footer retained；valid public source quotations；tail values have exact source quotations；cold resumed real model quality checks passed，AssertionError / cold resumed real model quality checks passed

真实请求按角色/会话/effort/cap：

- main / test-session-3cc470a01b3953a4：medium / cap=16384，请求21，known/unknown=21/0，已知token=7,410,945
- auxiliary-role-unconfirmed / test-session-07c13cddf299ca7f：max / cap=16384，请求1，known/unknown=1/0，已知token=5,524
- auxiliary-role-unconfirmed / test-session-c758ca08134da160：max / cap=16384，请求1，known/unknown=1/0，已知token=7,098
- auxiliary-role-unconfirmed / test-session-21f97487aa3588a8：max / cap=16384，请求1，known/unknown=1/0，已知token=8,790
- auxiliary-role-unconfirmed / test-session-792d07d4f946381e：max / cap=16384，请求2，known/unknown=1/1，已知token=20,212
- auxiliary-role-unconfirmed / test-session-5de66f98dcf5439f：max / cap=16384，请求2，known/unknown=1/1，已知token=21,792
- auxiliary-role-unconfirmed / test-session-66f3ab33f20d7920：max / cap=16384，请求1，known/unknown=0/1，已知token=0
- auxiliary-role-unconfirmed / test-session-aa80639c19d77b31：max / cap=16384，请求2，known/unknown=1/1，已知token=21,122
- auxiliary-role-unconfirmed / test-session-ed10ebf5eedfe740：max / cap=16384，请求1，known/unknown=1/0，已知token=11,180
- auxiliary-role-unconfirmed / test-session-86126a322a1f95a8：max / cap=16384，请求1，known/unknown=1/0，已知token=9,787
- auxiliary-role-unconfirmed / test-session-0a77e0f73d437711：max / cap=16384，请求2，known/unknown=2/0，已知token=27,676

## 边界

- 原版0.4.0-rc.3插件+native auto压缩，对比候选0.5.0-rc.3+local30K，是声明产品配置的对比；不是只隔离一个算法，也不要求相同prune次数。
- native auto按1000000上下文窗口压力触发，可能零次；local30K是软目标，不能由配置推断每次实际请求都低于30K。
- 两臂共用同一公开十轮fixture与冻结12项评分；新memory/quote专用协议在两臂均关闭，最终公共引文及双源真实读回仍要求。
- 墙钟包含30秒本地节流等待、模型服务时间、进程和冷恢复开销；不是纯算法延迟。未知usage不当零，缓存与reasoning不重复叠加。
- 一对受控样本没有统计推广意义；并发运行的通道负载与缓存是实测条件，不据此推算金额或普遍节省。
- 原错误、未完成阶段和额外尝试均保留；未结束不预写成功，不自动重跑，也不把本地取消等同上游slot释放。
- TRANSPORT/Connection error单列为运行失败，不解释成模型能力差；一臂未完成十轮时，整任务token/耗时优势保持null。共同完成prompt SHA前缀不等于可比请求前缀，缺逐请求turn边界时不比较其用量。
- 结论仅适用于plan及实际launch核对的冻结包SHA；后续检索修复的新TGZ不继承本对照的通过、失败或成本结论。
- 严格JSON无法解析或grade.value缺失时，冻结评分原样保留，但实际约束遗漏为未判定；解析失败产生的其余false不自动解释为原值、限制或状态已丢失。未追加补充分数。
- 本新对照与旧rc.2不同条件的样本分开陈列，不合并成更大的A/B样本。
