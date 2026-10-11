# 安装、升级与回滚

面向使用 DSH Desktop 的用户。当前正式版为 [v0.3.2](https://github.com/Kayou-31/dsh-ultra-mode/releases/tag/v0.3.2)，目标宿主为 **DSH Desktop / Host 0.2.0-rc.2**。不保证旧 0.1.x API 或后续宿主版本可直接使用。

## 下载哪个文件

| 文件 | 用途 |
| --- | --- |
| [dsh-external-dsh-ultra-mode-0.3.2.tgz](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.3.2/dsh-external-dsh-ultra-mode-0.3.2.tgz) | DSH 插件安装包，已包含 `lib/` 编译文件 |
| [dsh-ultra-mode-0.3.2-source.zip](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.3.2/dsh-ultra-mode-0.3.2-source.zip) | 开发与源码检查，不作为本地 bundle 安装包 |
| [dsh-ultra-mode-0.3.2-docs-tests.zip](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.3.2/dsh-ultra-mode-0.3.2-docs-tests.zip) | 本次主分支的完整文档、源码与业务测试补充；不作为安装包 |
| [SHA256SUMS-0.3.2.txt](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.3.2/SHA256SUMS-0.3.2.txt) | 核对安装包与源码 ZIP 的 SHA-256 |
| [SHA256SUMS-0.3.2-docs-tests.txt](https://github.com/Kayou-31/dsh-ultra-mode/releases/download/v0.3.2/SHA256SUMS-0.3.2-docs-tests.txt) | 核对新增文档测试补充 ZIP 的 SHA-256 |

选择 Release 附件中的 TGZ，不要把 GitHub 自动生成的源码压缩包当成可安装 TGZ。普通安装不需要 Node.js、TypeScript 或独立复制 DSH SDK，也不需要 Jev 密钥。本插件通过 GitHub Release 分发，不表示存在 npm registry 发布。

Windows 可用 `Get-FileHash -Algorithm SHA256 <下载文件路径>` 核对文件；结果应与同一 Release 的哈希清单一致。哈希通过证明下载内容一致，不能代替启动与界面检查。

## 首选：DSH 本地包安装

1. 确认 DSH Desktop 与 Host 的版本，下载 TGZ 到自己的本地目录。
2. 升级前结束正在运行的任务，保留旧 TGZ 及 profile 的 `package.json`、锁文件和 `cordis.patch.yml`。已有插件列表也应保留。
3. 在 DSH 插件管理页打开本地包安装入口，选择该 TGZ 或填写其完整本地路径。入口名称以宿主界面为准。
4. 安装并启用 `@dsh-external/dsh-ultra-mode` bundle。若需要手动追加 bundle，使用下方配置示例，不替换整个列表。
5. 完整退出 DSH，包括托盘／后台实例，然后重新打开。Host 和 Web 客户端需要一起加载新版本；只刷新会话界面可能仍使用旧 Host。
6. 在已选择会话的输入框右侧检查 **Ultra**。菜单应包含关闭、Agent + 决策、2／3／4／5 路，背景应为实色。

新会话默认关闭。选择模式后提交普通任务，无需填决策提示词。先完成这类界面与设置检查，再按需要做模型任务；它们分别证明安装加载和模型运行。

## 备选：关闭 DSH 后更新 profile

适用于了解当前 DSH profile 的用户。以下路径是示例，需要按自己的安装位置调整；使用 DSH 随附 pnpm 或与宿主兼容的版本。

```powershell
$dshPnpm = 'D:\DSH\resources\runtime\pnpm\bin\pnpm.mjs'
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$packagePath = Join-Path $env:USERPROFILE 'Downloads\dsh-external-dsh-ultra-mode-0.3.2.tgz'

node $dshPnpm --dir $profileDir add $packagePath --ignore-scripts
```

操作前完整退出 DSH 并备份上面列出的 profile 文件。不要在 Electron 管理的 desktop profile 上强行接管 CLI；该宿主版本会拒绝普通 `dsh --profile desktop ...` 的接管请求，不能据此移除宿主保护。

在原有 `dsh.profile.bundles` 中追加插件，保留现有项及其顺序。例如原有基础项时：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@dsh-external/dsh-ultra-mode"
]
```

bundle 自带默认 patch。需要覆盖默认值时按相同 `id` 更新 profile patch，配置详见 [架构与配置](architecture.md#配置)。重新打开 DSH 后按上述清单检查。

## 依赖与版本

Host 使用 Cordis `~4.0.4`、Schemastery `~3.18.4`，以及 DSH agent/tools/llm/session/scope `0.2.0-rc.2`。Web 客户端使用同版本 UI renderer、connection、locale、session-controller，支持 React 18/19。

pnpm 的 peer 警告不能当作运行通过。DSH bundle resolver 应提供对应依赖；若实际宿主缺少这些 API，先确认版本和 bundle 状态，不把随机版本 SDK 复制进 profile。

仅从源码开发或运行业务案例时使用 Node.js 24；源码构建还需要开发依赖。构建与测试见 [测试指南](testing.md)；安装已经构建好的 TGZ 不需要走开发流程。

## 升级与回滚

升级遵循同一过程：结束任务、完整退出、保留配置与旧包、安装新 TGZ、保持原 bundle 列表，再重新打开。相同版本下更换本地包也需要确认 Host 与客户端实际加载了新内容。

回滚时完整退出 DSH，重新安装保留的旧 TGZ，并恢复必要的旧配置。若恢复锁文件和 `package.json`，应使用原宿主的包管理方式同步依赖，不只修改版本文本。先保留当前文件，再用已有备份恢复；不删除共享 profile 或会话数据。

只想停用时可在插件管理页禁用 bundle，或在 Ultra 菜单选择关闭。菜单关闭仅停止后续任务自动使用 Ultra；不要把它当作卸载或删除历史日志。插件卸载不会删除 DSH 的持久审计记录，旧内部路线可能重新出现在宿主列表。

## 安装后检查

| 检查 | 正常现象 | 仍未证明 |
| --- | --- | --- |
| 插件加载 | bundle 启用，无加载错误 | 模型和工具调用成功 |
| 按钮与菜单 | 六个选项、实色背景、会话选择正常 | 每路真实并发与子代理 |
| 重启状态 | 新会话关闭；首次开启并发默认 3 | 长任务清理、业务输出质量 |
| 模型任务 | 对应模式按预期执行与交付 | 所有任务、未来宿主和 Jev 实际账户兼容 |

出现 HTTP 405、按钮缺失、权限审批或依赖错误时见 [排障指南](troubleshooting.md)。
