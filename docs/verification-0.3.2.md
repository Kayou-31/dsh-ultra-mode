# 0.3.2 验证记录

目标宿主为 DSH Desktop / Host 0.2.0-rc.2。0.3.2 新增主 Agent 辅助模式和 2 路并发，保留 3/4/5 路与默认并发数 3。正常主 Agent 辅助核心机制和最新规划修复的两路核心验收均已通过。正式版验收条件已满足，准备按正式版交付；GitHub CI、最终包核对、Release 创建与上传尚待发布流程执行，不能提前记为已完成。历史失败与实际限制继续保留。

## 展示与消耗声明的边界

并发 Ultra 的内部 worker、child 和运行中 decision 不在主会话中逐路、逐步展示，用户主要看到最终交付阶段的宿主展示与文本结果。源码中的 `outcomeOf` 仅提取 text，不能据此声称最终 decision 的内部真实思维链会被逐字显示。可见普通主 Agent 转述时是否展示思考，取决于它自己的请求和宿主；这不能替代内部路线的过程观测。辅助模式保留主 Agent 的普通执行过程，只有旁路 decision 不逐步展示。

README 开头的“每多一路约增加 125%”是用户提供的粗略 Token 预算参考，不是插件实测的固定倍率，没有生成复利公式。实际消耗随上下文、工具步骤、child 和协调轮数变化；本版本没有提供预算计量或费用保证。

## 模式与入口设计

| 入口 | 语义 | 实际执行与交付 |
| --- | --- | --- |
| `/ultra assist`、`/ultra 1` 或辅助按钮选项 | 普通主 Agent 加独立只读 Max 决策辅助；`1` 是模式别名 | 主 Agent 保留当前模型、provider、preset、思考强度、工具权限，处理执行、写入、子代理和最终交付。辅助只提供运行中判断与建议。 |
| `/ultra 2/3/4/5` 或相应并发按钮选项 | N 个独立 Max worker 加 1 条 Max decision，decision 不计入 N | worker 研究与派普通子代理；decision 规划、运行中协调，最终统一实施和交付。 |
| `/ultra on` | 恢复当前选项；新会话首次开启默认 3 路 | 继续当前选择的辅助或并发模式。 |
| `/ultra off` | 后续真实用户任务不再自动启动 Ultra | 普通 DSH 主 Agent。 |

设置按会话隔离。更改运行中的选择只作用于后续任务。普通用户任务由宿主自动触发；并发模式的手动 `ultra_task` 入口继续受递归与内部路线守卫限制。辅助模式不把主会话降为最终答案转述者，不通过副作用工具实施任务，也不替代主 Agent 的原生子代理能力。

状态与配置沿用 `enabled` 和 `concurrency`，不增加 `mode` 字段：`concurrency: 1` 为辅助，`2..5` 为对应并发 worker 数，上限保持 5，默认保持 3；`enabled: false` 为关闭。关闭保留当前选项，开启恢复它。`1` 不表示单个 Max worker 接管任务。按钮继续独立于 DSH 滑轨和思考强度选择器，采用实色背景。

运行中建议使用宿主原生下一模型步骤通道，已发出的模型请求不能被中途改写。辅助绑定当前用户任务的主 Agent turn，主 Agent 完成或取消后停止副决策，不额外唤醒主 Agent；主 Agent 不进入并发模式的 `deliveryOnly` 限制。辅助和并发模式的 API 行为应分别核对：状态与按钮/命令的一致性、保持普通主 Agent 设置、只读辅助权限、真实用户任务边界、建议串行与停止清理。以上是设计与验收目标，不作为已通过的测试数。

辅助核心的 API 设计为：创建独立只读 Max decision 后启动初始 JSON 检查；其后监听主 Agent 工具返回、完整助手文本与本次创建的原生 child 进展，串行限频并仅在新进展时运行。反馈的消息来源为 `kind: ultra-assist`、`form: feedback`，通过原生 steer 送往仍运行的原主 turn 下一 step；消息入队不是实际采纳证据。父 turn/end、下一 turn/start、原 signal 取消、超时或显式停止立即禁收并取消 decision，完成清理等待其运行和 dispose，不取消或 followup 主 Agent。

