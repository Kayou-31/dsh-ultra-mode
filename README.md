# DSH Ultra Mode

> **v0.6.0 三包正式版**：完整 Ultra、独立 Memory、独立 Decision 一起提供。协作调度、多模型子代理、decision 治理、证据检索、上下文管理及显式授权知识库来自共同核心，保留手动模式和权限边界。主验收宿主为官方 DSH **0.2.1-rc.2**；旧 0.2.0-rc.2 的离线回归单列。

**14 轮合格压缩，压后约 65K 级（含预留）；测试范围内任务一致性保持，随任务更新持久化项目进度，支持检索与恢复。**

完整 Ultra 将普通 Team、多路线 Max 研究和 decision 协调连在一起。你选择协作方式，插件关联原始证据、传递进展、保留项目状态，并在需要时读回旧资料；Memory 与 Decision 也可独立安装或组合，无需另造一套宿主或手动传递每路摘要。

[下载三个正式包](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0) · [独立安装与组合](docs/companion-plugins.md) · [发布验证与限制](docs/releases/0.6.0.md) · [安装与回滚](docs/installation.md) · [架构](docs/architecture.md) · [更新记录](CHANGELOG.md)

本轮 OCG / Flash 实测使用独立 profile：500K 总窗口、420K 含预留触发，**14 个合格周期的首个实际压后包络为 21,033～62,902 token**。第15阶段质量、来源与提交通过，压后为 **65,664**，但压前请求缺缓存分桶，未达到预设测量门槛，不能计为第15个合格周期。整组保持 **failed、14/30**；原定30轮和一天项目跨度未完成，额外归档冷读回未启动。约65K是本案例体积，不是压缩率、固定硬上限或绝对无损保证。

用户已选择按当前结果收尾发布。失败、检索返工、原基线30轮与本次归档组分别保留在[实验说明](docs/OCG-EXPERIMENTS.md)和[上下文曲线口径](docs/experiments/compression-efficiency.zh.md)。本次239个请求已核对原生用量；最终正式包与真实被测开发包的源码／运行时对应关系见发布附件，改号和文档打包不算重新运行真实模型。

## 按需安装完整包或附属包

| 包 | 源码位置 | 用途 |
| --- | --- | --- |
| `@dsh-external/dsh-ultra-mode` `0.6.0` | 仓库根目录 | 完整的关闭／辅助／手动 2～5 路、Team、模型池、治理、证据／上下文与全局知识 |
| `@dsh-external/dsh-ultra-memory` `0.1.0` | [packages/dsh-ultra-memory/](packages/dsh-ultra-memory/README.md) | 独立项目证据检索、可选原生压缩及显式授权全局知识；不创建模型 |
| `@dsh-external/dsh-ultra-decision` `0.1.0` | [packages/dsh-ultra-decision/](packages/dsh-ultra-decision/README.md) | 独立普通 Team、协作多模型池、只读决策旁路及意图／诊断／验收；没有 Max 多路线入口 |

可以单装任意一包，也支持 Memory＋Decision、Ultra＋Memory。Ultra 和 Decision 可同时安装，但同一 scope 重复主动启用协调插件会明确拒绝，需选择一个。Decision 的额外旁路默认关闭，显式 `/decision on` 才开启；`/team` 单独控制普通协作。

根 `src/` 是共同核心的权威来源，附属包是自包含派生 bundle，不增加服务、密钥或默认付费调用。组合通过原生 lease 复用唯一证据服务，配置权威为 Memory > Ultra > Decision，项目授权不并集；释放一个 lease 保留其余插件。安装、配置、包内来源清单及回滚见[附属插件说明](docs/companion-plugins.md)。三个包在同一 [Release](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0) 提供；SHA256、实测与未验证项见[本版发布记录](docs/releases/0.6.0.md)。

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
| **可选历史替换与恢复** | 先持久化、校验证据及恢复入口，再原生替换较早工具正文；另提供默认关闭的已完成阶段归档。原始日志保留，普通正文替换与跨角色归档分别记录恢复语义 |
| **资源与状态可见性** | 提供阶段、路线、覆盖缺口、检索、冲突、压缩前后估算和用量快照；请求／token预算、检索量、协调频率与失败退出可配置，已知、未知和估算分开 |

