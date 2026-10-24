# 测试与验证

本项目把自动回归、实际 SDK 离线运行、界面检查、真实模型运行和业务质量对照分开记录。某一层通过不能代替另一层。

## 运行检查

建议使用 Node.js 22；0.7.0 在 22.23.3 上验证，锁文件固定官方 DSH 0.2.1-rc.3 SDK。在源码根目录运行：

```powershell
npm ci --ignore-scripts
npm run build
npm run typecheck
$env:DSH_ULTRA_TEST_SDK = (Resolve-Path node_modules).Path
npm test
npm run test:benchmarks
```

GitHub Actions 的 [verify 工作流](../.github/workflows/verify.yml) 配置为 Ubuntu／Windows、Node 22.23.3，并为原生 SDK 测试指定 `DSH_ULTRA_TEST_SDK`。是否通过以对应提交的 Actions 结果为准。`test:benchmarks` 只运行离线案例，不请求付费模型。只使用业务案例工具时无需安装 SDK，参见 [案例使用说明](../benchmarks/README.md)。

0.7.0 本机完整回归为 745 项：743 通过、0 失败、2 项因 Windows 符号链接权限跳过；版本门控的原生用例已执行。构建、类型检查与 66 项参考业务检查通过。详见[本版发布报告](releases/0.7.0.md)。下文 0.3.2、0.6.0 的数字、JIT 排查与真实实验均为历史记录，不能计入当前版本。

最终 TGZ 可在全新目录验证原生 Loader、唯一工具注册和组合卸载（`--sdk` 指向该版本完整 `node_modules`）：

```text
node scripts/verify-release-packages.mjs --sdk <native-node_modules> --packages <three-tgz-directory> --work <fresh-directory>
```

此脚本的 agents 为惰性夹具，不运行 CLI、桌面或真实模型。它只从指定 SDK 加载服务和解包后的入口；整套 `npm test` 中还有直接导入项目依赖的测试，因此不能仅切换环境变量就将整套结果称为另一个 SDK 版本的全量回归。

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

## 普通协作模型池检查点

先 `npm run build`、`npm run typecheck`。将 `DSH_ULTRA_TEST_SDK` 设为完整0.2.0-rc.2 runtime的 `node_modules` 后运行 `npm test`，新 `model-pool-sdk.test.mjs` 才会执行真实SDK子代理＋工具调用＋JSONL检查；未设置时明确SKIP，不视为通过。这里的适配器是本地脚本，不是在线模型。

打包后用独立空目录运行原生CLI验收：

```text
node scripts/host-acceptance/run-profile.mjs --runtime <extracted-rc.2-root> --candidate <candidate.tgz> --work <isolated-root> --mode model-pool
node scripts/host-acceptance/run-profile.mjs --runtime <extracted-rc.2-root> --candidate <same-candidate.tgz> --work <same-isolated-root> --mode model-pool-resume
```

首轮通过实际Settings/ConfigEditor保存两个provider候选、固定→自动及volatile热更新；第二个CLI进程从已落盘配置恢复。必须使用同一最终TGZ并核对outcome哈希。另以原 `core`、`resume`、`disabled` 检查旧功能回归。运行器隔离profile和OS目录并禁止网络，结果不能冒充ElectronUI或真实模型验收。详见[模型池说明](model-pool.md)。

## 0.6.0-dev.2 决策治理检查点

目标宿主是精确的 `0.2.0-rc.2 || 0.2.1-rc.2`。新宿主原生接线与旧宿主回归分别记录，不将某一个版本通过写成所有版本通过。`decisionGovernance` 默认 false，启用方法见[治理说明](decision-governance.md)。

离线验证至少核对以下边界：完整原文与整体 `task-result` 不被部分意图取代；用户引文逐字一致；机器建议无法授权；诊断只引用本任务活动路线与真实来源；TTL、替代、跨轮去重及取消；实际原生入队、准入、请求可见分开记录；缺验收项或缺工具证据保持未验证；普通模型池及旧模式继续回归。

原生离线运行器 `scripts/host-acceptance/run-decision-loop-profile.mjs` 使用独立、全新空目录，校验最终候选 TGZ 的精确 SHA256，隔离 profile 和 home，禁止网络；每次运行创建新目录，不复用日常配置。`probe` 与 `core` 用于原生工具／会话接线及完整治理闭环，原生 JSONL 和实际请求证据与插件汇总分开核对。最终包有变更时需以相同最终 TGZ 重跑，早先包的结果不能自动转移。

`model-pool-live-driver.mjs` 当前只有离线配置、随机挑战、提示生成和证据判定纯函数，不注册 provider 适配器、不读取凭据、不启动真实模型调用。其单元测试通过仅证明这些判定逻辑，不代表恢复在线模型测试。

