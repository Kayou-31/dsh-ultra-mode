# 独立 DSH 宿主验收驱动

此目录仅用于验收，不属于 Ultra 插件的生产运行代码。驱动作为 profile 的 Cordis 插件行，由真实 DSH 0.2.0-rc.2 CLI Loader 加载。根目录的 `run-profile.mjs` 管理独立的 `DSH_HOME`、profile、项目目录和候选包安装；本驱动不调用 `ctx.plugin(Ultra)` 绕过 Loader。

实际执行的部分包括 AgentLoop、工具运行和权限限制、原生 preset 继承、JSONL 持久化、冷进程恢复、token-meter、工具结果的原生 surface 替换与回放。模型端使用不联网的本地脚本 LlmAdapter；usage 字段为固定合成计数，不能代表真实模型 token、账单、推理质量或长期任务完成质量。

`core` 覆盖：

- 默认关闭状态、手动辅助和手动两路模式；主 Agent 保留 medium，研究和 decision 按原行为使用 Max。
- 真实 worker 读取长结果，提供给模型的投影与进展均遗漏尾部答案；decision 通过实际 search/get 工具读回原始证据，核对进展中的来源 ID。
- 第二个 worker 产生相反原文；decision 读回双方原文并保留带来源的未决问题。
- 检索返回预算、实际请求次数预算在 adapter 调度前拒绝后续步骤、项目与会话隔离、复制的 Agent 身份拒绝、真实取消。
- 运行中反馈在第一条实际请求已发出时入队，随后分别核对原生准入与下一条实际请求可见性。脚本的确认输出只证明测试脚本看到了资料，不证明真实模型采纳。
- 实际子会话事件的一次索引写入拒绝，随后 checkpoint 审核修复，并验证幂等。
- 压缩探针使用明确标识的历史协议 fixture，经原生工厂创建和真实 AgentLoop 后续轮次进入原生日志；不将其包装成真实模型长任务。覆盖原生 token-meter、压缩与证据回读、默认压缩器冲突、运行中出现另一压缩器、checkpoint 取消和提交后持久化失败的补偿。

`resume` 在另一个进程恢复 core 的真实原生会话，读回原始与冲突证据、一次性限制、压缩后的 surface 和补偿后的历史，然后执行新的本地轮次。

`disabled` 使用单独的项目目录，验证 `evidenceEnabled: false` 时没有检索工具、证据运行和项目索引文件。

调用记录与结果写入 runner 配置的 `resultFile`，冷恢复凭据写入 `receiptFile`，压缩清单位于独立项目目录。以上“凭据”仅是测试会话和来源 ID，不包含服务密钥。

禁止在日常 profile 里加载这些测试工具。本驱动的 `read` 和 `write` 是仅在本地返回 fixture 的哨兵；`write` 不修改业务文件。运行时网络阻断和最小环境变量由 runner 提供，不能省略。

## 已授权真实模型时的单进程全局门限

`real-model-global-limit.mjs` 是单独的验收组件，不创建 provider，不读取凭据，不启动任务，也不改写原生请求。在独立 profile 的部署层加载一次，并让所有 worker、decision、辅助与压缩请求使用该层的同一原生 LLM 服务。它以 `prepend` 包装 `llm/stream`，允许的 provider 和 model 必须精确匹配。并发只接受 1 或 2，默认 2；请求准入预算默认 60。多进程验收应由外部 runner 顺序启动，门限不跨进程共享。

配置字段为 `testRoot`（已存在的独立目录绝对路径）、`logFile`（其下的日志路径）、`allowedProvider`、`allowedModel`、`concurrency` 和 `maxRequests`。`ctx.get('ultraAcceptanceModelGate').snapshot()` 提供峰值并发、队列和准入/结束计数。

日志只保存运行/请求/会话 ID、渠道和模型标识、阶段、计数、耗时及提供方回报的数值 usage。它不记录提示词、工具内容、模型输出、私有思维链、凭据、错误消息或堆栈；usage 不推算价格。多条 usage 以最后一条回报为最终观察，不擅自相加。`synthetic: false` 适用于连接已授权真实渠道的运行；本组件的单元测试用本地流 fixture，不可作为真实模型效果证据。

计数口径是通过原生 LLM 流入口的准入数量。后续其他宿主钩子可能仍拒绝请求，不能据此把每个准入都当成提供方已经计费。门限按实际流生命周期持有并发许可；排队取消、下游失败和消费者提前关闭都会释放许可。日志写入失败会禁止后续调度。
