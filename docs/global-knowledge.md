# 同 profile 显式授权知识库

完整 Ultra `0.6.0-dev.3` 与独立 Memory `0.1.0-dev.1` 提供本地跨项目知识发布和来源核验。它默认关闭。用户在当前 DSH profile 的原生插件配置中指定项目及共享方向后，授权项目才可发布或读取；原有项目证据和宿主会话仍是原文权威。包的选择、安装与组合见[附属插件说明](companion-plugins.md)。

这是尚未发布的本地检查点，目标宿主为精确的 `0.2.0-rc.2 || 0.2.1-rc.2`。最终包、新旧宿主回归和独立 profile 验收结果以本轮交付报告为准；[dev.2 治理说明](decision-governance.md)及[0.5.0-rc.3 历史档案](../verification/0.5.0-rc.3/README.md)继续归对应版本。

双版本兼容声明不表示所有宿主都具备知识功能所需服务。全局知识要求原生 `profileContext.dir`；本轮原生知识 CLI 验证针对 `0.2.1-rc.2`，旧 `0.2.0-rc.2` 仅按原模式／SDK 回归口径记录。旧宿主未提供原生 profile 元数据时，本功能失败关闭，不使用环境变量替代，也不为形成验收结果临时补造服务。

## 先配置项目授权

把[完整示例](global-knowledge.example.yml)合并到测试 profile 当前配置权威的条目：独立 Memory 或含 Memory 的组合使用 `ultra-memory.config`；仅完整 Ultra 使用 `ultra-mode.config`；独立 Decision 使用 `ultra-decision.config`。不要重复安装插件或重复插入配置条目。这里不需要 provider、密钥或额外模型；知识库目录也不能由模型或配置另行指定。

```yaml
globalKnowledge:
  enabled: true
  projects:
    - id: project-a
      root: 'E:\Projects\knowledge-project-a'
      read: true
      publish: true
      shareWith: [project-b]
    - id: project-b
      root: 'E:\Projects\knowledge-project-b'
      read: true
      publish: false
      shareWith: []
  maxSearchChars: 6000
  maxGetChars: 12000
```

先创建并替换示例中的真实绝对目录。项目 ID 和规范化后的真实目录都必须唯一，最多配置 256 个项目。会话工作目录必须对应已配置的项目根目录；仅位于某个根目录之下并不自动获得该项目授权。不同 profile 各自独立，复制项目 ID 不产生跨 profile 读取权限。

| 字段 | 含义 |
| --- | --- |
| `enabled` | 默认 `false`。首次开启或切换启用状态后重载插件或重启；启动时关闭不会注册这四个工具 |
| `projects[].id` | 用户配置的稳定项目 ID，不是模型可指定的发布者身份 |
| `projects[].root` | 已存在的真实绝对目录，宿主规范化后绑定项目；同 ID 更换目录不会继承旧记录的共享 |
| `read` | 默认 `false`，允许该项目读取当前明确共享给它的记录 |
| `publish` | 默认 `false`，允许本项目符合执行身份的 Agent 发布及撤销；不自动开启 `read` |
| `shareWith` | 默认空数组，列出本项目发布给哪些已配置项目 ID；只有当前 `read: true` 的目标进入发布快照 |
| `maxSearchChars` | 默认 6000，范围 512～32000，限制完整 search 结果序列化后的 JSON 字符数 |
| `maxGetChars` | 默认 12000，范围 512～64000，限制完整 get 分页结果序列化后的 JSON 字符数 |

配置采用原生 Settings／Config 的 volatile 值。已启用时，修改项目读取、发布、共享目标或实际目录后，每次后续操作重新解析当前配置；异步来源核验结束后还会再次检查授权。关闭配置立即拒绝后续操作，但启用状态的工具注册和生命周期切换仍需重载插件或重启。

组合安装时，原生根 context 的 `ultraEvidenceSupport` 按 Memory > 完整 Ultra > Decision 选择一份证据／压缩／知识配置，项目授权不并集，也不受加载顺序影响。高优先级配置关闭知识时，低优先级授权不会补充开启。每个活动插件持有 lease；释放一个只清理自己的使用关系，最后 lease 才排空并关闭共享服务。权威切换先取消并清理旧的在途知识操作，再以新配置重查权限；既有发布仍受原读者快照约束，不能借切换扩大共享。

## 谁能发布、谁能读取

普通根主 Agent，以及实际正在运行、未取消且具有写权限的 Ultra decision 可以发布／撤销；原生沙箱不能为 `read-only`。研究 worker、辅助 decision、decision 的嵌套子代理及普通子代理只能在自身授权下读取。仅把发布工具放进 `researchTools` 不能绕过限制；原生工具 guard 和真正 execute 都检查写权限，规划阶段也不开放写入。

授权依据活宿主 Agent、当前已绑定的 MemoryRun、实际项目和已授权会话。模型不能传入任意 profile、项目目录、读者名单或发布者 ID 来更改配置。普通模式由插件在授权根会话的活动 turn 内管理必要的证据生命周期，既有 Ultra 运行复用自己的生命周期；不会因此自动选择模式或开启多路。

