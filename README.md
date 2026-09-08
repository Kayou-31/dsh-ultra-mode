# dsh-ultra-mode

ULTRA 并发模式插件（DeepSeek Harness / DSH）：像 GPT Pro 那样——**一次处理一件事时并发 N 个独立 agent（self-consistency），再由第 N+1 个 agent 交叉核对并合并成一份最终答案**。composer 输入行右侧是一个辐射滑块（运行时有"燃烧"光效），另有 `/ultra` 命令与随会话状态动态注入的提示词引导。

已验证环境：**DSH 0.1.1-rc.2**（DSH Desktop / Host，2026-09 实测：`ultra_task` 真机 2 路并发 + 合并跑通；`/ultra`、滑块 RPC、提示词注入均验证）。

## 它做什么

```
你：用 ultra 分析一下这个仓库的架构
（滑块 ULTRA 3）
→ ultra_task：3 个独立 agent 并行分析 → 合并者交叉核对 → 一份汇总答案
→ 我：直接基于合并结果答复你
```

| 部件 | 说明 |
| --- | --- |
| `ultra_task` 工具 | 并发 N（2–5）个全新子代理处理同一任务，全部完成后第 N+1 个合并代理输出统一答案 |
| composer 滑块 | 关 / 2 / 3 / 4 / 5 路；拖动即设，状态按会话隔离 |
| `/ultra` 命令 | `on` / `off` / `<2-5>`，与滑块双向同步 |
| 提示词引导 | **每次装配时**读取该会话的开关状态并注入（开启时明确要求"本轮必须先调用 `ultra_task`，且仅一次"） |
| 运行态光效 | 有 ULTRA 正在执行时滑块转为金橙"燃烧"态；**它只表示运行状态，不是实际额度计量** |

## 开关是怎么生效的

模型不会去猜滑块位置：

- 插件注册一个提示词段（`ultra-mode`），其文本是**回调**，在每一轮请求装配时被求值；
- DSH 的装配上下文携带 `agent`（`assembleContextFor` 同时设置 `agent` 与 `scope`），插件由此定位到**当前会话**的状态；
- 开启时注入：

  ```
  ULTRA 当前状态：已开启
  并发数：3
  本轮必须先调用 ultra_task（task 参数 = 用户请求全文），且仅调用一次；随后基于合并结果直接答复用户，不要重新执行整个任务。
  ```

- 关闭时给出简短说明（仅用户明确要求时使用）。未操作过滑块的会话没有状态条目，因此不会注入任何文本。

## 安装

三种方式等价于"让 profile 的 `node_modules` 能解析到本包"，差别只在来源：

```bash
# ① 本地目录（开发/自用，推荐）
cd ~/.dsh/profiles/desktop
pnpm add link:/path/to/dsh-ultra-mode

# ② Git 仓库（分享给朋友）
pnpm add link:../dsh-ultra-mode          # clone 后本地 link
# 或 git+file / 私有 registry 视你的发布方式而定

# ③ npm 包（若你自行发布）
pnpm add @dsh-external/dsh-ultra-mode
```

然后把包名加入该 profile `package.json` 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@dsh-external/dsh-ultra-mode"]
    }
  }
}
```

重启 Host 生效（或用 `dsh-super-injector` 的 `dev_install_package` 免重启热装配）。

## 配置

```yaml
- insert:
    - id: ultra-mode
      name: '@dsh-external/dsh-ultra-mode'
      config:
        provider: ''         # subagent provider 名；留空自动探测
        toolName: ultra_task # 模型可见工具名
        concurrency: 3       # 默认并发路数 2-5
        sectionOrder: 117.5  # 提示词段插入顺序
        maxSessions: 64      # 会话状态条目上限（LRU 淘汰）
