# 安装、升级与回滚

面向 DSH Desktop 用户的 [0.5.0-rc.3 预发布版](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.5.0-rc.3) 安装说明。本版包含独立 Team 协作、Ultra 辅助／手动2～5路、持久证据与检索、项目状态及可选原生历史替换。目标宿主为 **DSH Desktop / Host 0.2.0-rc.2**；不保证旧0.1.x或后续alpha API可直接使用。完整界面与权限组合尚未验收，建议先使用独立测试profile。

## 下载哪个文件

| 文件 | 用途 |
| --- | --- |
| [dsh-external-dsh-ultra-mode-0.5.0-rc.3.tgz](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.5.0-rc.3/dsh-external-dsh-ultra-mode-0.5.0-rc.3.tgz) | 本版安装包，含lib编译文件 |
| [SHA256SUMS-0.5.0-rc.3.txt](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.5.0-rc.3/SHA256SUMS-0.5.0-rc.3.txt) | 核对同一Release的安装包和源码ZIP |
| [dsh-ultra-mode-0.5.0-rc.3-source.zip](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.5.0-rc.3/dsh-ultra-mode-0.5.0-rc.3-source.zip) | 开发和源码检查，不作为bundle安装包 |
| [0.4.0-rc.3 TGZ](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.3/dsh-ultra-mode-0.4.0-rc.3.tgz)／[SHA256SUMS](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.4.0-rc.3/SHA256SUMS-0.4.0-rc.3.txt) | 保留的历史预发布包，可用于回滚 |

选择Release附件中的TGZ，不要把GitHub自动源码压缩包或源码ZIP当作安装包。普通安装不需要Node.js、TypeScript、另装记忆插件、复制DSH SDK或Jev密钥。GitHub Release分发不表示已发布到npm registry。

Windows可使用 `Get-FileHash -Algorithm SHA256 <下载文件路径>` 核对同版本SHA256SUMS。模型实测包与文档更新包整包哈希分别保留，44个lib文件逐字核对一致；不要把旧包哈希套在新TGZ上，也不把文档重打包当作再次在线实测。

## 首选：DSH 本地包安装

1. 确认 DSH Desktop 与 Host 的版本，下载 0.5.0-rc.3 TGZ 到自己的本地目录，并核对同版本哈希清单。
2. 升级前结束正在运行的任务，保留旧 TGZ 及 profile 的 `package.json`、锁文件和 `cordis.patch.yml`。已有插件列表也应保留。
3. 在 DSH 插件管理页打开本地包安装入口，选择该 TGZ 或填写其完整本地路径。入口名称以宿主界面为准。
4. 安装并启用 `@dsh-external/dsh-ultra-mode` bundle。若需要手动追加 bundle，使用下方配置示例，不替换整个列表。
5. 完整退出 DSH，包括托盘／后台实例，然后重新打开。Host 和 Web 客户端需要一起加载新版本；只刷新会话界面可能仍使用旧 Host。
6. 在新会话的输入框右侧检查 **协作增强（Team）** 与 **Ultra** 两个独立按钮。Ultra 菜单应包含关闭、Agent + 决策、2／3／4／5 路，背景应为实色；协作按钮单独控制协作状态。

默认配置下，新会话协作与 Ultra 都关闭。只使用普通 Agent 协作时，开启协作并保持 Ultra 关闭；需要决策辅助或并发再单独选择 Ultra。选择后提交普通任务，无需填写决策提示词。界面与设置检查证明安装加载，真实任务另行验证模型运行。

| 命令 | 用途 |
| --- | --- |
| `/team on` | 开启后续任务的协作增强，不改变 Ultra 模式 |
| `/team off`、`/team` | 关闭后续任务的协作，或查询当前协作状态 |
| `/ultra off` | 保持普通主 Agent 执行，独立于协作开关 |
| `/ultra assist`、`/ultra 2` 至 `/ultra 5` | 另行选择决策辅助或并发模式 |

## 备选：关闭 DSH 后更新 profile

仅适用于已确认系统 Node 与宿主依赖兼容、并了解当前 DSH profile 的用户。以下路径均为示例，需按自己的安装位置调整；使用 DSH 随附 pnpm 或与宿主兼容的版本。未确认兼容时使用上面的 GUI 安装入口。

