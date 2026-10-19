# 同一 profile 显式授权的全局知识库

用户已批准上一轮推荐结构并明确要求持续实现、独立 profile 离线验证和新包。本轮只做一个本地跨项目知识发布、检索与来源核验闭环，保留既有模式、证据库、模型池及权限。无在线模型、日常安装、push、发布或破坏迁移。

## 数据与授权

- 现有项目证据仍以原宿主日志及项目 `.dsh-ultra/v1` 为权威，不迁移、合并或扫描全部历史。
- 全局发布记录保存在宿主 `profileContext.dir/.dsh-ultra-knowledge/v1`，profileId 为真实规范 profile 路径的SHA256。宿主没有 profileContext 时启用操作明确拒绝，不使用HOME/env猜测。禁止符号链接存储路径/文件；目录0700、记录0600，Windows继承DACL不作为对同OS用户的隔离承诺。
- `globalKnowledge` 默认关闭。原生插件配置保存授权：`projects:[{id,root,read,publish,shareWith:string[]}]`；root为真实绝对项目目录，id与规范root均唯一。模型不能修改授权、目录或profile。
- 每次操作重新解析当前授权。发布者只能来自活宿主Agent、已绑定MemoryRun及本项目授权会话来源；只有普通主Agent或当前可写Ultra决策路线可以发布/撤销。研究worker、辅助decision、普通嵌套子代理只读，不能通过把工具名加入researchTools绕过。
- 发布记录的readers是配置shareWith的快照；读取时还需当前发布者shareWith、当前读者read权限、相同profile共同允许。撤销授权后标题、命中数量、摘录和get都不泄漏。新加读者不追溯扩大旧发布范围，需要显式重新发布新版本。

## 发布与版本

工具 `ultra_knowledge_publish` 接收key/title/summary/applicability/topics、最多4个 `{sourceId,quote}`、可选supersedes/expiresAt。引文最多2000字/来源，summary4000、applicability2000、title200、topics16项各128。宿主从当前MemoryRun校验完整来源可见、原文quote精确匹配、来源完整性和项目身份；只允许host/captured，不把truncated/reference-only伪装完整。

保存明确允许共享的知识文本和这些引用片段，不复制整条原始会话。记录包括profile/publisher/key/id/revision/createdAt/readers、原sourceId/projectId/sessionId/sha256/version/start/end/quote。`source-match`只证明引用匹配，知识是模型整理，`hostVerified:false`，不证明结论、适用性或新增授权。历史知识始终是资料。

同publisher+key的相同有效发布幂等。不同内容必须supersedes精确当前ID，版本追加，旧记录不覆盖；撤销以独立不可变记录关闭目标。过期、被替代、撤销状态区分。默认检索不显示旧状态；仅发布者可显式查询自己的历史。单写锁、原子写及校验和防部分写入和并发丢更新；崩溃遗留锁失败关闭，不盲目自动抢占。

## 读取与核验

`ultra_knowledge_search` 用关键词、主题、publisher与分页检索，先过完整ACL再匹配、统计与生成摘录。`ultra_knowledge_get` 按ID有界分页；宿主只为已获授权的发布片段核对来源，不能给读者任意项目文件/会话读取能力。当前授权与来源元数据必须重核，匹配原文quote及完整source SHA；不可用、hash不符明确返回，不把保存过快照当当前来源仍可读。

search/get输出实际JSON字符预算包含metadata，用户请求预算向配置上限夹紧。默认search6000/get12000，最低512。get把标题、正文、适用条件及逐来源核验结果放在可分页文档中，外层始终保留ID、版本、当前状态、核验概况、偏移及nextOffset。第一版词法检索，不引入数据库服务/embedding/自动学习路由。

## 集成和范围

沿用原生工具、Config/Settings、systemPrompt、MemoryRun与取消生命周期。仅启用且项目获授权时提供精简全局检索入口，按需读取；无新增模型调用、自动多路或全部知识注入。知识发布与撤销是写工具，guard和execute均校验。普通主Agent、协作、辅助、并发模式继续按原选择工作。压缩仍先存证再替换，不以压缩作为自动公开许可。

## 验收

真实DSH0.2.1-rc.2独立profile+离线LlmAdapter：项目A工具得到原生来源→授权主Agent发布→项目B搜索/get→片段与原始工具结果核验。未授权项目C、另一profile、未授权会话、worker写入、伪造来源/quote、撤权、来源变更、预算、重启、幂等/部分写入失败、替代/撤销均有明确断言。旧0.2.0-rc.2与新0.2.1-rc.2分别全套回归；真实模型质量、Electron完整交互与OS断电明确未验证。