```

**provider 探测规则**：`provider` 非空 → 直接用；为空 → 优先 `spawn`，否则取 `subagents.list()` 的第一项。两者都没有时，`ultra_task` 调用会报 `no subagent provider available (subagents.list() is empty)`，而滑块与 `/ultra` 仍可正常设置状态。

## 降级与失败矩阵

| 情况 | 行为 |
| --- | --- |
| 某路 worker 启动失败 | 已启动的 worker 与 merger 全部在统一 `finally` 中 `dispose()`（不会留下继续烧额度的后台 agent），工具报错 |
| 成功样本 **< 2** | **不合并**，直接报错说明"可靠性不足"（不把单路结果伪装成 ULTRA） |
| 成功样本 2 … N−1 | 允许降级合并：合并提示词里写明"请求 N 路、实际成功 M 路"，返回文本头部再带一条 `[ULTRA]` 提示；空白输出不计为成功 |
| 合并代理失败 | 退回"各分支结果拼接"（保留全部可用样本），不吞成果 |
| 用户取消 / 超时 | 通过 `exec.signal` 传播到所有 worker 与 merger；`activeRuns` 归零后 UI 光效熄灭 |
| 重叠调用（同会话两次 ULTRA） | `activeRuns` 计数，先结束的一次不会让光效提前熄灭；`lastRun` 只在全部归零后写入 |
| 服务缺失 | `tools`/`subagents` 缺失 → 插件等待；`commands`/`systemPrompt`/`connection` 缺失 → 命令 / 提示词段 / 滑块分别自动裁剪 |
| 浏览器能力缺失 | canvas / ResizeObserver / MutationObserver / matchMedia 不可用时滑块退化为纯 CSS 静态呈现 |
| RPC 被拒（如缺少 `sessionId`） | 滑块立刻回滚到上一次已提交档位，不保留假状态 |

## 数据与状态

- **数据传播**：任务文本会复制给 N 个 worker；每个 worker 的最终输出（每路最多 20 000 字符）再复制给 merger。也就是说同一段输入会被多次发送给模型。
- **状态**：只驻留内存，按会话（`agent.id`）隔离，读取不创建条目，上限 `maxSessions`（LRU）。**Host 重启后全部复位**（滑块回到"关"）。
- **不含持久化、不写配置文件、不联网**（除模型与子代理自身的调用）。

## 成本

ULTRA N 会额外启动 **N 个分析 agent + 1 个合并 agent**。但实际 token 消耗**不是固定的 (N+1) 倍**：

- merger 要重新读入各分支输出（最多 N × 20 000 字符）；
- 主 agent 还要基于工具结果继续答复；
- 部分失败或取消时，已启动的分支可能已经产生消耗；
- 合并失败也会消耗 merger 的额度。

UI 在首次拖到 4/5 路时会弹一次确认（记在 `localStorage` 的 `dsh-ultra-mode.risk-ack`，清掉即会再次提示）。

## 从源码构建

```bash
DSH_PROFILE_STORE=~/.dsh/profiles/node_modules/@deepseek-ai/dsh/node_modules \
  bash scripts/build.sh        # host: tsc → lib/
pnpm run build:client          # client: tsdown → lib/client.js
pnpm test                      # 纯策略单测（node:test）
```

- 构建脚本优先使用**运行时包 store**（`~/.dsh/profiles/.../@deepseek-ai/dsh/node_modules`，含编译产物），可用 `DSH_PROFILE_STORE` 覆盖；`DSH_CHECKOUT` 指向源码 checkout 时作为回退，但该 checkout 必须已编译出 `lib/`。
- `pnpm test` 只依赖 `lib/ultra.js`（纯函数），不需要 Cordis 运行时。
- 在完全干净的环境里 `pnpm install` 可能因 DSH 生态部分 peer 包尚未发布到公共 npm 而失败（例如 `@deepseek-ai/dsh-compact` 返回 404）；本仓库随源码附带 `lib/` 产物，因此**安装使用不需要构建**。若要自行构建，请复用上面提到的 store 或 DSH checkout。

## 许可

BSD-3-Clause。