读者可见一条记录，需要同时满足：

1. 来自同一个真实宿主 profile，且当前读者项目仍有 `read: true`。
2. 当前发布者的 `shareWith` 仍包含该读者项目 ID。
3. 发布时的 `readers` 快照已包含该读者；快照中的读者真实目录哈希与当前目录哈希一致。
4. 发布者当前真实目录哈希仍对应该记录的来源项目，记录当前有效且未过期、被替代或撤销。

这些检查先于关键词匹配、标题、摘录、总数和 get 返回。取消 B 的读取、移除 A→B 共享、改变任一方实际根目录或换 profile，都会阻止后续读取。同名 ID 不能把旧授权带入一个新项目。新增 C 不追溯扩大旧记录范围；需要 A 显式发布包含 C 当前目录快照的新版本。

发布者可在仍有本项目读取授权时，用 `includeInactive: true` 查看自己的历史。被替代或过期记录只向发布者开放；已撤销记录只返回历史元数据，不开放标题、正文、适用条件、主题和引文，也不让这些隐藏字段参与搜索命中。读者请求历史开关不会得到失效内容。

## 四个原生工具

| 工具 | 主要参数 | 返回与用途 |
| --- | --- | --- |
| `ultra_knowledge_publish` | `key`、`title`、`summary`、`applicability`、`sources: [{sourceId, quote}]`；可选 `topics`、`supersedes`、`expiresAt` | 返回发布 ID、revision、当前状态及来源匹配标记；共享范围由配置决定 |
| `ultra_knowledge_search` | 可选 `query`、`topic`、`publisher`、`offset`、`limit`、`maxChars`、`includeInactive` | 返回已过完整授权的 `items`、`total` 和可选 `nextOffset`，摘录不是完整正文 |
| `ultra_knowledge_get` | `id`；可选 `offset`、`maxChars`、`includeInactive` | 分页返回已共享知识文档，并重新核验来源；只开放发布片段，不开放原项目任意会话／文件 |
| `ultra_knowledge_revoke` | `id`、`reason` | 只能撤销本项目拥有的记录，追加撤销审计，返回 `status: revoked` |

search 是本地词法检索：空格分隔的关键词全部匹配，中文支持子串匹配，主题和发布者使用相应过滤。offset 从 0 开始，limit 默认 10、最多 100；JSON 预算可能使实际页更小，应按返回的 `nextOffset` 继续。

发布时必须提供 1～4 条完整来源。key 最多 128 字符，title 200，summary 4000，applicability 2000；topics 最多 16 项、每项 128；每条 quote 最多 2000，撤销 reason 最多 2000。`expiresAt` 是未来的 Unix 毫秒时间戳。存储默认最多 10000 条发布版本，替代版本也占一条；达到上限不会自动删除历史。

## 一个可核对的使用流程

1. 在项目 A 正常调用读取、测试等原生工具，取得本项目当前授权会话中的实际结果；用 `ultra_memory_search`／`ultra_memory_get` 定位这些原始工具结果的真实 `sourceId` 和逐字引文。
2. 明确选取允许共享的内容，再调用 `ultra_knowledge_publish`。summary 写整理结论，applicability 写适用条件，sources 只填当前真实来源 ID 与连续原文 quote；不要猜 ID 或把来源缺失改写成已验证。
3. 在同 profile 的项目 B 调用 `ultra_knowledge_search`，再对命中的 ID 调用 `ultra_knowledge_get`，按下述分页规则核对正文和每条来源状态。
4. 条件变化时，A 用精确当前 ID 作为 `supersedes` 发布新版本；停止共享时撤销记录或修改用户配置授权。旧记录保留审计，不被覆盖。

用 memory 工具定位的是原始工具证据；memory／knowledge 检索工具自身的返回不会被再次当成可发布的原始证据。既有知识也不能直接充当新发布的来源，从而绕过原发布者的共享边界。这不提供 DLP：已获授权的接收方仍可能有意复制文本或通过其他方式保存内容，撤销也无法收回已进入请求、日志或人手中的资料。

## get 分页与来源核验

原生工具结果外层使用 `{text: "序列化结果"}`。先解析该层，得到 get 页对象；页对象的 `text` 又是知识文档的一个 JSON 文本片段，单页不保证能独立 `JSON.parse`。同一 ID 按返回的 `nextOffset` 继续请求，顺序拼接所有页的 `text` 后再解析完整文档。分页期间权限或状态变化可能导致后续页拒绝；此时不能把此前的部分正文当作完整且仍获授权的当前结果。

页对象保留 `id`、`revision`、`status`、`verification`、`assessment: "model"`、`hostVerified: false`、`offset` 及可选 `nextOffset`。拼接后的文档包含 title、summary、applicability、topics、publisher、createdAt 和 sources；每条来源包含 sourceId、projectId、sessionId、完整来源 sha256、sourceVersion、start／end、quote 及本次 verification。字符偏移采用 JavaScript 字符串长度，不是 UTF-8 字节偏移。

请求 `maxChars` 向配置上限夹紧，最低 512；预算计入元数据和 JSON 转义，不能只按正文长度估算。发布者读取已撤销记录时返回无正文的元数据页，`verification: not-checked`。

