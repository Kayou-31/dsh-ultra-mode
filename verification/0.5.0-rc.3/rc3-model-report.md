> 交付前文档更新：新包 SHA256 ed912f4b03ef9ebd51bb51379c4c0a72eb8e3ea3a3d2fa46b3c784e80f6f2410；真实模型实测包 SHA256 291b000ae83863e2ae6cbadb2711665ec996453463d80b9335553217ffe8f5cc。仅 README 与中文说明改变，44 份 lib 文件逐字节一致；新包精确字节已重跑独立离线 Loader 核心、恢复、关闭模式。逐次模型记录保持原哈希，不声称新哈希又跑了一轮模型。详见 final-package-verification.json。

# rc.3 真实模型公开结果

截至 2026-10-16T07:35:54.901Z，仅汇总launch.finishedAt已结束的20个尝试；0个未结束案例排除。汇总器只读公开结果及快照字节哈希，没有启动模型/宿主、读取私有原生日志或修改原始结果。

已观察285次请求，usage已知273、未知12；已知总token小计66,162,179。其中无终止结果且全零等不完整零usage有11条，按未知处理。所有缓存分项与reasoning保持独立，不重复加root-only usage。金额未计算。

峰值：gate=2，公开请求时间区间=2；最大2并发观察=满足；已结束case启动区间不重叠=否。执行耗时合计6224.47s，不含case间等待；不能把并行单请求耗时相加当墙钟延迟。

## 已通过的阶段

| case / variant | 阶段结果 | 请求 | 已知/未知usage | 已知token小计 | 峰值 | 执行耗时 | 最终质量 |
|---|---|---:|---:|---:|---:|---:|---|
| rc3-control-ultra-1792127909470 / control | 最终fixture验收通过 | 22 | 22/0 | 359,478 | 2 | 618.40s | 12/12 通过 |
| rc3-holdout-a-ultra-1792128621532 / holdout-a | 最终fixture验收通过 | 25 | 25/0 | 330,981 | 2 | 332.26s | 12/12 通过 |
| rc3-drift-b-long-1792129564623 / drift-b | 阶段通过，任务未判定完成 | 22 | 22/0 | 10,205,908 | 1 | 277.07s | 此阶段无最终质量判定 |
| rc3-drift-b-cancel-mid-1792129858509 / drift-b | 阶段通过，任务未判定完成 | 1 | 0/1 | 0 | 1 | 2.16s | 此阶段无最终质量判定 |
| rc3-drift-c-long-1792130152025 / drift-c | 阶段通过，任务未判定完成 | 23 | 23/0 | 9,993,935 | 1 | 315.95s | 此阶段无最终质量判定 |
| rc3-drift-c-cancel-mid-1792130470110 / drift-c | 阶段通过，任务未判定完成 | 1 | 0/1 | 0 | 1 | 2.17s | 此阶段无最终质量判定 |
| rc3-drift-diverse-continue-long-1792132397555 / drift-diverse | 阶段通过，任务未判定完成 | 21 | 21/0 | 11,650,027 | 1 | 801.80s | 此阶段无最终质量判定 |
| rc3-drift-diverse-cancel-mid-1792133203225 / drift-diverse | 阶段通过，任务未判定完成 | 1 | 0/1 | 0 | 1 | 6.25s | 此阶段无最终质量判定 |
| rc3-extreme-paired-a-long-1792133646201 / extreme-paired-a | 阶段通过，任务未判定完成 | 24 | 20/4 | 6,027,903 | 1 | 832.33s | 此阶段无最终质量判定 |
| rc3-drift-diverse-long-repair-1792134634434 / drift-diverse | 最终fixture验收通过 | 5 | 5/0 | 984,685 | 1 | 135.86s | 12/12 通过 |
| rc3-holdout-final-ultra-1792135147191 / holdout-final | 最终fixture验收通过 | 28 | 28/0 | 681,465 | 2 | 912.28s | 12/12 通过 |

## 失败或未确认阶段

