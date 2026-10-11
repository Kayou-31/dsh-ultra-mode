# 可复现业务测试

这四个案例用来检查 Ultra 在真实任务类型中的收益：是否减少关键遗漏、能否排除误导证据、是否适应需求变更，以及是否避免无故修改正确实现。它们是独立的离线项目，使用 Node.js 24 标准库，不需要 DSH、API Key 或第三方依赖。

**案例自检通过，只证明初始缺陷和验收器有效，不证明 Ultra 比普通 Max 更好。** 仓库尚未完成这些案例的真实模型 A/B 对照。不要把参考实现的满分写成模型的成绩。

## 案例选择

| 案例 ID | 场景与目标 | 可观察的收益 |
| --- | --- | --- |
| `payment-consistency` | 修复支付幂等、多租户缓存及提交顺序之间的缺陷；保持正常支付、退款与重试语义 | 多路审查是否发现分布在不同逻辑层的遗漏；修复是否引入回归 |
| `incident-triage` | 在事故日志、最近变更等证据中定位真正根因，并修复限流/重试行为 | 是否能排除看似相关的错误线索，并以可复现证据支持结论 |
| `refund-policy` | 将退款策略从初始要求改为新规则，检查时限、已消耗额度、企业合同及金额边界 | 新需求是否进入最终代码与行为；运行中协调是否真实改变路线方向 |
| `reconciliation` | 清洗并对账支付/退款数据，处理重复记录、前导零 ID、时区及同客户多订单 | 并行核对是否减少静默数据错误；JSON 和 CSV 是否一致 |

每个目录提供 `case.json`、公开的 `challenge`、独立的 `organizer/grade.mjs` 和正确实现覆盖层 `organizer/reference`。具体 API、业务规则和交付格式以各案例的 `challenge/SPEC.md` 为准。不要只按当前数据硬编码输出。

## 快速开始

在仓库根目录打开 PowerShell。只运行案例工具无需 `npm install`：

```powershell
node scripts/benchmarks.mjs list
node scripts/benchmarks.mjs selftest

# 父目录需要已经存在；每次导出使用一个全新的目录。
New-Item -ItemType Directory -Path D:\UltraRuns -Force
node scripts/benchmarks.mjs export --case payment-consistency --out D:\UltraRuns\payment-max
node scripts/benchmarks.mjs export --case payment-consistency --out D:\UltraRuns\payment-ultra3
```

将 DSH 的实际工作目录分别设为导出的目录，用相同模型、权限、提示词和任务材料运行普通 Max 与 Ultra。阅读 `TASK.md`，将其中任务交给模型；退款案例先发送公开的 `TASK-initial.md`，再由操作者发送保留在 `organizer/TASK-update.md` 的后续指令，避免提前泄漏变更。初始目录含有待修缺陷，其评分失败是预期行为。

任务完成后，在仓库侧评分，不让参测模型接触验收器：

```powershell
node scripts/benchmarks.mjs grade --case payment-consistency --workspace D:\UltraRuns\payment-max --mode max --model YOUR_MODEL --report D:\UltraRuns\payment-max-result.json
node scripts/benchmarks.mjs grade --case payment-consistency --workspace D:\UltraRuns\payment-ultra3 --mode ultra-3 --model YOUR_MODEL --report D:\UltraRuns\payment-ultra3-result.json
node scripts/benchmarks.mjs compare --left D:\UltraRuns\payment-max-result.json --right D:\UltraRuns\payment-ultra3-result.json --report D:\UltraRuns\payment-comparison.json
```

退出码：评分全部通过为 **0**，业务检查不通过为 **2**；无效参数、验收器进程异常或超时为 **1**。报告文件使用独占创建，已有文件不会被覆盖。命令输出的 JSON 含每条检查结果、关键失败和夹具指纹。

## 对照方法

