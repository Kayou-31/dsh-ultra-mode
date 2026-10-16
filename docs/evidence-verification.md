# 证据与上下文验收记录（0.5.0-rc.3）

本页记录 **0.5.0-rc.3预发布版** 的实测来源、失败与限制。安装资产见 [Release](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.5.0-rc.3)；本轮验收未安装到日常环境。测试日期为2026-10-15／16，使用独立DSH 0.2.0-rc.2 profile和用户授权的naizhi / deepseek-v4.1-flash。下列只统计已结束的rc.3阶段；历史rc.2另列，不以新通过覆盖旧失败。仓库提交、可安装TGZ与Release是不同状态。

入口：[公开验收档案](../verification/0.5.0-rc.3/README.md)、[逐阶段真实模型总账](../verification/0.5.0-rc.3/rc3-model-report.md)、[同步A/B报告](../verification/0.5.0-rc.3/paired-comparison-report.md)。完整本地交付另含逐请求JSON和公开原始回执；不包含私有思维链、日常会话或凭据。最终包／在线实测包及文档更新包之间的来源关系以[公开收据](../verification/0.5.0-rc.3/receipt.json)与同批交付清单为准，不改写历史在线包哈希。

## 当前验证层级

| 层级 | 实际结果 | 边界 |
| --- | --- | --- |
| 主套件：单元、模拟、真实rc.2 SDK组合 | 300项：299通过、0失败、1项Windows目录链接环境跳过 | 显式使用实际SDK；跳过不算通过，不代表真实模型质量 |
| 模型驱动纯测试／既有业务断言 | 19项／66项通过 | 合成fixture、协议与参考答案检查，不能泛化业务质量 |
| 实际宿主、脚本模型 | 独立CLI → Loader → AgentLoop／ToolRuntime／JSONL，核心、同根冷恢复及关闭模式通过 | 使用脚本adapter与合成usage，和真实模型任务分别报告 |
| 实际模型 | 20个结束尝试，285次原生LLM流准入；273次known、12次unknown | 这是尝试／流总账，不是20个独立成功任务，也不是独立核验的上游HTTP或账单次数 |
| 本版桌面UI与完整权限组合 | 未验证 | 后端通过不能替代Electron界面、完整sandbox／审批／普通子代理组合 |

主测试日志、模型驱动日志、[宿主回执](../verification/0.5.0-rc.3/host-profile-verification.json)、[隔离核对](../verification/0.5.0-rc.3/isolation-verification.json)分别保留。已知用量小计66,162,179 tokens：input 25,854,653、cacheRead 39,788,160、output 519,366。缓存是该宿主回报中的独立输入分项，不能再叠加到total；无reasoning分项不等于模型没有思考。失败／取消流的缺失或全零usage为未知，非零失败用量仍保留，未知不按免费计算。

## Max报告、来源与检索修复

研究worker通过ultra_submit_report提交报告、evidenceIds、unknowns与conflicts，经宿主校验后原生concludeTurn收尾；未完成或取消的路线不采用。四阶段cap可显式配置，默认0继承，保留Max；规划实际tools=[]且执行器拒绝工具，不为完成报告额外默认加模型请求。早期控制／holdout分别严格12/12，但不是最后构建的替代证明。

最后模型实测构建的未知答案Max双路任务严格12/12：28次请求、已知681,465 tokens、两份completed原生报告、一次协调，decision独立search/get取回尾部并核验引用，执行哨兵为0。同一构建较早一次SERVER502／TRANSPORT失败保留，不能只统计成功重跑。路线、decision、报告和检索请求均纳入该测试门限。

连续quote返回canonical sourceId、字符范围、SHA和实际工具参数origin.resourceId。正文内部A-/B-标签不是公共资料身份。检索修复在完整ACL之后联合该来源的origin.resourceId／工具metadata与正文词项，定位后部分块；多词分散命中时摘录锚定正文命中，避免退回块首。4项回归先失败再通过，并核对冷恢复、隔离和完整返回预算；旧索引无破坏性迁移。

## 约23MB长线、取消和冷恢复

drift-diverse包括20份各1MB不同ASCII操作记录、两份早期约1.5M字符原文，共26个完成用户轮，另有一次中途取消。原值位于压缩首尾预览之外；最终轮前公开助手进度和native替换预览的原值曝光计数均为0，不能用摘要中的答案冒充索引找回。初次第15轮请求频率失败保留；continue-long核对同一session、源文件SHA与早期完整读取收据后只续剩余9轮，未重复已完成轮。取消记录与跨进程恢复的原生aborted事件核对。

