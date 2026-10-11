# dsh-ultra-mode 0.2.0

DeepSeek Harness 的独立 Ultra 编排按钮：**一个用户会话，3 / 4 / 5 条独立 Max 执行路线，再加 1 条持续 Max 决策路线**。按钮放在会话输入框右侧，不修改 DSH 的滑轨或思考强度选择器。

目标宿主为 **DSH Desktop / Host 0.2.0-rc.2**。这次按实际安装版本的 API 重写了 0.1.x 插件。Ultra 表示比单路 Max 增加并行研究和独立决策；模型请求仍使用宿主支持的 `reasoningEffort: max`。它不会给模型 API 发送虚构的 `ultra` 强度值，也不声称复现 Codex 的内部实现。

## 使用

在已选择的会话输入框右侧点击 **Ultra**，选择关闭、3 路、4 路或 5 路。新会话默认关闭，开启后默认 3 路；接下来提交的普通用户任务由宿主自动编排，无需模型主动调用工具。设置按会话隔离，修改运行中的选项只影响后续任务。

也可使用 `/ultra on`、`/ultra off`、`/ultra 3`、`/ultra 4`、`/ultra 5`。`ultra_task` 工具用于按钮关闭时用户明确提出的手动 Ultra 请求，不能从内部路线或它们的子代理递归调用。

## 运行机制

1. 新建一个独立 decision loop，以 Max 规划任务并分配 N 个不同研究方向。
2. N 个独立 worker loops 并行工作。它们继承主会话的模型、provider、preset 和已完成轮次的上下文，固定使用 Max。它们不是 `subagents.start()` 创建的子代理，也不消耗一层委派深度；每一路仍可调用宿主正常的子代理工具。
3. 原来的 decision loop 收到全部分支报告，核对冲突、实施变更、验证并形成交付。它保留自己的规划上下文，不会另起一个无关的合并代理。
4. 主会话呈现结果。宿主守卫禁止该轮主会话再调用工具重复实施；下一轮用户任务恢复正常行为。

**执行策略：**并发 worker 负责读取、搜索、推理、提出实现方案和调用研究子代理；共享文件的写入、命令执行和发布由 decision 收敛阶段统一执行。当前版本没有给每个 worker 自动建立 Git worktree，因此不让多路同时修改同一份工作区。研究工具 allowlist 是配置项；追加有副作用的工具会改变这个边界。

研究阶段强制 native 工具呈现，支持父会话的 native / ptc / both 模式，并继续禁止任意 JavaScript 的 `run_code`。decision 实施阶段恢复父会话实际工具呈现和权限。审批保留实际调用路线的审计身份，通过可见主会话接受；人机问题也转发给主会话。

内部路线有独立、持久化的 DSH 审计日志，但不在普通会话列表中展示。客户端使用针对 0.2.0-rc.2 的会话列表兼容桥，仅过滤 `ultra-route-` 前缀的内部记录，不改原快照或子代理 origin；卸载恢复原读取函数。升级宿主版本前应重新验证这条桥。

## 安装

从 [GitHub Releases](https://github.com/Kayou-31/dsh-ultra-mode/releases) 下载 `dsh-external-dsh-ultra-mode-0.2.0.tgz`。包已包含 `lib/`，安装时不需要构建，也不需要复制 DSH 运行库。

在 DSH 的插件管理页面按本地包路径安装并启用 bundle。也可以在关闭 DSH 后，通过该宿主使用的 pnpm 将本地包添加到 desktop profile：

```powershell
# 按自己的路径替换；使用 DSH 随附 pnpm 或兼容版本。
node 'D:\DSH\resources\runtime\pnpm\bin\pnpm.mjs' `
  --dir "$env:USERPROFILE\.dsh\profiles\desktop" add `
  'D:\Downloads\dsh-external-dsh-ultra-mode-0.2.0.tgz' --ignore-scripts
```

保留 profile `package.json` 和 `cordis.patch.yml` 原件。在原有 `dsh.profile.bundles` 中追加 `@dsh-external/dsh-ultra-mode`，不要替换已有列表：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@dsh-external/dsh-ultra-mode"
]
```

重新打开 DSH 后检查插件状态和按钮。desktop profile 由 Electron 管理，普通 `dsh --profile desktop ...` CLI 在该版本中拒绝接管；不要据此修改宿主保护。pnpm 对缺失的 peer 发出警告时，须确认宿主 bundle resolver 提供下方所列版本，不能将警告视为已经完成运行验证。

## 配置

bundle 已提供默认 patch。需要覆盖时，在用户 profile patch 中按相同 `id` 更新，例如：

```yaml
- id: ultra-mode
  config:
    concurrency: 3
    timeoutMs: 900000
    reportChars: 20000
    jevEnabled: false