辅助模式不调用 Jev，不接管最终实施和交付。`coordinationMaxRounds: -1` 不限；辅助的正数限制 `decision.run` 调用预算，单轮格式修复也消耗一次，`0` 仅允许一次初始 run，上限 1 不做修复。辅助摘要 `rounds` 统计逻辑检查轮数，格式修复不再加一轮；一个 run 内可有多次 provider/model 请求或工具步骤，因此此配置不是底层真实模型请求数上限。并发模式仍限制逻辑协调轮数，`0` 关闭运行中协调、保留规划与最终决策。下面将目标回归、SDK fixture 与真实候选运行分开，不根据源码描述或 fixture 结果宣称实际 DSH 已通过。

## 本机构建与目标回归

最新严格规划修复后的 0.3.2 构建及 host/client 严格 TypeScript 检查通过，退出码 0。普通 JIT 下执行以下 6 个目标测试文件，共 **97/97** 项通过，无失败、取消或跳过，退出码 0；其中辅助仍为 15/15。此前待消费反馈清理阶段为 88/88、辅助 11/11，辅助协议修复阶段为 92/92、辅助 15/15；本轮新增 5 项规划回归，没有修改辅助模块：

```sh
node --test test/assist.test.mjs test/client.test.mjs test/jev.test.mjs test/orchestrator.test.mjs test/plugin.test.mjs test/ultra.test.mjs
```

辅助收尾跟踪本运行反馈的 message ID，收到持久 user/message 准入事件后解除待消费追踪。stop、turn/end、abort 或下一 turn/start 同步禁收、移除监听并 abort decision，再将剩余本运行消息的 public inbox 清理排入 microtask；保留人类消息、其他运行消息和已准入历史。`done` 与 factory 失败路径等待清理，清理失败记录并 reject，不误报完成。达到有限预算只停止新 decision run，不立即 dispose 运行所有者；当前建议仍可在原主 turn 消费，最终随主生命周期清理。

此前 3 项 inbox 回归核对 blocked/error 收尾、有限预算消费及显式停止/abort/new-turn 清理，并模拟 SDK 在 session/event 发布期间禁止重入 append 的契约。本轮 4 项新增协议回归核对：非法输出后一次修复成功、修复仍非法不入队且不循环、修复在途时父 turn 结束或取消、有限预算包含 repair。严格 JSON、长度、类型、字段与目标身份校验保留，不从杂文本或多个对象中挑出看似正确的片段；原错误不吞掉。

内置辅助提示词进一步明确：工具过程中可用自然语言，但最后一条助手回复只能是单个 JSON 对象。发生协议错误后，仍在活跃父 turn 且剩余预算允许时，同一 decision 上下文最多 repair 一次，只提供有界具体错误和格式要求，不回放非法全文为可信指令；repair 再次失败如实记录。本轮审批修复提高可见主会话桥的 source 优先级，使请求的上下文、subject、身份与请求 agent 都归到可见主会话；原调用 decision/child 的审批策略、取消信号及 asked/decided 审计仍保留。

本轮规划解析改为单个严格 JSON 对象，只允许 `assignments` 字段，数组数量必须等于执行路线数，每项必须为非空字符串。非法规划在原 decision 上下文中最多修复一次；第二次仍非法或 repair provider 请求失败，则按稳定的宿主路线索引降级，明确保留用户指定的每路动作，不再将某一路通用分配为只审查而省略其必做工作。首次 provider 请求失败仍终止任务。规划和 repair 错误如实附入最终交付；不把父路线算出的数值冒充要求的真实 child 结果。

更早的实际 SDK 集成 `test/runtime.test.mjs` 当时包含 4 项断言，普通 JIT 与 `--jitless` 各尝试一次，共两次；每次断言均通过，但各次 SDK 子进程退出均失败：普通 JIT 出现 V8 `node->IsInUse` 致命错误，`--jitless` 尝试只报告测试文件失败。因此不将其记为“4/4 命令通过”。本轮新增审批场景后，文件共 5 个测试，只单独运行了新增目标；没有重跑或宣称整个当前 SDK 测试文件及全套 `npm test` 成功。

## 实际编译 SDK 的离线烟测

