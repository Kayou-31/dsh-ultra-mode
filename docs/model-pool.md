# 普通协作多模型子代理池

适用：**0.6.0-dev.1 本地开发检查点**，DSH **0.2.0-rc.2**。尚未发布；不把旧版在线成绩视为本功能成绩。

## 使用

1. 在 DSH 原有模型设置中配置 provider、模型与凭据。Ultra 不另存密钥或新增服务地址。
2. 在输入区“协作”旁打开“模型池”（窄屏“池”），从宿主目录添加候选。下拉同时显示名称、provider、实际模型ID，同名模型不混淆。
3. 填稳定ID、名称、启用、擅长／适用／不适用、默认、并发及可选参数；保存通过宿主 Settings／ConfigEditor 写入当前 profile。
4. `/team on` 后提出任务，主 Agent 用原来的协作链委派，例如：

```json
{
  "task_name": "audit-auth",
  "message": "只读检查鉴权边界，提供证据和未验证项，不修改共享文件。",
  "model_config_id": "review",
  "model_reason": "该候选适合独立审查鉴权边界"
}
```

5. 面板记录与 `ultra_list_agents` 可核对任务、候选、选型来源、理由、状态和可用用量。面板重新打开时刷新，不额外调用模型评选或总结候选。

当前SDK缺少通用工具能力标记，使用自己的候选前需明确勾选允许试用未验证工具兼容性；跨provider委派还需相应授权。示例保留false以便你核对后决定，不能原样当作已验证配置。

子代理支持原生工具调用：**模型 tool-call → ToolRuntime 校验执行 → 结果进入子代理后续请求**。只继承父 Agent 实际可见且可继承的工具，不因换模型获得新文件、命令、审批或会话权限；`run_code` 仍不进入新增协作委派的继承列表。原生深度限制保持。

## 优先级与回退

**配置用户固定ID > 主 Agent 选ID > 启用的默认候选 > 明确允许的原生继承回退。** 空池且未指定ID时完全沿用旧创建规则。界面的“用户固定候选”对应 `explicitModelId`；切回自动会清除旧固定值。工具没有可自行声称用户授权的标志。自然语言指定仍由主 Agent 遵守；需要宿主强制固定时用配置界面。

不存在／禁用ID、缺少简短选型理由、非法参数、并发满额和预算耗尽都有明确拒绝。`fallback=error` 默认不换模型。`default`／`inherit` 仅授权**创建预检失败**时一次有记录的回退，可能改变成本；用户固定选择失败不回退。运行中API或工具失败不自动换模型或重放任务，避免重复执行。候选快照连续预检或运行失败达 `failureLimit` 后停止重新派发，修改候选或重启插件后重新核对；取消不当作供应商失败。

续作使用原模型快照并重新取得活动配额。池中子代理经原生委派创建的后代也受同一配额、请求预算与快照约束，不能绕过池限制。宿主自身的深度和活动子代理上限仍会再次检查。

本轮仅改**普通协作**。主 Agent、Ultra worker、decision及辅助decision的模型保持原值，它们原有的委派选模方式保持原值。从普通主 Agent 直接调用原生 `subagent` 工具仍用该工具自己的配置；新增池不会静默接管它。

## 配置

字段位于既有插件条目的 `config.collaborationModelPool`，可复制 [profile 示例](model-pool.example.yml)。整个字段为宿主 volatile 配置：只改池不卸载插件，新建实例读取新快照；活动实例及后续续作保持旧快照。同时改其他普通字段或升级代码仍可能触发宿主正常重载与取消。

| 字段 | 含义 |
| --- | --- |
| `models` | 0～32个候选；空数组保留原有继承 |
| `models[].id`、`name`、`enabled` | 稳定唯一ID（1～64位）、显示名、启用状态 |
| `provider`、`model` | 宿主已配置的精确路由，创建前重新查宿主目录 |
| `strengths`、`suitableFor`、`avoidFor` | 用户声明，分别最多2000字符；不作为技术兼容性证明 |
| `reasoningEffort` | 可选，必须在精确模型的宿主 reasoning.efforts 中；未知则拒绝 |
| `maxTokens` | 可选单请求输出上限，正整数；不能从默认值推断供应商硬最大值 |
| `isDefault` | 最多一个启用的默认候选 |
| 候选 `maxConcurrent` | 同时活动实例上限，默认1；续作也占额度 |
| `allowCrossProvider` | 默认false；配置用户明确允许向不同于父请求的provider发送子任务数据 |
| `allowUnverifiedTools` | 默认false；允许试用未知工具兼容性，勾选仍不代表已验证 |
| `costNote`／`speedNote` | 可选说明；标实测时填写测试来源、条件、时间 |
| `costSource`／`speedSource` | `user`或用户提供记录的`measured`；插件不将填写自动认定为独立实测 |
| `explicitModelId` | 用户固定ID，空字符串取消固定 |
| `fallback` | `error`（默认）、`default`、`inherit`，只作用于创建预检 |
| 池级 `maxConcurrent` | 本插件实例中普通池总活动实例上限，默认2，跨普通协作组共享 |
| `maxRequests` | 每轮普通池原生请求准入次数预算，默认0不增加上限；含池内原生后代 |
| `failureLimit` | 连续失败阈值，默认3，范围1～100 |

