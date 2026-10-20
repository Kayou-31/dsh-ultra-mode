# DSH Ultra Decision

> 本包与完整 Ultra 一起提供于 [v0.6.0 正式版](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0)。安装组合、实测范围与限制见[发布记录](https://github.com/Kayou-31/dsh-ultra-mode/blob/main/docs/releases/0.6.0.md)。


`@dsh-external/dsh-ultra-decision` **0.1.0** 是可独立安装的正式包。普通 DSH 可单独安装本 TGZ，无需安装完整 Ultra。

提供普通子代理 Team 六工具、协作多模型池，以及只读 decision 辅助和可选原文意图、运行诊断、最终验收治理。额外 decision 默认关闭；显式 `/decision on` 后才为后续任务开启一条只读旁路。没有 Max 手动 2～5 路的工具、命令或 RPC 入口。

## 安装与使用

先保留旧包及目标 profile 配置，核对交付清单中的精确 TGZ SHA256。使用 DSH 原生本地包入口安装并启用 `@dsh-external/dsh-ultra-decision` bundle，在已有 `dsh.profile.bundles` 列表追加该包，保留其他 bundle，再完整退出并重启。不要把源码 ZIP 当安装包，也不要用普通 CLI 接管 Electron 的日常 desktop profile。

在原生 Settings／Config 中覆盖默认 patch 的 `ultra-decision` 条目。普通模型池使用 DSH 已有 provider／模型目录与凭据，不另建服务或密钥库；空池继承宿主原用法，添加候选不会自动启动更多代理。用户固定候选优先，模型及工具权限仍由宿主校验。

| 命令 | 行为 |
| --- | --- |
| `/team on`、`/team off`、`/team` | 开启、关闭或查询普通子代理协作 |
| `/decision on`、`/decision off` | 开启或关闭额外只读 decision 旁路，与 Team 独立 |

Team 提供 `ultra_spawn_agent`、`ultra_send_message`、`ultra_followup_task`、`ultra_wait_agent`、`ultra_interrupt_agent`、`ultra_list_agents`。消息和模型建议不构成新的人类授权；普通主 Agent 仍执行任务，辅助 decision 不取得写权限。

`decisionGovernance` 默认 false，显式开启后在既有 decision 调用中处理意图、诊断和可选验收；开关自身不新增优化器、路线或额外模型调用，不强制增加一次最终调用。完整用户原文和整体 `task-result` 保留；缺证据保持 `unverified`，模型判断标为 `hostVerified: false`。Team 任务和显式旁路运行仍会按宿主正常消耗模型用量，本附属包的独立／组合宿主验收与共享核心真实模型实验分开记录。

## 组合、配置与回滚

支持 Decision 独立或 Memory＋Decision。独立时包含项目证据 fallback，证据／压缩／知识配置权威顺序为 Memory > 完整 Ultra > Decision；组合时只使用一份当前权威配置，授权不并集。用 Memory＋Decision 时在 `ultra-memory` 配置记忆及知识，在 `ultra-decision` 配置 Team、模型池和决策治理。

完整 Ultra 已包含本组能力。Ultra 和 Decision 可同时安装，但同一 scope 重复主动启用会明确拒绝；先停用一个协调 bundle 再启用另一个。`/ultra off` 或 `/decision off` 只关闭对应任务模式，不能替代停用重复插件。

共享证据服务由原生 `ultraEvidenceSupport` lease 管理，移除一个插件不破坏剩余插件，最后 lease 释放才排空关闭。每次知识操作仍重查当前授权与旧发布快照；切换权威配置不会增加读者权限。

停用前先停止任务和发布并备份 profile、项目证据与知识目录。停用 bundle、重载或重启后，再按宿主方式移除包及 patch；回滚用已保留 TGZ 与目标版本认识的配置，不删除历史证据或知识审计。

目标宿主精确为 `0.2.0-rc.2 || 0.2.1-rc.2`。全局知识另需原生 `profileContext.dir`；本轮知识闭环验证目标为 `0.2.1-rc.2`，旧 `0.2.0-rc.2` 的原模式／SDK 回归不证明知识兼容。

## 共享来源与验证

仓库根 `src/` 是共同核心的权威来源，本目录入口构建为自包含 `lib/index.js`／`lib/client.js`。包内 [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json) 记录来源 SHA256，[core-src/](core-src/) 保留可读共同核心，`src/index.ts` 是附属入口；运行时不依赖仓库路径或另一个未发布附属包。

三个正式包的SHA、源码／运行时对应关系及独立／组合原生验收见Release验证附件。真实OCG实验主要使用完整Ultra的冻结开发候选，附属包通过共同源码、运行字节和原生矩阵核对，不能声称各自又跑过真实30轮。

归档实测按14/30收尾，约65K级为本案例压后含预留体积；30轮、一天跨度和额外归档冷读回未完成。压缩与阶段归档默认关闭；已有arc_检查点须保留兼容读取器、证据服务、原始日志与项目归档清单，不能直接交给不理解它的旧版续作。详细配置与迁移见[安装说明](https://github.com/Kayou-31/dsh-ultra-mode/blob/main/docs/installation.md)。未安装日常环境；离线脚本不证明所有模型、业务或完整Electron UI效果。
