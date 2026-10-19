# DSH Ultra Mode

> **v0.6.0-dev.3 三包预发布**：完整 Ultra、独立 Memory、独立 Decision 一起提供，保留现有手动模式和权限边界。普通协作多模型池、可选意图／诊断／验收治理、同 profile 显式授权知识库来自共同核心。原生验收目标为 DSH `0.2.1-rc.2`，旧 `0.2.0-rc.2` 另做 SDK 回归；兼容范围与实测范围分开。[发布说明与验证边界](docs/releases/0.6.0-dev.3.md)。

完整 Ultra 将普通子代理协作、多路线 Max 研究、decision 协调和长任务证据管理连在一起；Memory 与 Decision 可单独安装或组合，便于按需选择。你选择怎样协作，插件传递进展、定位原文、保留项目状态，并收敛为可核对的交付。

[下载三个预发布包](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0-dev.3) · [独立安装与组合](docs/companion-plugins.md) · [发布验证](docs/releases/0.6.0-dev.3.md) · [安装与回滚](docs/installation.md) · [架构](docs/architecture.md) · [更新记录](CHANGELOG.md)

## 按需安装完整包或附属包

| 包 | 源码位置 | 用途 |
| --- | --- | --- |
| `@dsh-external/dsh-ultra-mode` `0.6.0-dev.3` | 仓库根目录 | 完整的关闭／辅助／手动 2～5 路、Team、模型池、治理、证据／上下文与全局知识 |
| `@dsh-external/dsh-ultra-memory` `0.1.0-dev.1` | [packages/dsh-ultra-memory/](packages/dsh-ultra-memory/README.md) | 独立项目证据检索、可选原生压缩及显式授权全局知识；不创建模型 |
| `@dsh-external/dsh-ultra-decision` `0.1.0-dev.1` | [packages/dsh-ultra-decision/](packages/dsh-ultra-decision/README.md) | 独立普通 Team、协作多模型池、只读决策旁路及意图／诊断／验收；没有 Max 多路线入口 |

可以单装任意一包，也支持 Memory＋Decision、Ultra＋Memory。Ultra 和 Decision 可同时安装，但同一 scope 重复主动启用协调插件会明确拒绝，需选择一个。Decision 的额外旁路默认关闭，显式 `/decision on` 才开启；`/team` 单独控制普通协作。

根 `src/` 是共同核心的权威来源，附属包是自包含派生 bundle，不增加服务、密钥或默认付费调用。组合通过原生 lease 复用唯一证据服务，配置权威为 Memory > Ultra > Decision，项目授权不并集；释放一个 lease 保留其余插件。安装、配置、包内来源清单及回滚见[附属插件说明](docs/companion-plugins.md)。三个包在同一 [Release](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0-dev.3) 提供；SHA256、实测与未验证项见[本版发布记录](docs/releases/0.6.0-dev.3.md)。

## 可以怎么用

| 模式 | 适合的工作 | 谁执行与交付 |
| --- | --- | --- |
| **Team 子代理协作** | 普通 Agent 需要拆分任务、交换线索或续接已有子任务 | 普通主 Agent 保留模型、思考强度和原有权限；Team 与 Ultra 分别开关 |
| **Ultra 关闭** | 按宿主原有方式工作 | 普通主 Agent；不会自动启动 Max 辅助或多路线 |
| **Agent＋决策辅助** | 希望正常执行过程中有独立复核和建议 | 普通主 Agent 执行；额外只读 Max 辅助观察进展，在后续步骤给建议 |
| **手动 2～5 路** | 需要从不同方向研究、交叉核验或处理冲突 | N 个独立 Max worker 只读研究，另一个 Max decision 完成规划、协调和最终实施 |

路线数不包含 decision。每个 worker 仍可使用宿主普通子代理，但保留原有权限、深度和容量限制。共享证据不扩大文件、命令、会话或发布权限；研究 worker 与辅助 decision 只读，最终实施仍须符合用户授权与宿主审批。模式由你选择，不根据任务自动提高并发。

### Team：六个协作工具

Team 可以独立于 Ultra 开启，提供：