精确通过数、跳过、失败、包哈希与版本以本轮交付报告和原始结果为准。脚本响应验证原生 SDK／CLI 行为，不证明真实模型智能、业务质量、节省费用或完整 Electron 界面；生产治理路径不会把任意后续工具活动自动记为独立效果验证。历史真实模型与发布成绩继续归原版本。

## 0.6.0-dev.3 显式授权全局知识检查点

功能与配置见[知识库说明](global-knowledge.md)及[独立 profile 示例](global-knowledge.example.yml)。`globalKnowledge` 默认关闭，目标宿主仍是精确的 `0.2.0-rc.2 || 0.2.1-rc.2`。两个版本的全套回归、原生 CLI 和包哈希分别记账，不能把开发中单项通过或某一宿主通过写成最终全层通过。

全局知识必须取得宿主原生 `profileContext.dir`。本轮知识原生 CLI 闭环使用 `0.2.1-rc.2`；旧 `0.2.0-rc.2` 记录原模式与 SDK 回归，不把其缺少原生 profile 服务的运行当成知识闭环通过。缺少该服务时应失败关闭，不从环境变量猜测 profile，也不额外安装旧宿主服务来替代实际环境。

构建、类型检查后，可先运行知识功能及原生接线的目标回归：

```text
node --test test/knowledge-store.test.mjs test/knowledge-host.test.mjs test/knowledge-integration.test.mjs test/knowledge-driver.test.mjs
```

最终仍需执行本页开头的完整回归及 benchmark 自检。重点核对持久化／重启、校验和／部分写入失败、并发幂等与精确替代、锁冲突、过期／撤销、完整来源 SHA256 与逐字 quote、当前来源变更、真实 Agent／会话绑定、worker／辅助／普通子代理禁写，以及读取的完整 JSON 字符预算。ACL 必须先于标题、摘录、命中数量和 get；新增读者不能追溯授权，同一发布者或读者 ID 更换真实目录不能继承旧记录。

原生离线运行器使用最终冻结的精确 TGZ，在全新空目录中创建隔离 profile、home 和项目，不读取日常凭据、不调用在线模型：

```text
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --candidate <final-candidate.tgz> --candidate-sha256 <exact-final-sha256> --work <NEW-empty-isolated-root> --node <node24-executable>
```

运行器禁止网络并把同时 stream 上限设为 2，依次执行 `core`、`foreign`、`resume`：从 A 的真实原生工具结果建立来源、授权主 Agent 发布、B 通过原生 search/get 取得精确发布并核验片段；另一个 profile 不可见；新 CLI 进程恢复后检查旧记录及撤销。身份、权限、目录重绑定、来源伪造和来源变更等细项还应结合目标回归与 driver 明确断言，不能仅凭一段汇总声称全覆盖。

保留 `outcome.json`、`phases.json`、各阶段 `*-launch.json`、`*-result.json`、`*-session-inventory.json`、stdout／stderr、原生 session JSONL 及 stream／网络守卫记录。运行器检查实际匹配的原生 tool/call→tool/result 与后续请求，不能用直接注入的插件结果冒充工具经过宿主或模型理解。精确最终 TGZ 有任何变化都需重跑对应原生验收；此前包的通过不能自动转移。

版本来源、精确通过数、跳过／失败、最终哈希与尚未完成的层次以本轮交付报告和上述原始结果为准。本节说明验收方法，不预先宣告最终全套或原生验收完成。Windows 无文件符号链接创建权限时的 SKIP 不等于该环境已完成该项；完整 Windows DACL 隔离、Electron UI、真实模型质量和 OS 断电尚未验证。dev.2 及历史 rc.3 的原有证据与限制保持原归属。

## 独立附属包与组合检查点

本轮包为根 `@dsh-external/dsh-ultra-mode` `0.6.0-dev.3`、`packages/dsh-ultra-memory/` 的 Memory `0.1.0-dev.1`、`packages/dsh-ultra-decision/` 的 Decision `0.1.0-dev.1`。安装组合与配置权威见[附属插件说明](companion-plugins.md)。根 `src/` 是共同核心权威，附属 TGZ 的 `SOURCE-MANIFEST.json`、`core-src/` 和可独立加载的 `lib/` 应与冻结源码及最终包对应；源码层通过不能代替实际打包后的加载。

本页开头的构建／类型／全套回归与 benchmark 仍需执行，再分别核对：