原26轮最终严格9/12：最新／替代决定、用户限制及已执行／未验证状态保留，但batch/checksum未找回，不能称为长线首次通过。检索修复后只在同一根会话追加1个最终修订轮，5次模型请求、严格12/12，取得两目标字段及四份真实quote。累计27个完成轮、23次原生prune；原失败、频率错误、未知用量、修复构建差异与这一次返工全部保留，不将改善归为单一因果效果。

其他历史长测也保留：drift-a因预览含答案主动停止，不算质量失败或完成；drift-b严格12/12但缺vendor专用quote回执，仍是阶段失败；drift-c原TRANSPORT保留，有界恢复后严格10/12，四份host原文引用有效但value标签和quote封装头不符合冻结格式，不重判通过。人类消息与Ultra恢复通知曾被驱动误计，离线更正计数不改变模型评分。

## 30K与“约32%下降”的实际含义

本版使用确定性旧工具正文替换，保留用户原话和原生原事件，不是递归生成摘要。压缩前先校验证据／恢复入口并checkpoint，再通过原生prune与surface replace移走正文；另一个compactor、取消、写入失败、提交后补偿和冷重放有独立机械检查。持久索引可恢复，不保证模型每次主动检索或解释正确。

30K是每Agent软目标。全部273条known请求中，174条按已回报输入及缓存分项相加的下界已超过30K；该总体含原版对照，不能全归因于候选。另152条有装配估算的请求中148条超预算。系统、工具、用户原话和近期大结果仍会使实际请求显著超额，不能宣称全部请求已控制到30K。

drift-b／c／diverse同次装配前后输入估算下降中位数约32.7%／32.7%／32.2%。diverse压缩后估算输入仍约201,918～855,793；其他场景最高估算超过百万。估算与provider实测是不同指标，不把估算再次计入用量；这些中位数不是总token或账单节省，没有未压缩反事实。墙钟包含模型服务、重启、工具和后期保守30秒本地等待，不推断供应商RPM或上游slot释放。

## 同步原版／候选A/B：不完整，不能证明优势

两臂分别独立home／profile，各本地门限1，合计≤2；主Agent、辅助和压缩请求都纳入各自门限。原版0.4.0-rc.3与ecf056f源码及离线构建核对；候选是检索修复前冻结构建。相同公开fixture、十条用户提示与冻结12项判分，原版启用native auto，候选启用local30K，是明示产品配置差异，不是只隔离一个算法。

原版前三轮完成，第4轮TRANSPORT Connection error终止，不重跑，不能解释成能力差。候选完成10轮、同根冷恢复、12次native prune、最终真实双源定点读取，执行0；最终带叙述及fenced JSON，严格解析失败为0/12。actualConstraintMisses为null／未判定，不能把解析失败产生的全部false称为事实或约束丢失，也不从embedded JSON补评分；自拟公共ID和正文别名问题仍保留。

双方共同完成且提示SHA一致的前缀为3轮，缺逐请求turn归属，不比较其token或延迟。缺完整10对10，整任务成本／耗时优势保持null，不计算节省比例；该冻结候选也不代表后续检索修复构建。一次受控样本没有统计推广意义，旧rc.2六轮样本另列，不合并A/B成绩。

## 来源、日常隔离和交付边界

实测Desktop／CLI／AgentLoop／JSONL为0.2.0-rc.2，本机安装构建commit为04f392c9ddd144fa426da2045178797da6db6c11；公开tag为639ed015397290b3745d163aafe02ffee4aa3f84，分别记录，不外推远端alpha兼容。每次从明确TGZ安装到测试profile，未使用PATH上的旧DSH。

DSH_HOME、cwd与profile隔离；日常4个配置／包／锁文件前后哈希一致，不扫描日常凭据和会话。离线阻断网络，在线只使用授权通道与测试凭据副本；测试副本已清理。私有推理和完整原生日志不公开，公开交付仅保留合成资料、最终答复、数值用量和审计收据。本轮验收未安装到日常环境；安装请核对本版Release的同批资产与哈希。