| case / variant | 阶段结果 | 请求 | 已知/未知usage | 已知token小计 | 峰值 | 执行耗时 | 最终质量 |
|---|---|---:|---:|---:|---:|---:|---|
| rc3-drift-a-long-1792129463867 / drift-a | 测试设计主动停止，非质量失败 | 4 | 3/1 | 546,710 | 1 | 未记录 | 此阶段无最终质量判定 |
| rc3-drift-b-resume-1792129862657 / drift-b | 阶段失败或未确认 | 16 | 16/0 | 1,809,572 | 1 | 134.31s | 12/12 通过 |
| rc3-drift-c-resume-1792130474339 / drift-c | 阶段失败或未确认 | 17 | 16/1 | 1,919,752 | 1 | 235.64s | 此阶段无最终质量判定 |
| rc3-drift-diverse-long-1792131148371 / drift-diverse | 阶段失败或未确认 | 29 | 28/1 | 13,603,776 | 1 | 407.12s | 此阶段无最终质量判定 |
| rc3-drift-c-long-repair-1792132183128 / drift-c | 阶段失败或未确认 | 2 | 2/0 | 208,216 | 1 | 41.15s | 10/12 未通过 |
| rc3-drift-diverse-resume-1792133242925 / drift-diverse | 阶段失败或未确认 | 12 | 12/0 | 2,721,948 | 1 | 357.85s | 9/12 未通过 |
| rc3-extreme-paired-a-baseline-long-1792133646178 / extreme-paired-a | 阶段失败或未确认 | 11 | 10/1 | 3,515,407 | 1 | 303.35s | 此阶段无最终质量判定 |
| rc3-extreme-paired-a-resume-1792134481521 / extreme-paired-a | 阶段失败或未确认 | 11 | 11/0 | 1,516,223 | 1 | 313.91s | 0/12 未通过 |
| rc3-holdout-final-ultra-1792134818963 / holdout-final | 阶段失败或未确认 | 10 | 9/1 | 86,193 | 1 | 194.60s | 此阶段无最终质量判定 |

## 尚未结束，未纳入数字

无已发现的未结束case；这不表示尚未启动的后续极限任务已经完成。

## 已结束case明细

分项已知token：input=25,854,653（273请求报告）；output=519,366（273请求报告）；cacheRead=39,788,160（251请求报告）；cacheWrite=未报告；reasoning=未报告。分项仅列示，不再次加到totalTokens。

报告提交接受7次；16个case提供原生prune快照，按session/seq去重55次；execute尝试全部明确为0=是；清理错误0条。gate请求登记与公开请求数一致=是，末尾active/queue均为0=未满足或缺证据。

启动至退出的已结束case墙钟合计6332.12s；1次请求缺终止时间，公开请求区间峰值仅为有完整端点的观察下界。测试设计主动停止1例。

### 测试设计主动停止

- rc3-drift-a-long-1792129463867：Stopped by test owner: tail-preview answer leakage invalidates the intended omitted-answer experiment；实际调用仍计入，既不记模型质量失败，也不记完成。


### 长线、压缩与预算

| case | 本进程已完成公开轮 | 观察到代次变化 | 带估算预算的请求 | 已报告uncached input范围 | 原值曝光检查 |
|---|---:|---:|---:|---:|---|
| rc3-drift-a-long-1792129463867 | 1 | 0 | 2 | 302～271,170 | 未判定 |
| rc3-drift-b-long-1792129564623 | 11 | 8 | 22 | 163～555,565 | 未判定 |
| rc3-drift-b-cancel-mid-1792129858509 | 0 | 0 | 1 | 未知 | 未判定 |
| rc3-drift-b-resume-1792129862657 | 3 | 2 | 16 | 160～281,753 | 公开驱动限定检查通过 |
| rc3-drift-c-long-1792130152025 | 11 | 8 | 23 | 203～555,994 | 未判定 |
| rc3-drift-c-cancel-mid-1792130470110 | 0 | 0 | 1 | 未知 | 未判定 |
| rc3-drift-c-resume-1792130474339 | 2 | 2 | 17 | 198～281,777 | 未判定 |
| rc3-drift-diverse-long-1792131148371 | 14 | 11 | 29 | 185～547,652 | 未判定 |
| rc3-drift-c-long-repair-1792132183128 | 1 | 0 | 2 | 632～6,553 | 未判定 |
| rc3-drift-diverse-continue-long-1792132397555 | 9 | 10 | 21 | 166～543,962 | 未判定 |
| rc3-drift-diverse-cancel-mid-1792133203225 | 0 | 0 | 1 | 未知 | 未判定 |
| rc3-drift-diverse-resume-1792133242925 | 3 | 2 | 12 | 154～267,800 | 未判定 |
| rc3-extreme-paired-a-baseline-long-1792133646178 | 3 | 0 | 0 | 152～269,730 | 未判定 |
| rc3-extreme-paired-a-long-1792133646201 | 7 | 0 | 0 | 2,077～577,767 | 未判定 |
| rc3-extreme-paired-a-resume-1792134481521 | 3 | 0 | 0 | 254～53,741 | 未判定 |
| rc3-drift-diverse-long-repair-1792134634434 | 1 | 0 | 5 | 714～5,175 | 公开驱动限定检查通过 |

