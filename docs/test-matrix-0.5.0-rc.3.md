# rc.3 测试覆盖与证据边界

最终运行结果以交付目录 verification.json、rc3-model-verification.json 和原始公开收据为准。下表是检查入口；列出测试不等于宣称所有真实业务场景通过。

| 用户验收项 | 自动化入口 | 真实宿主／模型验证与边界 |
| --- | --- | --- |
| 一次性早期限制压缩后保留 | context-memory：exact historical human constraint；oversized instructions | 长线模型保留标签、禁止发布与重做；确定性压缩保护用户原话，没有测试任意生成式摘要链 |
| 长工具尾部在进展截断后可检索 | capture-memory：actual ToolRuntime；memory-host：worker discovery | 双路模型的 bounded preview 不含尾部，decision 经原始索引取回 |
| 答案不在摘要仍能找回 | evidence：lexical search；memory-regression | drift 原值不在公开进度与压缩首尾预览，后续仅允许从归档获取；原始来源靠后再附无关尾段 |
| 两路冲突独立取证 | evidence-integration；report-memory；orchestrator | 两组 Max 双路严格12/12；主 Agent 长线也保留双方，不自行选边 |
| 新决定替代旧决定 | evidence：supersession/public current and superseded | 长线用户决定两次更新；模型需恢复最新与旧版状态。结构化 supersedes 关系单独由单元／宿主验证 |
| 重启、取消、半写与幂等 | evidence：torn writes/corruption/multiple instances；memory-host：checkpoint retry | 实际 JSONL 冷恢复及流取消；写入故障为明确注入，未做物理断电／真实磁盘满 |
| 项目与会话隔离 | evidence ACL；memory-host forged/unrelated root；memory-sdk | 独立 Loader 执行器拒绝跨项目／无 lineage／伪造调用；不是对所有宿主漏洞的安全证明 |
| 多次压缩后不重做 | memory-host operation recovery；context-memory replay | 原生重启后 executed/未验证保持，fixture_execute 哨兵为0；不推断任意业务副作用幂等 |
| 检索有预算，不重撑满 | evidence serialized exact-boundary；tiny pages；context budget | 完整 JSON 返回受预算；整个实际请求仍可能因最近大结果超30K软目标，超额独立记录 |
| 辅助与并发保留权限 | memory-sdk；runtime-loop；assist/orchestrator/runtime | 原生关闭／辅助／两路检查；2–5调度模拟持续覆盖。测试全模型 gate≤2，生产路线数量配置本身不是总流量闸门 |

## rc.3 新增修复的负向检查

- 原文引文错误、跨权限、宿主原文改变、附件仅引用、预算不够：拒绝伪造或静默截断 citation。
- 工具 resourceId 与正文内部别名不同：从实际 call 参数建立关联；call/result 中间重启后恢复；旧无关联记录不猜。
- 报告仅属于当前只读 worker；非法证据、root/decision/child 身份、post-execute 拒绝和取消均不能伪装完成。
- 规划实际 tools=[]；即使模型编造全局／本路工具调用也被执行器拒绝；研究与最终阶段恢复各自权限。
- Max与阶段 cap、0继承、请求数不增加、失败不自动重试；协调测试以事件屏障和受控时钟排除负载相关定时器竞态。

## 可复现命令

```powershell
npm ci --ignore-scripts
npm run build
npm run typecheck
# 对应SDK包含AgentLoop等真实运行时依赖，不能用缺失后的skip冒充通过。
$env:DSH_ULTRA_TEST_SDK = '绝对路径/提取版rc.2/node_modules'
npm test
npm run test:benchmarks
node scripts/memory-regression.mjs ./work/memory-regression.json
node scripts/stress-evidence.mjs ./work/citation-stress.json
node --test scripts/host-acceptance/real-model/repair.test.mjs
```

离线独立 Loader 复测通过 scripts/host-acceptance/run-profile.mjs，依次 core/resume/disabled。在线组件默认不加载，无密钥；要配置独立 profile、实际 provider 与全模型门限后显式启动。不能把本地脚本 adapter、SDK 组合、真实模型、桌面 UI 四层互相替代。
