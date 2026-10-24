# 安装、升级与回滚

> **0.6.1 兼容更新**：三包加入 DSH 0.2.1-rc.3；新测试结果见[本版发布报告](https://github.com/Kayou-31/dsh-ultra-mode/blob/main/docs/releases/0.6.1.md)。下文涉及真实模型、14/30 或旧 CLI 数字的内容属于 0.6.0 历史证据，不计入本次验证。

本页对应 [0.6.1 三包正式版](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.1)：完整 Ultra **0.6.1**、独立 Memory **0.1.1**、独立 Decision **0.1.1**。本次兼容验收宿主为官方 **DSH 0.2.1-rc.3**；旧 **0.2.0-rc.2** 保留原模式、模型池、取消与恢复回归，不能据此宣称旧宿主的全局知识可用。以实际 Host／SDK 版本为准，第三方桌面应用的版本号不能代替内核版本。建议先使用独立测试 profile；完整 Electron 安装及权限组合仍未验收。

## 下载哪个文件

| 文件 | 用途 |
| --- | --- |
| [Ultra 0.6.1 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-external-dsh-ultra-mode-0.6.1.tgz) | 完整模式、Team、模型池、治理、证据、上下文与知识库 |
| [Memory 0.1.1 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-external-dsh-ultra-memory-0.1.1.tgz) | 独立证据检索、可选压缩与显式授权知识库，不创建模型 |
| [Decision 0.1.1 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-external-dsh-ultra-decision-0.1.1.tgz) | 独立普通协作、多模型池和可选决策治理，无 Max 多路线入口 |
| [SHA256SUMS.txt](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/SHA256SUMS.txt) | 核对同一 Release 的三个 TGZ、源码 ZIP 与验证附件 |
| [冻结源码 ZIP](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-ultra-mode-0.6.1-source.zip) | 开发和源码检查，不作为 bundle 安装包 |
| [验证附件 ZIP](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-ultra-mode-0.6.1-verification.zip) | 白名单汇总与验证说明，不含私有 profile、凭据或原始模型会话 |
| [0.6.0-dev.3 三包](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0-dev.3)／[原哈希与边界](releases/0.6.0-dev.3.md) | 保留的上一版，可用于对应配置回滚 |
| [0.5.0-rc.3](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.5.0-rc.3)／[原 SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.5.0-rc.3/SHA256SUMS-0.5.0-rc.3.txt) | 历史预发布，不混用新包哈希 |
| [0.4.0-rc.3 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.3/dsh-ultra-mode-0.4.0-rc.3.tgz)／[SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.3/SHA256SUMS-0.4.0-rc.3.txt) | 保留的历史预发布包，可用于回滚 |

选择Release附件中的TGZ，不要把GitHub自动源码压缩包或源码ZIP当作安装包。普通安装不需要Node.js、TypeScript、另装记忆插件、复制DSH SDK或Jev密钥。GitHub Release分发不表示已发布到npm registry。

Windows 可使用 `Get-FileHash -Algorithm SHA256 <下载文件路径>` 核对同版本 SHA256SUMS。正式包使用同批外部SHA256SUMS；以[本版发布记录](releases/0.6.1.md)和 Release 附件为准。中间候选与 fixture-only 实验包有独立哈希，不能代替最终 TGZ 的校验值，也不能把文档重打包算作新的在线实测。

可单装任意一包，或组合 Memory＋Decision、Ultra＋Memory。同一 scope 的 Ultra 与 Decision 协调入口只能主动启用一个；共享证据配置按 Memory > Ultra > Decision 选择，授权不取并集。配置 ID 分别为 `ultra-mode`、`ultra-memory`、`ultra-decision`，源码路径与示例见[附属插件说明](companion-plugins.md)。以下界面与命令以完整 Ultra 为例；Memory 没有多路线入口，独立 Decision 的额外旁路由 `/decision on`／`/decision off` 控制。

## 首选：DSH 本地包安装

1. 确认实际 DSH Host 版本，下载需要的 0.6.1／0.1.1 TGZ 到本地目录，并核对同版本哈希清单。
2. 升级前结束正在运行的任务，保留旧 TGZ 及 profile 的 `package.json`、锁文件和 `cordis.patch.yml`。已有插件列表也应保留。
3. 在 DSH 插件管理页打开本地包安装入口，选择该 TGZ 或填写其完整本地路径。入口名称以宿主界面为准。
4. 安装并启用 `@dsh-external/dsh-ultra-mode` bundle。若需要手动追加 bundle，使用下方配置示例，不替换整个列表。
5. 完整退出 DSH，包括托盘／后台实例，然后重新打开。Host 和 Web 客户端需要一起加载新版本；只刷新会话界面可能仍使用旧 Host。
6. 在新会话的输入框右侧检查 **协作增强（Team）** 与 **Ultra** 两个独立按钮。Ultra 菜单应包含关闭、Agent + 决策、2／3／4／5 路，背景应为实色；协作按钮单独控制协作状态。

默认配置下，新会话协作与 Ultra 都关闭。只使用普通 Agent 协作时，开启协作并保持 Ultra 关闭；需要决策辅助或并发再单独选择 Ultra。选择后提交普通任务，无需填写决策提示词。界面与设置检查证明安装加载，真实任务另行验证模型运行。

| 命令 | 用途 |
| --- | --- |
| `/team on` | 开启后续任务的协作增强，不改变 Ultra 模式 |
| `/team off`、`/team` | 关闭后续任务的协作，或查询当前协作状态 |
| `/ultra off` | 保持普通主 Agent 执行，独立于协作开关 |
| `/ultra assist`、`/ultra 2` 至 `/ultra 5` | 另行选择决策辅助或并发模式 |

## 备选：关闭 DSH 后更新 profile

仅适用于已确认系统 Node 与宿主依赖兼容、并了解当前 DSH profile 的用户。以下路径均为示例，需按自己的安装位置调整；使用 DSH 随附 pnpm 或与宿主兼容的版本。未确认兼容时使用上面的 GUI 安装入口。

```powershell
$dshPnpm = '<DSH安装目录>\resources\runtime\pnpm\bin\pnpm.mjs'
$profileDir = '<独立测试profile绝对路径>'
$packagePath = '<下载的dsh-external-dsh-ultra-mode-0.6.1.tgz绝对路径>'

node $dshPnpm --dir $profileDir add $packagePath --ignore-scripts
```

保留 profile 原有的包管理配置，例如 `autoInstallPeers: false`、`nodeLinker: hoisted`；不要为了 peer 警告更改这些设置或随机安装 SDK。普通 GUI 安装直接使用已构建 TGZ，不需要这些命令或复制 SDK。

操作前完整退出 DSH 并备份上面列出的 profile 文件。不要在 Electron 管理的 desktop profile 上强行接管 CLI；该宿主版本会拒绝普通 `dsh --profile desktop ...` 的接管请求，不能据此移除宿主保护。

在原有 `dsh.profile.bundles` 中追加插件，保留现有项及其顺序。例如原有基础项时：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@dsh-external/dsh-ultra-mode"
]
```

证据索引默认随已授权Ultra运行建立，不为索引默认启动付费模型；contextCompression默认false。若显式开启压缩，先核对原生日志／checkpoint和token-meter能力，并停用同一上下文的其他compactor，确保唯一管理者。完整配置及权限边界见 [证据与上下文管理](evidence-context.md)。

近期窗口可通过 `contextRetainRecentMessages` 配置为 2～128，默认 8；修改不改变已有模式和默认压缩开关。已接入官方 token meter 的保守压力估算，与本地估算取较大值，输出和后续工具预留另计一次。上游用量、原生压力和本地估算不是同一计量，不能把 soft target 当作精确硬窗口。

0.6.0 历史验收中[独立工程验收](experiments/workflow-500k-30-spec.zh.md)的基线组使用以下插件设置，**不是建议覆盖日常 profile 的新默认值**：

```yaml
contextCompression: true
contextTargetTokens: 420000
contextRetainRecentMessages: 2
contextOutputReserveTokens: 8192
contextToolReserveTokens: 2048
```

420K 目标包含 8,192 输出与 2,048 后续工具预留，因此约对应 409,760 输入的估算边界；保守包络也可能更早触发。500K 总窗口由0.6.0 历史验收中运行器登记并做请求准入及 provider 用量核验，不是上述配置自动建立的精确 tokenizer 硬限制。系统／工具定义、消息、检索返回和预留均须计入；小规模校准通过不等于 30 个压缩周期通过。正式结果见[实验说明](OCG-EXPERIMENTS.md)，安装过程不需要启动该在线实验。

新增高效选项可分离触发门槛与压后软目标：`contextTriggerTokens` 省略时沿用 `contextTargetTokens`，配置时须大于或等于 target。其余默认值保持为最小结果 4,096 字符、最多 16 次替换、预览 320 字符，`contextCompactLocators` 与 `contextRetrievalReceipts` 均为 false。默认示例见[证据配置](evidence-config.example.yml)。

高效实验在独立 profile 显式使用下面设置，不能套用到日常环境：

```yaml
contextCompression: true
contextTriggerTokens: 420000
contextTargetTokens: 30000
contextRetainRecentMessages: 2
contextMinResultChars: 64
contextMaxPrunes: 256
contextPreviewChars: 0
contextCompactLocators: true
contextRetrievalReceipts: true
contextOutputReserveTokens: 8192
contextToolReserveTokens: 2048
```

该组合将短工具结果和本地 memory 检索返回替换成精简恢复定位。检索收据只保存宿主来源和校验元数据，不重复索引正文，不成为新事实、语义来源或全局发布候选；读回复用现有项目／会话权限、SHA、调用身份、分页与预算。全局知识返回不压缩。用户原话、assistant 历史、工具调用配对、附件及原始日志保持原状；受保护内容可能使压后超过 30K。实际总包络仍为完整实际输入加 8,192＋2,048，不能超过实验的 500K 上限。95 项离线测试不等于真实 30 轮验收，配置及实验差异见[压缩效率说明](experiments/compression-efficiency.zh.md)。

bundle 自带默认 patch。需要覆盖默认值时按相同 `id` 更新 profile patch，配置详见 [架构与配置](architecture.md#配置)。重新打开 DSH 后按上述清单检查。

### 完整旧阶段归档与 130K 验收配置

`contextArchiveCompletedTurns` 默认关闭。以下是 C 组的独立验收配置：保留 4,096 字符的普通正文替换门槛，不要求所有短工具结果都单独压缩；另在已完成且工具调用配对平衡的旧阶段建立 `arc_` 恢复入口。组合安装时只在活动证据权威中配置一份，并先停用宿主在同一上下文的其他 compactor。

```yaml
evidenceEnabled: true
memoryGetChars: 12000
contextCompression: true
contextTriggerTokens: 420000
contextTargetTokens: 30000
contextRetainRecentMessages: 2
contextMinResultChars: 4096
contextMaxPrunes: 16
contextPreviewChars: 0
contextCompactLocators: true
contextRetrievalReceipts: true
contextArchiveCompletedTurns: true
contextOutputReserveTokens: 8192
contextToolReserveTokens: 2048
```

500K 总窗口是该次独立运行器与模型容量设置，130K 是逐轮验收门槛，均不是新增的产品通用硬限制。系统、工具定义、近期消息、检索和 10,240 预留都须计入；受保护内容可能使其他任务无法降到目标。归档使用官方本地模板事件，不新增摘要模型调用。原文继续在宿主持久日志，清单位于项目 `.dsh-ultra/v1/archives/`；`arc_` 用于分页恢复，事实引用仍须原始 `src_`／`chunk_` 来源核验。

已有活动归档的会话必须保留当前授权的 `ultra_memory_get`、至少 1,024 字符的读取预算及证据服务；否则后续模型／业务调用会暂停。关闭归档开关只停止新建，不解除既有恢复责任。若显示 `committed/persistenceUncertain`，保留现场并先核验持久化，不能直接重新执行已提交操作。官方 Web 插件清单没有通用归档配置表单；0.6.0 历史验收中通过独立 profile 文件配置，不声称已在浏览器保存该开关。

## 依赖与版本

接口声明为 DSH `0.2.0-rc.2 || 0.2.1-rc.2 || 0.2.1-rc.3`，Cordis `~4.0.4`、Schemastery `~3.18.4`。协作增强需要宿主的 continuable 子代理服务和支持该能力的 provider，默认名为 `spawn`。Web 客户端使用同版本 UI renderer、connection、locale、session-controller，支持 React 18/19。0.1.x 和其他 alpha 不在本版兼容承诺内。

全局知识依赖原生 `profileContext.dir`；0.6.0 历史验收中跨项目闭环只验收官方 0.2.1-rc.2，旧宿主缺少元数据时明确拒绝，不从环境变量猜目录。0.6.0 历史冻结运行时代码通过新旧宿主 29 个原生离线 CLI、838 条检查。旧 0.2.0-rc.2 的 core／resume／disabled／model-pool／model-pool-resume 五个阶段有独立收据；其中两个模型池进程仅检查配置和恢复，0 次模型请求，会话／流门项为不适用。不能外推全部 GUI、provider 或知识能力。OCG 实机失败、正式压缩验收及最终包复核分别记录，见[实验说明](OCG-EXPERIMENTS.md)；最终包来源与原生验证结果以Release附件单列；归档真实实验按14/30收尾，原30轮门槛未完成。

pnpm 的 peer 警告不能当作运行通过。DSH bundle resolver 应提供对应依赖；若实际宿主缺少这些 API，先确认版本和 bundle 状态，不把随机版本 SDK 复制进 profile。

从源码开发或运行业务案例建议使用 Node.js 22；本版以 22.23.3 验证。源码构建还需要开发依赖。构建与测试见 [测试指南](testing.md)；安装已经构建好的 TGZ 不需要走开发流程。

## 升级与回滚

升级遵循同一过程：结束任务、完整退出、保留配置与旧包、安装新 TGZ、保持原 bundle 列表，再重新打开。相同版本下更换本地包也需要确认 Host 与客户端实际加载了新内容。

没有活动归档检查点的会话可用 `evidenceEnabled:false` 停用证据子系统，或用 `contextCompression:false` 停止新增压缩，再重启对应 profile。已有 `arc_` 的会话仍需证据服务和兼容读取器，不能通过关闭证据绕过恢复检查。不要在运行中删除 `.dsh-ultra`；先备份索引、归档清单、原生日志和旧配置，原始日志与原生 prune 重放的关系见 [迁移与回滚](evidence-context.md#迁移与回滚)。

使用过高效选项后降级，先关闭压缩、精简定位及检索收据，并移除旧版不认识的配置。旧读取器可打开新增 metadata，但不理解其 context receipt 分类，原文统计、MD 和语义校验不能外推为新版边界；不要将其当作新事实使用。不自动删除收据、索引或宿主日志，恢复新版可重新获得正确分类。独立旧读取器的 5 项兼容检查与限制见[效率升级／降级说明](experiments/compression-efficiency.zh.md#升级与降级)。

回滚没有活动归档的会话时，完整退出 DSH，重新安装保留的旧 TGZ，并恢复必要的旧配置。若恢复锁文件和 `package.json`，应使用原宿主的包管理方式同步依赖，不只修改版本文本。已有 `arc_` 会话不能直接交给不理解它的旧版续作：保留新版读取器、完整宿主日志、归档清单及业务文件，另开兼容会话迁移。不得通过删除清单或重放已完成操作撤销历史替换。先保留当前文件，再用已有备份恢复；不删除共享 profile 或会话数据。

只想停用整个插件时可在插件管理页禁用 bundle；只停止后续任务的增强时，分别关闭协作与 Ultra（`/team off`、`/ultra off`）。两个开关互不代替，也不是卸载或删除历史日志。插件卸载不会删除 DSH 的持久审计记录，旧内部路线可能重新出现在宿主列表。

## 安装后检查

| 检查 | 正常现象 | 仍未证明 |
| --- | --- | --- |
| 插件加载 | bundle 启用，无加载错误 | 模型和工具调用成功 |
| 按钮与菜单 | 独立的协作/Ultra 双按钮；Ultra 六个选项、实色背景、会话选择正常 | 每路真实并发与子代理 |
| 新会话与重启状态 | 默认配置下协作、Ultra 都关闭；首次开启并发默认 3 | 长任务清理、业务输出质量 |
| 模型任务 | 对应模式按预期执行与交付 | 所有任务、未来宿主和 Jev 实际账户兼容 |

出现 HTTP 405、按钮缺失、权限审批或依赖错误时见 [排障指南](troubleshooting.md)。