| 工具 | 用途 |
| --- | --- |
| `ultra_spawn_agent` | 后台派发子任务，返回真实子代理 ID；父 Agent 可继续工作 |
| `ultra_send_message` | 给同组目标排队信息，不唤醒空闲目标 |
| `ultra_followup_task` | 在同一子代理 ID 和上下文中显式续作 |
| `ultra_wait_agent` | 按事件等待结果，支持 cursor，避免重复消费 |
| `ultra_interrupt_agent` | 中断自己创建的子代理或后代当前活动 |
| `ultra_list_agents` | 查询本组任务、状态和结果快照 |

消息不是新的人类授权。成功入队、进入实际请求和模型确实采用是不同证据。工具参数与生命周期见 [协作说明](docs/collaboration.md)。

### 普通协作多模型池

在“协作”旁打开“模型池”，从 DSH 已配置的 provider／模型目录添加候选，声明擅长、适用及不适用场景。主 Agent 可在 `ultra_spawn_agent` 中选择 `model_config_id` 并附一句 `model_reason`；宿主按精确 provider＋模型校验，使用原生子代理创建与工具执行链。记录区展示请求候选、解析与实际请求模型、工具结果观察、状态及已报告用量。

用户固定候选优先。空池维持原有继承；默认不回退，跨 provider 和工具兼容性未知的候选需要明确配置允许。热保存只影响随后新建的普通子代理；运行实例及续作保持原快照，权限、审批、深度仍由宿主管理。主 Agent、Ultra worker／decision 及其原来的选模方式保持原值。

详见[中文配置与架构说明](docs/model-pool.md)及[profile 示例](docs/model-pool.example.yml)。它不会因为添加了多个模型自动启动更多代理。

### 可选决策治理

在既有 `ultra-mode` 配置中显式设置 `decisionGovernance: true`，让现有 decision 调用同时处理原文意图、运行中诊断和最终验收。默认值为 false；开关不增加优化器、路线或额外模型调用，也不强制辅助模式补一次最终调用。关闭／辅助／手动 2～5 路与普通协作模型池保持原用法。

完整原始任务及其哈希始终保留，整体 `task-result` 验收项不会被局部摘要替代；模型补充不能变成用户授权。诊断记录区分原生入队、实际准入、实际请求可见与独立效果证明，生产路径不会自动把后续工具活动当作效果已验证。最终 `satisfied / failed / unverified` 是基于实际工具来源的模型判断，始终标明 `hostVerified: false`。

配置、协议、审计、迁移和边界见[决策治理说明](docs/decision-governance.md)与[手动两路示例](docs/decision-governance.example.yml)。DSH 继续拥有模型、工具执行、会话、权限、收件箱、pre-step 和 JSONL；插件复用 EvidenceStore 与紧凑 RPC／UI 状态。

### 同 profile 显式授权知识库

在原生插件配置中显式启用 `globalKnowledge`，并按真实项目目录分别授予读取、发布和 `shareWith` 目标。项目 A 的普通主 Agent 或当前可写 decision 可以把当前授权来源的逐字引文与整理结论发布给 B；B 用 `ultra_knowledge_search`／`ultra_knowledge_get` 按需检索并重新核对来源。研究 worker、辅助 decision 和普通子代理保持只读，知识内容不能新增权限。

授权同时核对当前 profile、当前配置、发布时读者快照以及双方真实目录的哈希。撤权即时阻止后续读取；同 ID 更换目录不继承旧发布，新加读者需要显式发布新版本。知识结论始终是模型整理，`hostVerified: false`；`source-match` 只说明来源匹配。不会扫描全部历史、引入 embedding／数据库或新增模型调用，也不把全部知识塞入提示词。

默认关闭；首次切换启用状态后重载插件或重启，启用后的项目授权可热修改。具体配置、四个工具、分页、撤销及迁移回滚见[知识库说明](docs/global-knowledge.md)与[profile 示例](docs/global-knowledge.example.yml)。

全局知识还要求宿主原生 `profileContext.dir`。本轮原生知识闭环以 `0.2.1-rc.2` 为验收目标，`0.2.0-rc.2` 保留原模式／SDK 回归；旧宿主若未提供 profile 元数据，知识功能明确拒绝，不用环境变量猜测目录。