只桥接这条原生链支持的 effort 和 maxTokens；`temperature`、任意JSON参数、URL、密钥、工具列表等旁路字段会被拒绝。留空时显式清除父 effort／输出cap，采用目标模型默认值；目标没有默认值则保持未设置，实际请求仍核对。

`maxRequests` 不包含主 Agent、Ultra路线或其他profile；池并发也不是供应商账户级全局并发。0表示不增加本模块上限，不代表无限费用授权。宿主原策略始终有效；本轮不实现美元预算或全账户总token预算。

## 兼容性与可核对记录

创建前核对候选、精确路由、输入类型、思考档位、跨provider授权及配额；适配器调用前再次核对最终provider／模型、effort／cap、实际图像、工具和请求预算。未声明输入类型表示未知并拒绝。

当前SDK没有通用工具支持标记，因此未知默认拒绝，用户明确允许后才尝试。真实成功工具结果记为 `observed-native-tool-result`，仅证明该实例至少一次原生工具链成功，不证明全部工具或供应商API协议兼容。只支持文本的模型也不能在后续工具返回图像后绕过输入检查。

记录中的解析／创建成功是 `pending`；组装请求通过守卫后才为 `observed`／`actual`，不表示供应商已执行、模型已采纳或业务已验证。用量是adapter报告；未知、尚未结算、已报告分开，不把估算当实测。测试适配器的token是人工测试值，不是账单数据。

配置唯一权威是宿主profile；选模审计唯一权威是原有 **`.dsh-ultra/v1` EvidenceStore**，界面是读取视图。审计类型 `collaboration/model` 仅存公开任务、选型、状态和消耗元数据，不复制完整历史或私有思维链；沿用项目／父会话边界、原子写、分块与SHA。DSH rc.2不安全支持这类外部Session事件，本实现不向原生会话写未知事件，原生JSONL仍可恢复。

适配器前先持久化“请求已观察、用量待结算”；终态与结算再写入。结算写入失败会显示 `recordingError`，不能把内存记录当作已耐久保存。中途崩溃保留为尚未结算，不推断最后费用。取消等待原生drain；若drain失败，残留实例保留额度及拒绝新请求的守卫直到实际销毁。配置描述、历史与工具输出都是资料，不增加授权；模型没有池配置写工具。

## 验证边界

分别验证纯逻辑／工具适配、React表单、真实rc.2 SDK AgentLoop＋ToolRuntime＋子代理＋JSONL，以及独立CLI Loader／Settings／ConfigEditor profile。两个provider同名候选均实际发出工具调用，由真实ToolRuntime执行，结果进入后续实际请求；热更新、用户固定、续作快照、权限、深度、取消与证据审计另有测试。CLI核对热更新不卸载、原profile文件落盘与进程重启恢复。精确数量、执行命令及包哈希见本轮交付验收文件。

**未验证**：真实多provider在线模型、供应商工具协议、Electron桌面面板、桌面审批全链、异常断电及账户级费用上限。没有读取已清除的naizhi凭据、在线长测或操作日常DSH；旧版真实模型成绩不移植为本轮成绩。

## 迁移、回滚与扩展

旧profile无需迁移，新增字段默认空池。建议先在独立profile安装本地开发包，核对目录后将池并发设为2或更低测试自己的候选。清空 `models` 并取消固定ID可关闭后续池选模；已启动实例持原快照，必要时用原取消机制停止。

回滚前等待收尾，备份profile和 `.dsh-ultra`；移除 `collaborationModelPool` 后恢复旧TGZ。审计只增加旧EvidenceStore兼容的source记录，不修改原生会话或旧记录，无破坏性迁移，不必删除索引。源码可按本轮before快照应用反向补丁，先核对差异，不重置其他既有修改。

模块分工：`model-pool.ts` 解析、选型与准入；`model-pool-settings.ts` 桥接schema和Settings；`model-pool-audit.ts` 复用证据存储；`collaboration-host.ts` 连接原生创建、工具、续接与请求守卫；`collaboration.ts` 管组内账本；`client/model-pool.ts` 管表单与展示。后续可组合任务预算和验收，本轮没有自动学习路由、复杂评分或压缩重构。