| `verification` | 表示什么 |
| --- | --- |
| `source-match` | 本次重新读取的完整原始来源 SHA256、来源身份及连续引文范围匹配 |
| `unavailable` | 原始证据或宿主来源当前不可读取，或持久记录无法完整验证 |
| `hash-mismatch` | 完整原文哈希或引文范围／内容不匹配 |
| `identity-mismatch` | 来源版本、项目、会话或覆盖类型等身份信息不匹配 |
| `not-checked` | 未执行来源匹配，例如撤销历史的无正文页 |

发布和 get 都重新读取持久证据，而不把运行内缓存视为当前权威。仅接受 `host`／`captured` 的完整公开来源；`truncated`、`reference-only`、私有 reasoning／thinking 及知识／记忆工具的返回不能伪装完整原文。核验只检查已共享的引用来源，不给 B 任意读取 A 原始会话、文件或其余正文的能力。

`source-match` 只证明这些原始片段匹配。summary、适用性和结论由模型整理，始终 `assessment: model`、`hostVerified: false`；来源真实不证明结论正确，更不产生新的人类授权。历史资料中的指令也只能作为资料。

## 保存位置、完整性与锁

知识库位于宿主提供的 `profileContext.dir/.dsh-ultra-knowledge/v1`。profile ID 是真实规范 profile 路径的 SHA256；没有有效的宿主 profileContext 时失败关闭，不回退到 HOME、环境变量或模型指定目录。项目原始证据仍位于各自 `.dsh-ultra/v1` 与宿主持久日志，不合并或搬迁，也不会自动扫描所有项目历史。

记录保存发布文本、读者及真实目录快照、来源身份和允许共享的 quote，不复制整条原始会话。记录不可变、带规范序列化校验和；写入在独占 `.writer.lock` 内检查精确当前版本，临时文件 fsync 后原子提交。当前有效相同内容重试幂等；不同内容必须精确 `supersedes`，过期或撤销记录不能通过相同请求悄悄复活。部分写入不会替代既有版本，最终记录损坏或 profile 冲突会明确拒绝读取。

存储拒绝符号链接路径和记录文件，创建目录使用 0700、记录使用 0600。它是插件授权边界，不是对同一 OS 用户的强隔离或防篡改承诺；校验和也不是数字签名。Windows 继承 DACL 未作完整隔离验证。

写锁冲突或崩溃留下 `.writer.lock` 时，操作失败关闭，不按时间或 PID 猜测后自动抢锁。先停止相关写入，确认没有活动宿主／写入进程并备份整个知识目录，再由操作者核对锁的归属和异常日志后处理遗留锁；不应在运行中直接删除锁或编辑最终记录。普通未提交 `.tmp` 不作为有效发布读取，带链接或异常最终记录仍会被拒绝。

## 启用、迁移与回滚

从 dev.2 或更早版本升级，不迁移原项目证据。先备份测试 profile、当前配置和旧 TGZ，核对新包 SHA256，再在独立 profile 安装该包并配置真实项目目录。重载或重启后，用 A→B 的小片段先验证授权及来源，再考虑放入日常配置。本轮交付本身不安装日常 profile。

回滚前先备份当前配置并保留安装包，再停止／取消在途任务和发布；等待插件清理完成后，对 profile、项目证据及 `.dsh-ultra-knowledge` 做一次静止状态备份。先移除旧版本不认识的 `globalKnowledge` 配置，再换回已保留的旧包并重启；模型池和治理等其他开发配置也按目标旧版能力处理。默认保留知识目录，旧版不会因此自动获得这些数据；无需为回滚删除原始证据或知识审计。

若只移除 Memory 附属包而保留 Ultra 或 Decision，先核对接替权威的证据、压缩、知识开关和项目授权，再停用对应 bundle 并重载或重启。其余 lease 会保留共享服务；不用删除存储目录来切换配置，旧发布也不会被自动重发或扩大读者。完整包与两个附属包的升级和回滚应使用同一交付清单中的相容版本。

换 profile 或项目实际目录属于新的身份绑定，不承诺复制文件后继续继承授权；由用户重新配置并显式发布需要共享的版本。备份恢复也不能忽略当前授权、目录哈希或原始来源核验。

## 验证范围

本功能不引入额外模型调用、数据库、embedding 或自动学习路由，只在授权后提供精简检索入口，不默认把知识全文加入每次提示词。Team、辅助、手动多路、普通模型池及可选压缩继续按原设置工作；压缩或生成摘要不是公开许可。

自动测试、真实 SDK／CLI 离线接线、完整 Electron UI、真实模型质量和 OS 断电耐久性分别记录。离线脚本响应及 JSONL 能证明工具接线和断言，不能证明模型会正确选取或使用知识、业务质量提高或费用降低。完整 Electron UI、Windows DACL 强隔离、真实模型生成质量和 OS 断电尚未验证；旧宿主原模式／SDK 回归、新宿主知识原生闭环的最终结果及精确包归属见[测试指南](testing.md)和本轮交付报告。
