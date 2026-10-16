# DSH Ultra Mode

**0.5.0-rc.3 本地候选**将多路线研究、Max decision 协调、Agent＋决策辅助、持久证据索引、按需检索、项目状态和可选上下文压缩整合在一个插件中。长任务经过截断、路线交接或压缩后，可以按稳定来源 ID 找回可访问原文，核对状态并继续工作。它不保证模型每次主动找对证据，也不承诺信息或能力绝对无损。

[使用与配置](docs/evidence-context.md) · [架构](docs/architecture.md) · [本轮验收与限制](docs/evidence-verification.md) · [公开验收档案](verification/0.5.0-rc.3/README.md) · [更新记录](CHANGELOG.md)

当前候选**未发布 Release、未安装到日常 DSH**。提交源码、生成可安装包与发布 Release 是不同动作；安装来源和哈希以同批交付清单为准。历史已发布 [v0.4.0-rc.3](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.4.0-rc.3) 的安装包和成绩不会被本候选改写。

## 一个插件完成协作与证据管理

- Ultra 内部统一管理来源、增量索引、只读 search/get、精确 quote、主题 MD 与项目状态；不需要用户手工搬运路线摘要。相关机制已整合，不需要另装 [billion-context-dsh](https://github.com/tyan66666/billion-context-dsh) 或外部向量数据库。
- worker 与 decision 有独立会话；常规路线装配必要约束、任务、状态和检索入口，按需读取证据，不默认复制全部历史。原始文本检索独立于模型语义提炼。
- 研究 worker 只读，最终实施由 decision 按宿主权限处理；辅助模式保留普通主 Agent 的执行职责。共享索引不扩大文件、命令、会话或发布权限。
- 本地索引和确定性正文替换不会默认启动摘要模型、embedding 或额外付费路线。是否使用辅助、多少路线，仍由用户手动选择。

## 安装候选与开始使用

1. 取得本次交付的 **0.5.0-rc.3 TGZ** 和同批 SHA256 清单，核对后再安装；源码 ZIP 用于开发。候选尚无新的 Release 下载链接，不要把旧版 Release TGZ 当作本候选。
2. 在独立测试 profile 中保留旧包、配置和宿主日志，通过 DSH 本地包入口安装并启用 `@dsh-external/dsh-ultra-mode` bundle。合并配置，不覆盖其他 bundle。发布包已含 lib，不需要用户构建。
3. 退出并重启该测试 profile，再开新会话。目标为 **DSH Desktop / Host 0.2.0-rc.2**；本轮测试使用安装构建 `04f392c9…`，不是用远端 master／alpha 接口推断兼容。完整来源见 [兼容与回滚](docs/evidence-context.md#迁移与回滚)。
4. 使用原来的「协作」和「Ultra」按钮或下列命令。新会话默认都关闭；证据功能随已授权 Ultra 运行建立，不会自动开多路。

| 选择 | 行为与权限 |
| --- | --- |
| `/ultra off` | 普通主 Agent 按原设置工作，关闭后续任务的自动 Ultra，保留所选模式 |
| `/ultra assist` 或 `/ultra 1` | 普通主 Agent＋只读 Max 辅助；主 Agent 的模型、思考强度和执行权限不变 |
| `/ultra 2`～`/ultra 5` | N 个独立 Max 研究 worker＋1 个 Max decision；N 不含 decision，研究阶段不执行写入或命令 |
| `/ultra on` | 恢复当前选择；新会话首次开启并发默认 3 路 |
| `/team on`、`/team off` | 独立控制普通子代理协作，不改变 Ultra 模式 |

内部 worker 和运行中 decision 不在主界面逐路展示完整过程；辅助模式保留普通主 Agent 的可见执行。多路线、协调和子代理会增加模型消耗。四阶段输出预算可配置，默认 0 继承，不降低 Max；有限预算仍可能耗尽，不能把 N＋1 路等同于 N＋1 次请求。详见 [配置示例](docs/evidence-config.example.yml)。

## 长任务与压缩边界

原文关联在可访问的工具结果被进展／报告截断前建立。宿主持久日志是原始会话权威；插件记录定位、校验、状态与覆盖缺口，MD 是派生视图。用户原话持续保留，历史工具输出和外部文本始终是资料，不会变成新授权。

**30K 是单 Agent 工作上下文软目标。** 系统、工具、用户约束、近期大结果与检索返回都可能使实际请求明显超额；本轮多数大型请求确实超过该目标。压缩默认关闭，开启须确认同一上下文只有一个压缩管理者；先持久化与校验，再通过 DSH 原生历史替换移走旧工具正文，失败则保留或补偿恢复。不可与另一个压缩插件同时管理相同历史。

本轮反复压缩测试使用**确定性工具正文替换**，没有递归生成摘要的误差链。约 32% 是同一次请求装配压缩前后**估算输入下降的样本中位数**，不能当作总 token、账单或相对原版节省。完整限制及关闭、迁移、回滚步骤见 [使用说明](docs/evidence-context.md)。

## 本轮已验证与未验证

| 范围 | 实际结果与限制 |
| --- | --- |
| 单元／模拟／真实 rc.2 SDK 组合 | 300 项：299 通过、0 失败、1 项 Windows 目录链接环境跳过；另有 19 项模型驱动纯测试及 66 项合成业务断言 |
| 独立真实宿主 | CLI → Loader → 原生 AgentLoop／工具／持久化，核心、冷恢复、关闭模式通过；脚本模型与真实模型证据分开 |
| 全部 rc.3 真实尝试 | 20 个结束尝试、285 次原生 LLM 流准入；已知 reported total tokens 66,162,179，12 次 usage 未知。不是独立核验的上游 HTTP／账单次数 |
| 最后一个模型实测构建的 Max 双路 | 严格 12/12，28 次请求，两份原生报告及一次协调，decision 独立读回证据；同构建较早的 502／TRANSPORT 失败仍保留 |
| 约 23MB 长任务 | 26 个完成轮、一次取消与冷恢复，原最终 9/12；检索修复后同根额外 1 轮严格 12/12。累计 27 个完成轮、23 次原生 prune，原失败与返工不改写 |
| 原版／候选同步 A/B | 原版第 4 轮网络中断，完成 3 轮；冻结旧候选完成 10 轮但严格格式评分 0/12，实际双源读取成立。没有完整可比任务，不能证明最终新构建质量或成本优势 |
| 尚未验收 | 当前候选的 Electron 桌面 UI、完整桌面权限／审批／普通子代理组合、异常断电、更多稳定业务长测与完整重复 A/B |

上述真实任务是公开合成 fixture；不是任意业务质量证明。解析失败的 0/12 不等于全部事实或限制已丢失，实际约束遗漏在该场景为未判定。未知用量不按零计算；失败、主动停止、取消和有界修订均在 [本轮报告](docs/evidence-verification.md) 及 [逐阶段公开总账](verification/0.5.0-rc.3/rc3-model-report.md) 中保留。

## 开发与历史

[测试指南](docs/testing.md) · [业务样例](benchmarks/README.md) · [协作工具](docs/collaboration.md) · [安装详情](docs/installation.md) · [排障](docs/troubleshooting.md) · [贡献指南](CONTRIBUTING.md)

历史记录：[0.4.0-rc.3](docs/verification-0.4.0-rc.3.md)、[0.4.0-rc.2](docs/verification-0.4.0-rc.2.md)、[0.3.2](docs/verification-0.3.2.md)。旧 UI 实测和旧业务任务只证明对应版本，不作为本次候选的验收成绩。

提交问题前移除密钥、个人路径、私有会话及原始思维链，见 [安全约定](SECURITY.md)。项目采用 [BSD-3-Clause](LICENSE) 许可。
