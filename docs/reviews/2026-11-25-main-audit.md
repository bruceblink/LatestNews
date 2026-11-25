# LatestNews 主线代码审查（2026-11-25）

## 1. 基准和证据边界

审查提交：`b9a62c8e20effb94a6b3e86e1e089a731f04b1ed`。版本字段 0.8.4，实际 React 18.3.1、Vite 8、Nitro 3 beta、H3 2。仓库 631 个跟踪文件。检查仓库清单、主要模块的关键执行路径、配置、测试和发布记录。全仓库 lint/typecheck/Vitest 覆盖自动化范围；未逐行穷尽全部传统来源文件、所有 UI 交互和全部部署环境。结果不能代替独立安全审计或生产验收。

正式 Release [v0.8.4](https://github.com/bruceblink/LatestNews/releases/tag/v0.8.4) 对应 `82b2efb53bc49b8d81d335b2267fe3582f446f3e`，2026-11-24 16:33:48 UTC 发布，immutable=true，18 个公开资产，均有 GitHub digest 字段。未完整下载复算，也未进行安装测试；主线比该 Release 更新。发布矩阵为 Windows x64/arm64、Linux x64/arm64、macOS arm64，另有 Web 包；macOS x64 不在当前矩阵。

| 核对项 | 本轮证据 |
| --- | --- |
| 工具链 | 隔离 Linux，Node 22.23.4，pnpm 12.21.0 |
| 静态检查 | lint、Node/Web 和 Electron typecheck 通过 |
| Vitest | 97 文件、519/519 通过 |
| Python release guard | 32/32 通过，使用模拟测试，不发布 |
| 构建 | Node/Pages 构建通过；跳过在线图标抓取 |
| D1 | 实际 Pages 产物 + 隔离 Miniflare/workerd；现有 smoke 全部通过，兼容日期 2026-08-06，非生产配置 2026-11-23 |
| 主线 CI | b9a62c8 的 Web Chromium E2E、Electron E2E、Crawler host smoke、Windows desktop、Cloudflare Pages 检查全部 success |
| 生产 | 未手动请求生产数据、未修改数据库/配置、未发布新版本 |

## 2. 已复现缺陷

所有数据均为临时隔离 SQLite 中的人工构造 fixture，不来自生产。使用当前 `ArticleIndex`、`reconcileArticleEventId`、`normalizeNewsItems` 等真实代码，不是用替代算法模拟。缺陷编号供后续独立 PR 引用。

| ID / 优先级 | 代码位置 | 实际结果与影响 |
| --- | --- | --- |
| A01 / P0 | [article-index.ts](../../server/database/article-index.ts#L453-L460) | 两个不同规范 URL 的 32 位多项式哈希相同；第二条 INSERT 因 articles.article_key 唯一约束失败。若指纹冲突被当作已存在记录，另需防止覆盖；尚未复现这一覆盖情形。 |
| A02 / P0 | [article-index.ts](../../server/database/article-index.ts#L130-L191) | 两来源并发 upsert 同一 URL 时，一次成功、一次 canonical_url UNIQUE 失败，文章只有一条、来源映射只留下 weibo；来源缓存写入后索引异常被吞并为日志，历史可能漏记录。 |
| A03 / P1 | [article-index.ts](../../server/database/article-index.ts#L256-L276)、[启动检测](../../server/database/article-index.ts#L372-L378) | 人工构造同数量的重复/缺失 FTS 行，重启 init 后未修复；Alpha 返回同一文章两次，Beta 走 like 回退。证明仅按行数不能判定完整性；不证明该数据损坏已在线上发生。 |
| A04 / P1 | [新闻时间归一化](../../shared/news-item-schema.ts#L167-L188)、[article-index.ts](../../server/database/article-index.ts#L296-L298) | 同时插入秒、毫秒、过期、无效字符串时间。since 过滤的 FTS 和字面路径均只返回 invalid、ms，漏掉同一时刻的秒级时间。存储混合类型与 SQLite 比较造成误判。 |
| A05 / P1 | [article-event-identity.ts](../../server/database/article-event-identity.ts) | 已有 event-a、event-b，另有未关联 C；聚类候选恰为 event-a 时，协调返回 event-a，但历史只含 A，B/C 不在其中，原关联未覆盖。说明候选与注册身份不可仅靠字符串判别。实际 API 是否出现此组合的频率未测。 |
| A06 / P0 输入边界 | [news-item-schema.ts](../../shared/news-item-schema.ts#L108-L134)、[插件校验](../../crawler-platform/core/output.ts) | normalizeNewsItem 对非 HTTP(S) 的 file:///audit-fixture 返回合法对象。插件及配置来源有 URL 校验，但共享条目入口只检查非空；Web 阅读链接直接使用 URL。已证实校验不一致，未验证真实浏览器可利用性或线上发生情况。 |
| A07 / P1 | [synchub-merge.ts](../../shared/synchub-merge.ts#L58-L64) | 模拟离线删除，本地 favorites=[]，旧远端含一条收藏；合并函数恢复该条。现有 union 无法表达删除。不是完整的真实双端同步复现。 |
| A08 / P2 | [electron/lifecycle.ts](../../electron/lifecycle.ts) | maxEvents=16，模拟注册并关闭 300 个窗口后 events=16，windows=300（全部 closed）。诊断记录的窗口表无上限；未测真实内存占用。 |

### 可重复的输入和预期输出

在对应提交的独立工作树执行（确保依赖安装完毕，Node/pnpm 使用项目版本）。使用 `createDatabase(sqliteConnector({name:":memory:"}))` 创建每例独立数据库，`await new ArticleIndex(db).init()`，每例结束 dispose。文章对象含 id、title、url、pubDate；日期默认 1795550000000。不要使用生产数据库。

- A01：依次写入 weibo 的 First Alpha（https://example.test/Aa）、v2ex 的 Second Beta（https://example.test/BB），不同 id。第二次报 `UNIQUE constraint failed: articles.article_key`；唯一记录 key 为 article-l2jxre。
- A02：同一实例 Promise.allSettled 并发写入两个来源的 https://example.test/same，id 分别 a/b，title 同为 Parallel title。实测一个 fulfilled、一个 rejected；查询 articles 与 article_sources 均只有一行。
- A03：写 Alpha title、Beta title 两条；直接删除 Beta 的 article_search 行，再插入一条 Alpha 副本。new ArticleIndex(db).init() 后 articles.count=2、article_search.count=2、distinct article_key=1；search Alpha 返回 one,one。
- A04：title 均含 Time query；输入 pubDate 分别 1795550000、1795550000000、1795463600000、"unknown"，先走 normalizeNewsItems 后 upsert；since=1795546400000。search 和 searchLike 均返回 invalid,ms。
- A05：登记 A、B 的 event-a/event-b，再加入未登记 C。调用 reconcileArticleEventId(db,[A.url,B.url,C.url],"event-a")，得到 event-a；getEvent 只有 A，B 保留 event-b，C 仍为 null。
- A06：normalizeNewsItem({id:"audit",title:"URL validation test",url:"file:///audit-fixture"}) 返回非 undefined。
- A07：mergeSyncHubFavorites([],[{url:"https://example.test/favorite",updatedAt:1}]) 返回旧条目。
- A08：createDesktopLifecycleTracker({maxEvents:16})，循环 registerWindow(i,"auth")/updateWindow(i,"closed","window-closed")，snapshot 返回 300 个 closed 窗口记录。

## 3. 静态发现及待验收风险

| 范围 | 源码证据 / 结论 | 后续 |
| --- | --- | --- |
| 缓存与历史写入 | [Cache.set](../../server/database/cache.ts#L47-L67) 缓存成功后逐条 upsert，索引故障只记警告；refresh 的 refreshed 只说明来源缓存已保存，不说明文章/FTS 全部已保存。FTS delete/insert 分离且全量 rebuild 先删除再逐条写。无索引补写持久任务或显式 schema 版本。 | 独立状态、事务/原子 SQL、补写、迁移、恢复与容量测试；保留缓存失败隔离设计。 |
| 初始化与能力 | [cache.ts](../../server/database/cache.ts#L143-L159) 只在 INIT_TABLE=true 初始化；部署文档称默认初始化。禁用初始化时即使已有 FTS，searchLike 路径/未初始化实例也会降级，现有部署健康仅判断 Cache 对象是否存在。 | 区分 schema 初始化与只读能力探测；增加索引、注册表及积压指标，不暴露凭据。 |
| 事件治理 | [insights.post.ts](../../server/api/v1/insights.post.ts#L19-L64) 接受来源范围、隐藏 URL、topicLimit 后将用户视图聚类写入共享关联；N4-F 首次关联固定，N4-I 别名只人工批准。不同用户视图可能影响首次归属，是静态设计风险，未量化线上误合并。32 位候选事件哈希也需升级策略；旧 ID 不重算。 | 把用户展示和全局事件归属分离；候选、已注册、冲突分别表示；保留旧字段、别名和历史关联。 |
| Web/PWA 产品闭环 | [search-bar](../../src/components/common/search-bar/index.tsx) 搜索来源；[insights](../../src/routes/insights.tsx#L725-L800) 当前仅展开最多 5 个话题和每组 3 篇报道。src/electron 未消费历史文章搜索与事件详情端点；已有 Node Manifest 宣告。 | 新增历史搜索入口和完整事件详情，保留来源搜索；明确缓存及本地能力。 |
| Electron | 已有 contextIsolation、sandbox、IPC、独立插件宿主和更新机制；本地 JSON 缓存无历史索引，不应假装支持服务端历史。A08 是长时稳定性待修项。 | 远端能力协商，原生安装/升级/托盘/退出及长期循环。 |
| 采集与插件 | SourceEngine Singleflight/取消/队列和 HTTP per-origin 上限已有测试；N4-C 仍缺完整 API 4/6/8 对照；配置型 RSS/JSON 与真实出口/断开仍需按原计划验收。可信 JS 插件不是任意第三方代码的安全沙箱。 | 修复写入后再做隔离端到端性能测量；N3 来源质量观察须有授权和部署基线。 |
| 同步 | 合并函数保留新记录，但删除语义缺失（A07）；真实认证/SyncHub 跨端证据不足。 | 先协议协商、账户隔离与离线墓碑策略，再两客户端实测；不改变外部服务凭据。 |
| 发布/供应链 | immutable release guard 已有 32 项 Python 测试；正式 Release 与主线不同。当前桌面矩阵不包含 macOS x64。Docker 使用 node:22-alpine 浮动标签，需评估版本/摘要固定和原生 SQLite ABI。 | 固定候选提交，资产逐字节核验、安装升级与镜像启动；macOS x64 支持范围明确决策。 |
| 混合检索 | N4-H 初标非独立人工标签；N4-K 离线 RRF 与最佳字符通道同排名，无额外收益；N4-J 中文字面查询可能扫描大表。 | 真实标注和规模化证据优先；暂不开启自动合并、向量库、外部付费搜索。 |

## 4. 开发结论

本轮不实施功能修复。将问题转为主线开发计划中的独立 PR、准入条件、回归用例和回退边界。P0 的含义是下一版本扩展前必须关闭或明确隔离，而非已经发生生产事故。详细顺序见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)。任何生产数据迁移、清理、部署配置、凭据修改或新 Release 需另行授权。