已记录估算预算超出目标148次；30K工作目标尚不能视为每次实际请求都已达成。上述input范围是实际已报告分项，cache另列；不是完整输入或压缩前后同输入对照。逐次估算、邻近真实请求配对、取消与恢复证据在JSON保留。

### 同一原生会话的连续阶段

- drift-a / test-session-c24822c46b54ed86：1个已结束阶段，完整公开轮1，取消阶段0、恢复阶段0；已知/未知usage=3/1，已知token=546,710；冻结12项质量通过=否，全部已观察阶段验收通过=否，核心drift检查通过=未确认，vendor附加协议失败=未记录；恢复取消aborted事件的明确检查=尚无。
- drift-b / test-session-8dace402be8d78c1：3个已结束阶段，完整公开轮14，取消阶段1、恢复阶段1；已知/未知usage=38/1，已知token=12,015,480；冻结12项质量通过=是，全部已观察阶段验收通过=否，核心drift检查通过=是，vendor附加协议失败=已记录并保留；恢复取消aborted事件的明确检查=通过。
- drift-c / test-session-d7d3695463dbf903：4个已结束阶段，完整公开轮14，取消阶段1、恢复阶段1；已知/未知usage=41/2，已知token=12,121,903；冻结12项质量通过=否，全部已观察阶段验收通过=否，核心drift检查通过=未确认，vendor附加协议失败=未记录；恢复取消aborted事件的明确检查=通过。
- drift-diverse / test-session-c9ad70cf072743ac：5个已结束阶段，完整公开轮27，取消阶段1、恢复阶段1；已知/未知usage=66/2，已知token=28,960,436；冻结12项质量通过=是，全部已观察阶段验收通过=否，核心drift检查通过=未确认，vendor附加协议失败=未记录；恢复取消aborted事件的明确检查=通过。
- extreme-paired-a / test-session-6556293a95f02e1f：1个已结束阶段，完整公开轮3，取消阶段0、恢复阶段0；已知/未知usage=10/1，已知token=3,515,407；冻结12项质量通过=否，全部已观察阶段验收通过=否，核心drift检查通过=未确认，vendor附加协议失败=未记录；恢复取消aborted事件的明确检查=尚无。
- extreme-paired-a / test-session-3cc470a01b3953a4：2个已结束阶段，完整公开轮10，取消阶段0、恢复阶段1；已知/未知usage=31/4，已知token=7,544,126；冻结12项质量通过=否，全部已观察阶段验收通过=否，核心drift检查通过=未确认，vendor附加协议失败=未记录；恢复取消aborted事件的明确检查=尚无。

### 按variant区分计划与实际

- drift-a：计划14个完整轮（3+8+3），公开实际完成1轮、其中前置后压力轮0轮；实际足量读取0份load资料、不同来源hash0个。计划轮数已被观察=否，包含取消/原生aborted恢复及全部阶段的计划验收=尚未通过。
- drift-b：计划14个完整轮（3+8+3），公开实际完成14轮、其中前置后压力轮8轮；实际足量读取8份load资料、不同来源hash8个。计划轮数已被观察=是，包含取消/原生aborted恢复及全部阶段的计划验收=尚未通过。
- drift-c：计划14个完整轮（3+8+3），公开实际完成14轮、其中前置后压力轮8轮；实际足量读取8份load资料、不同来源hash8个。计划轮数已被观察=是，包含取消/原生aborted恢复及全部阶段的计划验收=尚未通过。
- drift-diverse：计划26个完整轮（3+20+3），公开实际完成27轮、其中前置后压力轮20轮；实际足量读取20份load资料、不同来源hash20个。计划轮数已被观察=否，包含取消/原生aborted恢复及全部阶段的计划验收=尚未通过。
- extreme-paired-a：计划10个完整轮（3+4+3），公开实际完成3轮、其中前置后压力轮0轮；实际足量读取0份load资料、不同来源hash0个。计划轮数已被观察=否，包含取消/原生aborted恢复及全部阶段的计划验收=尚未通过。
- extreme-paired-a：计划10个完整轮（3+4+3），公开实际完成10轮、其中前置后压力轮4轮；实际足量读取0份load资料、不同来源hash0个。计划轮数已被观察=是，包含取消/原生aborted恢复及全部阶段的计划验收=尚未通过。

### 保留原失败的增量续跑

- drift-diverse / test-session-c9ad70cf072743ac：续跑新完成9个负载轮，完整轮总数27；未重复已完成轮次的公开/原生断言=通过；原rate失败seq在最终恢复中保留=尚未验证。失败保留后的恢复完成=尚未完成；全部历史阶段通过仍=否。

本地并发和30秒间隔仅按各launch及pacing记录列示，不推断上游slot已释放或RPM规则。

### 离线补充引用复核，保留原始判定

