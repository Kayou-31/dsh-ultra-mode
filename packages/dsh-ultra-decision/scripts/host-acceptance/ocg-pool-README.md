# OCG 普通协作选模实机驱动

`ocg-pool-plugin.mjs` 是独立 profile 的在线验收插件。它复用官方 DSH 0.2.1-rc.2 的真实模型适配器、Loader、Settings/ConfigEditor、普通子代理与工具执行链，不注册脚本模型，不读取日常配置或凭据。

外部启动器负责：新建隔离的 `DSH_HOME`、OS home、临时目录和项目目录；只向这个进程提供已授权的 OCG 凭据；固定可访问的网络端点；安装确切候选包与原生宿主插件；限制请求数、同时活动 stream 数与进程时长。不要将本驱动装进日常 profile。它本身不是通用安装器，也不会自动开始付费测试。

Loader 插件配置：

```json
{
  "runtimeRoot": "绝对路径/官方-0.2.1-rc.2-runtime",
  "ultraRoot": "绝对路径/隔离安装的Ultra包",
  "configFile": "绝对路径/私有测试配置.json",
  "resultFile": "绝对路径/结果.json"
}
```

私有测试配置示例（模型 ID 与思考档位必须先由宿主目录确认，并单独通过短工具 smoke；下面的 `host-confirmed-model` 是占位符）：

```json
{
  "projectDir": "绝对路径/隔离合成项目",
  "provider": "opencode-go",
  "model": "host-confirmed-model",
  "presetId": "ocg",
  "sessionId": "ocg-pool-unique-attempt",
  "maxConcurrent": 4,
  "maxRequests": 80,
  "timeoutMs": 600000,
  "mainEffort": "low",
  "mainMaxTokens": 4096,
  "routes": [
    { "id": "implement", "kind": "code", "provider": "opencode-go", "model": "host-confirmed-model", "reasoningEffort": "low", "maxTokens": 4096 },
    { "id": "inspect", "kind": "review", "provider": "opencode-go", "model": "host-confirmed-model", "reasoningEffort": "high", "maxTokens": 8192 }
  ]
}
```

可选的 `bundleName` / `settingsId` 默认是 `@dsh-external/dsh-ultra-mode` / `ultra-mode`。测试独立 Decision 附属插件时同时指定 `@dsh-external/dsh-ultra-decision` / `ultra-decision`。`presetId` 必须对应启动器实际加载的原生 preset。

外部 `real-model-global-limit.mjs` 必须配置相同的 `maxRequests` 与 `concurrency=maxConcurrent`，`syntheticUsage: false`，以及 main 和每个候选的精确 `allowedRoutes`。所有候选限于本次已授权的 `opencode-go` provider；驱动不授权跨 provider 发送。宿主还需挂载原生子代理服务、spawn provider、Settings、ConfigEditor、commands、JSONL 持久化。`researchTools` 只允许合成的 `fixture_read` 及插件必需的只读工具，不能借验收扩大命令、文件写入或发布权限。

驱动执行：

1. 通过原生 Settings 保存两个用户声明能力的候选，不传递内部 `kind` 评分字段。
2. 原生工具入口拒绝不存在或禁用的候选，确认没有对应的模型请求。
3. 主智能体根据候选目录分别处理计算与代码审查任务，自主选配置 ID；普通子代理必须亲自调用只读 `fixture_read`，获得随机 nonce、计算答案并交付。
4. 首个子代理开始实际请求后修改配置的输出上限，核对该实例的后续请求仍使用原创建快照。
5. 单独的显式优先权用例要求请求计算候选，但配置用户固定审查候选；核对原生记录保存请求 ID、实际选中 ID 与 `source=user`，真实调用固定的模型和参数。
6. 每轮将 spawn、wait/list 记录、原生工具调用/结果配对、子代理答案、主智能体公开答案与实际 `llm/stream` 请求相互核对。只记录可核对的路由、选型理由、工具 nonce、公开答案、状态和 adapter 报告的用量，不导出请求原文或私有思维链。

两项候选若实际 provider/model 相同，结果标为 `same-model-different-config` 或 `same-model-same-config`，不能称为两个不同模型。`distinctModels: true` 会在这种情况下拒绝配置。成本没有实测时为 `null`，缺少 usage 的调用单独标为未知；不要用当前候选能力描述推断模型真实兼容性。

本文件的自动化测试验证配置组装、原生事件判定与证据拒绝逻辑，是离线测试。只有真实启动器生成的通过结果、原生 JSONL 核验与允许的 provider 调用记录才能证明对应实机阶段运行。这里不证明长期压缩效果、全部模型兼容性、完整桌面 GUI 或跨进程重启；这些应由独立验收阶段报告。

## 公共启动器

`run-ocg-profile.mjs` 支持 `--scenario pool`、`--scenario s0`、`--scenario knowledge` 及实验中的 `--scenario workflow`。它只接受新空目录，在 Windows 中设置当前用户独占 ACL，重建 OS home、临时目录与 DSH home。它核对 TGZ SHA256、拒绝归档路径穿越和链接、固定官方宿主包的版本、冻结验收脚本并记录各文件 SHA256；模型调用继续经过真实 pi-ai adapter 和精确 origin 网络守卫。进程结束后独立读取原生 JSONL，重核工具调用/结果配对与每轮证据链。

### 500K / 420K / 30 次工程工作流实验

