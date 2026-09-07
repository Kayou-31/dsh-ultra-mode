# dsh-ultra-mode

ULTRA 并发模式插件（DeepSeek Harness / DSH Desktop）：像 GPT Pro 那样——**一次处理一件事时并发 N 个独立 agent（self-consistency），再由第 N+1 个 agent 交叉核对并合并成一份最终答案**。composer 输入行右侧配了一个敢死队级的辐射滑块（执行时还有"烧额度"光效），外加 `/ultra` 命令与提示词自动引导。

## 效果演示

```
你：用 ultra 分析一下这个仓库的架构
（滑块 ULTRA 3）
→ ultra_task：3 个独立 agent 并行分析 → 合并者交叉核对 → 一份汇总答案
→ 我：直接给你基于合并结果的最终答复
```

## 功能

| 功能 | 说明 |
| --- | --- |
| `ultra_task` 工具 | 并发 N（2-5）个全新子代理处理同一任务，全部完成后第 N+1 个合并代理输出统一答案；分支全挂会报错，合并失败退化为分支拼接，不吞成果 |
| composer 滑块 | 输入行右侧辐射滑块：拖到最左=关，往右 2/3/4/5 路；执行期间滑块进入"燃烧态"（金橙光带 + 白热 knob），直观感受额度流逝（悲） |
| `/ultra` 命令 | `on` / `off` / `<2-5>`，与滑块状态双向同步 |
| 自动引导 | 提示词段说明"ULTRA 开启时每个新请求先 ultra_task 再作答" |
| 会话隔离 | 状态按会话（agent.id）隔离，多会话互不串扰 |
| max 思考 | 分支请求不显式携带 effort；配合部署默认档位（如 `llm-deepseek.reasoningEffort: max`）即为"全 max" |

## 安装

作为 bundle 插件安装（推荐 DSH Desktop）：

```bash
pnpm add link:../dsh-ultra-mode   # 在你的 profile 目录
```

并把 `dsh-ultra-mode` 加入 profile `package.json` 的 `dsh.profile.bundles` 列表，然后重启 Host。

## 配置

```yaml
- insert:
    - id: ultra-mode
      name: '@dsh-external/dsh-ultra-mode'
      config:
        provider: ''        # subagent provider 名；留空自动探测（spawn → 首个可用）
        toolName: ultra_task # 模型可见工具名
        concurrency: 3      # 默认并发路数 2-5
        sectionOrder: 117.5 # 提示词段插入顺序
```

## 兼容性

- `tools` / `subagents` 是核心依赖；`commands` / `systemPrompt` / `connection` 为软依赖，缺席时对应功能（命令 / 提示词段 / 滑块）自动裁剪，不抛错。
- 无 `connection`（terminal-only）时滑块不渲染，`ultra_task` 与 `/ultra` 仍可用。
- canvas / ResizeObserver / MutationObserver / matchMedia 缺失时滑块降级为纯 CSS 静态呈现。
- 亮/暗主题自适应；`prefers-reduced-motion` 用户自动关闭流动动画。

## 成本提醒

一次 ultra = N 个分支 + 1 个合并者 = **（N+1）个完整 agent 会话**，默认 3 路时约为单路成本的 4 倍。开启前请确认额度余额（悲）。
