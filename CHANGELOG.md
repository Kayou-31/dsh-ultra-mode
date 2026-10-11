# 更新记录

发布文件以 [GitHub Releases](https://github.com/Kayou-31/dsh-ultra-mode/releases) 为准。此页概述行为变化；按版本记录的测试、失败和验收边界保留在 `docs/verification-*.md`，不以新通过覆盖旧失败。

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
