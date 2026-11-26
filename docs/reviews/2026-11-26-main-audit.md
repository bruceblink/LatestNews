# LatestNews 主线复审（2026-11-26）

## 1. 基线与证据边界

审查提交 `a222a888f69027026598f2ac53d56f75cb9ca23a`，PR #33 合并后的 main，版本字段 0.9.0。697 个跟踪文件；509 个 TS/TSX/MJS/PY 文件共 63,509 行（含测试及生成代码）。本轮执行全源码文件清单与模式扫描（错误投影、请求绑定、网络、存储、计时器、反序列化、执行入口、HTML 注入），审查主要跨模块调用及关键执行路径、现有专项报告与工作流。不声称逐行穷尽所有 legacy 来源、UI 交互或独立渗透审计。

正式 [v0.9.0](https://github.com/bruceblink/LatestNews/releases/tag/v0.9.0) 于 2026-11-25T16:58:51Z 发布，immutable=true、非 draft/预发布。Git 远端 tag 剥离后为 `baacb5d292dc0bf23467f2c2b98171d402695fca`，18 项资产均有 GitHub digest 元数据；未下载逐件复算、未实机安装。PR #33 在标签之后合并，不属于 v0.9.0。保留该不可变版本，不重新发布。

| 验证 | 本轮结果 |
| --- | --- |
| 环境 | 隔离 Linux x64，Node 22.23.4，pnpm 12.21.0，复用已安装依赖 |
| Vitest | 107 文件、593/593 |
| Python release guard | 32/32；模拟发布测试，不产生真实 Release |
| lint、Node/Web/Electron typecheck | 全部通过 |
| PR #33 的构建/CI（已有证据，不计作本轮重跑） | Node/Pages 构建、本地 D1 17 检查点、Playwright E2E、Windows desktop CI 通过；Codex 无未解决发现 |
| 新问题复现 | 五个隔离用例通过了“现状缺陷存在”的断言；不是修复通过，不计入 593 |
| 生产 | 未请求生产服务/数据库；未改变配置、发布、定时任务或外部 SyncHub |

## 2. 新增发现与优先级

P0 表示下一轮发布/功能扩展之前优先处理或明确隔离；不是生产事故声明。A01–A08 继续引用 [2026-11-25 审查](2026-11-25-main-audit.md)。A01–A06/A08 的修复已合并且本地回归通过，生产迁移与实机另计；A07 尚未关闭。

| ID / 优先级 | 代码位置 | 证据与影响 | 后续 |
| --- | --- | --- | --- |
| A09 / P0 | [source-health.ts](../../server/utils/source-health.ts#L126-L145)、[source-health-api.ts](../../shared/source-health-api.ts)、[source-health-diagnostics.ts](../../shared/source-health-diagnostics.ts#L161) | 合成错误内标记原样进入公开 JSON 和下载诊断。原始上游异常可能包含 URL 查询、凭据或内部细节；未证明真实秘密泄露。 | N3-G1 统一公开错误码、可公开文本及长度边界，持久化和日志同样不得保留秘密。 |
| A10 / P0 | [cache-store.ts](../../server/database/cache-store.ts#L29-L64)、[article-index.ts](../../server/database/article-index.ts#L149-L212)、[search](../../server/database/article-index.ts#L524-L577) | SQLite 上调用真实 Pages Cache.openPages(false) 路径；人为删除一条 FTS 行，完整审计为 inconsistent，快速探测的 health=ok，FTS=1、LIKE=2。证明快速探测不能独立建立完整性；不证明正常原子写入会损坏 FTS。 | N4-P1 明确持久校验证据、过期/未校验状态和独立审计，避免每个请求全表审计。 |
| A11 / P1 | [cache-store.ts](../../server/database/cache-store.ts#L120-L189)、[read-source.ts](../../server/utils/read-source.ts)、[resolve-source-batch.ts](../../server/utils/resolve-source-batch.ts)、[insights.post.ts](../../server/api/v1/insights.post.ts#L68) | 单个 Cache 第一次补写完成后，再保存两个来源：只调度 1 次，pendingIngest=2；下一次普通缓存读不推进。insights 与受保护 refresh 可推进，不能宣称所有流量下无恢复路径，也未测实际堆积速率。 | N4-P2 独立有界维护、积压可观察、最终收敛与公平性。 |
| A12 / P0 | [synchub-contract.ts](../../shared/synchub-contract.ts#L7-L45)、[synchub.service.ts](../../src/services/synchub.service.ts)、[synchub-policy.ts](../../electron/synchub-policy.ts)、[main.ts](../../electron/main.ts#L1080-L1100) | Mock fetch 接受非本地 HTTP 地址并构造含合成 API key 的请求；HTTP 200 + code=123 在 Web 与 Electron 验证函数均返回成功。未发送真实网络请求。HTTPS 页面可能由浏览器阻止 mixed content；不是应用自身安全保证。Electron 本身限制 HTTP 至开发环境。 | N2-D1 统一传输/业务码、重定向与验证后持久化语义。 |
| A13 / P1 | [source-health-events.ts](../../server/database/source-health-events.ts#L60-L75)、[singleton](../../server/database/source-health-events.ts#L124-L142)、[00.pages-d1.ts](../../server/middleware/00.pages-d1.ts)、[source-health.ts](../../server/utils/source-health.ts#L201-L205) | 真实 db0 D1 connector + 模拟 nitro/database provider 和 A/B 两个绑定，INSERT await 时切换 globalThis.__env__；同一 append 记录 A:INSERT → B:DELETE。模拟证明动态绑定风险，不是目标 Cloudflare 实例串写证明。公开健康摘要仍仅从内存读，listRecent 仅测试使用；事件持久化未进入请求 waitUntil。 | N3-G2 请求级绑定、等待生命周期、单次采集去重、明确持久/实例指标。 |
| A14 / P1（静态） | [historyAtom.ts](../../src/atoms/historyAtom.ts)、[readingStateAtom.ts](../../src/atoms/readingStateAtom.ts)、[useSyncHub.ts](../../src/hooks/useSyncHub.ts#L104-L178)、[history.tsx](../../src/routes/history.tsx#L272-L298) | 保存新配置后 reload，但阅读 atom 使用固定本地存储键，bootstrap 仍 union 本地/远端，上传队列按集合而非账户划分。是否允许账户间主动导入应明确；尚未做真实双账户 E2E，不能断言已发生数据泄露。 | N2-D2 明确账户/服务隔离、取消或持久化旧队列，显式导入；N2-D3 才引入删除协议。 |
| A15 / P1（条件性静态） | [upstream-node-client.ts](../../server/utils/upstream-node-client.ts#L222-L285)、[pinned fetch](../../server/utils/upstream-node-client.ts#L357-L407) | DNS 校验、地址固定、禁止重定向及截止时间已有实现，但 pinned transport 将全部 chunk 收集后复制至单一 buffer，无明确 body 字节上限。可配置 upstream 才使用；未实际发送大响应测压。 | N5 扩展前补响应上限、慢 body、异常释放和限流；若已启用 upstream，升为独立 P1 加固。 |

## 3. 复现说明

在上述提交、安装依赖的隔离工作树执行。用 Vitest mock provider/网络；SQLite 为内存 fixture。仅使用 example.test 和合成值，禁止接真实服务。

- A09：mock getSourceHealthEventsTable 返回 undefined，调用 recordSourceFailure("weibo", 7, new Error("GET https://example.test/?token=AUDIT_SYNTHETIC_NOT_A_SECRET failed"))；getSourceHealthSummary 后传入 createSourceHealthSourcesResponse 与 createSourceHealthDiagnosticsResponse，断言合成标记同时出现在 JSON 和报告。修复验收则必须断言标记不存在。
- A10：Cache.init；ArticleIndex.init；同源写入两篇标题含 Alpha 的文章；直接删除一条 article_search（不改 articles），断言 ftsIsInconsistent=true；新 Cache(db,{deferMaintenance:()=>{}}).openPages(false)，health.status=ok、searchArticles({query:"Alpha"}).mode=fts、items.length=1；index.searchLike 同查询为 2。
- A11：Cache(db,{deferMaintenance:p=>tasks.push(p)}).openPages(true)；set weibo 后等待 tasks，再 set v2ex、ithome；tasks.length=1、pendingIngest=2；新 Cache 同样 openPages(false) 后 get("v2ex")，仍 2。
- A12：verifyLatestNewsSyncHubConnection("http://example.test","shk_audit_synthetic_only", mockFetcher)，mock 返回 HTTP 200 + JSON {code:123,message:"denied"}；断言调用目标 HTTP、X-API-Key 合成值、结果 ok=true；isSyncHubVerificationSuccessful(200,'{"code":123}') 同样 true。网络未执行。
- A13：createDatabase(db0/connectors/cloudflare-d1({bindingName:"AUDIT_DB"}))，mock nitro/database.useDatabase 返回该库，ENABLE_CACHE=true、INIT_TABLE=false。模拟 binding A 的 prepare/bind/run；INSERT 在 gate 等待；开始 append("weibo", healthy event) 后等 INSERT 到达，替换 globalThis.__env__.AUDIT_DB 为 B，释放 gate。两次实际 connector 调用记录 A:INSERT、B:DELETE。真实 D1 请求生命周期另测。

复现文件是临时用例，执行后移除，未作为正常测试通过或已修复状态写入仓库。隔离日志：/tmp/ln-review-repro.log 与 /tmp/ln-review-d1-context.log。

## 4. 模块复审结论与剩余验收

| 范围 | 已有证据 / 源码判断 | 下一步 |
| --- | --- | --- |
| 采集与 HTTP 调度 | SourceEngine singleflight/取消、队列边界、FetchScheduler origin 限制、受信插件协议与配置来源边界已存在；72,000 全 API、45,000 回环 HTTP 请求有三轮数据。 | 保持默认并发 8；针对真实来源和 Pages 请求生命周期补证据。 |
| 数据持久化 | 文章规范 URL、原子写入、持久 journal、FTS generation/cursor、事件审批与别名已实现；#33 仅扩大 SQLite 重建页，D1 不变。 | A10/A11 先修；再对持续在线写入、审计锁、目标 D1 和备份迁移验收。SQLite CLI 不是 D1 维护工具。 |
| 观测与 API | v1 API、OpenAPI、health、Node manifest 已存在。来源事件持久表和公开内存摘要目前不是同一观测语义。 | A09/A13；复核公开错误、数据新鲜度、实例/持久化来源标识。 |
| Web/PWA | /archive、历史事件分页、共享阅读操作已接入；TanStack Query 取消信号、查询键和离线状态检查已有代码；现有 React 18、Vite 8、Nitro 3 beta/H3 2。 | 不再重复建设档案界面；验证目标部署及 30 分钟阅读循环、存储故障、键盘/移动端回归。 |
| Electron | 主进程代理、固定来源、IPC 可信窗口、HTTPS、受信插件进程和安全存储边界已有实现。 | A12/A14；v0.9.0 正式安装/升级/卸载、托盘、异常恢复与长测；本地 JSON 缓存不冒充服务端历史。 |
| 同步 | v1 无条件 PUT、union 合并、按集合上传队列；已有 tombstone/CAS 参考模型，未启用生产。 | A12 优先；账户隔离、旧客户端兼容与真实双客户端冲突验收；外部服务需授权。 |
| 事件质量/检索 | 历史人工审批、别名、独立复核工具与未审核候选集已就绪。中文/混合查询当前字面匹配。 | 独立双人标注及保留集确认；先验证漏召回与成本，不开启自动归属或 RRF。 |
| 发布/供应链 | immutable Release guard、18 个正式资产摘要元数据、Node/Pages/桌面 CI；v0.9.0 早于 #33。 | 只读核验已发布资产；正式实机验收与双架构 Docker，固定基础镜像候选；下一次发布需单独授权。 |
| 节点联邦/插件 | 上游 DNS 地址固定、下游权限/限流、熔断与诊断；当前属于条件性能力。 | A15，先完成边界加固与本地节点验收，不扩展分布式读写或开放非受信插件。 |

## 5. 执行决策

本次只更新开发计划和复审证据，不实现缺陷修复，不重复已合并工作。首轮 P0 为 N3-G1、N2-D1、N4-P1；随后 N3-G2、N4-P2、N4-P3；独立质量复核和正式版本验收可并行，外部部署、真实账户及目标 D1 依赖授权。每项必须有独立 PR、可复现基线、明确通过门槛与回退策略。持续写入阈值、审计有效期及 D1 预算是待验证方案，不视作已有 SLO。详见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)。