```

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `concurrency` | `3` | 只允许 3、4、5，不含 decision |
| `toolName` | `ultra_task` | 手动入口工具名称 |
| `timeoutMs` | `900000` | 一次运行截止时间，毫秒 |
| `reportChars` | `20000` | 传入 decision 的每路报告字符上限 |
| `maxSessions` | `64` | 内存中的会话设置 LRU 上限；不淘汰运行中的状态 |
| `researchTools` | 读取、搜索及子代理工具 | 研究路线和后代的工具 allowlist |
| `jevEnabled` | `false` | 开启额外 Jev 决策辅助 |
| `jevKeyEnv` | `TYPESAFE_API_KEY` | 仅由 Host 环境读取的密钥变量名 |
| `jevModel` | `jev-latest` | TypeSafe Jev 模型名 |
| `jevBaseUrl` | `https://api.typesafe.ai` | Jev API 服务地址 |
| `jevTimeoutMs` | `15000` | Jev 请求截止时间，100–120000 毫秒 |

开关和路数只驻留 Host 内存，重启后复位。内部审计日志仍遵循 DSH 的持久化行为；“状态不持久化”不表示任务文本不会写入宿主日志。

## 可选 Jev

适配的是 [TypeSafe 的 Jev API](https://api.typesafe.ai/redoc)，调用 `/v1/systemone`，比较各路报告、返回路线选择和证据充分性概率。它属于 decision 的辅助判断，不能替代 DSH 的工具执行循环，也不增加一条执行路线。

开启 `jevEnabled` 并给启动 DSH 的进程提供 `TYPESAFE_API_KEY`。开启后，任务及成功分支报告的受限摘录会发送到配置的 Jev 服务（任务最多 4000 字符，每路最多 8000 字符，截断会标记）。密钥不进入按钮 RPC、日志结果或分支正文。缺密钥、超时、HTTP 错误或无效响应会明确降级为 DSH Max decision。

这不是 npm 发布，也没有捆绑 Jev 模型权重。本次未提供 Jev 实际账户密钥，验证使用离线官方协议 fixture，没有真实 Jev 服务调用证据。

## 失败和清理

- 至少需要 2 条非空、完成的报告才会进入最终 decision；2 / N 成功会明确显示部分失败。
- decision 失败只保留分支证据，标记尚未完成交付。
- 同一会话拒绝重叠 Ultra，以避免两个最终实施者同时写入。
- 用户取消、超时和插件卸载都会取消并等待实际路线及其子代理退出。插件卸载的取消和 drain 已通过离线宿主测试。
- 路线清理不会删除 DSH 的持久化审计日志。卸载本插件后，保留的内部日志可能重新出现在原生列表中。

## 构建与验证

需要 Node.js 22.13 或更新版本。发布包自带编译产物；从源码构建：

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run typecheck
npm test
```

`--legacy-peer-deps` 用于开发构建；DSH 的可选客户端 peer 由宿主提供。上述离线测试不依赖把本机运行库复制到项目中。严格类型检查和 59 项测试在独立目录中通过，覆盖并行、取消、部分失败、自动入口、状态隔离、按钮异步竞态、卸载和 Jev 协议。

实际 DSH 0.2.0-rc.2 的编译后服务另做了 9 组路线场景和 1 组热卸载 smoke：3/4/5 独立循环、每路真实普通子代理、Max、preset、native/PTC/both、审批与人机问题、只读边界、同轮重复执行拦截、取消/卸载零活跃循环残留。**模型响应和写工具在该 smoke 中是脚本化 fixture**；这不能代替真实模型调用、长期运行或真实桌面窗口验收。详见 [验证记录](docs/verification-0.2.0.md)。

宿主 peer：Cordis `~4.0.4`、Schemastery `~3.18.4`、DSH agents/tools/llm/session `0.2.0-rc.2`；Web 客户端依赖同版本 UI renderer、connection、locale、session-controller，以及 React 18/19。未宣称兼容旧 0.1.x API。

## 消耗

N + 1 指活跃的独立路线数量，不代表只发 N + 1 个 API 请求。decision 至少有规划、收敛两轮，worker 可以多步用工具和子代理，主会话还有呈现请求；报告与上下文也会重复发送。实际 Token、时间和配额消耗随任务变化，按钮没有额度估算。

## 许可

BSD-3-Clause。
