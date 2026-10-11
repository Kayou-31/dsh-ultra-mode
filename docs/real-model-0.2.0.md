# 0.2.0 真实模型运行记录

2026-10-11，用户完整重启 DSH 后确认按钮菜单正常，HTTP 405 消失，并手动提交 3、4、5 路验收任务。审核人员只读检查这三组已确认会话及其血缘，没有请求应用接口、发起新模型请求或读取无关历史。

日志由独立 Python zstandard 0.25.0 完整解压、校验压缩帧，并由 DSH 官方 session-format-catalog 按 current/strict 解析。全部选择记录完整校验通过。未发布个人原始会话日志。

| 实际执行路数 | 独立执行 loop | 额外决策 loop | 普通子代理 | 所有相关请求 Max | 执行路线共同活动区间 |
| --- | --- | --- | --- | --- | --- |
| 3 | 3，origin 为空、depth 0 | 同一个 ID，两轮 completed | 每路 1 个，origin=subagent、depth 1、completed | 是 | 6026 ms |
| 4 | 4，origin 为空、depth 0 | 同一个 ID，两轮 completed | 每路 1 个，origin=subagent、depth 1、completed | 是 | 6889 ms |
| 5 | 5，origin 为空、depth 0 | 同一个 ID，两轮 completed | 每路 1 个，origin=subagent、depth 1、completed | 是 | 8894 ms |

3 路与 4 路首轮 provider 流片段分别有 964 ms、1152 ms 的共同重叠，支持真实模型并发。上述时间来自宿主事件与流片段，不能解释为精确网络发包区间或严格 TTFT。

3 路结果为 14、30、55；4 路结果为 14、30、55、91，子代理真实 ID 已从会话血缘恢复。等待式 subagent 返回体不提供 ID，one-shot 子代理也不会出现在只列可继续子代理的 list_agents 中，这不意味着没有真实子代理。

5 路的机制项通过，但任务验收未通过。旧决策规划把“真实调用子代理独立计算”扩成了“必须执行 Python 等命令，不能只用推理”，与研究路线禁止命令的策略冲突。4 个孩子返回拒绝，另一个返回 140；不得把全部 turn completed 写成全部计算成功。0.3.0 通过内置提示词、工具 schema 对齐和宿主观察的创建身份补证修复相关设计，仍需新版本真实复验。

4 路最终决策为了恢复 ID 调用了文件搜索与只读命令，其中 grep/glob 对 ASAR 内部路径的查找失败。结果与子代理能力通过，但该轮没有严格遵守验收文本的“不读写文件”条件。证据中保留了此项边界。

Windows computer-use 操作实际 DSH 被工具以 product policy blocks this app 拒绝；未绕过该限制。按钮状态来自用户实际操作反馈，真实并发和子代理身份来自运行时日志核验。0.3.0 的新实时协调能力、真实 Jev 服务和长期稳定性没有此轮真实模型证据。