- rc3-drift-b-resume-1792129862657：离线补充复核实际交付的冲突引用与host citation一致=是；附加vendor-a/b专用回执=未完成。原状态failed、冻结评分与原有失败均不改变；额外模型调用0。
- rc3-drift-c-long-repair-1792132183128：离线补充复核实际交付的冲突引用与host citation一致=是；附加vendor-a/b专用回执=已取得。实际sourceId引用核验=4/4；本轮人类user=1、恢复notice=1，原计数断言失败保留；原状态failed、冻结评分与原有失败均不改变；额外模型调用0。
- rc3-drift-diverse-resume-1792133242925：离线补充复核实际交付的冲突引用与host citation一致=是；附加vendor-a/b专用回执=已取得。原状态failed、冻结评分与原有失败均不改变；额外模型调用0。

### rc3-control-ultra-1792127909470

包SHA256：57a6fd482a511226b43b9fed9123c01b24b2ba361ce961fefe627defae769113；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-control。

fixture源码快照SHA256：52df4e345b7f4fcff5f3d5367d63c6bb97bc02c0c6c4c4c393cd65f24dbfc3ab；driver快照SHA256：40d03285dd97e957a5fe112e67dab2b0deb21bb89be0bd87b69ff959d0d459fe。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：2次，接受并结束轮次2次，涉及2个session。
- quote服务公开核验：7条去重来源定位，资源=catalog, vendor-a, vendor-b。decision成功get=4；独立读到冲突双方=是；角色识别=one internal route distinct from accepted-report worker routes。
- 原生prune快照数=未记录；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 构建边界：初control包没有planningOnly，不把后续功能算入此结果。

按session/effort/cap分组：

  - test-session-6ca700b8fab73dce：effort=max，cap=65536，3请求，已知/未知=3/0，已知token=65,396。
  - test-session-d31b0ec7ae6dc4bf：effort=max，cap=131072，7请求，已知/未知=7/0，已知token=109,519。
  - test-session-a49f70811f52062d：effort=max，cap=131072，7请求，已知/未知=7/0，已知token=96,478。
  - test-session-6ca700b8fab73dce：effort=max，cap=131072，4请求，已知/未知=4/0，已知token=85,853。
  - test-session-9e6161e82c10f46a：effort=medium，cap=16384，1请求，已知/未知=1/0，已知token=2,232。

### rc3-holdout-a-ultra-1792128621532

包SHA256：b146af03bef1e1bc5bea346aaa53a27eb1c18b6600d3706ab2cac99e93ae3e09；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-holdout-a。

fixture源码快照SHA256：2aa50beed39997299c558e632ed81de9333f1f3644d556d0a67ace232ca1347b；driver快照SHA256：40d03285dd97e957a5fe112e67dab2b0deb21bb89be0bd87b69ff959d0d459fe。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：2次，接受并结束轮次2次，涉及2个session。
- quote服务公开核验：13条去重来源定位，资源=catalog, vendor-a, vendor-b, brief, state。decision成功get=4；独立读到冲突双方=是；角色识别=one internal route distinct from accepted-report worker routes。
- 原生prune快照数=未记录；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。

按session/effort/cap分组：

  - test-session-9ac35d1f5d52850a：effort=max，cap=65536，1请求，已知/未知=1/0，已知token=7,761。
  - test-session-4f7769bb99f87ae9：effort=max，cap=131072，10请求，已知/未知=10/0，已知token=119,142。
  - test-session-7a653a358e206f0c：effort=max，cap=131072，8请求，已知/未知=8/0，已知token=98,464。
  - test-session-9ac35d1f5d52850a：effort=max，cap=131072，5请求，已知/未知=5/0，已知token=103,234。
  - test-session-a86ade25b1cf4e7d：effort=medium，cap=16384，1请求，已知/未知=1/0，已知token=2,380。

### rc3-drift-a-long-1792129463867

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-a。

fixture源码快照SHA256：0c47920eb5fa0f2c3a3190a96609c12f17411b297fb19d4cb3a47278a462046b；driver快照SHA256：9c0bd71375579c7f1f9b70d7f916e2317c8ade1cdf38f4eb8311734cd4d69d28。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=0；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。

按session/effort/cap分组：

  - test-session-c24822c46b54ed86：effort=medium，cap=16384，2请求，已知/未知=2/0，已知token=274,235。
  - test-session-c24822c46b54ed86：effort=默认，cap=未显式提供，2请求，已知/未知=1/1，已知token=272,475。

### rc3-drift-b-long-1792129564623

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-b。

