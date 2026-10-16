# 更新记录

发布文件以 [GitHub Releases](https://github.com/Kayou-31/dsh-ultra-mode/releases) 为准。此页概述行为变化；按版本记录的测试、失败和验收边界保留在 `docs/verification-*.md`，不以新通过覆盖旧失败。

## 0.5.0-rc.3 — 2026-10-15／16（本地候选，未发布Release）

- 同一Ultra插件整合协作研究、decision协调、辅助、持久证据、按需检索、版本状态、派生主题MD、路线入口和可选原生正文替换；保留关闭／辅助／2～5路手动选择，不依赖另装记忆插件，不默认增加摘要／embedding调用。
- worker通过ultra_submit_report提交证据ID、未确定项与冲突，宿主校验后原生concludeTurn收尾；四阶段cap默认0继承并保留Max，规划实际tools=[]且执行器拒绝工具。有限预算仍可能耗尽。
- quote校验连续原文、canonical sourceId、实际resourceId与范围；修复公共origin metadata未参与后部分块关键词匹配、多词摘录退回块首的问题。完整ACL先于匹配，预算和旧索引兼容不变，4项回归红→绿。
- 当前主套件300项：299通过、0失败、1环境跳过，显式启用真实rc.2 SDK；另19项模型驱动纯测试和66项合成业务断言。最后模型实测构建Max双路严格12/12，28次请求、两报告及一次协调；较早同构建502／TRANSPORT失败保留。
- 本轮真实总账20个结束尝试、285次原生LLM准入，已知66,162,179 tokens、12次usage未知。约23MB／26轮原9/12保留，检索修复后同根额外1轮12/12，累计27轮及23次prune，取消、冷恢复和返工分别记录。
- 30K是软目标，大请求确有明显超额；约32%仅为同次装配输入估算下降中位数，不是账单节省。不完整原版A/B保留网络与格式失败，不能证明最终构建优势。Electron UI和完整桌面权限组合未验收。
- 本机宿主安装commit与公开tag、模型实测包与文档更新包分别核对；未安装日常环境。配置、迁移、回滚及历史失败见[当前验收](docs/evidence-verification.md)与[公开档案](verification/0.5.0-rc.3/README.md)，仓库提交不等于Release。

## 0.5.0-rc.2 — 2026-10-15（本地候选，未发布）

- 将持久证据、只读按需检索、项目状态、路线入口包和可选原生历史替换接入同一个 Ultra 插件，保留关闭／辅助／2～5 路手动选择。
- 根据独立 rc.2 profile 验收补齐：子会话遗漏事件的增量审计、失败重试与冷恢复；压缩期间的动态宿主所有权检查与取消信号；提交后持久化失败时的原文上下文补偿与诚实状态。
- 验证层级、脚本响应与真实模型的区别、迁移及回滚见 [证据验收记录](docs/evidence-verification.md)。该历史候选未发布、未安装到日常环境。

## 0.4.0-rc.3 — 2026-10-12（已发布预发布版）

[预发布 Release](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.4.0-rc.3) · [安装包 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.3/dsh-ultra-mode-0.4.0-rc.3.tgz) · [SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.3/SHA256SUMS-0.4.0-rc.3.txt)。

- 针对用户真实截图中双按钮挤占输入框工具栏、使原生模型名称被收起的问题，改为有文字的紧凑双控件：中文「协作」／英文「Team」44 像素、间隔 4 像素、Ultra 84 像素，常规总宽 132 CSS 像素；容器宽度不超过 440 像素时总宽 96 像素。按钮使用 13 像素字体，保留独立选择、完整 aria/title 提示及菜单。
- 最终文字版本机安装后，协作与 Ultra 辅助同时开启时保留完整原生模型名称，六项 Ultra 菜单与原生模型菜单正常；构建、类型检查通过，180 项测试中 179 通过、1 跳过，共享工具栏 fixture 86 项检查通过。范围见 [rc.3 验证记录](docs/verification-0.4.0-rc.3.md)，rc.2 的真实模型历史继续归属 rc.2。

## 0.4.0-rc.2 — 2026-10-11（已发布预发布版）

[预发布 Release](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.4.0-rc.2) · [安装包 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.2/dsh-ultra-mode-0.4.0-rc.2.tgz) · [SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.2/SHA256SUMS-0.4.0-rc.2.txt)。保持已测 rc.2 版本及包内容，旧 v0.3.2 稳定版继续保留。

- 保留 rc.1 的真实失败：普通 Agent 单开协作时，首个模型请求缺少六个协作工具；任务退回原生派发，210／56 运算结果正确仍不构成新增协作验收通过。
- 修复请求组装时机：在主 Agent 的 `turn/start` 预挂载本次协作工具，而不是等首轮 `agent/pre-step` 后才注册。连续任务先等待上一协作组排空，必要时通过公开 system prompt 组装接口重新生成完整请求材料，保留宿主工具顺序与呈现设置。
- 本机重装候选包后，真实普通 High Agent 的首请求含六工具，两个深度 1 子代理及 cursor 等待得到 363；消息排队不唤醒、同 ID 续作得到 46。保留初测等待参数越界和恢复，补充明确的等待参数说明，最终新会话复核工具错误为 0。范围及限制见 [rc.2 验证记录](docs/verification-0.4.0-rc.2.md)。

## 0.4.0-rc.1 — 2026-10-11（候选版）

- 分成独立的协作增强与 Ultra 算力两层：`/team on|off` 按会话切换协作，`/ultra` 保留辅助及 2–5 路选择；两者互不覆盖，设置更改用于后续任务。
- 协作提供六个 `ultra_*` 工具：真实 continuable 后台派发、非唤醒消息收件箱、显式续作、带 cursor 的事件等待、状态列表和中断。保留原生工具，使用明确的插件派发策略，继承主 Agent 模型及宿主权限、深度和容量边界。
- 有界 Agent 登记与消息队列；任务结束、取消和卸载排空所属子代理，并清理本次尚未准入的 relay，保留人类输入、其他运行消息和已准入记录。
- 路由释放前排空原生 continuable 后代；清理失败保留原始原因，存活研究后代继续受到工具守卫限制。
- 修复辅助格式 repair 恢复后错误显示、超时/取消/停止终态混淆，以及失败降级报告的路线编号错位。
- 补齐测试用 SDK 依赖并增加 Windows/Linux CI；新增协作协议、原生接线、双开关和生命周期回归。本次新增功能的验收范围见 [候选版验证](docs/verification-0.4.0-rc.1.md)，不沿用旧正式版的真实模型成绩。

## 仓库文档与测试补充 — 2026-10-11

- 重组中文首页，补充安装、架构、排障和贡献说明，明确主仓库与 Release 资产的区别。
- 新增 9 项案例工具检查和支付一致性、故障定位、退款规则更新、数据对账 4 个独立业务案例，共 66 项业务检查。包含缺陷基线、正确实现、独立验收器与单缺陷回退证据。
- 提供导出、评分、配对比较与自检命令；案例导出不包含 organizer 目录，已有目录和报告不会被覆盖。模型标签与用量由操作者提供，工具不会调用模型。
- 此次补充用于主分支和独立文档测试附件，不移动 `v0.3.2` 标签，也不替换已经真实验收的安装包或原始源码 ZIP。最新命令和结果见 [测试指南](docs/testing.md)，样例与质量验证边界见 [benchmarks](benchmarks/README.md)。尚未完成这些案例的真实模型 A/B，不能据此声称 Ultra 业务质量更优。

## 0.3.2 — 2026-10-11

[正式 Release](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.3.2) · [发布 CI](https://github.com/Kayou-31/dsh-ultra-mode/actions/runs/38151173809)

- 新增普通主 Agent + 只读 Max 决策辅助；主 Agent 保留会话设置、工具、写入、子代理与最终交付。
- 新增 2 路独立 Max worker，保留 3／4／5 路及默认 3；`/ultra assist` 与 `/ultra 1` 选择辅助。
- 按钮与菜单采用实色背景，独立于宿主滑轨与思考强度选择器。
- 修复审批桥身份与优先级；辅助有界协议 repair、有限 run 预算和本运行待消费反馈的异步清理。
- 规划严格校验单对象 assignments；同上下文最多一次修复，必要时按稳定路线索引降级保留用户每路动作，错误如实交付。
- 最终两路真实验收核对各一个普通 Max child、14／30、正常审批、唯一写入与实际读回。辅助真实证据核对同原 turn 准入及具体采纳行为；任务格式偏差保留。
- 发布 CI 构建与类型检查成功，97 测试通过、0 失败、5 实际 SDK 检查缺环境跳过。实际 SDK 脚本证据和 Windows 历史退出失败单独记录，不计跳过为通过。

完整证据见 [0.3.2 验证](docs/verification-0.3.2.md)、[最终真实摘要](docs/real-model-0.3.2-final-summary.json)、[历史候选失败](docs/real-model-0.3.2-candidate-summary.json) 与 [修复阶段复验](docs/real-model-0.3.2-recheck-summary.json)。

## 0.3.1 — 未发布历史

仅补充协调提示词的 assessment 与完整 JSON 长度上限，没有独立 Release。真实长任务证据来自 0.3.0 阶段，不能换名为 0.3.1 真实运行。见 [历史验证](docs/verification-0.3.1.md)。

## 0.3.0 — 预发布

完善运行中跨路决策、进展触发、原 turn 改向与实色界面。真实五路及长任务留下子代理、方向准入、具体采纳和任务范围偏差的分层记录，见 [验证](docs/verification-0.3.0.md) 与 [真实摘要](docs/real-model-0.3.0-summary.json)。

## 0.2.0 — 预发布

针对 DSH 0.2.0-rc.2 重写独立路线运行时，支持 3／4／5 路、普通原生子代理、审批与最终统一实施。见 [验证](docs/verification-0.2.0.md) 与 [真实模型记录](docs/real-model-0.2.0.md)。
# 0.5.0-rc.1（本地开发候选，未发布）

- 统一 Ultra 证据来源／分块／校验、宿主预保留捕获与原文独立检索，项目／根会话执行器权限隔离。
- 来源保留的语义分类、替代／冲突、状态版本及派生主题 MD；路线报告携带原文引用。
- 新路线入口装配，保留精确用户要求；可选 rc.2 原生无模型工具结果 pruning、durability checkpoint 与冷重放验证。
- 实际请求观察、provider usage／未知／估算区分、在途预算、连续协调失败退出和菜单可见性。
- 保留旧模式、权限及默认付费调用策略；修复失败路线后 fallback 报告编号。
- 中文配置、迁移／回滚与分层验证说明。真实模型 A/B、完整 Loader／桌面 UI 验收未运行。
