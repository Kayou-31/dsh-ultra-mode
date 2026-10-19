# DSH Ultra Memory

> 本包与完整 Ultra 一起提供于 [v0.6.0-dev.3](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.6.0-dev.3)。以下本地开发说明保留验收冻结时状态，最新安装组合与验证边界见[发布记录](../../docs/releases/0.6.0-dev.3.md)。


`@dsh-external/dsh-ultra-memory` **0.1.0-dev.1** 是独立的本地开发检查点，尚未发布。普通 DSH 可单独安装本 TGZ，无需安装完整 Ultra。

提供项目原始证据、`ultra_memory_search`／`ultra_memory_get` 按需检索、可选原生历史压缩，以及同 profile 显式授权的知识发布／读取。Memory 不创建任何模型、子代理或 Ultra 路线，不需要额外服务、密钥、embedding 或数据库。原始宿主日志与项目证据仍是来源权威，摘要和知识结论不等于事实验证。

## 安装与配置

先保留旧包及目标 profile 配置，核对交付清单中的精确 TGZ SHA256。使用 DSH 原生本地包入口安装并启用 `@dsh-external/dsh-ultra-memory` bundle，在已有 `dsh.profile.bundles` 列表追加该包，保留其他 bundle，再完整退出并重启。不要把源码 ZIP 当安装包，也不要用普通 CLI 接管 Electron 的日常 desktop profile。

在原生 Settings／Config 中覆盖默认 patch 的 `ultra-memory` 条目。`contextCompression` 和 `globalKnowledge.enabled` 默认 false。下面只示例开关，不包含跨项目授权：

```yaml
- id: ultra-memory
  config:
    evidenceEnabled: true
    contextCompression: false
    globalKnowledge:
      enabled: false
```

开启知识时还须明确配置真实项目目录、`read`、`publish`、`shareWith`；首次切换启用状态后重载插件或重启。每次操作重查当前授权、profile、来源和发布时读者快照，新增读者不追溯扩大旧发布。知识位于原生 `profileContext.dir/.dsh-ultra-knowledge/v1`，项目证据保留在各自 `.dsh-ultra/v1` 与宿主日志。

目标宿主精确为 `0.2.0-rc.2 || 0.2.1-rc.2`。全局知识另需原生 `profileContext.dir`，本轮知识闭环验证目标为 `0.2.1-rc.2`；旧 `0.2.0-rc.2` 的原模式／SDK 回归不能证明知识兼容，缺服务时失败关闭。压缩须确认原生持久化及 token-meter 能力，并确保同一历史只有一个压缩管理者。

## 组合与回滚

支持 Memory 独立、Memory＋Decision、Ultra＋Memory。Memory 的证据／压缩／知识配置优先于 Ultra，再优先于 Decision；只采用当前权威的一份配置，授权不并集。Team、模型池及协调参数仍在所选协调插件配置。

各包通过原生 `ultraEvidenceSupport` lease 复用唯一证据服务。卸载一个插件不关闭其余插件仍持有的服务，最后一个 lease 才排空并关闭。配置权威切换会取消并清理旧知识操作，旧发布快照仍不能扩大。

Memory 关闭证据时，已有运行暂停捕获、请求观察、恢复入口与压缩，保留原状态，并把停用区间记为覆盖缺口。同一运行恢复时不回填该区间；存在缺口时不继续自动压缩，以免改写未索引历史。停用期间用量不记为已实测，恢复压缩应开始新会话并核对覆盖。

停用前先结束任务和发布并备份 profile、证据与知识目录。停用对应 bundle、重载或重启后，再按宿主方式移除包及 patch；移除 Memory 后若保留其他包，先检查接替配置的授权和压缩开关。回滚使用已保留的 TGZ 和相容配置，不删除原始证据或知识审计。

## 共享来源与验证

仓库根 `src/` 是共同核心的权威来源，本目录入口构建为自包含 `lib/index.js`。包内 [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json) 记录来源 SHA256，[core-src/](core-src/) 保留可读共同核心，`src/index.ts` 是附属入口；运行时不依赖仓库路径或另一个未发布附属包。

最终哈希、测试数及原生独立／组合验收以本轮交付报告为准，此处不预先宣告通过。离线原生 CLI 脚本不代表真实模型质量或完整 Electron UI 验收。本轮不调用在线模型、不安装日常环境、不 push 或发布。
