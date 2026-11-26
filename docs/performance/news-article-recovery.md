# N4-L2 索引一致性与恢复（2026-11-25）

基准 b548c5b。新增来源快照补写队列、已处理快照检查点、FTS 待修复 key 队列及持久修复游标。数据库仍为 SQLite / D1。INIT_TABLE 未配置时默认初始化；false 只探测已有 schema，缺少迁移时来源缓存继续读写，历史索引能力降级。必须先按 N4-L1 备份迁移要求停用旧写入器。

来源缓存与快照 journal 在一个原子批次写入；文章写入失败保留 journal，后续缓存写入、启动或运维命令有界重试。按观测时间保留较新文章，重放旧快照不覆盖更新记录。若 journal 自身不可用，允许 cache-only 写入；最新未处理快照由检查点对账发现。此故障期间被后续快照覆盖的内容不保证恢复，须通过外部采集记录或备份处理。队列不自动丢弃未成功快照，容量与告警门槛待 N4-N 验证。

FTS 对账检测重复、缺失、孤立、过期标题/URL。每步至多 50 个有效 key，原子替换该页，使用 generation/cursor 防止并发修复覆盖进度，增量队列同步处理。全量校验与 FTS 虚表扫描的数据库工作量仍可能随表大小增长；只保证单次修复的 key 数量有界，不宣称固定时延。重建期间查询使用字面回退，来源未补写时历史结果可能不完整。旧非法 URL 行不自动删除。

`GET /api/v1/health/deployment` 新增可选 checks.articleIndex，含 status、fts、pendingIngest、pendingFts、eventRegistry、untrackedCache，不返回快照内容或凭据。状态表示可探测 schema、已知积压及本进程的 FTS 校验状态，不是每次健康请求全库审计。事件注册表状态表示表可用性，不保证聚类正确。

## SQLite 运维

先备份、停止旧写入器，在隔离副本验收后再按授权操作目标库。命令不会访问 D1 或远端。status 只探测；repair/migrate 需要 --confirm；backup、restore-copy 不覆盖已有路径。restore-copy 输入必须是已验证的独立备份文件，而不是运行中的 WAL 数据库。

```bash
pnpm articles:maintain --db /path/to/existing.sqlite status
pnpm articles:maintain --db /path/to/existing.sqlite drain --confirm --passes 5
pnpm articles:maintain --db /path/to/existing.sqlite backup --backup /path/to/new-backup.sqlite
pnpm articles:maintain --db /path/to/existing.sqlite migrate --backup /path/to/new-before-upgrade.sqlite --confirm --passes 5
pnpm articles:maintain --db /path/to/existing.sqlite repair --confirm --passes 5
pnpm articles:maintain --db /path/to/new-backup.sqlite restore-copy --backup /path/to/new-restored.sqlite --confirm
```

N4-P2 的 drain 仅执行有界 journal/FTS 维护，不主动重建索引；租约、重试和独立调度见[维护报告](n4p2-bounded-maintenance.md)。

备份使用 SQLite backup API 并执行 integrity_check。修复仍有积压或不可用时返回退出码 2，重复执行有界批次，检查故障原因；不自动清理或恢复生产。恢复副本先验证读写、身份、事件与版本，再由运维决定切换。D1 备份、规模化迁移/恢复需在目标授权环境验收；本地 Miniflare 不能替代。

## 验收

Linux / Node 22.23.4 / pnpm 12.21.0，100 文件 545 项 Vitest（新增 8 项）；lint、三端类型检查、Node/Pages 构建通过。隔离 SQLite 实测同数量错误 FTS、重启续修、并发修复/写入、FTS 故障、持久快照重放、旧快照保护、INIT_TABLE=false 的探测及旧库可用；实际运维命令完成备份、迁移、恢复副本、修复和状态读取。实际 Pages 产物 + Miniflare/workerd D1 通过既有 smoke，以及注入来源关联失败、缓存仍读、健康降级、重启重放、同数量 FTS 错误、分页修复/并发写入和查询降级/恢复。兼容日期 2026-08-06，不修改生产配置。

回退保留文章/来源/事件、检查点与未处理队列；旧代码不会继续处理队列，因此不能简单回滚后宣称恢复完整。未执行生产数据修改、新部署操作或 Release。下一切片 N4-M。