这些机制已整合在 Ultra 中，不需要另装 [billion-context-dsh](https://github.com/tyan66666/billion-context-dsh)、外部向量库或 embedding 服务。本地索引、检索和确定性正文替换没有默认额外模型调用；模型主动调用检索仍属于其正常工具步骤。语义提炼可能遗漏，因此原文另有独立检索路径。不可访问或已被上游截断的内容会标记覆盖缺口，不伪装成保留了完整原文。

### 例：调查一次发布后的接口延迟

你先选择 `/team on`、`/ultra 2`，再提出：“分别检查监控与发布变更，先只读调查；未经批准不要修改线上，给出有证据的结论与验证方案。”

1. decision 把两个研究方向分给 worker；各 worker 可用 Team 派发普通子任务。长工具结果先关联稳定来源，再形成简短进展。
2. 两路对根因有分歧时，报告列出冲突与来源 ID；decision 独立 search/get 定位原文并核验 quote，再决定是否调整调查方向。
3. 状态保留“待确认的假设”和“已经查过但未验证的操作”。若明确启用了压缩，旧工具正文移出工作上下文后仍可按来源读回；取消或冷恢复后据状态核对续作，不靠摘要猜测已完成步骤。
4. 最终给出带引用的方案与未解决项。用户未授权线上修改时，decision 不执行修改；获得授权后才按宿主原有权限统一实施、验证并更新状态。

## 安装与常用命令

- [完整 Ultra TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0/dsh-external-dsh-ultra-mode-0.6.0.tgz) · [Memory TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0/dsh-external-dsh-ultra-memory-0.1.0.tgz) · [Decision TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0/dsh-external-dsh-ultra-decision-0.1.0.tgz)
- [SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0/SHA256SUMS.txt) · [验收冻结源码 ZIP](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0/dsh-ultra-mode-0.6.0-source.zip) · [验证附件](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.6.0/dsh-ultra-mode-0.6.0-verification.zip)
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

`contextRetainRecentMessages` 已支持配置 2～128，默认仍为 8，只影响近期保留窗口；用户要求、附件及受保护内容不会为达标而强行移走。启用压缩时以官方 token meter 的 usage 锚与 surface 变化估算作为下限，并与本地 decoded-message 估算取较大值：正文、工具参数和 reasoning 按解码后的原始内容计量，保留 framing、工具定义及 rich／unknown 结构回退，不重复计算 JSON 传输转义和宿主消息 metadata。这些数值始终标为 estimated，不是 provider 精确 tokenizer 或无条件硬上限，也不保证压缩无损。本轮 retain=2、500K／420K 是独立验收设置，产品默认值未改。

`contextArchiveCompletedTurns` 默认 false；仅在显式启用压缩、经核对的官方 `0.2.1-rc.2` 原生接口及唯一压缩权威下试用。它归档完整结束且工具配对平衡的旧阶段：用户／控制文字与公开 assistant 文字逐字保留，旧工具调用参数和结果从工作表面移出，原文仍在宿主追加日志中。系统／开发者指令、当前阶段、近期窗口及不支持的富媒体或全局知识区域受到保护。重复归档展开既有清单，不反复套摘要；不提取、索引或展示私有 reasoning，不增加摘要模型调用。旧工具正文 pruner 及其默认设置保持原样，短结果无须普遍压缩。

归档清单只保存项目／会话／事件定位、长度、公开事件 SHA 和既有来源 ID，使用 `ultra_memory_get` 按 `arc_` ID 分页读回。`contextArchive:true` 和 `verification: returned-events` 表示本页事件已核验；`manifestSha256` 校验清单，不是完整原文 SHA 或事实引用。引用仍用原始 `src_`／`chunk_` ID 再 get／quote。当前项目和会话授权在读取前后复查，归档不会成为新的语义事实或知识发布来源。

提交前失败保留旧表面；跨角色检查点已经提交后若持久化不确定，明确记录 `committed/persistenceUncertain` 并停止后续模型及业务调用，直至持久化和恢复入口校验成功，**不宣称精确回滚**。关闭新开关只停止创建，不绕过未解决的持久化边界，也不删除已存在的恢复入口。归档会话降级前须保留新版读取器、原生日志和 `.dsh-ultra/v1/archives/`，不能直接在不识别它的旧插件上续作。本轮归档实测按14/30收尾，完整30轮及额外归档冷读回未验证；安装配置和恢复限制见发布记录。

30-a 的工具 JSONL 曾被整条消息再次 JSON 编码，导致预算误拒；对同一原生可见输入离线重放，含预留预算由旧估算 518,237 修正为新估算 463,595。被拒的大请求没有发送给 provider，这不是 actual 450K 输入或该组 30 次通过证据；30-a 与 30-b 原始失败保留，基线的 30 轮通过归属显式 recovery-1。

本次恢复只在显式验收 profile 使用官方有界 TRANSPORT 重试，最多 2 次，默认仍为 0；不会改变产品默认行为。对已完成提交、仅收尾连接失败的阶段，显式冷恢复只读补齐 final 核验，不重做旧提交；后续新阶段仍须按原授权执行。错误流包装中的 0 usage 按 unknown 保留，不当作真实零消耗或成功调用计费；新请求依唯一 gate ID 和最后 provider usage 单独计入已知小计。

## 使用边界与验收

默认 Team、Ultra、压缩、阶段归档和全局知识均按原开关管理，不会自动提高路线数或为索引新增模型。研究 worker、辅助 decision、普通子代理的工具、审批、数据和深度限制仍由宿主执行。历史资料与检索返回不构成新授权；语义整理及模型验收不是宿主证明。

最终源码在官方0.2.1-rc.2测试 **727项：725通过、2跳过、0失败**；旧0.2.0-rc.2为 **706通过、21跳过、0失败**。两套不相加，跳过不算通过。服务端／客户端类型检查及构建通过。三包安装、组合、取消与恢复的正式TGZ原生矩阵，以及来源／哈希核对结果，以[发布记录](docs/releases/0.6.0.md)和Release验证附件为准；脚本模型测试不能替代真实长期效果。

官方Web＋真实Chrome的本轮离线界面检查 **12通过、1不适用**，包括模型池保存／刷新／CLI冷启动、归档估算／完整恢复ID、暂停提示、鼠标与键盘展开及六个手动模式。状态为显式合成投影、0模型调用；官方插件清单没有通用归档配置表单，归档通过profile文件配置。完整Electron、窄屏像素／鼠标回归和Web在线模型任务未验证。

原压缩基线确实完成过30轮一致性验收，但末轮压后实际输入363,182；它不是本次约65K归档组的30轮证明。新旧失败与不同候选分别记账，没有等工作量完整原版A/B，不计算普适费用节省或其他产品的能力分数。虚拟项目时间与实际43.37分钟控制器工作分列；本次合格阶段仅覆盖10小时50分，第15阶段已提交到11小时40分。

历史0.6.0-dev.3、0.5.0-rc.3的成绩继续只归对应版本，见[历史发布](docs/releases/0.6.0-dev.3.md)和[历史证据验收](docs/evidence-verification.md)。当前桌面内核0.1.2-alpha.1低于支持范围，本轮没有安装或修改日常DSH环境。

## 开发、历史与支持

[测试指南](docs/testing.md) · [业务样例](benchmarks/README.md) · [排障](docs/troubleshooting.md) · [贡献](CONTRIBUTING.md) · [安全约定](SECURITY.md)

历史 [0.4.0-rc.3](docs/verification-0.4.0-rc.3.md)、[0.4.0-rc.2](docs/verification-0.4.0-rc.2.md)、[0.3.2](docs/verification-0.3.2.md) 的成绩只归对应版本；旧版TGZ可按安装指南用于回滚。项目采用 [BSD-3-Clause](LICENSE) 许可。
