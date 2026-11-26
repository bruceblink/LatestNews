# N4-N：FTS 恢复专项性能与正确性复验

2026-11-26。父提交 `baacb5d292dc0bf23467f2c2b98171d402695fca`；继承 11 月 25 日 `acf9ac6` 的有界 clear/build/verify 设计。PR #19 的 12.067 秒只完成 5,500 键，不能作为完整恢复时间；后续 [FTS 容量恢复对照](n4n-fts-rebuild.md) 已记录 6.566/6.350 秒的完整恢复。本专项从最新主线的 50-key 重建页出发。

## 方法

Linux x64 / AMD EPYC 8 逻辑核 / 约 16 GiB RAM / Node 22.23.4 / better-sqlite3 13.0.3 / SQLite 3.53.4；journal_mode=delete，synchronous=FULL。每轮独立临时文件库，100,000 条确定性文章、映射与 FTS 夹具，追加 10 条双来源文章。先验证全量一致，再调用 rebuildSearchIndex()，循环 continueRepair(1) 直到 ok；十分钟 watchdog 判失败，不把 pending 当成功。计时不包含夹具载入、最终独立复查及查询。六轮顺序运行，未随机化。与历史 pilot 的前置查询/负载及探针不同，不直接比较历史耗时。

探针仅在性能脚本中包装 native prepare/statement 与 transaction.immediate；SQL 类别包括 prepare + 执行，事务边界为事务 wall time 减去已记录 SQL，不等同 fsync。外层进度采样有额外开销。首次尝试因 native immediate 只读属性的探针错误退出，排除；第一对仅记录主要类别，第二、三对补充事务 wall P95/max，不改变恢复算法和主要计时类别。EXPLAIN QUERY PLAN 证实覆盖索引扫描及按主键查询。

## 实测

| 指标 | 50 键基线 | 200 键候选 |
| --- | ---: | ---: |
| 第 1 轮全恢复 | 7,215.678 ms | 4,338.489 ms |
| 第 2 轮全恢复 | 6,873.407 ms | 4,126.875 ms |
| 第 3 轮全恢复 | 7,208.047 ms | 4,221.772 ms |
| 中位数 | 7,208.047 ms | 4,221.772 ms |
| 批量事务 / 轮 | 2,504 | 1,004 |
| API 调用 / 轮 | 2,485 | 985 |
| 重建 INSERT / 轮 | 2,001 | 501 |
| 事务边界开销中位数 | 2,907.846 ms | 1,438.685 ms |
| 第 2/3 轮重建事务 P95 | 2.352 / 2.419 ms | 4.552 / 4.462 ms |
| 第 2/3 轮 verify 事务 wall | 661.890 / 762.677 ms | 594.317 / 618.609 ms |

六轮均 100,010 键、ok、独立审计无不一致、FTS 搜索正确、pendingFts/pendingIngest=0。中位数减少 41.4%；事务数减少 59.9%。第一轮基线事务边界 3,022.817 ms、索引写入 1,095.729 ms、主键扫描 182.650 ms、状态 1,098.658 ms、清理 503.859 ms、事务内审计 676.439 ms、队列补偿 206.497 ms；其他为外层及探针等开销。最终全量审计仍是一笔较长事务，不删除或移出原子 ready 发布条件。

## 变更和正确性

仅 better-sqlite3 重建页 50→200；D1 仍 50，清理 200，pending 补偿 50。游标、generation 守卫、持久 pending、事务原子性、LIKE 回退及完整校验不变。continueRepair(maxPages) 仍有页数边界，但 SQLite build 单次调用工作量上限变为原先四倍（默认 20 页最多 4,000 键；缓存补写两页最多 400 键）。回退只需恢复页大小；当前主线已理解 fts-v2 游标，无新 schema 或游标版本。禁止回退到不理解 fts-v2 的旧算法并混跑。

新增 450 篇真实文件 SQLite 测试：clear 后重开；子进程在 FTS insert、pending delete 之后、cursor 更新提交之前 SIGKILL，重开后游标和 FTS 行数仍未改变；下一子进程完成 200 键事务后 SIGKILL，重开保持游标及行数；两个独立 SQLite 连接交错修复、游标前后更新、新增、较旧快照重放和 verify 阶段写入；最终 451 文章、451 FTS 行、453 来源映射，最新标题与来源正确、旧标题无结果、pending=0、审计通过。进程终止断言为 POSIX 测试，Windows 跳过；不等同物理断电测试，交错写入不等同多线程压力测试。

107 文件 593 Vitest，lint、Node/Web/Electron typecheck 通过。本次未重新构建完整 Node/Pages 包，也未执行长时间写入压力测试。

## D1 边界

独立本地 Miniflare/workerd（compatibilityDate 2026-08-06）通过 220+1 篇夹具：首批仍 50 键、并发修复与写入、workerd 重启保留游标、最终验证并查询最新标题。直接调用 D1 connector 与 ArticleIndex，不是实际 Pages 构建或目标 D1 验收。D1 页大小与 SQL 不变；本地吞吐不能外推到远端批处理时延、CPU、读写行数、费用和生产 SLO。最终全量审计成本及持续写入下收敛/锁等待仍须验证；不访问生产库。

## 复现

```sh
pnpm performance:article-recovery 100000
pnpm exec vitest -c vitest.config.ts run
pnpm lint:check
pnpm typecheck
pnpm typecheck:electron
LATESTNEWS_MINIFLARE_DIR=/path/to/isolated/miniflare-install pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/article-recovery-d1-smoke.mjs
```

基线使用父提交的 article-recovery.ts 和同一 benchmark 脚本，候选使用本变更；单独 worktree，依赖一致，不并行运行。原始记录：[n4n-fts-recovery-profile-2026-11-26.json](n4n-fts-recovery-profile-2026-11-26.json)。

专项本地通过；建议保留 200 键候选，不扩大页大小或修改 D1 默认值。若在线写入尾延迟、恢复收敛或正确性退化，则回退 50；下一步验证实际写入负载及最终审计锁占用，再考虑审计优化。整个 N4-N 的长测、真实上游、独立标注、目标 D1 均未由本次专项关闭。
