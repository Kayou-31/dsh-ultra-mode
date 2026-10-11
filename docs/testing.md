# 测试与验证

本项目把自动回归、实际 SDK 离线运行、界面检查、真实模型运行和业务质量对照分开记录。某一层通过不能代替另一层。

## 运行检查

使用 Node.js 24。在源码根目录运行：

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run typecheck
npm test
npm run test:benchmarks
```

GitHub Actions 的 [verify 工作流](../.github/workflows/verify.yml) 在 Linux / Node 24 上执行这些命令。`test:benchmarks` 只运行离线案例，不请求付费模型。只使用业务案例工具时无需安装 SDK，参见 [案例使用说明](../benchmarks/README.md)。

## 证据层次

| 层次 | 覆盖范围 | 重要边界 |
| --- | --- | --- |
| 构建与严格类型检查 | Host/client 编译与 SDK 接口匹配 | 不证明宿主已加载插件或模型成功调用 |
| 单元与回归测试 | 会话状态、规划、并发、反馈、取消/清理、权限、辅助决策及新的案例导出/比较工具 | 模拟路径不能代替真实 provider |
| 业务夹具自检 | 支付、事故定位、退款变更、对账；缺陷基线失败，参考实现通过 | 未完成 Ultra vs Max 的真实模型 A/B |
| 实际编译 SDK 离线场景 | 规划修复、原生普通 child、同 turn 改向准入、下一请求可见与最终清理 | 没有真实模型请求或 DSH UI |
| 独立菜单检查 | React/Chrome 中的按钮、菜单、实色样式与状态交互 | 不等同于 DSH 宿主 UI 自动验收 |
| 历史真实模型验收 | 用户手动运行；从运行时账本和输出核对 worker/decision/普通 child/审批 | 覆盖已记录短任务；不推出长期稳定性、普遍质量提升或 Jev 真实账户兼容 |

已发布 0.3.2 的 [原始 CI](https://github.com/Kayou-31/dsh-ultra-mode/actions/runs/38151173809) 为 **97 项通过、0 失败、5 项跳过**；跳过项涉及公开 SDK 无法加载的 runtime 检查，不计为通过。此次补充新增案例工具与夹具自检，最新结果以对应主分支提交的 Actions 日志为准。

本机曾使用实际宿主 SDK 执行目标回归和专门离线场景，但完整 runtime 测试在 Windows 普通 JIT/jitless 下出现过进程退出失败。没有据此宣称 Windows 完整 `npm test` 通过，也没有将这些失败改记为成功。`npm test` 的 SKIP 需要查看具体原因。

此次扩充的本机检查记录在 [repository-expansion-0.3.2.json](repository-expansion-0.3.2.json)：构建、类型检查和原有目标回归 **97/97** 通过；新工具检查 **8 通过、1 因 Windows 无目录符号链接权限跳过、0 失败**，进程退出 0。四个参考实现共 **66/66** 业务检查通过，四个缺陷基线均有关键失败。Linux CI 也执行符号链接检查，具体结果以对应 Actions 日志为准。

新测试最初使用 Windows junction 创建目录链接，断言完成后测试进程没有退出；这两次整套尝试及一次最小复现均没有记为成功，相关自有测试进程已终止。当前改为普通目录符号链接，并明确处理权限不足的 SKIP；没有绕过 Windows 权限，也没有以 SKIP 声称 Windows 链接创建已通过。

## 历史验收材料

| 文件 | 含义 |
| --- | --- |
| [sdk-verification-0.3.2.json](sdk-verification-0.3.2.json) | 公开 SDK 构建、类型和测试摘要 |
| [real-model-0.3.2-candidate-summary.json](real-model-0.3.2-candidate-summary.json) | 首候选包失败，包括两路审批与辅助格式问题 |
| [real-model-0.3.2-recheck-summary.json](real-model-0.3.2-recheck-summary.json) | 审批/辅助修复后的真实复验，保留两路缺 child 等遗留 |
| [real-model-0.3.2-final-summary.json](real-model-0.3.2-final-summary.json) | 最终两路真实验收与证据边界 |

这些材料是历史快照，不能用其中的“准备发布”字样推断当前 Release 状态。正式 0.3.2 已发布；本次仓库文档/测试扩充不替换正式 TGZ、不移动原标签。

最终两路真实验收记录了两个独立 depth 0 Max worker，各自一个 depth 1 Max 普通 child，结果为 14/30；同一 decision 完成 plan、coordination 和 final。短任务的三轮协调没有新 directions，因此不能用它证明新增改向被采纳。辅助模式的既有行为采纳证据单独记录。真实最终任务首轮规划成功，规划 repair 和双失败降级仍属于离线证据。

## 推荐的真实使用验收

1. 在目标 DSH 版本安装并启用正式 TGZ，完整重启后用新会话检查按钮及 RPC 状态。
2. 分别执行需要原生普通 child 的任务，并从运行时证据核对每条 worker 与各自 child 的创建、完成和结果。前台 `subagent` 返回值可能没有 ID；可从账本核对，禁止推测 ID。
3. 对改向任务记录生成、准入与行为变化；只出现建议文本或最终汇总不足以判定实时调整成功。
4. 对业务收益采用冻结案例、相同条件、多次对照，保存失败项、最终 diff、总时长与完整用量；不能只比较文字长度或算术是否正确。

Jev 真实账户、反复长任务与未来 DSH 版本仍未验证。复验时使用正常宿主权限和审批流程；自动界面工具拒绝访问时，不应绕过限制。