fixture源码快照SHA256：2aa8d0c8812c4af1510c7958d64329f7eb9c1b1501a54eb3643348ac936b18d0；driver快照SHA256：d22872c0d815ad659c1e4e461fa0fe900d7069fba5eedfeed57f75fe38fa62f2。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=8；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。

按session/effort/cap分组：

  - test-session-8dace402be8d78c1：effort=medium，cap=16384，22请求，已知/未知=22/0，已知token=10,205,908。

### rc3-drift-b-cancel-mid-1792129858509

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-b。

fixture源码快照SHA256：2aa8d0c8812c4af1510c7958d64329f7eb9c1b1501a54eb3643348ac936b18d0；driver快照SHA256：fcf2abc588217ceebfa6cec6882fe1cd667f1015d49a3cb7eea4349d880d3647。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=8；原生aborted证据=已观察；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：native real-provider stream admitted before forced cancellation；通过：native cancellation does not claim task completion；通过：cancelled task attempted no completed execution。

按session/effort/cap分组：

  - test-session-8dace402be8d78c1：effort=medium，cap=16384，1请求，已知/未知=0/1，已知token=0。

### rc3-drift-b-resume-1792129862657

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-b。

fixture源码快照SHA256：2aa8d0c8812c4af1510c7958d64329f7eb9c1b1501a54eb3643348ac936b18d0；driver快照SHA256：fcf2abc588217ceebfa6cec6882fe1cd667f1015d49a3cb7eea4349d880d3647。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=10；原生aborted证据=已观察；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 阶段错误：AssertionError / cold final conflict citations verified by main agent through host service。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：cold resume reads exact persisted aborted turn；通过：at least two genuine native source prunes across restart；通过：cold resumed real model quality checks passed；通过：latest decision survives repeated compression；通过：early target values omitted from public progress and compression previews。

按session/effort/cap分组：

  - test-session-8dace402be8d78c1：effort=medium，cap=16384，16请求，已知/未知=16/0，已知token=1,809,572。

### rc3-drift-c-long-1792130152025

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-c。

fixture源码快照SHA256：3944d8f2bb69f2a1943a855480277e5c3c0dc8ac31b8d958aff69319c1752638；driver快照SHA256：7a5c241f2d9f62cf782e61604a74f5efb63eee6a63515b77d3962ee48c57d824。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=8；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。

按session/effort/cap分组：

  - test-session-d7d3695463dbf903：effort=medium，cap=16384，23请求，已知/未知=23/0，已知token=9,993,935。

### rc3-drift-c-cancel-mid-1792130470110

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-c。

fixture源码快照SHA256：3944d8f2bb69f2a1943a855480277e5c3c0dc8ac31b8d958aff69319c1752638；driver快照SHA256：7a5c241f2d9f62cf782e61604a74f5efb63eee6a63515b77d3962ee48c57d824。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=8；原生aborted证据=已观察；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：native real-provider stream admitted before forced cancellation；通过：native cancellation does not claim task completion；通过：cancelled task attempted no completed execution。

按session/effort/cap分组：

  - test-session-d7d3695463dbf903：effort=medium，cap=16384，1请求，已知/未知=0/1，已知token=0。

### rc3-drift-c-resume-1792130474339

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-c。

fixture源码快照SHA256：3944d8f2bb69f2a1943a855480277e5c3c0dc8ac31b8d958aff69319c1752638；driver快照SHA256：7a5c241f2d9f62cf782e61604a74f5efb63eee6a63515b77d3962ee48c57d824。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=10；原生aborted证据=已观察；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 阶段错误：AssertionError / native model turn completed 3。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：cold resume reads exact persisted aborted turn。

按session/effort/cap分组：

  - test-session-d7d3695463dbf903：effort=medium，cap=16384，17请求，已知/未知=16/1，已知token=1,919,752。

### rc3-drift-diverse-long-1792131148371

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-diverse。

fixture源码快照SHA256：2397a195c0aee0710a9ce1bd2e96c7c1897108a38a170932c8efefd2fb1ae4d5；driver快照SHA256：1b2cfa0aeb17cbc3fe31c700ee40d5d6890c1d36bfe5c3180cced80e2a084e8b。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=11；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 阶段错误：AssertionError / native model turn completed 15。

按session/effort/cap分组：

  - test-session-c9ad70cf072743ac：effort=medium，cap=16384，29请求，已知/未知=28/1，已知token=13,603,776。

### rc3-drift-c-long-repair-1792132183128

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-c。

fixture源码快照SHA256：3944d8f2bb69f2a1943a855480277e5c3c0dc8ac31b8d958aff69319c1752638；driver快照SHA256：8930bdf4466e2db4e1fef20aebf71733b9b74447128e93108bfc846c60524836。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=10；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=both conflicting values preserved；valid public source quotations。
- 阶段错误：AssertionError / final recovery preserves the failed turn and adds exactly one completed native user turn。
- 生命周期检查：通过：final recovery resumes the exact session after its failed final turn。