## Ultra 如何把一次任务做成闭环

并发模式使用同一个 decision 上下文完成 **规划 → 新进展协调 → 最终核对与实施**。规划只分配任务；worker 分别研究，提交带证据 ID、未确定项和冲突的原生报告。decision 可以自己读回原文，向仍在运行的路线发送下一步骤方向，最后统一处理变更、验证和交付，减少重复实施。

| 组成 | 实际作用 |
| --- | --- |
| **稳定证据来源** | 在可访问工具结果被进展、投影保留或报告截断前建立关联，记录项目／运行／会话／路线／事件、分块及校验；优先引用宿主持久日志 |
| **只读按需检索** | `ultra_memory_search` 用关键词及已授权来源 metadata 定位资料；`ultra_memory_get` 分页读原文，`quote` 校验连续引文、范围、来源 ID 和实际工具资源 ID |
| **主题与项目状态** | 结构化版本记录目标、约束、进度、下一步、阻塞、决策替代与冲突；区分计划、已执行和已验证，主题 MD／目录是可读派生视图 |
| **路线上下文装配** | 保留宿主指令、用户原话和必要约束，加入当前路线任务、状态、近期资料与精简索引入口，按需取证，不默认复制全部共享历史 |
| **可选历史替换与恢复** | 先持久化、校验证据及恢复入口，再通过原生历史替换移走较早工具正文；保留原事件、工具配对与恢复审计，失败时保留或补偿恢复 |
| **资源与状态可见性** | 提供阶段、路线、覆盖缺口、检索、冲突、压缩前后估算和用量快照；请求／token预算、检索量、协调频率与失败退出可配置，已知、未知和估算分开 |