代码、包、源码和文档更新的对应关系由交付清单和公开receipt核对；模型实测包与文档更新包整包哈希分别保留，44个lib文件逐字核对一致；线上实测包记录不会因文档重打包而改写，也不把后者计作再次在线模型测试。关闭、迁移和回滚见[使用说明](evidence-context.md#迁移与回滚)。下一步是桌面UI、完整权限组合、异常断电、更多业务与稳定窗口下的完整重复对照；不再建议外接另一套索引插件，也不承诺绝对无损。

## 历史rc.2验收（原结果保留，非本轮成绩）

以下为上一候选当时的结果与运行条件；旧测试总数、顺序启动、失败与后续目标均只归历史rc.2。当前rc.3结果以上文和公开档案为准。

#### rc.2 来源记录

本候选经过独立 DSH profile 的真实宿主验收和用户指定 naizhi 通道的真实模型测试。机械路径通过，真实模型最终交付仍存在失败，不能视为全面验收通过。最终计数、来源、调用与哈希以交付目录 verification.json、host-profile-verification.json、model-verification.json、日志及 SHA256SUMS.txt 为准。测试日期为洛杉矶 2026-10-15（UTC 10-16）。

### 来源与隔离

本机 Desktop 只读副本：Desktop/CLI/AgentLoop/JSONL 均为 0.2.0-rc.2，构建提交 04f392c9ddd144fa426da2045178797da6db6c11，app.asar SHA256 为 983ca71114e6dfd353fc79af5a1f9481a250ee64c2a3c757673029b811b23bc2。这与公开 tag 提交是不同来源标识。未使用 PATH 上的旧版 DSH。

实际 CLI → profile bundle/patch → Loader → 原生 AgentLoop、ToolRuntime、preset、JSONL、token-meter。每次从 TGZ 安装到测试 profile/node_modules。DSH_HOME、profile、cwd、USERPROFILE/HOME/APPDATA/LOCALAPPDATA 均独立；不加载日常技能与会话。日常四个配置／包／锁文件前后哈希一致。

离线阶段阻断网络，使用本地脚本适配器及合成 usage。在线阶段仅复制指定 NAIZHI_API_KEY 引用到测试凭据文件，只允许 naizi.stream；密钥未打印或交付，结束后删除测试副本。不交付可能含私有推理的完整原生日志，只交付公开测试资料、最终答复、数值用量及审计收据。日常进程未被停止或安装候选。

### 验证层级

| 层级 | 结果 | 边界 |
| --- | --- | --- |
| 单元、模拟、真实 SDK 组合 | 281 项：280 通过、0 失败、1 环境跳过 | Windows 目录链接既有权限限制；另有 3 项模型驱动离线检查 |
| 既有离线业务检查 | 66 项通过 | 不代表真实业务模型质量 |
| 最终 TGZ 的独立 profile core/resume/disabled | 55 / 16 / 5 项 | 本地脚本模型、真实后端；最终机器记录须通过才计入交付 |
| 真实 naizhi 小样本 | 实际工具调用与原文检索成功 | 原生 pi-ai，无脚本模型替代 |
| 真实 Max 双路线 | 报告交付失败 | 8K 规划预算耗尽；一次提高到 32K 后，两 worker 报告仍耗尽输出预算；未继续盲目重跑 |
| 六轮真实任务＋冷恢复 | 双方完成六轮并保留关键事实，初始严格最终交付均失败 | 格式／逐字引用／来源 ID 仍需返工 |
| 一次额外修订 | 原版 12/12；新版 10/12 | 新版冲突 ID 使用内部标识，非要求的公共资料 ID；保持失败 |
| 桌面 UI、完整 sandbox／审批／普通子代理组合 | 未验证 | 后端验收不能替代桌面验证 |

### 真实宿主机械检查

关闭、手动辅助、手动两路保持原选择；主 Agent medium，研究／decision Max；worker 无 write/run_code，最终执行归 decision。全局测试门限限制所有模型流合计并发为 2，历史rc.2各在线进程顺序启动，不是仅设worker数为2；当前rc.3同步对照改为每臂门限1、合计不超过2。

worker 工具生成 62,452 字符原文，宿主投影、进展和报告遗漏尾部。decision 经实际 search/get 取得尾部并核对稳定 ID；第二路线相反原文及未决冲突在冷恢复后保留。同项目无关根、其他项目和伪造 Agent 被执行器拒绝。一次捕获失败后 checkpoint 从原生日志增量补回，重复登记幂等，跨进程恢复保留原始 runId。

完整序列化检索返回受预算限制；次数预算在 adapter 调度前阻止新请求。方向区分 queued、admitted、request-visible；资料进入请求不等于模型采纳。真实取消完成 checkpoint 与清理。写入失败是明确注入的拒绝，不冒充断电或物理磁盘满。

压缩探针用明确标识的历史协议 fixture，随后进入实际 AgentLoop pre-step。native token-meter surface 估算 43,599 → 935；172,910 字符原文以相同 SHA256 回读。另一 compactor 已存在或等待中出现时拒绝第二所有者。提交后 checkpoint 拒绝以相邻补偿事件恢复完整原文，43,599 → 43,599，并通过冷进程重放。这是本地估算，不是模型账单。

### 真实模型与对照

用户指定 naizhi / deepseek-v4.1-flash / openai-completions，经原生 pi-ai 访问 https://naizi.stream/v1。仅在测试 profile 补充 deepseek reasoning 映射 medium→high、Max→max，未降低原 Ultra Max 行为。参考 [官方 thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) 与 [Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)，第三方通道仍以实测为准。

真实双路已调用 memory_search/get，但未交付有效报告。随后同根会话冷恢复，不重开 worker，经已有授权历史来源读取真实 199 字符工具片段并完成事实交付。原驱动曾把进展拼入最终 JSON、且误要求片段必须大于 50K；离线修正评分单独保存，原失败未覆盖，没有额外模型请求。该片段不能证明完整大输出已保留。

六轮对照：同冻结 fixture、同六条提示、主模型 medium、16K 输出预算、辅助模式和两份约 160K 字符真实工具结果；三轮后关闭进程，再恢复原会话完成后三轮。原版为 ecf056f / 0.4.0-rc.3 干净构建。新版开启本地 30K 目标压缩；原版使用 compaction-basic（1M 模型窗口）。这是功能条件差异，不能作为纯因果 A/B。

新版实际产生两次 native prune，各旧工具正文约 40K 估算 tokens。重启后早期“协作”限制、批次、校验码、双方窗口、待确认 footer 和“已执行、未验证”状态均可取得，重复执行哨兵为 0。原版也保存这些事实。双方最终轮通过 fixture_read 定点回读两份尾部；新版该轮没有用 memory_get 回读两份完整压缩前来源，不能用机械验收结果冒充本样本的主动索引取回。

双方初始最终答案均有 JSON 外解释或引用问题，严格检查失败。各追加同一条不含答案值的修订提示，只一个原生用户轮次：原版 12/12；新版 10/12，冲突 ID 使用 A-/B-内部标识。返工各 1；不放宽评分、不无限续测。新版修订使用包含用量修复的新构建，包哈希另行记录。

30K 是软目标。保护近期消息、硬约束、系统和工具可使实际请求超过目标；本例主请求用量曾约 71.9K。取消或失败的全零／缺失 usage 为未知，实测与估算分开。数值是提供方报告的已知 token 下界，非完整费用；不推算日卡账单，不叠加根会话 usage 与流 usage。

逐案例、路线、调用、token、耗时及返工见 model-verification.json、真实模型对照.md。没有完整历史基线；一个受控样本不能证明总体节省、长期能力无损或优于原版。

### 修复、复跑与限制

本轮修复取消信号、动态 compactor 检查、子会话失败补扫与冷恢复、虚假覆盖缺口、语义失败误判原文耐久性、提交后失败补偿、按 kind 检索原始工具证据，以及取消全零 usage 被误计免费。均有回归测试。

运行 npm ci --ignore-scripts、npm run build、npm run typecheck、npm test、npm run test:benchmarks；离线长序列为 scripts/memory-regression.mjs。真实 Loader runner、网络阻断在 scripts/host-acceptance/，真实模型公开 fixture／评分器在 real-model/。验收组件默认不加载到生产插件，不含凭据；在线复跑须显式配置 provider、预算及全局门限。

TGZ、源码 ZIP、补丁和中文文档来自同一源快照，构建文件逐一核对。索引保持 .dsh-ultra/v1，无破坏性迁移；旧 grant 缺少 runId 有兼容回退。evidenceEnabled=false 关闭新系统，contextCompression=false 单独关闭压缩；保留旧包／profile／原生日志可回滚。该历史阶段未发布Release、未安装日常环境；仓库提交与发布状态需分别核对。

该历史阶段的Max报告与精确来源失败继续保留，当前rc.3新增的通过与返工结果以上文为准。桌面UI、完整权限组合、更多业务样本及异常断电仍未验证，不承诺信息或能力绝对无损。