完整口径见 [验收规范](../../docs/experiments/workflow-500k-30-spec.zh.md)。该场景使用隔离的订单对账验收工程，模型逐阶段编写声明式测试模块，固定 Node runner 实际执行不同订单用例，随后从证据库取回原始报告并提交幂等阶段回执。它测持续验收工程，不宣称模型从零开发了整个业务引擎。

测试 profile 的模型容量元数据设为 500000，压缩软目标设为 420000，后者包含 8192 输出预留及 2048 后续工具预留。官方 meter 的 usage 锚点仍带估算增量，不能称精确 tokenizer。发出前近似准入和服务端实际 usage 事后核验分别记录。近期窗口为 2，只在此实验显式设置；产品默认仍为 8。

先使用 `--workflow-calibrate-only --workflow-report-rows 100 --workflow-segment-cycles 1` 做小规模校准，校准通过不等于压缩验收通过。主实验用 `--workflow-calibration-file <私有校准result.json>`、最多 12000 个报告用例作为可调上限，根据当前历史大小和校准密度缩减报告，避免多轮累积重新越过窗口。`--workflow-cycles 30 --workflow-segment-cycles 30` 执行完整序列；有限 request/time 预算仍必须显式提供。每次独立原生替换、实际前后请求、同源回读及阶段验收齐全才计数。

模拟时间线覆盖至少 24 小时，实际墙钟时间另列；未进行真实墙钟 24 小时耐久运行时必须明确标为未验证。初始要求只提供一次，新增要求按阶段加入；失败保留现场，不自动无限重新派发。该实验接通和真实结果以实验报告为准，此处是运行方式，不是已通过声明。

先在私有目录准备 bootstrap JSON；下列模型名仅为结构示例，须使用自己已经确认授权与兼容的精确模型：

```json
{
  "provider": "opencode-go",
  "providerConfig": {
    "apiKeyEnv": "OPENCODE_GO_API_KEY",
    "models": [{ "id": "host-confirmed-flash" }, { "id": "host-confirmed-review-model" }],
    "timeoutMs": 180000,
    "streamIdleTimeoutMs": 90000
  },
  "credentialFile": "绝对路径/私有目录/selected-credentials.yaml",
  "allowedOrigins": ["https://opencode.ai"],
  "mainModel": "host-confirmed-flash",
  "mainEffort": "high",
  "routes": [
    { "id": "implement", "kind": "code", "provider": "opencode-go", "model": "host-confirmed-flash", "reasoningEffort": "high", "maxTokens": 8192 },
    { "id": "inspect", "kind": "review", "provider": "opencode-go", "model": "host-confirmed-review-model", "reasoningEffort": "high", "maxTokens": 8192 }
  ]
}
```

凭据 YAML 必须仅有 `version: 1` 和 `refs` 中唯一的 `OPENCODE_GO_API_KEY`。不得将整个日常凭据文件交给启动器。bootstrap、凭据、整个实机目录、stdout/stderr 和原始会话日志均属于私有实验资料，不进入源码、包或公开实验附件。

```powershell
node scripts/host-acceptance/run-ocg-profile.mjs `
  --runtime 'E:/private/official-runtime' `
  --candidate 'E:/packages/candidate.tgz' `
  --candidate-sha256 '<确切64位小写SHA256>' `
  --work 'E:/ocg-tests/NEW-attempt' `
  --bootstrap 'E:/private/bootstrap.json' `
  --scenario pool --concurrency 4 --max-requests 80 --timeout-ms 600000
```

`s0` 仅对 `mainModel` 做短工具 smoke；`pool` 做两项自主选型与一项显式优先权阶段。不同进程的 gate 不共享并发许可，多个实机进程的总并发必须由实验调度器另行约束。`--max-requests` 是准入的原生 LLM stream 数，不能冒充独立观察到的 wire HTTP 数。此启动器尚未提供 `long/resume`；长期状态测试沿用已有单独的记录与恢复入口，不能把新空目录当成跨进程恢复。

## 知识库小闭环

`--scenario knowledge` 使用 `ocg-knowledge-plugin.mjs`，只调用 bootstrap 的 `mainModel`，不使用模型池候选。可选主 Ultra 或独立 Memory TGZ；仍必须给出确切 SHA256。建议先用有限的 `--max-requests 40 --timeout-ms 600000`，遇到相同传输失败时诊断，不自动重试整组任务。

启动器创建三个不同的实际目录 A/B/C，在原生 profile 配置中仅授权 A 发布给 B、B 只读，并通过 Settings 再写入并核对真实项目 roots。模型 A 获得一个只读合成资料工具，随机引文与未共享尾部仅在工具结果中出现；它必须通过项目原文检索取得真实 source ID、用 quote 校验源 SHA，然后显式发布允许的短引文。模型 B 位于独立会话与项目，提示词只给检索主题；它通过全局 search/get 取回发布资料，核对 source ID、源会话与 SHA，再公开返回原句。B 不得到 A 的任意原文访问权，未发布尾部不得出现在 B 的实际请求里。

B 的实际请求开始前，驱动另用原生 ToolRuntime 核对 B 无法读取 A 原文或发布、C 无项目授权时无法检索。这些直接调用只验证宿主边界，不算模型主动拒绝，也不额外启动 C 模型。最终 `native-session-inventory.json` 读取真实 JSONL 重新核对 A/B 原生工具事件与读回结果；`source-match` 仍只证明共享来源片段与原文匹配，不能升级成模型结论正确或获得新权限。该场景不覆盖重启撤销、根目录重绑定、所有权限攻击或完整 GUI；已有离线原生场景和专项回归应单独报告。
