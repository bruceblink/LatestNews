# N4-P2 独立有界维护与积压治理

基线：N3-G2 合并后的 1ed12e9。验收环境：隔离 Linux、Node 22、SQLite、实际 Pages 构建 + Miniflare/workerd（兼容日期 2026-08-06）。未访问生产 D1、真实上游或发布服务。

## 机制与运维契约

- 新增 article_maintenance_lease 和 article_ingest_work 两张附加表。每库一个 60 秒持久租约，以随机 owner 原子取得。已有 owner 时返回 busy；异常终止后到期接管。释放、进度、重试、检查点与 journal 删除验证 owner；文章及来源原子写批次也验证租约，丢失租约时整个批次回滚。FTS 更新仍从现有文章行生成；既有 generation/cursor 防止过期重建进度覆盖。旧版 CLI repair/migrate 属于停旧写入器的显式运维，不把它们混作并发调度入口。
- 正常写入保留缓存 + journal 原子提交。每次维护默认 5、最多 20 个快照分片；每分片最多 30 个条目，旧大快照使用持久 offset 继续处理。完成全部分片才删除 journal；发生中断时未确认分片可以重放。不保证 exactly-once，不承诺源站输入缺失、cache-only 覆盖或等时跨来源冲突能自动恢复。非法 URL 仍按既有安全策略过滤；无法解析 JSON 或必需字段不合法的快照保留。
- 独立处理优先最老且可重试快照；普通 Node 写入仍可优先自己的 journal。每轮同一个快照至多尝试一次。首次失败允许下一轮立即重试，之后 1 秒起指数退避，最多 5 分钟。失败记录不会被自动删除或移动到不可见队列。成功/失败/分片进度计数指本轮已确认操作；attempts 为仍积压快照的累计次数，非终身计数。
- 5 秒是启动下一分片/FTS 维护的软预算；FTS 仍最多两页，已开始的数据库原子操作或全量审核不能强制中止。初始化、诊断统计、单次数据库等待、旧大快照 JSON 解析和最终审核可能越过预算。持续输入可能产生积压；锁预算、正常写入速率及 30 分钟负载需 N4-P3 验证。
- 使用已配置的 LATESTNEWS_REFRESH_TOKEN 调用 POST /api/v1/articles/maintenance?limit=5，不需请求体，不采集源站。HTTP 200 返回 ok/pending，409 返回 busy，503 表示不可用或中断；未配置/无效令牌不执行维护。报告 pendingIngest、最老观测时间/年龄、累计尝试、退避数、pendingFts、untrackedCache、成功/失败/分片进度和本轮耗时，不返回 journal 内容。定时器由运维另行授权和配置，不在本 PR 启动。
- Node CLI 使用 articles:maintain --db <existing.sqlite> drain --confirm --passes 5。它不主动发起全量重建。非 ok 返回退出码 2；按状态排查后再执行。INIT_TABLE=false 缺表时保持来源缓存可用，独立维护 unavailable，不自动 DDL。受控迁移先备份并停止旧写入器；不得同时运行不理解租约的旧维护程序。

## 验收结果

- SQLite 8 项专项：三轮各 30 来源、每来源 30 条（共 2700 条观测、900 个唯一文章键）；无 UI 访问可排空；双连接租约、到期接管与旧 owner fencing；65 条快照分片续处理；毒消息退避并允许其他有效工作推进；取消与注入的软预算耗尽；维护期间新缓存提交不被旧快照覆盖。原事件分页夹具显式先排空 101 条快照，再注册事件；不改变分页和结果断言。
- 实际 Pages 构建后的隔离 D1 新增 5 个检查点：授权与限额、租约争用；三轮 30 来源；workerd 重启 + 持久进度/过期租约；过期 owner 写入回滚；坏数据保留与其他条目处理。既有 33 个 Pages/D1 检查点通过。测试未配置真实上游网络。
- 全量 Vitest 113 文件、631 项；lint、三端类型检查、Node/Pages/Electron 构建、实际 Node/Electron 采集宿主 smoke 通过。独立 SQLite 文件的 CLI drain/status 实测从 1 条待入库 journal 收敛到 0，FTS verified。历史完整性用 ftsIsInconsistent 验证。
- 有限输入的正确性与积压收敛已验收。持续输入时的吞吐、真实锁等待、P95/P99 和恢复时间候选门槛仍属于 N4-P3。目标 D1 的费用、硬时限与生产调度未验收，不能从本地时延外推。

复现：先构建 Pages，再在安装有 Miniflare 的独立目录设置 LATESTNEWS_MINIFLARE_DIR，并设置 LATESTNEWS_D1_TEST_COMPAT_DATE=2026-08-06，执行 pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/article-maintenance-d1-smoke.mjs。