```powershell
$dshPnpm = '<DSH安装目录>\resources\runtime\pnpm\bin\pnpm.mjs'
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$packagePath = Join-Path $env:USERPROFILE 'Downloads\dsh-external-dsh-ultra-mode-0.5.0-rc.3.tgz'

node $dshPnpm --dir $profileDir add $packagePath --ignore-scripts
```

保留 profile 原有的包管理配置，例如 `autoInstallPeers: false`、`nodeLinker: hoisted`；不要为了 peer 警告更改这些设置或随机安装 SDK。普通 GUI 安装直接使用已构建 TGZ，不需要这些命令或复制 SDK。

操作前完整退出 DSH 并备份上面列出的 profile 文件。不要在 Electron 管理的 desktop profile 上强行接管 CLI；该宿主版本会拒绝普通 `dsh --profile desktop ...` 的接管请求，不能据此移除宿主保护。

在原有 `dsh.profile.bundles` 中追加插件，保留现有项及其顺序。例如原有基础项时：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@dsh-external/dsh-ultra-mode"
]
```

证据索引默认随已授权Ultra运行建立，不为索引默认启动付费模型；contextCompression默认false。若显式开启压缩，先核对原生日志／checkpoint和token-meter能力，并停用同一上下文的其他compactor，确保唯一管理者。完整配置及权限边界见 [证据与上下文管理](evidence-context.md)。

bundle 自带默认 patch。需要覆盖默认值时按相同 `id` 更新 profile patch，配置详见 [架构与配置](architecture.md#配置)。重新打开 DSH 后按上述清单检查。

## 依赖与版本

Host 使用 Cordis `~4.0.4`、Schemastery `~3.18.4`，以及 DSH agent/tools/llm/session/scope `0.2.0-rc.2`。协作增强需要宿主的 continuable 子代理服务和支持该能力的 provider，默认名为 `spawn`。Web 客户端使用同版本 UI renderer、connection、locale、session-controller，支持 React 18/19。

pnpm 的 peer 警告不能当作运行通过。DSH bundle resolver 应提供对应依赖；若实际宿主缺少这些 API，先确认版本和 bundle 状态，不把随机版本 SDK 复制进 profile。

仅从源码开发或运行业务案例时使用 Node.js 24；源码构建还需要开发依赖。构建与测试见 [测试指南](testing.md)；安装已经构建好的 TGZ 不需要走开发流程。

## 升级与回滚

升级遵循同一过程：结束任务、完整退出、保留配置与旧包、安装新 TGZ、保持原 bundle 列表，再重新打开。相同版本下更换本地包也需要确认 Host 与客户端实际加载了新内容。

仅停用新增证据子系统可设置 `evidenceEnabled:false`，仅停用压缩可设置 `contextCompression:false`，重启对应profile。不要在运行中删除 `.dsh-ultra`；先备份索引、原生日志和旧配置，原始日志与原生prune重放的关系见 [迁移与回滚](evidence-context.md#迁移与回滚)。

完整回滚至保留的0.4.0-rc.3包时，完整退出 DSH，重新安装保留的旧 TGZ，并恢复必要的旧配置。若恢复锁文件和 `package.json`，应使用原宿主的包管理方式同步依赖，不只修改版本文本。先保留当前文件，再用已有备份恢复；不删除共享 profile 或会话数据。

只想停用整个插件时可在插件管理页禁用 bundle；只停止后续任务的增强时，分别关闭协作与 Ultra（`/team off`、`/ultra off`）。两个开关互不代替，也不是卸载或删除历史日志。插件卸载不会删除 DSH 的持久审计记录，旧内部路线可能重新出现在宿主列表。

## 安装后检查

| 检查 | 正常现象 | 仍未证明 |
| --- | --- | --- |
| 插件加载 | bundle 启用，无加载错误 | 模型和工具调用成功 |
| 按钮与菜单 | 独立的协作/Ultra 双按钮；Ultra 六个选项、实色背景、会话选择正常 | 每路真实并发与子代理 |
| 新会话与重启状态 | 默认配置下协作、Ultra 都关闭；首次开启并发默认 3 | 长任务清理、业务输出质量 |
| 模型任务 | 对应模式按预期执行与交付 | 所有任务、未来宿主和 Jev 实际账户兼容 |

出现 HTTP 405、按钮缺失、权限审批或依赖错误时见 [排障指南](troubleshooting.md)。
