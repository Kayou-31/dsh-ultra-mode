# 自由选择完整包与附属插件

本地开发检查点提供三个安装包。主包仍保留完整能力；两个附属包让普通 DSH 用户按需安装记忆或协作决策能力，不要求先安装 Ultra。三个 TGZ 一起提供于 [v0.6.0-dev.3](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0-dev.3)；文件名、SHA256、自动测试与原生离线验收结果见[发布验证](releases/0.6.0-dev.3.md)。

## 选择安装组合

| 包与源码位置 | 本轮版本 | 能力及默认行为 |
| --- | --- | --- |
| `@dsh-external/dsh-ultra-mode`，仓库根目录 | `0.6.0-dev.3` | 完整 Ultra：关闭／辅助／手动 2～5 路、Team、普通协作模型池、意图／诊断／验收治理、项目证据／上下文及显式授权全局知识。既有模式和默认值保留 |
| `@dsh-external/dsh-ultra-memory`，[packages/dsh-ultra-memory/](../packages/dsh-ultra-memory/README.md) | `0.1.0-dev.1` | 普通项目的原始证据、按需 search/get、可选原生历史压缩与同 profile 显式授权知识库。不创建模型或 Ultra 路线；压缩和全局知识默认关闭 |
| `@dsh-external/dsh-ultra-decision`，[packages/dsh-ultra-decision/](../packages/dsh-ultra-decision/README.md) | `0.1.0-dev.1` | 普通子代理 Team 六工具、协作多模型池，以及只读 decision 旁路和可选意图／诊断／验收。额外 decision 默认关闭，显式 `/decision on` 才开启；没有 Max 手动多路线入口 |

支持 Ultra 独立、Memory 独立、Decision 独立、Memory＋Decision、Ultra＋Memory。Memory＋Decision 让普通主 Agent 使用独立记忆和协作决策；Ultra＋Memory 由完整 Ultra 协调，Memory 统一管理证据配置。

Ultra 和 Decision 可同时安装，但在同一 scope 只能启用一个协调插件。重复主动启用会明确拒绝并提示选择一个，不会默默启动第二套协调。要切换时先停止活动任务，停用当前协调 bundle，再启用另一个并重载或重启；仅执行 `/ultra off` 或 `/decision off` 不能代替停用重复的插件入口。

## 共享源代码与包内路径

仓库根 `src/` 是共同核心的权威来源，三个产物从该源码构建。附属目录只保留自己的入口、manifest、默认 patch 与说明；附属 TGZ 中的 `lib/index.js` 是自包含派生 bundle，不在运行时引用仓库或另一个未发布包。

每个附属包内提供：

| 路径 | 用途 |
| --- | --- |
| `package.json`、`cordis.patch.yml` | 包身份、原生 bundle 入口与默认配置 |
| `lib/index.js` | 可独立加载的 Host bundle；原生 DSH 依赖由宿主提供 |
| `lib/client.js` | Decision 的客户端入口；Memory 不需要此文件 |
| `src/index.ts` | 附属包入口源码 |
| `core-src/`、`SOURCE-MANIFEST.json` | 构建时共同核心的可读副本及来源 SHA256，用于核对同源；改算法应回到仓库根 `src/` |

源码 ZIP 用于开发与核对，不能代替安装 TGZ。独立附属包不需要额外服务、密钥、embedding 或数据库。Memory 不启动模型；Decision 的 Team 子任务和显式开启的辅助仍使用 DSH 已配置的模型与凭据，模型运行会按宿主正常计费，本轮只进行离线脚本验证。

## 安装到独立 profile

1. 保留原 TGZ 和目标 profile 的 `package.json`、锁文件、`cordis.patch.yml` 及 bundle 列表。核对交付清单中各 TGZ 的精确 SHA256；不要套用历史版本哈希。
2. 使用 DSH 原生本地包安装入口，选取所需 TGZ。分别安装 Memory、Decision，或保留完整 Ultra；不需要为附属包另装完整 Ultra。
3. 在原有 `dsh.profile.bundles` 中追加所选包，保留已有基础 bundle。下面是 Memory＋Decision 的配置片段；它不是替换整个 profile 的文件：

   ```json
   "bundles": [
     "@deepseek-ai/dsh-base",
     "@deepseek-ai/dsh-web-app",
     "@dsh-external/dsh-ultra-memory",
     "@dsh-external/dsh-ultra-decision"
   ]
   ```

4. 在原生 Settings／Config 中按默认 patch 的 ID 覆盖配置：完整 Ultra 为 `ultra-mode`，Memory 为 `ultra-memory`，Decision 为 `ultra-decision`。不要重复插入相同插件。独立 Memory 的知识授权示例见[global-knowledge.example.yml](global-knowledge.example.yml)。
5. 完整退出并重启目标 profile。新会话中 Team 和额外 decision 默认关闭；Decision 用 `/team on|off` 控制普通协作，用 `/decision on|off` 控制额外只读旁路。这两个开关独立，不会进入 2～5 路。