| 场景 | 必须保留的断言 |
| --- | --- |
| 完整 Ultra 独立 | 关闭／辅助／手动 2～5 路、Team、模型池、治理、证据／上下文／知识仍完整可用；旧行为没有因拆包被削减 |
| Memory 独立 | 普通主 Agent 的项目捕获与原文检索、显式压缩入口、知识 A→B 与跨 profile 隔离；不创建模型或协调路线 |
| Decision 独立 | 默认不启动额外 decision；Team 六工具、模型池候选与实际原生工具结果、显式只读辅助、意图／诊断／验收；工具／命令／RPC 均不能开启 Max 多路线 |
| Memory＋Decision，两种加载顺序 | 同一根 context 只有一个证据服务；捕获、请求观察、检索工具和压缩接线不重复；Memory 配置权威生效且授权不并集 |
| Ultra＋Memory | 完整协调保留，Memory 管理证据配置；旧发布读者快照不会随权威变化扩大 |
| Ultra＋Decision 重复启用 | 同一 scope 明确拒绝重复协调入口，不隐藏启动第二条旁路；仅关闭任务模式不代替停用重复插件 |
| lease 及卸载 | 释放一个 lease 后其余插件仍能工作；权威切换取消并排空旧知识操作，随后重查授权；最后 lease 才关闭服务 |

知识运行器已提供 `--target memory` 和可选 Decision 组合参数。以各自精确冻结 TGZ 在全新空目录运行，不能复用前一场景的 work 根：

```text
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --target memory --candidate <final-memory.tgz> --candidate-sha256 <exact-memory-sha256> --work <NEW-memory-isolated-root> --node <node24-executable>
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --target memory --candidate <final-memory.tgz> --candidate-sha256 <exact-memory-sha256> --companion <final-decision.tgz> --companion-sha256 <exact-decision-sha256> --load-order memory-first --work <NEW-memory-first-root> --node <node24-executable>
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --target memory --candidate <final-memory.tgz> --candidate-sha256 <exact-memory-sha256> --companion <final-decision.tgz> --companion-sha256 <exact-decision-sha256> --load-order decision-first --work <NEW-decision-first-root> --node <node24-executable>
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --target ultra --candidate <final-ultra.tgz> --candidate-sha256 <exact-ultra-sha256> --companion <final-memory.tgz> --companion-sha256 <exact-memory-sha256> --load-order ultra-first --work <NEW-ultra-first-root> --node <node24-executable>
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --target ultra --candidate <final-ultra.tgz> --candidate-sha256 <exact-ultra-sha256> --companion <final-memory.tgz> --companion-sha256 <exact-memory-sha256> --load-order memory-first --work <NEW-memory-ultra-root> --node <node24-executable>
node scripts/host-acceptance/run-knowledge-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --target memory --compression-probe --candidate <final-memory.tgz> --candidate-sha256 <exact-memory-sha256> --work <NEW-compression-root> --node <node24-executable>
node scripts/host-acceptance/run-companion-decision-profile.mjs --runtime <extracted-0.2.1-rc.2-root> --candidate <final-decision.tgz> --candidate-sha256 <exact-decision-sha256> --work <NEW-decision-root> --node <node24-executable>
```

配对知识场景刻意令协调插件的本地 `evidenceEnabled: false`、Memory 为 true，验证实际采用 Memory 的证据配置、捕获及请求计数，而非只测双方配置相同。`--compression-probe` 仅用于独立 Memory：两段明确标识的历史协议夹具，经实际 AgentLoop 的自然后续步骤进入生产压缩钩子；驱动不直接调用压缩器或 `beforeStep`。核对两次原生 surface 替换、相邻 prune、工具配对、一次性用户限制、完成回执标记、原文检索与来源 SHA，并用原生 token meter 记录请求用量估算。历史夹具、脚本响应及估算均不代表真实模型长期任务、真实账单或无损能力。

Decision 专用运行器通过真实 Settings 保存两个离线 provider／模型候选，核对实际子代理委派、只读工具、显式辅助、取消及冷启动恢复；具体通过数及仍未覆盖的治理、RPC、Electron 交互边界以最终报告为准。

运行器从精确 TGZ 安装到隔离 profile，再启动真实原生 CLI；该方法不需要推测不存在的安装子命令。上述知识组合场景不自动代表 Decision 独立辅助、卸载、全部协作模型池或完整 Ultra＋Memory 已验收，这些必须各有实际断言和日志。包内附带的脚本响应是离线模型，不使用日常凭据；本轮统一最多两个同时 stream，不运行在线模型，不安装日常环境，不 push 或发布。

最终交付报告应逐包记录版本、TGZ SHA256、共同来源清单、宿主精确版本、命令、通过／跳过／失败及原生 JSONL／实际请求证据。共享来源清单不是模型效果证明，离线请求计数也不是实际账单。任何最终 TGZ 变化都使旧包验收无法自动转移；目前本节仅列验收要求，不预先宣布最终三包或组合成功。