直接使用本机 DSH 的实际编译服务、插件 apply、原生工具运行时、AgentLoop、registry 和 session 运行独立烟测。以下既有两路烟测运行于审批桥修复之前，辅助完成/取消及 inbox 探针运行于 microtask 清理修复之后、辅助协议 repair 之前；它们不是最新源码的全量重跑。审批与辅助 repair 定向场景属于下一修复阶段，最新规划 repair 单场景另列在下方。全部模型回复由离线脚本 adapter 生成，没有调用真实模型/provider，没有启动或控制 DSH 应用，没有网络请求。模拟 write/pwsh 验证权限与调用路径，不是实际业务文件写入或命令执行。公开聚合证据见 [SDK 验证摘要](sdk-verification-0.3.2.json)。

**2 路并发，native 呈现：**实际创建 3 个独立 loop（2 worker + 1 decision）、2 个普通原生 child，配置均为 Max。2 条改向各有持久 user/message、原生 next-step 准入与下一模型请求可见证据；没有额外 worker turn。研究 schema 受限，唯一模拟 write 在最终 decision，最终工具呈现恢复。内部 registry、session 和 fixture stream 均为 0。这个烟测证明通道与生命周期，不证明真实模型能产生有用方向。

**主 Agent 辅助，native 呈现：**完成与取消两组场景各包含 1 个普通主 Agent、1 个只读 Max decision、0 个独立 worker 和 1 个普通原生 child。主 Agent 的 write/pwsh schema 与普通子代理能力保留，辅助没有接管其执行或交付。

完成场景中，模拟 pwsh、write 和最终交付仅由主 Agent 执行；decision 实际调用 write/pwsh 被运行时拒绝，read 调用成功。1 条 `ultra-assist` 反馈入队并持久准入，后续 3 个主 Agent 请求在同一 turn 看见反馈。主 turn 结束时，仍运行的 decision 请求被 abort，此后没有额外唤醒主 Agent。取消场景未产生已接受或准入的反馈，主 turn 为 aborted，辅助退出。两组最终 registry、session 和 fixture stream 均为 0。

**辅助待消费 inbox 独立探针：**初次运行失败，实际 SDK 在 turn/end(error) 的同步 session/event observer 中调用 inbox remove，会触发 session.append 重入，待消费反馈未被清除。原 unit harness 没有模拟这一契约，因此其通过没有证明该路径。修复后把清理延后到 microtask，并等待清理完成；第二次探针通过、退出码 0。它通过真实 SDK 的结束与 inbox 管线触发，不伪造 turn/end 事件。

| 独立场景 | 实际 SDK 脚本 adapter 与状态证据 |
| --- | --- |
| 错误结束 | adapter 抛出实际 `LlmError`（`OFFLINE_FIXTURE_ERROR`），SDK 产生 turn/end(error)。本运行反馈 queued 1、admitted 0、持久 discarded 1；人类 next-step 与其他来源 next-turn 消息保留。 |
| 显式停止辅助 | 本运行待消费反馈清除，人类与其他来源消息保留；主 Agent 仍为 running，随后才由 fixture 取消它。辅助没有取消或唤醒主 Agent。 |
| 辅助上限 1 | 保持超过 150 ms，辅助尚未 done、反馈仍待消费且 decision 只有 1 次 run。此脚本场景的主 Agent 共 2 次模型请求，turn 1 的第二次实际 SDK adapter 请求看见建议；admitted 1、discarded 0，主 Agent只有 1 个 completed turn。 |

以上 3 个独立场景中，decision 均为只读 Max，主 Agent 的 medium 设置保留；每个场景内部 agent/session 清零，root dispose 后全部 registry/session 清零，fixture stream 为 0。各行只报告该场景适用的检查，不跨场景推定所有字段为真。该证据证明真实 SDK 的反馈消费与收尾契约，不证明真实 provider/model 的建议采纳。

这些检查是实际 SDK 的脚本模型集成证据，区别于 `test/runtime.test.mjs` 的退出失败，也区别于实际 DSH 窗口和真实模型验收。辅助的入队/请求可见证据不等于真实模型已采纳建议，模拟交付不等于用户业务任务通过。

## 各修复阶段的定向 SDK 检查

**审批桥：**实际 AgentRegistry scope、ApprovalService 和 ApiRemotes 转发场景通过，目标测试 1/1、退出码 0。全局 remote source 先注册时仍选择可见主会话桥，请求上下文、subject、身份和 request agent 一致；原 decision 与普通 child 的策略、取消信号及审批审计保留。分别观察到拒绝、取消、`never` 策略和无回答方时 fail closed，没有授予审批；结束后 source/stream 关闭，agent/session registry 为 0。此单场景通过不把旧四项 SDK 测试的退出失败改记成功，也不代表完整 `npm test` 通过。