原生 CLI 启动形式已由本仓库离线运行器使用：`node <runtimeRoot>/node_modules/@deepseek-ai/dsh/lib/bin.js --profile <独立profile名>`。安装使用宿主本地 TGZ 入口；本文不假设宿主存在 `install` 或 `enable` 子命令。不要用普通 CLI 强行接管 Electron 管理的日常 desktop profile。历史公开包的安装流程另见[安装与回滚](installation.md)。

三个包的声明目标均为精确的 `0.2.0-rc.2 || 0.2.1-rc.2`，不表示已验证未来版本。全局知识另需宿主原生 `profileContext.dir`：本轮原生知识闭环的验证目标是 `0.2.1-rc.2`；旧 `0.2.0-rc.2` 只记原模式／SDK 回归，不能据此声称知识兼容。缺少该服务时明确失败关闭。

## 组合时哪份配置生效

三个插件通过宿主根 Cordis context 的 `ultraEvidenceSupport` 服务共享项目证据底座，每个活动插件持有一个 lease。服务管理唯一的 MemoryHost、检索工具、捕获、请求观察与压缩接线；不会为安装组合重复采集、重复观察或重复接管历史。

证据、压缩与知识配置的优先级为 **Memory > 完整 Ultra > Decision**。优先级按活动插件而不是加载顺序决定；只选一份权威配置，不合并项目授权。独立 Decision 使用自己的项目证据 fallback；和 Memory 一起使用时，应在 `ultra-memory` 配置证据、压缩及知识，而不是在两处维护不同授权。Memory 中关闭的知识也不会被低优先级配置重新打开。Team、模型池及 decision 协调参数仍属于所选协调插件。

授权在每次操作和异步来源检查后重新核对。切换权威配置不能把旧发布时的读者快照扩大：新读者仍需发布者显式发布新版本；目录重绑定、撤权和换 profile 继续阻止旧授权读取。完整规则见[知识库说明](global-knowledge.md)。

证据开关同样遵循该优先级。Memory 开启时，协调插件自己的关闭值不能漏掉请求预算或路线检索工具；Memory 关闭时，已有运行暂停捕获、请求观察、恢复入口和压缩，保留已收集的状态。停用区间记录为覆盖缺口，不在同一运行恢复时回填；存在这种缺口的会话不再自动压缩，避免改写未充分索引的历史。需要恢复压缩时结束当前运行、开始新会话并核对覆盖，不把停用期间用量当作已实测。

停用或卸载一个插件只释放自己的 lease，剩余插件继续使用共享服务。释放当前配置权威时，服务取消并排空旧配置的在途知识操作，再选择下一份配置；最后一个 lease 释放后才清理共享服务。lease 与配置权威变化不删除项目 `.dsh-ultra/v1`、宿主 JSONL 或 profile 的 `.dsh-ultra-knowledge/v1`。

## 升级与回滚

升级前停止任务及发布、等待清理并完整退出，再对 profile、项目证据及知识目录做静止备份。三个包应来自同一交付清单，避免混装不兼容的共享服务协议；包内来源清单用于核对实际构建来源，不能替代 TGZ 哈希。

要撤掉附属包，先停用对应 bundle 并重载或重启，再按宿主包管理方式移除包及不再使用的 patch 行。若移除 Memory 后保留 Ultra 或 Decision，先核对下一份权威配置的证据／压缩／知识开关与项目授权。切换不会自动并集授权，也不会自动重发知识。

回滚旧版前保留当前文件，按目标旧版移除它不认识的配置，恢复已保留的 TGZ 及必要 profile 配置。更换 `package.json`／锁文件时使用宿主原来的包管理方式同步依赖。保留证据与知识目录，不在活动任务中删除它们；旧版不会因为目录存在而自动取得知识授权。

## 本轮验证口径

需分别验证三个最终 TGZ 的独立原生加载、Memory＋Decision 两种加载顺序、Ultra＋Memory、重复协调入口拒绝、配置权威切换、单 lease 释放后继续工作与最后 lease 排空，以及捕获和请求计数不重复。项目来源、权限、撤权、压缩和知识来源验证仍按原边界检查。

本页不预先填写通过数或宣告原生验收成功。最终包哈希及每层通过／跳过／失败见本轮交付报告；执行方法见[测试指南](testing.md)。原生 CLI 离线脚本和 JSONL 只能证明接线及断言，不能证明真实模型质量、费用改善或完整 Electron UI。本轮不运行在线模型，不安装日常环境，不 push 或发布。