这些机制已整合在 Ultra 中，不需要另装 [billion-context-dsh](https://github.com/tyan66666/billion-context-dsh)、外部向量库或 embedding 服务。本地索引、检索和确定性正文替换没有默认额外模型调用；模型主动调用检索仍属于其正常工具步骤。语义提炼可能遗漏，因此原文另有独立检索路径。不可访问或已被上游截断的内容会标记覆盖缺口，不伪装成保留了完整原文。

### 例：调查一次发布后的接口延迟

你先选择 `/team on`、`/ultra 2`，再提出：“分别检查监控与发布变更，先只读调查；未经批准不要修改线上，给出有证据的结论与验证方案。”

1. decision 把两个研究方向分给 worker；各 worker 可用 Team 派发普通子任务。长工具结果先关联稳定来源，再形成简短进展。
2. 两路对根因有分歧时，报告列出冲突与来源 ID；decision 独立 search/get 定位原文并核验 quote，再决定是否调整调查方向。
3. 状态保留“待确认的假设”和“已经查过但未验证的操作”。若明确启用了压缩，旧工具正文移出工作上下文后仍可按来源读回；取消或冷恢复后据状态核对续作，不靠摘要猜测已完成步骤。
4. 最终给出带引用的方案与未解决项。用户未授权线上修改时，decision 不执行修改；获得授权后才按宿主原有权限统一实施、验证并更新状态。

## 安装与常用命令

- [完整 Ultra TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0-dev.3/dsh-external-dsh-ultra-mode-0.6.0-dev.3.tgz) · [Memory TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0-dev.3/dsh-external-dsh-ultra-memory-0.1.0-dev.1.tgz) · [Decision TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0-dev.3/dsh-external-dsh-ultra-decision-0.1.0-dev.1.tgz)
- [SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0-dev.3/SHA256SUMS.txt) · [验收冻结源码 ZIP](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0-dev.3/dsh-ultra-mode-0.6.0-dev.3-source.zip) · [验证附件](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0-dev.3/dsh-ultra-mode-0.6.0-dev.3-verification.zip)
- 目标接口范围为 `0.2.0-rc.2 || 0.2.1-rc.2`；全局知识的原生验证仅针对具备 `profileContext.dir` 的 `0.2.1-rc.2`，缺少服务时失败关闭。TGZ 含 lib，通过 DSH 原有本地包入口安装；先核对哈希、备份 profile 与旧包，再退出并重启。建议先用独立 profile。
- 具体组合与回滚见[附属插件说明](docs/companion-plugins.md)。配置 ID 分别为 `ultra-mode`、`ultra-memory`、`ultra-decision`；Ultra 与 Decision 同 scope 仅启用一个协调入口。

| 命令 | 行为 |
| --- | --- |
| `/team on`、`/team off`、`/team` | 独立开启、关闭或查询普通子代理协作 |
| `/ultra off` | 关闭后续任务的自动 Ultra，保留已选模式 |
| `/ultra assist` 或 `/ultra 1` | 普通 Agent＋只读 Max 辅助 |
| `/ultra 2`～`/ultra 5` | 手动选择对应数量的 Max worker＋Max decision |
| `/ultra on` | 恢复当前选择；新会话首次开启并发默认 3 路 |

新会话默认 Team 与 Ultra 都关闭。`contextCompression` 默认 false；如需开启，先在测试 profile 核对持久化／token-meter 能力，确保同一上下文只有一个压缩管理者，不能同时启用默认 compactor 或另一压缩插件接管该历史。阶段输出 cap 默认 0 继承，不降低 Max。配置和迁移见 [使用说明](docs/evidence-context.md) 与 [示例](docs/evidence-config.example.yml)。

## 使用边界与验收

**30K 是单 Agent 工作上下文软目标。** 系统、工具、硬约束、近期大结果和检索返回可能让实际请求明显超额。历史 0.5.0-rc.3 的多数大型请求确实超过目标；该轮约32%仅为同一次装配压缩前后估算输入下降的样本中位数，不是账单或相对原版节省。历史验证的是确定性工具正文替换，并非递归生成摘要，不承诺信息或能力绝对无损。

内部路线不在主界面逐步展示全部过程，也不公开私有思维链。多路线、Max、协调和普通子代理都会增加模型消耗，有限预算也可能耗尽；本版完整 Electron UI／桌面权限组合尚未验收。

本版新 SDK 自动测试 **496 通过、2 跳过、0 失败**，旧 SDK **495 通过、3 跳过、0 失败**；同一套498项不能相加。最终三包在独立 profile 完成 **24 个原生 CLI 进程、741 条断言、218 次离线脚本 stream**，峰值双并发、网络调用0。两轮长历史夹具压缩与来源 SHA 读回通过，但它们使用脚本模型且两轮之间进行了原生会话恢复，不能证明真实模型长期无漂移。

完整 Electron UI、真实模型质量，以及独立 Decision 对意图／诊断／最终验收的专门原生完整闭环仍未验证。日常 profile 检查为三个指纹一致、一个 patch 指纹变化且来源未知，未回写；不宣称日常配置全部未变。具体范围、跳过原因、已修复问题与来源链见[发布验证](docs/releases/0.6.0-dev.3.md)。

以下为 **0.5.0-rc.3 历史成绩**，不归到 dev.2／dev.3：真实宿主、模型及失败记录见 [历史验收与限制](docs/evidence-verification.md) 和 [公开档案](verification/0.5.0-rc.3/README.md)。主套件299通过／1环境跳过；最后模型实测构建Max双路12/12；约23MB长线原26轮9/12，检索修复后同根补1轮12/12、累计23次prune。原失败与返工保留；不完整原版A/B不能证明质量或成本优势。模型实测包与文档更新包分开记录哈希，44个lib文件逐字一致，不把文档重打包当作新的在线模型测试。

## 开发、历史与支持

[测试指南](docs/testing.md) · [业务样例](benchmarks/README.md) · [排障](docs/troubleshooting.md) · [贡献](CONTRIBUTING.md) · [安全约定](SECURITY.md)

历史 [0.4.0-rc.3](docs/verification-0.4.0-rc.3.md)、[0.4.0-rc.2](docs/verification-0.4.0-rc.2.md)、[0.3.2](docs/verification-0.3.2.md) 的成绩只归对应版本；旧版TGZ可按安装指南用于回滚。项目采用 [BSD-3-Clause](LICENSE) 许可。