**辅助协议 repair：**实际编译 SDK 与脚本 adapter 的 3 个独立场景通过，进程正常退出。每个场景均为普通主 Agent加 1 个只读 Max decision、0 worker，主 Agent medium 设置保留，协议错误保留，最终 registry/session/stream 为 0。

| 场景 | 最新实际 SDK 证据 |
| --- | --- |
| 上限 2，非法后修复成功 | 初始多对象输出不入队，同一 decision 的第二个 turn 进行一次 repair；decision run 2、repair 1、逻辑协调轮 1。有效反馈 queued 1、durably admitted 1，原主 turn 1 的第二个实际 SDK adapter 请求看见建议，主 turn completed。 |
| repair 在途取消 | 真实 root.cancel 使原主 turn 1 aborted；即使释放迟到的有效 JSON，queued/admitted 均为 0，原主 Agent 不重启，清理完成。 |
| 上限 1 | 初始非法输出保留错误，仅 1 个 run，没有 repair，queued/admitted 均为 0；普通主 Agent正常 completed。 |

上述检查没有真实模型、网络或 DSH UI。它们验证本轮修复的 SDK 协议、路由与生命周期，不能替代修复后的真实模型复验。

**最新规划 repair：**新增的实际编译 SDK 离线单场景通过、退出码 0。初始 `assignments` 类型错误，同一 decision 的第二个 turn 修复为严格 JSON，再进行协调与最终实施；同一身份串行完成 plan、repair、coordination、final 共 4 个 turn。2 条独立 Max worker 为 depth 0，各真实调用 1 个普通原生 child（origin subagent、depth 1）并完成；fixture stream 峰值为 3。两路方向均有持久准入、同一 worker turn 1 的下一实际 SDK adapter 请求可见证据，没有额外 worker turn。研究与协调阶段的 write/pwsh/run_code 被拒绝，只有 final 的模拟 write 成功，原工具呈现恢复；registry/session/stream 最终为 0。

该新场景调用实际 SDK，但模型与 write 是离线脚本 fixture，真实 provider、网络、DSH UI 调用均为 0。此前审批桥、辅助 repair、inbox 及旧两路 SDK 烟测保留各自阶段；新规划单场景通过不等于最新源码的全量 SDK 重跑，也不改写完整 runtime 文件的旧退出失败。

## 真实模型、界面与发布边界

独立 React 18 Chrome fixture 已实际检查菜单：关闭、Agent + 决策、2、3、4、5 共 6 个选项可见；点击辅助后状态快照为 `concurrency: 1`，再点击 2 路后为 `concurrency: 2`。将宿主菜单颜色 token 的 alpha 设置为 0.55 时，浅色模式下检查到的各背景 computed alpha 和 opacity 均为 1，菜单截图已生成。这是实际浏览器中的插件 UI 检查，没有操作 DSH 原生窗口，没有调用真实模型；聚合结果也包含在公开 SDK 摘要中。

用户手动运行的已安装 0.3.2 候选包（SHA256 前缀 `f00587f2`）已留下真实模型证据。它早于审批桥、辅助格式 repair 与最终待消费清理修复，不能当作当前源码的复验。严格恢复日志后的公开聚合结果见 [真实候选失败摘要](real-model-0.3.2-candidate-summary.json)。

| 真实候选模式 | 已有能力证据 | 整体验收结果 |
| --- | --- | --- |
| 2 路并发 | 2 个独立 Max worker 加 1 个 Max decision；2 个真实普通 child 的结果为 14、30；9 次协调、6 条持久消息准入。准入不能直接计为 6 次正确采纳。 | **失败：**最终 decision 审批超时，未完成要求的最终写入与交付。 |
| 普通 Agent + 决策辅助 | 主 Agent 仅 1 个 completed turn、0 个额外 turn；普通 child 真实完成结果 140；主 Agent 写入、读回并交付，旁路同一只读 Max decision 完成 6 轮，主 turn 结束后下一轮被取消。 | **失败：**6 个完整回复全部非法 JSON（1 个字符串语法错误，5 个尾随内容/多个对象），feedback queued/admitted 均为 0，没有真实反馈采纳；任务范围也违约。 |

