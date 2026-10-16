# 真实模型公开验收组件

本目录不自动运行，不属于生产插件入口，不注册模型适配器，不读取密钥。fixture 是合成业务资料；driver 由独立 rc.2 profile 的真实 Loader 加载。没有将脚本答复伪装成模型答复。

部署者须先配置独立 DSH_HOME、profile、cwd 和 OS home，以及原生 provider、credential、preset、AgentLoop、JSONL、命令服务，再挂载上一层的 real-model-global-limit.mjs。所有 worker、decision、辅助和原生压缩请求必须共享该 profile 的 LLM 闸门。该闸门在进程内生效，不是跨进程锁。同一测试 home 中的阶段顺序运行；双臂对照必须完全独立 home，每臂并发 1、最多两臂同时运行，并检查全体实际请求区间，不能双开两个并发 2 的 profile。不要在日常 profile 注册这些 fixture 工具，不要将本机私有 profile／凭据打入验收材料。

driver 配置需提供绝对 runtimeRoot（有 package.json 的提取版 rc.2 根）、ultraRoot（TGZ 安装路径）、projectDir、resultFile、stateFile、provider、model、presetId，以及 mode、sessionId、maxTokens、maxRequests、timeoutMs。runtimeRoot 用于解析对应宿主 SDK；native session 工厂和 appReady/appExit 必须来自真实 CLI。

模式：s0 为两调用工具握手；s1 为手动两路线；s1-recover 使用同 projectDir 和明确 resumeSessionId 恢复失败的两路线；s2／s2-resume 是相同任务前三轮／冷恢复后三轮；baseline-long／baseline-long-resume 用原版同资料任务；long-repair／baseline-long-repair 仅追加同一条无答案值提示、一个原生用户轮次。stateFile 存先前真实根会话 ID，不能为恢复另造会话。所有历史、检索和外部内容保持资料身份，不产生授权。

fixture.mjs 冻结六条共同提示与逐字评分器；严格评分失败不可放宽。每个实际在线 attempt 均保存当时 driver/fixture 副本、原结果及包哈希。交付版 driver 后续增加全零中断 usage 的保守分类；旧结果原样保留，由 model-verification.json 单列更正，不覆盖历史。

regrade-existing.mjs 仅针对已有公开文本和原生 text/usage 事件做离线重评，不调用模型。需明确 --result、--launch、--out，可指定 --session-log。它不会输出 reasoning，也拒绝覆盖原结果。使用 native 原生日志须遵守其私密性，交付时仅导出允许字段。

运行 node --test scripts/host-acceptance/real-model/repair.test.mjs 可验证评分器与未知用量处理；这不证明真实模型会通过。公开实测数值、失败、条件及限制见 docs/evidence-verification.md 和交付报告。

rc.3 可额外配置 requireReportSubmission、requireVerifiedCitations 检查两路原生报告与 quote 服务。driftStress/manualMemory/requireArchivedReadback/stressCycles 属于显式测试配置：关闭自动辅助后直接挂载记忆，前三轮读取两份大结果，再增加8个负载轮，cancel-mid中断实际流，s2-resume恢复同根后三轮。fixture 必须额外提供 load-0…load-7；测试部署者应在启动前验证每份数据尺寸、SHA 与压缩首尾预览中没有目标原值。示例的基础 fixture 不自动扩大为150万字符，部署时的实际生成代码及 frozen manifest 才是数据依据。

取消模式与恢复需要同一 stateFile，取消收据另存 `.cancel.json` 并核对实际原生 aborted seq；恢复同时校验全部 fixture hash。compressionSamples 为真实替换时的估算预算及请求序号，provider usage 单独统计。早期公开值曝光按最终检索前全部已恢复公开 assistant 文本计数，不导出私有推理。最终事实12项、决定版本、归档读回与额外 vendor 专用 quote 协议分别判定；12/12 不等于全部附加断言通过。

`variants.mjs` 只生成合成资料及预检，不读provider、凭据或启动模型。精确variant `drift-diverse` 生成20份各1,000,000字节的不同ASCII操作日志，连同两个早期源约23MB；计划为前三轮+20负载轮+恢复后三轮，共26完成轮，取消另计。普通drift仍为14轮。恢复须传同样stressLoadCount=20，long才执行20 stressCycles；原始目标不在320字首尾预览中。生成源码、完整manifest和实际每份读取的hash分别核对，不能把预检当在线完成。

若最终轮实际遇到传输错误，可明确选择一次 `long-repair` + `driftFinalRecovery:true,maxRequests:8`：同stateFile、同原生会话，只追加一个最终用户轮，不重做之前轮次；四份归档引文回执须在本轮重新取得。保留原TRANSPORT失败及1次返工，不伪称首次成功。工具/评分器不会自动触发该付费恢复。

```powershell
node --test scripts/host-acceptance/real-model/repair.test.mjs scripts/host-acceptance/real-model/variants.test.mjs scripts/host-acceptance/real-model/drift-final-recovery.test.mjs
node --test scripts/host-acceptance/real-model/partial-continuation.test.mjs
node --test scripts/host-acceptance/real-model/readback-recovery.test.mjs
```

这19项离线驱动检查与主套件分开报告。

`continue-long` 只针对明确的 drift-diverse 部分失败收据：核对原 launch/result/preflight 的 SHA、相同根会话、全部已完成原生轮次及工具全文 SHA 后，只执行剩余负载轮。它不重放决定更新，不覆盖原失败。恢复完成和全部阶段首次通过分开记录。请求启动间隔可以显式设置；取消后上游 slot 是否释放仍未知，不把本地流退出当作提供方确认。

最终恢复的人类轮次按原生 `user/message` 的 `source.kind=user` 计数；宿主注入的 `source.kind=ultra-mode` 恢复通知单独统计。两者都进入原生日志，但恢复通知不代表新的用户要求或授权。

`driftReadbackRecovery` 与传输恢复分开：只有前26轮已原生完成、最终公开判分失败，且明确提供原失败文件及 SHA 时，才允许一次最多8调用的同根读回修订。保留旧9/12与返工；只追加一个用户轮，禁止重读新 fixture 或重做前轮。此路径用于验证修复后的检索入口和归档恢复，不是原26轮首次通过，也不能证明补丁单独改变了模型表现。