1. 固定案例版本、模型、思考设置、权限、初始文件、任务文本与成功标准。一次运行使用一个新导出目录和新会话。普通 Max 也保留原生子代理能力，避免人为削弱基线。
2. 先试普通 Max，再试所需的「Agent + 决策」或 2–5 路；多次运行轮换顺序。对普通短任务也运行正确实现负对照，检查 Ultra 是否过度修改。
3. 先比较关键业务失败和总检查数，再比较总耗时、总 Token 和不必要改动。单个配对结果只能描述这一次运行，不能推出普遍提升或统计显著性。
4. 保存任务文本、案例指纹、模型设置、最终补丁和评分报告。模式/模型标签由操作者填写，评分工具不验证 DSH 是否真的开启了对应模式。

`compare` 要求两侧都保留有效的导出元数据，并使用同一案例、同一夹具指纹、同一输入变体和相同检查集合；缺失来源或未知变体会拒绝比较。已提供的模型标签若不一致也会拒绝。它不会连接模型，也不会自行测量耗时或 Token。

### 正确实现负对照

```powershell
node scripts/benchmarks.mjs export --case payment-consistency --variant clean --out D:\UltraRuns\payment-clean
```

这个变体导出正确实现，但仍不包含评分器和 organizer 目录。可将普通审查任务交给模型，观察是否把正确行为误判为缺陷、是否提出无必要重构。评分只能检查功能回归；“不必要改动”需要结合实际 diff 人工判断。`clean` 与 `faulty` 不应混在同一 A/B 配对中。

### 运行中需求更新

退款案例分为两段任务。在两种模式中，按同一触发点发送更新，例如观察到首次读取 `src/refund.mjs` 后发送 `TASK-update.md` 中的内容，并记录时间。**如果宿主因此中止旧 turn 并开启新 turn，只能证明新需求被下一轮接受。** 要证明同一运行内的决策改向，还需要运行时证据：建议生成、被具体路线准入、下一请求可见、在最终交付前改变执行动作。最终答案引用新规则并不能替代这些证据。

### Token 与耗时

可另外创建 metrics JSON，再给 `grade` 传入 `--metrics 文件路径`：

```json
{
  "complete": false,
  "durationMs": 0,
  "inputTokens": null,
  "outputTokens": null,
  "cachedInputTokens": null
}
```

这只是格式示例，`durationMs` 应替换为实测值，未知字段保留 `null` 或省略。Token 必须包含主会话、所有 worker、decision、普通子代理与规划修复请求。缺失子路线用量时 `complete` 保持 `false`，不能把未知用量当成 0。只有两侧都明确 `complete: true` 且输入/输出 Token 与总耗时均为有效数值，比较报告才标为指标完整；即使如此，它也没有独立审计这些数值。

## 隔离与执行边界

导出器仅复制 `challenge`，正确变体额外覆盖参考实现。它排除 organizer/评分器/参考目录，拒绝覆盖现有目标、写入源码等受保护目录及复制符号链接。`.ultra-benchmark.json` 记录不含个人路径的原始夹具指纹。

**导出不构成安全沙箱或严格盲测。** 仓库中的答案是公开的，模型若能访问仓库外的目录或联网，仍可能获取答案。严格盲测需要真正限制模型的文件和网络权限，并在独立环境中运行；提示词只能作为额外约束。

评分会在本机执行候选 JavaScript。父评分进程默认 45 秒超时，并限制输出大小；这不是恶意代码防护，不能保证清理候选自行启动的后台进程。只评分自己信任的输出，测试不可信代码时使用隔离环境。工具不会发送模型请求、绕过 DSH 审批或控制 DSH 界面。

`selftest` 检查四个缺陷基线不能全部通过、四个参考实现全部通过。导出及框架检查的工作文件保留在被 Git 忽略的 `.benchmark-runs/`，不进入文档测试补充 ZIP。它们不是正式发布资产。

插件自动测试、真实宿主与真实模型的不同证据见 [测试与验证](../docs/testing.md)。
