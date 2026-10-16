# Max报告与来源引用修复计划

> **For agentic workers:** 使用 systematic-debugging 和 test-driven-development；按接口边界并行，最终统一真实宿主复测。

**Goal:** 修复Max研究报告收口与资料ID混淆，交付独立profile实测候选。

**Architecture:** worker用原生concludeTurn提交短报告，不增加模型请求；阶段预算走原生agent/request。只读get新增quote验证，返回规范证据ID与原始工具资源ID，保持原文独立和ACL。

**Tech Stack:** TypeScript、DSH 0.2.0-rc.2、原生pi-ai、Node test。

**Spec:** 本会话用户要求；现有 evidence-context.md 的权限及无额外默认调用约束继续有效。

## 全局约束与审查重点

- 所有在线请求仅naizhi/deepseek-v4.1-flash，合计并发≤2；同一测试home内阶段顺序运行。用户后续授权同步对照，两臂需独立home、各并发1，禁止第三组同时请求；日常环境只读。
- 保留Max与原手动模式；预算默认0继承，不自动重试、不增加默认付费调用。
- 取消优先于报告；错误ID、伪造调用者、后代均不能提交所属worker报告。
- quote只验证连续原文及定位，不验证事实或授权；预算不足拒绝，禁止静默剪短已验证引文。
- 保留已有rc.2失败及不同构建哈希，单元、真实宿主、真实模型分别报告。

## 任务1：规范引用

- [x] 在evidence/memory-host测试新增真实红测：外层vendor-a与正文A编号不同、重启保留、错误引文/ACL/预算拒绝。
- [x] evidence.ts保存可选工具origin，get({quote})返回citation；memory-host从真实call参数获取资源id，index.ts注册quote参数。
- [x] tsc与相关证据/真实SDK组合测试通过；旧记录无origin仍兼容，不推断别名。
- [x] 真实naizhi核对引用并用冻结评分器验证，不后处理修正答案；两组Max严格12/12，长测格式偏移单列。

## 任务2：Max报告收口

- [x] runtime及orchestrator测试先红：阶段cap、原生concludeTurn、取消与非法证据ID。
- [x] 仅worker安装ultra_submit_report；report text/evidenceIds/unknowns/conflicts在宿主验收，原生completed后作为报告。规划/协调/最终decision不可调用。
- [x] 四阶段cap通过agent/request生效，Max保持；0继承。
- [x] 完整测试、真实SDK和独立Loader复测；最终交付包仍须单独核对。

## 任务3：实际压力测试和交付

- [ ] 同fixture重测原Max失败路径；新增未知答案变体、扩大工具结果、多次prune/冷恢复、取消/续跑；逐组记录请求、用量和延迟。
- [ ] 不预设绝对无损结论；遇失败先定位、不盲增并发/重跑。
- [ ] rc.3 TGZ、源码ZIP、补丁、中文说明、包来源哈希核对；测试凭据副本删除，日常指纹一致。

## 追加：双臂长任务受控对照

- [ ] 固定原版包来源、候选运行时字节、同一fixture和公共提示/12项判分；不要求原版调用新增记忆API。
- [ ] 独立两个home，每臂gate=1，先冻结并离线检查隔离与配置；当前长测退出后才启动双臂。
- [ ] 两臂相同前三轮、4次长结果压力轮、同根冷恢复后三轮；不自动重试或事后修正评分。
- [ ] 汇报事实/限制保留、实际读回、失败及返工、全部已知token和未知usage、墙钟与等待；缓存、压缩方式和单样本局限单列。
