# Decision 统一意图、诊断与验收：离线闭环检查点

用户已明确批准上一轮方向并要求持续实施。范围是现有 Ultra 的增量检查点，不重写宿主、不恢复在线模型测试、不操作日常 DSH、不 push 或发布。使用独立目录和 before 快照保护所有先前修改；不移动或重置旧 checkout。

## 目标与约束

在已有 decision 的规划、事件驱动协调及最终交付调用内，分别完成意图提炼、带证据的方向调整及逐项验收。保留原话、硬约束和来源；机器推断不成为人类授权。保持关闭、正常 Agent＋辅助、手动 2～5 路及模型池行为。新增治理可配置关闭，不默认增加独立优化器或额外路线。

官方目标固定为 DSH 0.2.1-rc.2（npm next，GitHub dsh-v0.2.1-rc.2）；0.2.0-rc.2 为旧回归目标。版本与请求组装必须实核，不能将 alpha.4 源码当作新版本运行证据。新宿主仍负责模型、工具、权限、Inbox、生命周期、会话与日志；本插件仅增加策略与公开审计。

参考 WestFox-AwA/dsh-prompt-optimizer 当前 po06 的意图原文锚定、机器来源、诊断停止条件、专项验收思想，独立实现本轮协议，不搬入其 Bash/runtime 或全局配置。代码如有直接复用，保留 BSD-3-Clause 版权和出处。只展示操作与判断，不导出私有思维链。

## 实施步骤

1. **恢复点与基线**：已保存 251 个当前来源文件及 manifest、Git diff，位置 work/decision-loop-checkpoint/before；记录日常配置哈希。执行现有离线基线，保留旧开发包。
2. **纯契约模块**：新增 decision-contract.ts，严格原文归因、机器条目、任务 hash/revision、诊断建议 ledger、来源白名单、TTL/替代/去重及模型验收状态；先写失败用例。用户条目的 text 必须逐字等于原话 quote，禁止反转原意后冒称人类指令。
3. **宿主兼容**：在全新 workspace runtime 安装固定官方 npm 产物（ignore-scripts、无凭据），核对 startActivation、工具过滤、取消/恢复和请求预算；保留旧宿主分支的精确行为，迁移工具权限时 fail closed。
4. **decision 集成**：新 decisionGovernance 显式开关；规划原调用接收 intent+assignments，错误沿既有一次修复/保守原文回退；协调使用已观察证据及任务版本，建议只在本次活动目标后续步骤准入；最终同一次交付调用输出正文和验收项。辅助模式仅建议，不接管主 Agent 执行或增加最终审查调用。
5. **可核对状态**：记录 queued、真实 user/message admitted、实际 llm/stream request-visible；只由受信独立验证器标注 effect-verified，任意后续工具或模型自称不能升级。取消、过期、已结束路线清理插件拥有的待处理项，不宣称撤回已发请求。通过既有 EvidenceStore 保存公开治理快照，面板/RPC读取视图不成为第二权威。
6. **独立宿主验收**：使用最终 TGZ 的固定 SHA、DSH 0.2.1-rc.2 CLI Loader/AgentLoop/ToolRuntime/JSONL 和明确离线脚本模型；统一最多双并发、有限请求/超时、禁止外网。两 worker 真执行 fixture 工具、decision 识别重复/偏差、原生后续请求收到建议、fixture 行为回执证明具体改变、最终缺证据项保留未验证。另查关闭、辅助、取消、冷恢复及旧模式回归。
7. **审查和交付**：独立代码审查与修复，完整 build/typecheck/test 和适当 benchmark；中文配置/兼容/来源/迁移回滚说明、本地开发包、源码及相对 before 增量补丁。核对 TGZ 与源码字节，验证 ZIP/哈希；不覆盖 rc.3/上轮 dev.1 交付。

## 文件与接口归属

| 任务 | 主要文件 | 接口与冲突处理 |
| --- | --- | --- |
| 契约纯逻辑 | 新 decision-contract.ts/test | 不依赖 SDK；root 消费显式协议 |
| 新宿主适配 | runtime.ts、collaboration-host.ts、新 host-compat 测试 | root 不并行编辑；steer 增加可选 delivery metadata，不改变旧调用 |
| 决策策略集成 | 新 decision-governance.ts、ultra.ts、coordination.ts、orchestrator.ts、assist.ts、index.ts | root 所有；模块不自行发 LLM 请求 |
| 原文与审计 | memory-host.ts 必要小接口 | 与宿主代理协商所有权，不另造日志框架 |
| 新宿主验收 | 新 decision-loop-plugin/run-decision-loop-profile/test | 不直接注入建议冒充 decision、不访问凭据 |

## 验收边界

纯逻辑、模拟适配器、真实宿主＋离线模型分别报告。未运行的真实模型决策质量、供应商协议、Electron 面板、账户级消耗、异常断电明确未验证。原生请求可见不等于语义采纳；fixture 只能证明被测条件的行为闭环。旧工作区已有空白差异不冒充本轮引入问题。

## 执行账本

- 2026-10-17：251 文件 before 快照完成，日常配置四文件 SHA 已记录。固定目标 next=0.2.1-rc.2；发布标签同版。
- 分派：纯契约模块、新版宿主适配、独立离线验收；root 负责策略集成和交付。
- Ruling：基于用户“保留现有改动、继续实现”的授权，使用现 checkout + 专用逐字节快照，无新 worktree/提交，避免从旧 HEAD 丢失既有工作。
- Ruling：独立实现参考协议思想，暂不导入外部可执行包，避免新增默认 LLM 调用、shell 工具及第二配置源。
- 实现完成：原文契约、同一 decision 的规划/诊断/验收、辅助模式及公开状态、共享证据审计、新旧宿主适配与中文配置说明；默认开关关闭，原模式和普通模型池保留。
- 原生冷恢复测试暴露新版子代理重建遗漏工具限制，已改为对每次精确 child 创建重施原快照，并补原生 SDK 断言。
- 独立代码审查确认并修复：同轮重复目标在校验前替代建议；辅助停止后已准入未请求建议的守卫寿命；较长指令截掉停止条件；全无效诊断未计入协调失败退出。各项保留红到绿证据；复审无待修 P1/P2。
- 最终交付前重新构建、双 SDK 全套回归及精确最终 TGZ 的独立新版 CLI 验收；最终数量、哈希与实际结果以外部交付报告为准，不把先前派生 driver 包通过移植为最终包成绩。
