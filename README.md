<div align="center">

# DSH Ultra Mode

**一起研究，带着证据继续。**

面向 DSH 的多代理协作、项目记忆与决策辅助插件<br>
让不同路线交换线索，让长任务保留进度，让结论有原文可查。

[![Ultra 0.6.1](https://img.shields.io/badge/Ultra-0.6.1-167d8d)](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.1)
[![Memory 0.1.1](https://img.shields.io/badge/Memory-0.1.1-526d82)](packages/dsh-ultra-memory/README.md)
[![Decision 0.1.1](https://img.shields.io/badge/Decision-0.1.1-7061a5)](packages/dsh-ultra-decision/README.md)
[![DSH rc.3](https://img.shields.io/badge/DSH_0.2.1-rc.2_%7C_rc.3-43853d)](package.json)
[![BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-737373)](LICENSE)

[下载三个插件包](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.1) · [完整源码](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-ultra-mode-0.6.1-source.zip) · [中文发布说明与验证](docs/releases/0.6.1.md) · [更新记录](CHANGELOG.md)

</div>

**当前版本：Ultra 0.6.1 / Memory 0.1.1 / Decision 0.1.1。** 本次适配 DSH `0.2.1-rc.3`，保留 `0.2.1-rc.2` 与旧 `0.2.0-rc.2` 的明确版本声明。三包从同一套核心源码构建，功能分工和默认开关保持原有行为。

[认识项目](#这是什么) · [选择安装包](#选择安装包) · [功能一览](#功能一览) · [快速开始](#快速开始) · [常用命令](#常用命令) · [升级与兼容](#升级与兼容) · [常见问题](#常见问题) · [开发文档](#开发文档)

## 这是什么

复杂任务常常需要几个方向一起调查，也需要在很多轮之后记得：最初要做什么，哪些事已经完成，哪些结论还只是猜测。

Ultra 把协作、项目状态和原文检索放在同一个任务里。主 Agent 可以派发子任务、接收消息、续接已有子代理；需要深入研究时，你可以手动选择 2～5 路，再由一个 decision 协调进展与实施。任务留下的证据和状态可以按来源查回，减少反复解释和凭摘要猜测。

- **你来选择协作方式**：普通 Team、只读决策辅助或手动多路线，分别控制。
- **进度有明确状态**：区分计划、执行和验证，保留约束、阻塞与下一步。
- **结论有来源可查**：搜索、分页读回并核验引文，来源不可访问时标注缺口。
- **能力按需组合**：完整 Ultra，或独立 Memory、独立 Decision。

## 选择安装包

**大多数用户只安装 Ultra 完整包即可。** 三包是三个功能选择，不要求全部启用。

| 安装包 | 适合你，如果…… | 包含的能力 |
| --- | --- | --- |
| **[Ultra 0.6.1](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-external-dsh-ultra-mode-0.6.1.tgz)** | 想在一个入口使用完整协作与研究流程 | Team、模型池、决策辅助、手动 2～5 路、项目证据、上下文管理及可选知识库 |
| **[Memory 0.1.1](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-external-dsh-ultra-memory-0.1.1.tgz)** | 主要需要长任务的证据检索与进度管理 | 项目证据、可选压缩与阶段归档、显式授权知识库；不创建模型或子代理 |
| **[Decision 0.1.1](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.1/dsh-external-dsh-ultra-decision-0.1.1.tgz)** | 想保留普通主 Agent，再增加协作与复核 | Team、模型池、可选只读 decision 辅助及证据支持；没有手动多路线入口 |

支持单包、**Memory＋Decision** 和 **Ultra＋Memory**。Ultra 与 Decision 可以同时安装，但同一 scope 只能主动启用一个协调插件。`/ultra off` 或 `/decision off` 只关闭任务模式，不能替代停用重复 bundle。

组合时证据配置优先级为 **Memory > Ultra > Decision**，共享一份服务，授权范围不会合并扩大。详见 [安装组合与回滚](docs/companion-plugins.md)。

## 功能一览

| 能力 | 当前可以做什么 |
| --- | --- |
| Team 协作 | 派发、发消息、续接、等待、中断和查询子任务；父 Agent 可继续工作 |
| 协作模型池 | 从 DSH 已配置的模型中选择候选，声明擅长与适用场景；保留权限与深度限制 |
| 决策辅助 | 普通主 Agent 负责执行，独立只读旁路提供建议 |
| 多路线研究 | 手动选择 2～5 个 Max worker，由额外一个 Max decision 规划、协调和实施 |
| 项目状态 | 保存目标、限制、进度、阻塞、决策和下一步，区分计划与验证 |
| 原文检索 | 关键词搜索、分页读回、连续引文校验；来源不完整时明确标注 |
| 可选上下文管理 | 先持久化证据与恢复入口，再替换旧工具正文；可显式开启已完成阶段归档 |
| 可选知识库 | 同一 profile 下按真实项目目录授权发布、读取与撤销，默认不跨项目共享 |
| 可选决策治理 | 在既有 decision 调用中记录意图、诊断与验收，模型判断与宿主证明分开 |

研究 worker 与辅助 decision 只读。最终实施受既有人类授权和宿主审批约束；检索内容、代理消息和模型建议不会成为新的权限来源。

## 快速开始

### 1. 下载并安装

1. 确认 DSH Host 为 `0.2.1-rc.3`、`0.2.1-rc.2` 或 `0.2.0-rc.2`。新版能力建议使用 0.2.1 系列。
2. 从 [发布页](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.1) 选择所需 TGZ，核对同页 `SHA256SUMS.txt`。源码 ZIP 用于开发。
3. 在宿主插件管理页通过本地包入口安装，启用对应 bundle。升级前结束运行任务，保留旧 TGZ 和 profile 配置。
4. 完整退出并重启 DSH，让 Host 与客户端一起加载新版本。

| 包 | bundle 名称 | 配置节点 |
| --- | --- | --- |
| Ultra | `@dsh-external/dsh-ultra-mode` | `ultra-mode` |
| Memory | `@dsh-external/dsh-ultra-memory` | `ultra-memory` |
| Decision | `@dsh-external/dsh-ultra-decision` | `ultra-decision` |

安装使用已构建的 TGZ，无需用户单独安装开发 SDK。手动配置时保留原有 bundle 列表，按 [安装指南](docs/installation.md) 追加对应项。

### 2. 从普通协作开始

在新会话中开启 Team，继续由普通主 Agent 推进任务：

```text
/team on
```

然后给出实际任务，例如：“检查这次接口改动，把实现和测试分开审查，汇总有文件依据的问题；先不要修改。”

Team 与 Ultra 分别开关。添加模型池候选不会自动创建代理，空池保留宿主原有继承行为。

### 3. 按需增加研究路线

完整 Ultra 支持手动选择：

```text
/ultra assist
/ultra 2
/ultra off
```

分别用于普通主 Agent＋辅助、两路研究＋decision，以及关闭后续任务的 Ultra 模式。路线数不含 decision；多路线和额外辅助会增加模型消耗。

压缩、已完成阶段归档、决策治理和跨项目知识库均需显式配置。开启压缩前确认原生日志、token meter 和恢复入口可用，并保证同一历史只有一个压缩管理者。

## 常用命令

| 命令 | 适用包 | 行为 |
| --- | --- | --- |
| `/team on`、`/team off`、`/team` | Ultra、Decision | 开启、关闭或查询普通协作 |
| `/ultra assist` 或 `/ultra 1` | Ultra | 普通主 Agent＋只读 Max 辅助 |
| `/ultra 2`～`/ultra 5` | Ultra | 指定数量的 Max worker＋一个 Max decision |
| `/ultra on` | Ultra | 恢复已选模式；新会话首次并发默认 3 路 |
| `/ultra off` | Ultra | 关闭后续任务的自动 Ultra |
| `/decision on`、`/decision off` | Decision | 单独控制只读辅助旁路 |

Memory 通过模型工具 `ultra_memory_search`、`ultra_memory_get` 检索。Team 的六个工具及事件等待规则见 [协作说明](docs/collaboration.md)。

## 升级与兼容

本版扩展三包 `engines.dsh` 和原生 peer 范围，以官方 rc.3 SDK 构建和验证。**没有更改证据存储格式、增加后台功能或自动迁移历史。** 精确结果见 [本版验证报告](docs/releases/0.6.1.md)。

全局知识仍要求原生 `profileContext.dir`。压缩和阶段归档要求原生持久化、恢复工具与唯一管理者；缺少能力时拒绝相应操作。旧宿主的基础兼容不等于具备所有新版能力。

升级时保留 `.dsh-ultra/v1`、宿主原始日志及 profile 知识目录。已有 `arc_` 归档检查点需要兼容读取器；降级前核对恢复条件，不能直接用不识别它的版本续作。详见 [恢复与回滚](docs/installation.md)。

## 常见问题

**需要同时装三个包吗？**

通常不用。完整 Ultra 已包含主要能力；希望分别配置记忆和普通协作时，可选 Memory＋Decision。

**Ultra Memory 和 Memory-Continuity 有什么区别？**

Ultra Memory 面向工程任务的证据、上下文与项目进度；[Memory-Continuity](https://github.com/Kayou-31/Memory-Continuity) 面向人物、经历、关系、承诺和人工成长审阅。它们是独立产品。后续可借鉴 M-C 的分层、条件注入与可追溯结构，在压缩插件内部加强主动进度查询，见[设计复用建议](docs/proposals/memory-continuity-context.md)。这不是合并插件，也不要求安装 M-C。本次尚未实现该设计，也没有验证两个插件最新版共同管理同一会话的兼容性。

**会默认调用更多模型吗？**

新会话的 Team、Ultra 和 Decision 额外旁路默认关闭。Memory 自身不创建模型；索引与确定性压缩没有默认摘要模型调用。显式启用协作、辅助或多路线后，会使用宿主配置的模型并产生正常用量。

**压缩后能保证完全不丢信息吗？**

不能保证模型效果无损。插件保留可访问原文与恢复入口，记录来源和覆盖缺口；模型如何使用它们是另一层问题。历史“约 65K”和“14/30”只属于特定实验，完整结果与失败保存在 [0.6.0 发布记录](docs/releases/0.6.0.md) 和 [实验说明](docs/OCG-EXPERIMENTS.md)。

**这次包含真实模型和桌面安装验收吗？**

本次用原生 SDK、脚本化本地响应和实际插件包验证兼容性。没有新增付费模型实验，也没有完成 rc.3 Electron 桌面的安装、交互或长时间运行验收。历史成绩不计入本版结果。

## 开发文档

建议使用 Node.js 22；本版在 22.23.3 验证，锁文件固定 rc.3 SDK。依赖安装可能访问 npm。完整原生用例应指定 SDK 根目录，避免跳过：

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run build
$env:DSH_ULTRA_TEST_SDK = (Resolve-Path node_modules).Path
npm test
npm run test:benchmarks
```

根目录 `src/` 是共同核心，`npm run build` 同时生成三包及来源清单。附属包的 `core-src` 与 `lib` 是派生产物，不要分别修改。运行时无需引用开发仓库。

[架构](docs/architecture.md) · [模型池](docs/model-pool.md) · [证据与上下文](docs/evidence-context.md) · [决策治理](docs/decision-governance.md) · [知识库](docs/global-knowledge.md) · [测试指南](docs/testing.md) · [贡献](CONTRIBUTING.md) · [安全约定](SECURITY.md)

项目采用 [BSD-3-Clause](LICENSE) 许可。