按session/effort/cap分组：

  - test-session-d7d3695463dbf903：effort=medium，cap=16384，2请求，已知/未知=2/0，已知token=208,216。

### rc3-drift-diverse-continue-long-1792132397555

包SHA256：fe0a50ef90a8b790abf9bf52e4e599a1c12a763e2d8b2c43d0ab7d2b74e39846；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-diverse。

fixture源码快照SHA256：2397a195c0aee0710a9ce1bd2e96c7c1897108a38a170932c8efefd2fb1ae4d5；driver快照SHA256：162ad1ec0a20ffa551beafcf3dbe1e73106a6efe2ce8c3ce352e75bf4389b644。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=21；原生aborted证据=此阶段未记录；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：diverse long completes its twenty-three pre-restart rounds。

按session/effort/cap分组：

  - test-session-c9ad70cf072743ac：effort=medium，cap=16384，21请求，已知/未知=21/0，已知token=11,650,027。

### rc3-drift-diverse-cancel-mid-1792133203225

包SHA256：788d17409e227cc88b4d99096f27223c7b7f9fe20c44c3fdda991d01025bba18；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-diverse。

fixture源码快照SHA256：2397a195c0aee0710a9ce1bd2e96c7c1897108a38a170932c8efefd2fb1ae4d5；driver快照SHA256：d72b7027e896da50cb5777a898cd15c49378f0c457e566b67b9ab7e03dc0d6ab。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=21；原生aborted证据=已观察；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：native real-provider stream admitted before forced cancellation；通过：native cancellation does not claim task completion；通过：cancelled task attempted no completed execution。

按session/effort/cap分组：

  - test-session-c9ad70cf072743ac：effort=medium，cap=16384，1请求，已知/未知=0/1，已知token=0。

### rc3-drift-diverse-resume-1792133242925

包SHA256：788d17409e227cc88b4d99096f27223c7b7f9fe20c44c3fdda991d01025bba18；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-diverse。

fixture源码快照SHA256：2397a195c0aee0710a9ce1bd2e96c7c1897108a38a170932c8efefd2fb1ae4d5；driver快照SHA256：d72b7027e896da50cb5777a898cd15c49378f0c457e566b67b9ab7e03dc0d6ab。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=23；原生aborted证据=已观察；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=tail batch exact；tail checksum exact；tail values have exact source quotations。
- 阶段错误：AssertionError / common final round independently reads both original long sources。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：cold resume preserves the original partial rate-failure turn；通过：cold resume reads exact persisted aborted turn；通过：diverse cold resume retains twenty-six completed turns and one cancellation。

按session/effort/cap分组：

  - test-session-c9ad70cf072743ac：effort=medium，cap=16384，12请求，已知/未知=12/0，已知token=2,721,948。

### rc3-extreme-paired-a-baseline-long-1792133646178

包SHA256：7cac5d9ad2bb6c5e0256724f03fe021f035b2c1fbfaeecdd35f97764bf74c2a1；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-extreme-paired-a。

fixture源码快照SHA256：922315ea9a3a114edca9541620edcc289dde73e38d173c757ad84faf29702f7d；driver快照SHA256：6b42cf7f7c3d9dc2ef3172432a498bc06b4260bf9055ff3db195a2fcec63d7c0。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=0；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 阶段错误：AssertionError / native model turn completed 4。

按session/effort/cap分组：

  - test-session-6556293a95f02e1f：effort=medium，cap=16384，8请求，已知/未知=7/1，已知token=2,699,073。
  - test-session-bd0d57e1a333feeb：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=2,779。
  - test-session-338a20804f127c13：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=273,499。
  - test-session-f0cadd87fa769efb：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=540,056。

### rc3-extreme-paired-a-long-1792133646201

包SHA256：788d17409e227cc88b4d99096f27223c7b7f9fe20c44c3fdda991d01025bba18；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-extreme-paired-a。

fixture源码快照SHA256：922315ea9a3a114edca9541620edcc289dde73e38d173c757ad84faf29702f7d；driver快照SHA256：6b42cf7f7c3d9dc2ef3172432a498bc06b4260bf9055ff3db195a2fcec63d7c0。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=3；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=10；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。

