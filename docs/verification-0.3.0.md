# 0.3.0 验证记录

目标宿主：DSH Desktop / Host 0.2.0-rc.2。该版本将决策提示词内置到规划、运行中跨路协调和最终交付过程，修正研究工具可见性，并提供普通子代理的宿主创建身份。

2026-10-11 的本机构建、host/client 严格 TypeScript 检查通过；最终使用 Windows Node 24.18.0 的 `node --jitless --test test/*.test.mjs`，76/76 项测试通过，无失败、取消或跳过。默认 JIT 的两次全套执行中，76 项断言均通过，但 SDK 测试子进程在退出阶段发生 V8 `Check failed: node->IsInUse()`，因此默认命令不能记为全套通过；该 SDK 文件单独运行 4/4 通过。测试使用 `--jitless`，没有修改 DSH 的启动参数。实际 SDK 集成测试通过 `DSH_ULTRA_TEST_SDK` 指向从本机安装包提取的 SDK。普通开发安装缺少完整 SDK peers 时，这 4 项集成测试会明确跳过，不能把跳过写成通过。

测试覆盖运行中跨路改向、同一 decision 串行、已完成路线拒收、没有新进展时无请求、显式轮数上限、默认不限模式连续 7 轮、异常 JSON、取消与清理。研究 schema 对齐、native/PTC/both 恢复、问题工具桥、子代理创建身份和后代进展归属使用真实 ToolRuntime、scope 与 SessionStore 另做检查；这些测试中的 agent driver 是小型 fixture。

## 实际 SDK loop 和原生子代理集成

以本机 DSH 编译后 Cordis、AgentRegistry、AgentLoop、SessionStore、ToolRuntime、preset、原生 subagent provider、sandbox 和 approval 服务运行，模型 adapter 使用完全离线的脚本化 fixture。未启动或控制 DSH 应用、未请求真实模型 API。

| 执行路线 | 父工具呈现 | 独立 loop 总数 | 实际普通子代理 | 已进入后续请求的改向 | 额外 worker turn | 活跃内部残留 |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | native | 4 | 3 | 3 | 0 | 0 |
| 4 | ptc | 5 | 4 | 4 | 0 | 0 |
| 5 | both | 6 | 5 | 5 | 0 | 0 |

同一个 decision ID 按规划、运行中协调、最终收敛依次完成 3 轮；所有实际 dispatch 使用 Max。工作路线的当前请求被测试 gate 保持，收到真实 `Agent.steer` 的 next-step inbox 消息后才释放。即使该请求只返回纯文本 stop，改向仍被宿主写入同一 turn 的 user/message，并被下一次模型请求看到。这证明进入模型上下文，不把入队或模型文本自述作为替代证据。

研究与协调阶段不暴露 pwsh/workflow/write/run_code schema，fixture 强行请求 write/pwsh/run_code 也被实际工具运行时拒绝。最终 decision 才恢复父工具呈现与 workspace-write 权限，并执行唯一一次模拟写入。3 路取消、PTC 热卸载另各一组通过，原生子代理和内部路线全部 drain；registry/session/fixture stream 残留为 0。

这些检查证明通道与生命周期，不能证明真实模型会做出有用的方向调整、实际代码改动质量或长期稳定性。0.2.0 的真实模型证据见 [历史真实模型记录](real-model-0.2.0.md)，不能代替此版本新能力的真实验收。

## 实色 UI 和本轮真实模型结果

插件构建产物在独立 React 18 浏览器 fixture 中检查浅色、深色、5 路选择、跨路协调状态和保存错误。宿主菜单 token 特意设为 alpha 0.55；实际按钮、菜单、选项及错误背景的 computed alpha 与 opacity 均为 1。此证据不是 DSH 原生窗口截图。

实际 DSH 的 0.3.0 五路算术已完成并只读核对：5 个独立 depth 0 worker 各调用 1 个普通子代理，5 个 child 的 origin=subagent、depth=1、turn completed，实际回复为 14/30/55/91/140；全部 13 个记录的请求配置为 Max。5 路 turn 共同活动 7854 ms；这不等于精确网络请求区间。同一个 decision 完成规划、3 次协调、最终交付共 5 轮。

前两次协调未提出指令，第三次提出 2 条。第三次响应返回时目标已完成，宿主接受数和实际注入数均为 0；不能把此轮算术写成真实改向通过。最终 decision 对第 5 路的 ID 列表与 finished 通知作了不准确的证据描述，审核日志确认这些证据实际存在。

第二段代码审查在上一任务尚未完成时进入主 turn 的 next-step，旧入口只按 step 1 调度，导致没有第二份 Ultra 载荷并受到上一交付锁阻止。现已改为实际认领且准入的新用户消息作为任务边界，新增 4 项入口回归检查；修复后实际 compiled AgentLoop 另做离线边界验证：第二条真实用户消息经 Agent.steer 进入同一主 turn 的 next-step，两条任务串行完成 2 组独立 3+1 路线和对应通知；后续 3 次主会话写入均被拒绝，路线全部释放后 registry/session 残留 0。此检查仍是离线 fixture；修复后真实代码审查待复验。浏览器访问原有 DSH Web 地址返回 ERR_BLOCKED_BY_CLIENT，未改端口或另启应用服务规避。

正式发布条件仍为实际 DSH 中验证新版本按钮、3–5 路独立循环、每路普通子代理和运行中改向。工具禁止自动操作 DSH 时由用户操作界面，开发者只读核对相应运行记录；未通过之前使用预发布标记。

Jev 的真实账户调用、连续长任务及未来宿主版本兼容性尚未验证。默认每有新进展可反复协调，最短启动间隔 1 秒，轮数不限；整个运行仍受 timeoutMs 和用户取消约束。
