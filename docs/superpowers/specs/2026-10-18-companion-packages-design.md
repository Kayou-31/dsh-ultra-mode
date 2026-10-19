# 同仓库的独立附属插件与完整 Ultra 同步

用户新增明确要求：全局知识库＋压缩检索成为独立附属包；普通子代理协作＋模型池＋decision意图/诊断/验收整组能力也独立成包，以便自由安装。主体Ultra Mode保留完整能力，核心实现同步，不复制成三套算法。

## 包与共享来源

- 主包继续是仓库根 `@dsh-external/dsh-ultra-mode`，本轮0.6.0-dev.3，仍有关闭/辅助/手动2～5路、Team、模型池、证据/上下文与全局知识。
- `packages/dsh-ultra-memory/`：独立包 `@dsh-external/dsh-ultra-memory` 0.1.0-dev.1，普通DSH可单独使用项目证据、按需检索、可选原生压缩与显式授权全局知识。不启动任何协调模型或Ultra路线。
- `packages/dsh-ultra-decision/`：独立包 `@dsh-external/dsh-ultra-decision` 0.1.0-dev.1，普通子代理Team六工具、同一模型池、只读decision辅助、意图诊断和可选验收；不提供Max多路线运行入口。默认不额外调用模型，用户明确开启decision辅助后才启动一条旁路。
- 三个产物从根src共享模块构建，附属包是自包含bundle，无未发布的远程包依赖、无运行时指向仓库外路径。构建来源清单记录每包共享源hash，包内提供可读来源/配置文档。

## 组合与唯一所有者

支持主包独立、Memory独立、Decision独立、Memory＋Decision、Ultra＋Memory。Ultra与Decision提供同一协调入口，不允许在同一scope重复主动启用；明确报错并提示选择一个，不默默多开模型或削减主包能力。

Memory底座使用原生Cordis根context服务 `ultraEvidenceSupport`，每个用户插件持有lease。服务拥有唯一工具/捕获/请求/压缩观察器与MemoryHost。最后lease释放才关闭服务；单个插件卸载不破坏仍在用的附属模块。优先配置者Memory附属包 > 完整Ultra > Decision的项目证据fallback，状态/文档明确配置权威；授权每次重核，切换owner不拓宽旧发布快照。

共享服务通过宿主context发现，避免不同bundle内WeakMap割裂：memoryFor/beginMemoryRun复用服务MemoryHost的绑定。发布权限由仍活跃的可信provider角色谓词和原生只读sandbox共同约束，研究worker/辅助/普通嵌套子代理不得写知识。配置权威切换、卸载及插件关闭必须受取消信号和所有者清理约束。

完整Ultra及Decision的协作/协调入口由唯一原生owner标识防重复。Decision只暴露/decision on|off、/team和对应工具/UI/RPC，不能通过工具、命令或RPC开启2～5路。主包默认入口、模式与模型选择不变。

## 验证与交付

继续全局知识原spec的来源、ACL、撤权、取消、预算测试。新增包独立Loader启动、Memory＋Decision组合（两个加载顺序）、主包完整回归、重复协调入口拒绝、卸载一个lease仍可用/最后lease排空、共享捕获与请求计数不重复。真实DSH独立profile＋离线脚本模型统一最多双并发；不跑付费模型、不触碰日常环境、不push或发布。

交付三个TGZ、同仓库源码ZIP、共享来源清单、增量回滚补丁及分层验收报告，明确以上两个目录和实际包哈希。