按session/effort/cap分组：

  - test-session-3cc470a01b3953a4：effort=medium，cap=16384，14请求，已知/未知=14/0，已知token=5,943,365。
  - test-session-07c13cddf299ca7f：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=5,524。
  - test-session-c758ca08134da160：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=7,098。
  - test-session-21f97487aa3588a8：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=8,790。
  - test-session-792d07d4f946381e：effort=max，cap=16384，2请求，已知/未知=1/1，已知token=20,212。
  - test-session-5de66f98dcf5439f：effort=max，cap=16384，2请求，已知/未知=1/1，已知token=21,792。
  - test-session-66f3ab33f20d7920：effort=max，cap=16384，1请求，已知/未知=0/1，已知token=0。
  - test-session-aa80639c19d77b31：effort=max，cap=16384，2请求，已知/未知=1/1，已知token=21,122。

### rc3-extreme-paired-a-resume-1792134481521

包SHA256：788d17409e227cc88b4d99096f27223c7b7f9fe20c44c3fdda991d01025bba18；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-extreme-paired-a。

fixture源码快照SHA256：922315ea9a3a114edca9541620edcc289dde73e38d173c757ad84faf29702f7d；driver快照SHA256：6b42cf7f7c3d9dc2ef3172432a498bc06b4260bf9055ff3db195a2fcec63d7c0。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=12；原生aborted证据=此阶段未记录；冷恢复记录=有。
- execute哨兵尝试=0；清理错误=0；质量失败项=final structured JSON；literal human label；tail batch exact；tail checksum exact；both conflicting values preserved；conflict remains unresolved；conflict left exact source quote；conflict right exact source quote；execution is distinct from verification；latest footer retained；valid public source quotations；tail values have exact source quotations。
- 阶段错误：AssertionError / cold resumed real model quality checks passed。
- 生命周期检查：通过：cold restart preserves every frozen fixture byte；通过：at least two genuine native source prunes across restart；失败：cold resumed real model quality checks passed。

按session/effort/cap分组：

  - test-session-3cc470a01b3953a4：effort=medium，cap=16384，7请求，已知/未知=7/0，已知token=1,467,580。
  - test-session-ed10ebf5eedfe740：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=11,180。
  - test-session-86126a322a1f95a8：effort=max，cap=16384，1请求，已知/未知=1/0，已知token=9,787。
  - test-session-0a77e0f73d437711：effort=max，cap=16384，2请求，已知/未知=2/0，已知token=27,676。

### rc3-drift-diverse-long-repair-1792134634434

包SHA256：291b000ae83863e2ae6cbadb2711665ec996453463d80b9335553217ffe8f5cc；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-drift-diverse。

fixture源码快照SHA256：2397a195c0aee0710a9ce1bd2e96c7c1897108a38a170932c8efefd2fb1ae4d5；driver快照SHA256：213487ab227c0925f64181cf883d6102bd2fa61f139e0f92c8247fc364363a07。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：0次，接受并结束轮次0次，涉及0个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=23；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 生命周期检查：通过：latest decision survives repeated compression；通过：early target values omitted from public progress and compression previews。

按session/effort/cap分组：

  - test-session-c9ad70cf072743ac：effort=medium，cap=16384，5请求，已知/未知=5/0，已知token=984,685。

### rc3-holdout-final-ultra-1792134818963

包SHA256：291b000ae83863e2ae6cbadb2711665ec996453463d80b9335553217ffe8f5cc；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-holdout-final。

fixture源码快照SHA256：9ae203bf809d5f7fee7fbb77b928f7e3348151500a463258c83e784554b12b7f；driver快照SHA256：213487ab227c0925f64181cf883d6102bd2fa61f139e0f92c8247fc364363a07。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：1次，接受并结束轮次1次，涉及1个session。
- quote服务公开核验：0条去重来源定位，资源=未记录。decision成功get=0；独立读到冲突双方=尚无完整证据；角色识别=inferred internal routes; roles may be ambiguous。
- 原生prune快照数=未记录；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。
- 阶段错误：AssertionError / native model turn completed 1。

按session/effort/cap分组：

  - test-session-7c3a324b21925d7d：effort=max，cap=65536，1请求，已知/未知=1/0，已知token=8,652。
  - test-session-2c059c493c60ab1c：effort=max，cap=131072，2请求，已知/未知=1/1，已知token=5,971。
  - test-session-9de595877cc1c7cb：effort=max，cap=131072，6请求，已知/未知=6/0，已知token=51,459。
  - test-session-7c3a324b21925d7d：effort=max，cap=32768，1请求，已知/未知=1/0，已知token=20,111。

### rc3-holdout-final-ultra-1792135147191

包SHA256：291b000ae83863e2ae6cbadb2711665ec996453463d80b9335553217ffe8f5cc；归档字节核对：一致。fixtureId=ultra-real-naizhi-2026-10-15-B-holdout-final。

