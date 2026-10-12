# 0.4.0-rc.1 候选版验证

本候选版增加独立子代理协作层，保留 Ultra 辅助与并发层。正式 Release 仍为 v0.3.2；本次候选包不改写该版本标签、安装包或历史失败记录。

## 本次验证范围

- 源码构建及 Host/Client TypeScript 类型检查。
- 协作协议：后台创建稳定 ID、创建容量预约、早到完成、消息不唤醒、显式续作、多目标事件等待、cursor 防重复、权限关系、失败及取消、进行中投递排空。
- 原生接线 fixture：调用官方 rc.2 公共 continuation 接口的参数、继承设置、深度、工具可见性、创建窗口、可续接 ID、owned-only drain 和 relay 来源/清理。该 fixture 使用离线替身，不是完整 continuation manager 的真实模型集成。
- 原有真实 SDK 工具/作用域/审批桥测试：补齐 devDependencies 后，原先因依赖不可用而跳过的五项可运行并通过。
- 两个会话开关独立：普通 Agent 可单开协作，不创建 Max decision；Ultra 的协作选择传给实际路线；会话隔离、RPC 原子校验、取消和卸载。
- 业务 fixture 参考实现共 66 项检查；只证明 fixture 与验收器有效。

本机最终构建、Host/Client 类型检查通过；172 项测试中 171 通过、0 失败、1 项目录链接检查因权限跳过，五项原真实 SDK 检查已通过。66 项业务参考检查通过。真实客户端组件使用模拟 RPC 的浏览器 fixture 通过双开关、会话隔离、菜单视口和桌面/手机布局检查。最终 TGZ 的 SHA256 记录在本次交付记录中。目录链接检查在本机权限不足时仍单独跳过；CI Windows/Linux 结果须以实际 workflow 为准。

## 未验证范围

尚未用真实 DSH GUI/模型跑新增协作模式，没有测得相对普通 Max 的业务质量、成本或时延优势。官方 SDK 公开契约与离线测试不能替代真实 provider、持久化冷恢复与长任务验收。单个 Agent turn 正常完成仍不表示业务正确。该版本没有自动 worktree、费用硬上限或跨兄弟代理通信；消息/续作遵守直接父子关系，中断遵守后代关系。

## 重跑

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run typecheck
npm test
npm run test:benchmarks
```
