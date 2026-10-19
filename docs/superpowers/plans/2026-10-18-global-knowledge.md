# Profile Global Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 同一profile下按用户项目授权发布、跨项目检索并核验有来源的知识。
**Architecture:** 项目证据保持权威；新增profile范围不可变发布库；宿主服务解析授权和来源，现有原生工具链调用。关闭时不改变原行为。
**Tech Stack:** TypeScript、Node fs/crypto、DSH0.2.1-rc.2，旧0.2.0-rc.2回归；无新增依赖或在线模型。
**Spec:** ../specs/2026-10-18-global-knowledge-design.md

## Global Constraints

- 保留现有全部未提交修改；源码基线为work/global-knowledge-checkpoint/before的268文件，不是旧ecf056f HEAD。
- 当前checkout+逐字节快照继续作为工作恢复点，真实Git索引不改、不commit/push；用户已明确要求按批准方案持续实施，不重复请求设计授权。
- globalKnowledge默认关闭；profile目录必须来自宿主，所有读写重核当前授权，worker/辅助/普通子代理无知识写权限。
- 独立profile验证，无日常安装、凭据读取或付费模型调用，全局最多双并发离线stream。

## Review Focus

- ACL先于标题/摘录/命中统计；不同profile和未授权project/session均不能越界。
- 热撤权及新读者不能追溯扩大旧发布；原文核验只返回已共享片段。
- 过期、替代、撤销及幂等发生在原子写锁内，失败不损坏旧数据。
- 来源引用真实不等于模型结论已验证，source缺失/hash变化不得虚标matched。
- request预算包括JSON元数据，旧关闭/辅助/并发/模型池无额外调用和权限变化。

### Task 1: 不可变知识发布库
Files: new src/knowledge-store.ts, test/knowledge-store.test.mjs.
Interfaces: KnowledgeSource{sourceId,projectId,sessionId,sha256,sourceVersion,start,end,quote}; KnowledgePublication{publisher,key,title,summary,applicability,topics,readers,sources,supersedes?,expiresAt?}; KnowledgeRecord adds id/profileId/revision/createdAt/status(current|superseded|revoked|expired). KnowledgeAccess{projectId,publisherIds:readonly string[]}; KnowledgeQuery{query?,topic?,publisher?,offset?,limit?,includeInactive?}.
KnowledgeStore(directory:string,profileId:string,options?:{now?:()=>number,maxEntries?:number}); publish(input):KnowledgeRecord; revoke(publisher:string,id:string,reason:string):void; search(access,query):{items:KnowledgeRecord[],total:number,nextOffset?:number}; get(access,id,includeInactive?:boolean):KnowledgeRecord|undefined.
- [ ] 写失败测试：空库、发布/重启、幂等、替代、撤销、过期、先ACL后计数、损坏JSON/checksum、部分写入与锁冲突。
- [ ] 实现有界校验、profile绑定、发布/撤销原子记录及锁、当前授权读视图；读取返回副本。
- [ ] 编译并跑专用测试，记录红/绿和文件归属；不修改其他任务文件。

### Task 2: 宿主授权及来源核验
Files: new src/knowledge-host.ts, test/knowledge-host.test.mjs.
Interfaces: GlobalKnowledgeConfig{enabled?:boolean,projects?:{id:string,root:string,read?:boolean,publish?:boolean,shareWith?:string[]}[],maxSearchChars?:number,maxGetChars?:number}; GlobalKnowledgeHost(ctx:{get(name:string):unknown},memory:UltraMemoryHost,config:()=>unknown,canPublish:(agent:Agent)=>boolean). Methods search(agent,query),get(agent,{id,offset?,maxChars?,includeInactive?}),publish(agent,input),revoke(agent,{id,reason}),entry(agent):string|undefined,status(agent).
- [ ] 失败测试配置默认关闭、假caller/项目/会话拒绝、精确quote/hash、跨项目授权和撤权、来源消失、分页JSON预算与另一profile。
- [ ] 实现profileContext.dir与真实root绑定，复用memory.access及EvidenceStore核验，不暴露跨项目原文读取器。search/get异步，以JSON实际序列化计算预算。
- [ ] 专用测试通过，向root说明接口与边界。

### Task 3: 原生插件接线与兼容
Files: new src/knowledge-settings.ts; modify src/index.ts, runtime.ts and corresponding tests.
- [ ] 为默认关闭/新四工具/精简入口/强制worker写拒绝及原生参数透传写失败测试。
- [ ] 添加原生Config schema，注册search/get/publish/revoke工具；worker仅有读工具，execute再核canPublish。可写route只限实际在运行的该route Agent；普通根Agent可写，普通嵌套子代理不能写。
- [ ] 更新VM测试真实模块导入映射并回归，无放宽原有测试；版本0.6.0-dev.3。

### Task 4: 独立profile闭环
Files: new scripts/host-acceptance/knowledge-profile-plugin.mjs, run-knowledge-profile.mjs and test/knowledge-driver.test.mjs.
- [ ] 明确纯脚本驱动断言与真实JSONL检查，复用现有network guard与stream gate2。
- [ ] 最终TGZ冻结哈希的projectA→发布→projectB检索/核验，越权/撤权/冷恢复及旧mode关键路径；所有profile专用新空目录。
- [ ] 真正经原生ToolRuntime传参执行并检查后续实际请求；不将直接注入结果冒充工具或模型能力。

### Task 5: 审查、回归与交付
- [ ] 独立全量代码审查（来源/ACL/并发/预算/生命周期），修复并复审。
- [ ] 新旧SDK全套、build/typecheck、benchmark参考断言和最终精确TGZ的原生CLI验收。
- [ ] 中文使用/授权配置/架构/版本来源/迁移回滚；更新README/CHANGELOG，保留历史成绩归属。
- [ ] 新outputs/global-knowledge-checkpoint：TGZ、源码ZIP、相对before补丁、哈希与分层验收报告；逐字节来源及补丁正反恢复核对，日常四文件fingerprint前后核对。

## Execution ledger

- 268文件before快照完成；日常配置四文件已记录。已有dev.2和历史交付保持原样。
- Ruling: 按用户“就按推荐方案继续开发”的明确授权，本文冻结已批准方案的接口并连续执行，不增加设计往返；无commit以免混入旧工作区修改。
- Preflight接口表：T1产出store/types由T2导入；T2产出host由T3导入；T3工具名由T4调用；T4只新增driver不改T1-T3；T5在冻结后更新docs/打包。无共享源文件并行写。