fixture源码快照SHA256：9ae203bf809d5f7fee7fbb77b928f7e3348151500a463258c83e784554b12b7f；driver快照SHA256：213487ab227c0925f64181cf883d6102bd2fa61f139e0f92c8247fc364363a07。这是源码快照哈希，不是未见完整生成数据的哈希。

- 报告提交：2次，接受并结束轮次2次，涉及2个session。
- quote服务公开核验：4条去重来源定位，资源=catalog, vendor-a, vendor-b。decision成功get=8；独立读到冲突双方=是；角色识别=one internal route distinct from accepted-report worker routes。
- 原生prune快照数=未记录；原生aborted证据=此阶段未记录；冷恢复记录=未记录。
- execute哨兵尝试=0；清理错误=0；质量失败项=无/此阶段未判定。

按session/effort/cap分组：

  - test-session-c9251ef8cd0355d2：effort=max，cap=65536，1请求，已知/未知=1/0，已知token=12,134。
  - test-session-bc0166c497056b02：effort=max，cap=131072，11请求，已知/未知=11/0，已知token=303,918。
  - test-session-439aab73cc22ca0e：effort=max，cap=131072，7请求，已知/未知=7/0，已知token=126,439。
  - test-session-c9251ef8cd0355d2：effort=max，cap=32768，1请求，已知/未知=1/0，已知token=12,754。
  - test-session-c9251ef8cd0355d2：effort=max，cap=131072，7请求，已知/未知=7/0，已知token=223,917。
  - test-session-675b27a7dcc10fd7：effort=medium，cap=16384，1请求，已知/未知=1/0，已知token=2,303。

## 验证边界

- 仅纳入launch.finishedAt已结束的尝试。未结束的holdout或极限阶段不计入，也不预写通过。
- 长任务前置或取消阶段通过，不等于extreme十轮或drift十四轮、取消及冷恢复的完整任务通过。
- 普通drift计划3+8+3=14个完整轮；精确variant drift-diverse计划3+20+3=26个完整轮及20份约1M不同ASCII负载；取消轮另计。计划不是完成证据，实际按公开completed轮数统计。
- drift使用/ultra off后手动beginMemoryRun，属于候选记忆和压缩机制测试，不等同于Ultra辅助协调全链路或原版同输入A/B。
- 压缩代次变化和compressionSamples是机制记录；压缩token字段和estimatedRequestBudget是估算。真实请求usage另列，不虚构未压缩反事实或逐次节省。
- 曝光口径按字段区分：旧版为本进程部分文本，中间版带前进程累计，最新preFinalPublicValueExposure扫描最终检索前已恢复的全部原生assistant/message公开文本，含取消轮。最终检索轮合法引文不算摘要种子泄漏；仍不等同递归生成摘要测试。
- 30K是配置工作目标，估算超出次数单独列出；不因看到压缩事件就宣称每次真实请求已经低于30K。
- 初control包57a6fd...尚无planningOnly；后续包及代码快照分别列出，不能混算功能。
- 源码快照哈希与完整生成fixture数据哈希不同。读取来源哈希仅覆盖公开记录中实际读到的工具材料。
- quote服务只核验具体来源与引用。最终报告提到来源不证明decision独立取回，须有对应decision会话的成功get记录。
- 旧rc.2对照的条件和构建不同，也没有完整历史基线，不与新增独立原版/候选A/B混算。新增A/B须按明确双臂、共同输入及运行条件另列，只依据实际已结束结果，不预写通过。
- 真实模型的少量受控合成fixture样本不能证明统计优势，也不能证明任意长任务绝对无损。
- 未知上游usage保持未知，不据此推算日卡价格、费用或节省金额。
- 强制停止可能使result.json落后于gate日志；实际请求按唯一admitted requestId归并一次。仅gate有记录时effort/cap等缺失字段保持未知，不把快照缺项当免费调用。
- 冻结12项事实质量、核心drift、最终实际引用的离线复核与vendor-a/b专用回执协议分别记录；任一局部通过均不改写原始失败，也不等于整个case或工作流验收通过。
- continue-long只加本进程实际完成的剩余负载轮；继承的partialContinuation累计数字不再次相加。原失败、sourceFiles SHA和原生失败seq另保留，恢复完成与全部阶段通过是不同字段。
- 后续本地并发1与最小30秒间隔属于保守运行条件；不据此推断上游RPM规则、取消后slot释放或纯算法延迟优势。

后续各variant（extreme计划10轮、普通drift计划14轮、drift-diverse计划26轮及20份约1M不同ASCII负载）、取消和冷恢复，只按后来真正结束的case和实际字段补入。本报告未把尚未结束、尚未启动或仅前置阶段通过的任务写成整体通过。旧rc.2对照没有在本轮重跑；构建与条件不同，不声称统计优势。
