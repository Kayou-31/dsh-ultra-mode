# Companion Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 可自由选择的Memory/Decision独立附属包，与完整Ultra共享源代码并同步验证。
**Architecture:** 原生Cordis唯一证据服务＋lease复用底座；完整/decision两种入口共用根index策略，独立包自包含构建，不另造宿主框架。
**Tech Stack:** 当前Node/TypeScript/esbuild/原生DSH，零新增依赖。
**Spec:** ../specs/2026-10-18-companion-packages-design.md

## Global Constraints
- 本计划叠加global-knowledge计划，原268文件before仍为本轮交付基线；既有dev.2成果与本轮新知识模块都保留。
- 用户已确认整组Decision能力独立，并明确主体完整与同步；无需重复询问实施授权。
- 无在线模型、日常安装、push/发布；原生测试统一gate2，真实未运行内容明确未验证。

## Review Focus
- 跨bundleMemoryRun绑定和服务生命周期不能重复捕获、计费、压缩或多启动decision。
- 插件加载顺序/卸载/配置权威切换不能泄露或破坏另一个模块。
- Decision附属入口不保留可绕过的多路线工具/命令/RPC；完整Ultra原入口均保留。
- 独立TGZ不依赖仓库路径、未发布npm包或另一个附属包；版本/来源可核对。
- 同profile授权、原文hash、撤权、预算、工具取消提交栅栏继续全部成立。

### Task A: 共享证据服务与Memory入口（代理所有）
Files: new src/evidence-support.ts,src/memory-plugin.ts; modify src/memory-host.ts,knowledge-integration.ts; new tests.
Interface: acquireEvidenceSupport(ctx:Context,config:MemoryConfig&{globalKnowledge?:unknown},options:{owner:'ultra'|'memory'|'decision',isUltraEnabled?:(agent:Agent)=>boolean,canPublish?:(agent:Agent)=>boolean}):{memory:UltraMemoryHost,captureStatus():unknown,knowledgeStatus(agent):unknown,readTools:readonly string[],release():Promise<void>}.
原生根context提供ultraEvidenceSupport，lease refcount+优先级memory>ultra>decision。唯一注册项目检索、捕获/session-event、llm观察、beforeStep及恢复notice、全局知识、普通MemoryRun生命周期；最后释放排空。所有hooks/tools由独立原生effect组持有，不随单个用户owner卸载。
memoryFor/beginMemoryRun先查共享服务memory的实际绑定，再走原有fallback；提供runFor(agent)受caller验证。KnowledgeIntegration允许提供跨bundle发布角色谓词，ordinaryEvidenceEnabled配置支持Memory单独运行时即使globalKnowledge关闭仍启用项目证据。
- [x] TDD：lease复用/计数不重复、配置优先级、加载顺序、单lease释放仍用、最终清理、跨bundle绑定、全局关闭下Memory独立检索与压缩入口。
- [x] 实现服务与Memory入口Config/inject，Memory default不启动模型，压缩仍显式false。

### Task B: 完整/Decision入口与三包构建（root所有）
Files: index.ts/client/index.ts必要小开关；new decision-plugin.ts；packages/*/package.json/src/index.ts/cordis.patch.yml；scripts/build-companions.mjs。
- [x] 根index消费共享服务，不再重复装memory hooks/tools；默认完整入口不变。
- [x] apply可接内部variant=decision：只提供Team/模型池/辅助，/decision和独立RPC/UI；禁用ultra_task与2～5路所有入口。原生owner防完整Ultra+Decision重复激活。
- [x] 自包含ESM bundles（native peer外置），复用同一client源决策菜单只含off/assist；根构建同步三包，附属package源位置和core源hash写清单。
- [x] 原有单测保留含义；新增variant与包独立性/共享来源断言。

### Task C: 原生独立及组合验收（验收代理）
- [x] 修复已观察的宿主schema DSL required标记及驱动Settings服务缺口后重新pack。
- [ ] 独立Memory跨项目core/foreign/resume，Decision协作/两候选/实际工具/只读旁路；Memory＋Decision两种加载顺序和卸载一项后保持功能，额外完整Ultra+Decision重复入口拒绝。
- [ ] 最终三个精确包SHA重新跑，实际模型请求/工具/JSONL与脚本断言分层记录。

### Task D: 文档、全量复审与交付
- [x] 中文三个安装组合、配置权威、目录、共享源、限制、迁移回滚；保留历史验证归属。
- [ ] 新旧SDK全套+benchmark+根/附属类型/构建，独立最强reviewer审查并修复。
- [ ] 新输出目录三个TGZ＋源码ZIP＋incremental patch＋来源/验收/hash，字节及正反补丁核验；日常四文件fingerprint保持。

## Execution ledger
- 接受用户新范围：两个独立附属包，主体完整，两个附属也可组合。
- 原global知识实现已完成源/权限/版本/预算单元回归，首次原生装载暴露sources.items.required DSL误用；root已改属性required:true。驱动缺Settings/ConfigEditor已修复。取消栅栏已透传signal并复审。
- Ruling：附属build复用根src而非复制算法；一个scope只保留一个协调主体，重复完整Ultra＋Decision启用明确拒绝；Memory底座原生共享，支持两个附属组合。
- Task A: complete；独立审查发现非首次配置切换失败会污染队列，回归先红后绿修复，原审查者复审无新P1/P2。保留失败租约报错，后续权威切换可恢复；兼容无ctx.get的既有注入工厂。
- Task B: complete；两个精确SDK的真实Cordis独立bundle测试验证重复协调入口被拒绝，卸载后另一入口可正常启用，无额外模型请求。
- 统一构建与旧SDK/前端/新SDK类型检查通过；一次完整回归在两个SDK各478项，476通过、2项Windows链接权限跳过；benchmark参考断言66、在线模型请求0。后续新增或修复后以最终交付报告为准，不累加重复运行。
- 原生早期Ultra及Memory独立包均通过core/foreign/resume。Decision早期夹具误将评分kind字段保存进模型池；保留失败记录并修复夹具，等待新包重测。以上早期包不是最终交付哈希。
- 最终审查的证据配置权威P2：Memory开启／协调本地关闭漏观察及反向停用的活动运行已修复，增加真实独立bundle双加载顺序、预算与只读路线、停用缺口及持久化失败用例。490项回归快照两SDK各488通过、2跳过；后续初始化竞态修复以最终报告为准。
- Ruling：将复审发现的初始化await窗口纳入同一权限边界修复，跟踪尚未完成初始化的运行并在关闭时排空，而不交付已知的停用区间回填漏洞；代价是追加一次构建、回归与精确包验证，不改变功能范围或额外调用模型。
- 初始化竞态新增四项回归先红后绿，覆盖两种恢复顺序、末lease关闭、初始化失败清理；24项authority/support、28项host及noEmit通过，最终原生包继续在冻结后验收。
