# Ultra 证据与上下文实施记录

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在保留手动模式和权限边界的前提下，使 Ultra 的研究、协调和辅助共用可恢复的证据与状态。

**Architecture:** 原始宿主日志保持权威；插件原子记录存放来源、词项、语义关系和状态版本，Markdown 单向派生。检索执行器根据真实 Agent、项目、根 lineage 授权。新路线使用精确要求与入口包；可选无模型 pruning 接入宿主 surface replace。

**Tech Stack:** TypeScript / Node.js builtins / DSH 0.2.0-rc.2 / React / node:test。

**Spec:** [中文使用与架构说明](../../evidence-context.md)，依据本次用户的九部分要求与十项验收用例。

## 全局约束

- 保留关闭、Agent＋决策辅助、手动 2～5 路；不自动加路或增加默认付费调用。
- 不推送、不发布、不安装到日常 DSH、不运行付费长测。
- 证据缺口、估算与未知均明确标示；不索引私有思维链。
- 初始仓库与远端 HEAD 均为 ecf056f，旧本地工作区干净；实施在新的隔离 clone 完成。

## Review Focus

- 跨根、跨项目、伪造 Agent、历史 lineage 缺口必须拒绝。
- 宿主预保留文本与最终日志不同，不能把短预览当完整原文。
- 同步回调中的索引失败不能改变成功工具的结果。
- 原生 surface 改写须先 checkpoint 并保持真实工具配对／冷重放。
- 预算检查须覆盖完整结果元数据、schema、系统消息、在途与未知请求。

## 分阶段任务

- [x] 核对 README、架构、SDK、旧源码线索、权限与测试基线；记录锁文件安装差异。
- [x] 原子来源／分块库、校验、幂等、竞争写与损坏拒绝；原文独立词项路径。
- [x] 宿主预保留捕获／精确引用提升；执行器 ACL 与 worker→decision 读回。
- [x] 引用穿过进展／最终报告截断；保持路线编号与调用次数。
- [x] 语义候选、替代／冲突、状态版本、主题 MD 和状态分页。
- [x] 路线上下文入口、精确人类要求、原生可选 pruning、持久检查点和重放测试。
- [x] 调用／usage／估算账本、在途预算、失败退出、菜单详情。
- [x] 增量索引元数据缓存、重启游标；修复完整 JSON 预算边界。
- [x] 原有模式回归、实际 SDK 组合、真实 ToolRuntime 与 Session 离线校验。
- [x] 中文说明、配置、迁移／回滚、候选构建／溯源／打包。

## 审查处理

独立审查的失败压缩快照兼容性与失败 attempt usage 两项均有针对性失败测试和修复。另补初始化失败回滚、从实际根逐层核对权限、工具预捕获后操作状态、分离 Session 的 checkpoint、检索自索引排除、全结果预算及项目操作账本按需分页。没有采用或隐藏“mock 通过即可推断长期任务质量”的结论。

完整 Loader／日常桌面安装及真实模型 A/B 属于明确未验证项，需另行授权，并未列为已完成测试。
