# N4-L1 文章身份、时间和原子写入（2026-11-25）

基准 b70fd0a，审查 A01/A02/A04。新文章使用 article-v2- 加规范 URL 的 SHA-256，若候选键被不同 URL 占用，使用独立 UUID；数据库 canonical_url UNIQUE 是身份判定边界。现有主键和事件归属不重算。来源原始 ID 和内容指纹仅为元数据，不用于合并不同规范 URL。来源 ID 复用时两个历史文章各自保留来源关系；同一文章同一来源保留最近一次写入的 raw_item_id（不是每次观察的完整日志）。

Node 使用 better-sqlite3 同步 immediate transaction，D1 使用绑定 batch；单篇文章的查询、upsert 和来源关联为一个事务。失败回滚该篇文章的插入或更新，先前成功的文章不回滚整个来源缓存；FTS 单篇 delete/insert 使用独立原子 batch，从实际文章行取标题，避免同一 key 并发写出重复或旧标题。FTS 故障仍降级，完整对账在 L2。

索引 published_at 为 UTC 整数毫秒或 NULL。正数小于 1e11 按秒，其他按毫秒；支持明确时区的 ISO、常用带时区邮件日期、ISO 日期（UTC 零点），不推断无时区的本地时钟时间。显式 since 排除未知时间；不传 since 仍返回未知时间文章。保留原始 item payload。已有源数据若早先已按本机时区错误转为数字，无法仅凭数据库恢复原时区。未统一所有来源专有时间解析逻辑。

旧 schema 的 article_sources UNIQUE(source_id, raw_item_id) 在原子批次中复制、替换为 PRIMARY KEY(article_key,source_id)，保留全部既有映射；日期按原 payload 有界分页、比较并写入，迁移完成标记记录到 article_schema_migrations。迁移中断可重新初始化，旧主键、事件、原 payload 不改。要求升级前备份、停用旧版本写入器，先在独立副本 INIT_TABLE=true 验证后才在目标环境执行。禁止仅恢复旧二进制继续写入：旧代码使用 raw ID/指纹关联，可能破坏新关系；回退须前向兼容修复或恢复备份并评估升级期间新写入。保留原数据库，无生产清理。规模化迁移、完整恢复与能力探测列入 L2/N。

## 实测

Linux Node 22.23.4 / pnpm 12.21.0：99 个 Vitest 文件、537 项通过（新增 8 项），lint、三端类型检查、Node/Pages 构建通过。隔离 D1 实际 Pages 产物：旧来源表和秒级日期迁移、旧 key/event 保留、旧 32 位哈希冲突、raw ID 复用、同 URL 双来源并发、触发器注入写失败回滚、FTS 单行、秒/毫秒/ISO/未知 since 过滤，以及既有事件/别名/URL 回归均通过。使用 Miniflare/workerd 兼容日期 2026-08-06，生产兼容日期未修改；目标 D1、多节点、大数据迁移未验证。

复现：
```bash
pnpm exec vitest -c vitest.config.ts run server/database/article-identity-migration.test.ts server/api/v1/articles/search.test.ts
pnpm test --run
```
D1 复现按 [事件注册表验收](news-event-registry.md) 运行 event-registry-d1-smoke.mjs。无新依赖或发布。