辅助候选的任务明确禁止命令及指定文件外搜索，主 Agent 实际调用 2 次命令；旁路进行了宿主安装区搜索、其他项目目录搜索和 repo-wide 搜索。旁路仍只调用 read/grep/glob，没有写入、命令或联网；这只证明只读工具边界，不证明遵守了任务路径范围。主 Agent 的首个输出写入被原权限拒绝，同操作一次审批后成功，不将该拒绝隐去。最后一个旁路 turn 因主任务结束而 aborted，其不完整文本不计为第七个协议失败。原始模型请求正文未留存，不能把上下文元数据或入队推定为抓包证据。

审批与辅助修复包（SHA256 前缀 `a7c78e0a`，早于最新规划修复）已经完成用户手动真实复验。根任务严格恢复指定日志，两次独立审核的公开聚合结果见 [修复阶段真实模型摘要](real-model-0.3.2-recheck-summary.json)。

| 真实复验模式 | 已通过的机制和交付 | 保留的失败或边界 |
| --- | --- | --- |
| 普通 Agent + 辅助 | 原主 turn 1 completed、0 额外 turn；1 个真实普通 depth-1 child 完成 140 和指定标记。只读 Max sidecar 同一身份串行完成 7 个严格有效 JSON 回复，7 条反馈入队、消费、同 ID 持久准入于原主 turn，并有后续模型输出与工具行为。一次审批后同文件重试成功，实际读回 9 行记录、交付标记。 | 辅助核心机制通过，但七条建议 97～182 字符，全部超任务要求的 80 字。输出只选记 2 条；其中第 1 条有明示采纳及数值/标记核对，第 2 条写入/读回行为相符，但目录存在性检查早于其准入，不归为由它触发的新检查。 |
| 2 路并发 | 2 个 depth-0 独立 Max worker 加 1 decision，活跃区间重叠约 13.351 秒；两路普通子代理 schema 均存在。审批 allowed-once，等待 1.234 秒；最终唯一文件实际写入、6 行读回，主 turn completed 并交付。 | **整体失败：**第一路真实 child 完成 14，第二路 0 次 child；非法规划触发通用降级，第二路误当只审查角色，用户每路职责未完成。工具隐藏或权限拒绝说法无证据。决策额外递归项目文件名 glob，超出输出存在性检查范围。 |

辅助最后第 8 轮在主 turn 结束时 aborted，其截断文本不计协议失败；7 个 completed 回复均有效，0 次协议 repair，结束时待消费反馈为 0。主 Agent、辅助与 child 没有命令、联网或额外子代理；主 Agent 仅在允许的 outputs 目录做存在性 glob，辅助 0 工具调用。其任务中的原生沙箱根仍与用户指定项目目录不同，因此主 Agent 正常发起一次输出写入审批，不隐去这一边界。该真实运行没有未消费反馈，不能代替 inbox purge 的独立离线边界证据。

两路原 decision 完成 plan 1、coordination 2、final 1；有一条改向回复晚于目标 worker 完成约 5.144 秒，未准入、未采纳，也未额外唤醒。父路线或最终决策的算术复核不能代替第二路没有创建的 child。上述活跃区间是 SDK 运行时事件时序，不是精确 HTTP 并发时序或网络首输出测量。

上述 `a7c78e0a` 是保留的阶段记录，不能将其第二路没有 child 的失败改写为通过。辅助模块在后续规划修复中未改；用户不必重跑已验证的辅助核心机制。最新两路真实结果见下节。原始请求正文未留存，后续消息准入和行为核对不称为抓包验证。

## 最新规划修复的真实最终验收

用户完成 SHA256 前缀 `701fbd1b` 的两路真实任务。根任务对指定 6 个日志核对稳定快照、Zstandard 校验及官方 current/strict 恢复，并核对实际输出文件；独立 worker 审计补充工具 schema、调用、父子账本、子会话完成结果与父工具返回文本的一致性。公开结果见 [最终真实验收摘要](real-model-0.3.2-final-summary.json)。**两路核心验收通过**，同时不把任务格式细节与完整长期稳定性推定为通过。

