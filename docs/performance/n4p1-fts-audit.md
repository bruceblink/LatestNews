# N4-P1：持久 FTS 审核与就绪语义（A10）

2026-11-26；开发基线 `972ce4124503a8106dc087c4bdbcd036c9aaa512`（#35 变基合并）。正式 v0.9.0 不包含本切片。

## 设计和兼容边界

- 原有 ready phase 仅表示恢复状态，不再单独授权 FTS 读取。新增单行 `article_fts_audit`（version、generation、audited_at、valid），不改旧表/文章/事件身份。当前审核版本 1；候选有效期 24 小时，非生产 SLO。
- 只有完整行一致性审核通过、代次/版本匹配、时间戳有效且未过期，且无待修 FTS 键与待入库 journal 时，查询才允许 FTS。健康返回可选 `ftsAudit`（verified/unverified/expired/failed，合法时含 auditedAt），原字段和 HTTP 契约保持。FTS 审核证据与 pendingIngest/untrackedCache 分开解释；不是全局实时完整性承诺。
- Pages 快速 probe 只检查 schema；在同一 SQL 快照读取 phase、pending FTS 和证据，检索 SQL 同时检查证据及恢复条件。普通请求不进行全量一致性审核。缺证据、过期、代次/版本不匹配、未来时间、无效证据、正在修复均回退 LIKE 或明确不可用。重建中 generation/cursor CAS 不变。观察到重复 FTS 结果或本地只读完整探测失败时，该实例保守回退，维护再审核。
- 维护批次以同一事务写入审核记录并推进 ready；失败或中断不可发布证据。强制启动审核先清理旧证据，失效状态不会因失败被刷新。旧证据只代表审核时刻的行一致性；正常受控写入依赖原有 durable journal/原子 FTS 更新。不受控 SQL、物理损坏或 FTS 内部倒排损坏并不能由该证书实时发现；外部写入在有效期内可能仍漏检。完整审核沿用行一致性检查，不宣称验证 FTS 内部所有 posting。
- Pages INIT_TABLE=true 对已迁移库仅添加审核表，不在交互请求重审十万行；缺失 FTS 表重建前清除旧证据。INIT_TABLE=false 无隐式 DDL，旧库继续提供 LIKE/缓存，须由操作者备份后显式升级。SQLite 使用现有 articles:maintain migrate（停旧写入器、独立备份）后执行维护；目标 D1 尚需独立迁移/回退验收。回退至不理解审核证据的旧版本不能宣称 N4-P1 门槛仍有效；再升级前应由操作者在维护窗口清除旧证据并重审，不自动删除历史数据。
- 现有维护入口在证据缺失或到期时执行审核，cached insights 的 deferred maintenance 也能推进；普通读不触发写入。N4-P2 仍负责独立调度、积压、租约及公平性，不把这一切片当作已实现周期任务。SQLite build 200、D1 build/pending 50 保持。

## 正确性和回归

- 旧 ready 无证据、缺失 FTS 行的 A10 复现：两篇文章，删一行 FTS；新 Pages fast path 显示 degraded/unverified，LIKE 返回两篇。自动添加审核表仍无证据；维护后完整索引和 FTS 两篇均恢复。
- 10 项专项 Vitest 包含 legacy、expiry、generation/version mismatch、future、invalid、失败审核、ready 转换回滚、空积压到期续证和丢失 FTS 表重建。原有 12 项恢复用例增强 SIGKILL：在审核记录插入之后、ready 更新前杀死真实 SQLite 子进程，重开证据未改变、游标仍 verify；继续并发写入、重建后证据与代次一致。
- 隔离 D1（Miniflare/workerd，compatibilityDate=2026-08-06）实际 Pages 产物新增 4 个审核检查点：跨 restart 保留证据、managed legacy 不 DDL、不信旧 ready、additive upgrade/维护、过期与注入失败恢复。原恢复、Pages cache、event registry smoke 2+4+17 个检查点通过，D1 30 条批次仍 2 batches/7 statements。不是目标 D1 实测。

## 10 万篇本地热路径对照

脚本：`pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/article-fts-audit-benchmark.ts 100000 100`。原始数据：[n4p1-fts-audit-baseline.json](n4p1-fts-audit-baseline.json)。同一隔离 Linux/Node 22.23.4、SQLite 3.53.4、文件数据库 DELETE journal、相同 synthetic fixture、20 次预热；各版本 3 轮、每轮 100 次健康及 100 次唯一命中 FTS。每次包含新 Cache/openPages(false)，无 HTTP/网络层。baseline 和最终候选顺序执行、非随机化；中间候选不计。下表 P95 为三个分轮 P95 的中位数，不能外推生产。

| 指标 | baseline | 最终候选 |
| --- | ---: | ---: |
| 健康 P95 | 1.160 ms | 1.032 ms |
| 健康 SQL prepare 次数/请求 | 14 | 13 |
| FTS P95（唯一命中） | 0.944 ms | 0.843 ms |
| FTS SQL prepare 次数/请求 | 8 | 7 |
| 热路径完整审核语句 | 0 | 0 |
| 一次启动含完整审核 | 281.981 ms | 300.495 ms |

合并 schema 查找与 readiness 读取减少调用。EXPLAIN QUERY PLAN 显示审核表/恢复表单行整数主键查找、FTS MATCH 虚表索引、文章 URL 唯一索引；未取得引擎精确 rows_read 或 VM steps，不将计划估算写成实测行数。LIKE 降级及高命中检索不属于本基准；完整审核锁与持续在线写入留给 N4-P3；真实 D1 CPU/读写/费用留给 N4-P4。

## 验收边界

本轮不操作目标部署、不迁移生产 DB、不发布版本。新表仅增加元数据；真实恢复与容量按指定环境验收。下一切片 N3-G2。N2-D1/D2/D3 仍延后，A12 保持开放 P0。
