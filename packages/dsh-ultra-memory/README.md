<div align="center">

# Ultra-Memory

**让上下文可以变短，让正在做的事继续。**

面向 DSH 的独立工程记忆、证据检索与上下文管理插件<br>
记住目标与约束，按当前问题找回线索，让模型主动查看进度、读回原文。

[![正式版 0.2.0](https://img.shields.io/badge/正式版-0.2.0-167d8d)](https://github.com/Kayou-31/Ultra-Memory/releases/tag/v0.2.0)
[![DSH rc.2 / rc.3](https://img.shields.io/badge/DSH_0.2.1-rc.2_%7C_rc.3-526d82)](package.json)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-43853d)](package.json)
[![BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-737373)](LICENSE)

[下载插件](https://github.com/Kayou-31/Ultra-Memory/releases/download/v0.2.0/dsh-external-dsh-ultra-memory-0.2.0.tgz) · [完整源码](https://github.com/Kayou-31/Ultra-Memory/releases/download/v0.2.0/Ultra-Memory-0.2.0-source.zip) · [中文发布说明](https://github.com/Kayou-31/Ultra-Memory/blob/main/docs/releases/0.2.0/RELEASE.zh.md) · [验证报告](https://github.com/Kayou-31/Ultra-Memory/blob/main/docs/releases/0.2.0/RESULTS.md)

</div>

**当前版本：0.2.0，工程记忆正式版。** 可以独立安装，不需要 Ultra Mode 或 Memory-Continuity。与 Ultra 0.7.0 三包发布中的 Memory 使用同一份 TGZ。安装后默认启用项目证据与分层记忆；历史压缩、阶段归档和跨项目知识库仍需显式开启。

[认识项目](#这是什么) · [功能一览](#功能一览) · [快速开始](#快速开始) · [模型工具](#模型工具) · [升级与兼容](#升级与兼容) · [常见问题](#常见问题) · [开发文档](#开发文档)

## 这是什么

长任务的问题不只是“消息太多”，还包括压缩之后不知道原来的约束、做过哪些尝试、下一步应该查什么。Ultra-Memory 将工程记忆拆成五层：目标与约束、当前进展、相关决策、历史证据、未完成事项。

每轮从已授权的项目记录中组成有限大小的记忆包；历史内容按当前用户问题的关键词、文件名或话题匹配后注入。模型也可以主动调用 `ultra_memory_status` 看进度，再搜索和分页读回原文。无需额外模型、embedding、数据库或密钥。

分层、条件选择、分级展开与来源追踪借鉴 [Memory-Continuity](https://github.com/Kayou-31/Memory-Continuity) 的经验，在工程任务上重新实现。两者没有运行时依赖，不合并数据，也不会自动读取人物记忆。

## 功能一览

| 能力 | 当前可以做什么 |
| --- | --- |
| 分层注入 | 五层组织目标、约束、进度、决策、证据和待办；默认 8192 UTF-8 字节预算 |
| 条件召回 | 按当前真实用户消息匹配授权记录；排除已被替代、不可读和重复来源，记录未选原因 |
| 主动进度查询 | `overview` 概览、`association` 状态与选择依据、`evidence` 限量证据样本；支持版本比较与分页 |
| 项目证据 | 原始来源和恢复索引保存在项目内，支持搜索、读回与连续引文核验 |
| 普通对话接入 | 第一条根会话用户消息建立初始目标，后续真实用户要求按顺序保留；工具非错误返回记录为 executed |
| 可选压缩 | 先持久化与核验来源，再替换旧工具正文；必要目标或约束放不下时暂停新增压缩 |
| 可选阶段归档 | 将满足条件的已完成阶段外置，保留检查点与可验证恢复入口；默认关闭 |
| 可选知识库 | 同一 profile 内按真实项目目录显式授权发布、读取和撤销；默认关闭 |
| 组合使用 | Memory、Ultra 和 Decision 共享唯一证据服务；卸载一个包不会提前关闭其余包使用的服务 |

**记录不等于当前事实。** `planned`、`executed`、`verified` 分开显示；即使记录写着 verified，也不代表本轮重新验过工作区。查询不会扫描当前代码或运行测试。自动召回是确定性关键词匹配，不是向量语义检索；本版不声称已经证明真实模型的成功率提升。

## 快速开始

### 1. 确认运行环境

| 组件 | 要求 |
| --- | --- |
| Node.js | 22 或更新版本；发布验证使用 22.23.3 |
| DSH | 推荐 0.2.1-rc.3；也验证 0.2.1-rc.2 原生 SDK |
| Cordis / Schemastery | 4.0.5 / 3.18.5 为本次验证组合 |
| 项目 | 宿主提供真实 cwd、会话持久化与授权的活动 Agent |

### 2. 安装插件

从 [0.2.0 正式发布页](https://github.com/Kayou-31/Ultra-Memory/releases/tag/v0.2.0) 下载 TGZ，按同页 `SHA256SUMS.txt` 核对。通过 DSH 的本地插件包入口安装，将 `@dsh-external/dsh-ultra-memory` 加到当前 profile 的 bundles，再完整退出并重启。保留已有 bundle；源码 ZIP 用于开发，不是安装包。

### 3. 按需配置

在宿主 Settings / Config 中覆盖 `ultra-memory` 节点。默认配置可先用于证据检索与分层记忆：

```yaml
- id: ultra-memory
  config:
    evidenceEnabled: true
    taskMemoryEnabled: true
    taskMemoryMaxBytes: 8192
    taskMemoryConditionalRecall: true
    taskMemoryRecallLimit: 6
    contextCompression: false
    globalKnowledge:
      enabled: false
```

| 设置 | 含义 |
| --- | --- |
| `taskMemoryEnabled` | 是否自动注入工程记忆；关闭后恢复原有简短检索入口 |
| `taskMemoryMaxBytes` | 2048～65536 字节，默认 8192；UTF-8 字节，不是精确 token 数 |
| `taskMemoryConditionalRecall` | 是否自动选择与当前问题相关的历史；关闭仍保留目标与进度 |
| `taskMemoryRecallLimit` | 每轮自动召回上限 0～16，默认 6 |
| `contextCompression` | 默认 false；开启前确认原生持久化与 token-meter 能力、真实模型容量，并避免同时启用多个历史压缩管理者 |

项目证据位于项目 `.dsh-ultra/v1`。启用全局知识还需明确配置真实项目目录、`read`、`publish`、`shareWith`，知识保存在原生 `profileContext.dir/.dsh-ultra-knowledge/v1`；不存在默认跨项目共享。

## 模型工具

| 工具 | 用法 |
| --- | --- |
| `ultra_memory_status` | 主动查看目标、记录的进度、阻塞、下一步，以及本轮记忆选择与来源 |
| `ultra_memory_search` | 在当前授权范围中搜索原始证据与语义记录 |
| `ultra_memory_get` | 按 ID、offset 和长度读回来源，必要时核对引文 |

进度查询示例：

```json
{"depth":"association","query":"payment retry","maxChars":6000}
```

响应的 `text` 是 JSON 文本的一页；完整 JSON 需要按 `nextOffset` 拼接。继续分页时保持同一 `query`、`depth`，传回 `revision`；版本改变会拒绝混接，需从 0 重新读。用 `sinceRevision` 可检查是否变化。`evidence` 最多展开 6 个来源短样本，完整内容仍使用 `ultra_memory_get`。

可以直接对模型说：“先查看当前项目进度，再读回与下一步有关的原始证据；执行之后重新检查文件和测试。”插件提供工具及提示，是否实际调用仍由模型决定。

## 升级与兼容

- 包身份继续使用 `@dsh-external/dsh-ultra-memory`，配置节点仍是 `ultra-memory`；独立仓库不是另一份应同时安装的插件。
- 保留旧 TGZ、profile 配置、项目证据和宿主原始日志；替换包并重启。已有证据结构继续读取，记忆包按需生成，没有人物数据迁移。
- 包的旧版声明仍包含 DSH 0.2.0-rc.2；缺少动态上下文服务时降级到原有恢复入口。本轮没有重新验证其新增能力，不将其列为新能力的实测目标。
- Memory 配置优先于 Ultra，再优先于 Decision；只采用当前权威配置，权限不取并集。停用证据会暂停捕获与压缩，停用区间不自动回填。
- 已有 `arc_` 归档检查点须保留相容读取器、原始日志和归档清单，不能直接交给不理解检查点的旧版续作。

## 常见问题

**是否就是 M-C 和 Ultra 的合并？** 不是。复用的是设计经验；工程记忆有独立实现、作用域与存储。

**能自动知道代码现在做到哪了吗？** 它展示已有证据和状态，不是文件监控器。普通对话初始目标不会自动被每条追问覆盖，后续真实用户要求按原顺序保留并优先解释；必要内容超预算时停止新增压缩。工具返回只代表执行记录。模型应重新读取相关文件和运行验收。

**压缩后是不是不会丢信息？** 没有这种保证。它保留来源与恢复通道，对缺失证据和预算溢出采取保守处理；摘要可能不完整，原始日志被外部删除后也无法凭空恢复。

**混合动态上下文能全部压掉吗？** 含其他插件 section 或未知字段的快照会完整保留；只有精确匹配本插件单一 section 的快照才从胶囊正文外置，原文仍可读回。

**有没有 M-C 那样的工作台？** 本版提供模型工具和宿主配置，没有独立图形记忆工作台。

**会调用额外模型或增加收费吗？** Memory 自身不发模型请求；注入和工具读回内容会进入宿主正常请求，增加相应上下文用量。

## 开发文档

独立源码、构建和测试入口在 [Ultra-Memory 仓库](https://github.com/Kayou-31/Ultra-Memory)。三包共同核心与组合验收在 [DSH Ultra Mode](https://github.com/Kayou-31/dsh-ultra-mode)。包内 `core-src/` 和 `SOURCE-MANIFEST.json` 保留来源与运行时哈希；TGZ 不依赖另一个 Ultra 包。

详见 [本版发布说明](https://github.com/Kayou-31/Ultra-Memory/blob/main/docs/releases/0.2.0/RELEASE.zh.md)、[验证结果与未测范围](https://github.com/Kayou-31/Ultra-Memory/blob/main/docs/releases/0.2.0/RESULTS.md)。真实模型长任务质量、完整 rc.3 Electron 安装流程和整日稳定性不在本轮已验证范围。