| 实际执行层 | 最终证据 |
| --- | --- |
| 两个独立 worker | origin 非 subagent、depth 0、Max，保留相同 11 个实际工具 schema，包括普通 subagent。各恰好一次前台普通 child 调用；第 1 路额外一次 list_agents(children)，不是新委派。两路没有命令、联网、读写或搜索工具调用，没有额外 turn。 |
| 两个真实普通 child | 各自 origin subagent、depth 1、Max，父路线 catalog 与 child header 匹配；均 completed，结果分别 14/30、标记匹配，0 工具调用、0 再下探。子会话最终助手文本与父路线 subagent 工具返回逐字一致。 |
| 父路线独立复核 | 第 1 路逐项累加，第 2 路闭式公式复算，均在 child 结果真实返回后进行并匹配。前台返回不暴露 ID，由账本恢复身份，不额外派 child 补 ID。 |
| decision 与主会话交付 | 同一 decision 串行完成 plan 1、coordination 3、final 1，共 5 个 completed turn。正常权限下写入先拒绝，同目标同内容仅升级重试一次，经一次 allowed-once 审批后成功；10 行记录的工具读回、实际文件与 write content 逐字节一致。主会话 completed，最终标记与路径交付，没有重复工具。 |

首轮 `assignments` 严格 JSON 有效，保留两路各一真实 child 的固定职责；本次真实运行没有触发规划 repair，repair 和再次失败降级的证据仍来自目标回归与离线 SDK。3 次协调均为空方向，proposed/accepted/admitted steering 为 0，不能把这个无冲突短任务写成新的运行中改向采纳证明；相应能力使用历史长任务和辅助实测的独立证据。

两路独立 loop 活跃区间重叠 9377 ms，主任务为 50314 ms；审批 asked 至 allowed-once 的日志间隔为 11057 ms。前两者属于运行时事件时序，未独立测得精确 HTTP 并发、网络延迟或首输出时序。实际继承的 workspace policy 仍指向原 C 盘工作区，授权的 D 盘输出正常走一次审批，没有更改原权限。审批显示路径与最终文件成功是日志及实际文件核对证据，不是自动控制 DSH 窗口的证据。

存在性检查先精确 read 目标，再对 outputs 做了非递归 `*` 列表，没有只使用精确文件名匹配，保留这一任务偏差。没有递归 repo glob、源码内容读取、其他目录搜索、命令或联网，decision 没有新 child。本次输出是一次成功写入，正常拒绝不隐去。

最终交付收尾只更新文档，发布检查将核对正式包编译文件与已实测 `701fbd1b` 一致；不声称文档更新后的新 TGZ 整包 hash 曾被真实模型运行。97 项目标测试、构建和类型检查使用已完成证据，不为文档修改重新运行。用户无需再测试。

当前自动化工具阻止 DSH 原生应用和现有 Web 界面的访问。未更改端口、另启宿主应用服务或使用其他通道绕过阻止。源码、构建、离线 fixture 与独立浏览器页面的验证，不能替代实际 DSH 窗口或真实模型验收。

历史 0.2.0 的 3/4/5 路实测和 0.3.0 的五路算术及长任务证据继续有效于各自已测试版本。0.3.0 长任务中 5 个独立 Max worker 共调用 6 个真实普通子代理；同一 decision 完成 1 次规划、21 次协调和 1 次最终交付。17 条方向指令均有准入链路和同 turn 后续真实模型步骤，仅 3 个实际采纳案例另做独立行为核对。历史任务的 repo 外只读越界、两名后台 child 晚于首次 worker 报告完成及无原始请求正文的边界仍保留，不因新增模式而改写。

0.3.1 只补协调提示词的既有长度限制，是未发布的中间历史，没有正式发布或新增真实模型证据。详细历史见 [0.3.1 验证记录](verification-0.3.1.md) 与[公开脱敏 0.3.0 摘要](real-model-0.3.0-summary.json)。新模式不能借用这些历史结果宣称已经实际通过。

Jev 真实账户调用、重复长任务稳定性与未来宿主版本兼容性仍未验证。0.3.2 核心正式版验收已通过，预期发布状态为 stable，不是 prerelease；CI、最终产物一致性、tag/Release 创建与上传结果由后续发布记录确认。辅助建议长度偏差、历史失败、前台 ID 可观测性及无原始请求正文边界仍保留。0.3.1 没有 Release。
