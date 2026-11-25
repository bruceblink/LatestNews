# N4-N 全 API 基准校准与重放优化

2026-11-25，基线 104f94e，Linux x64 / Node 22.23.4 / pnpm 12.21.0，8 逻辑核 AMD EPYC。所有测量使用同一修改后的 Node 构建、独立临时 SQLite 和无外网权限的 30 来源插件，每来源 30 篇。原始记录的 Git dirty 标志为 true，表示在提交前测试；本报告随测试代码提交。

## 根因和修复

旧基准在 cold 场景 HTTP 返回后直接清除下一波缓存，未等待后台补写，导致下一波被上一波的写入污染；此前的 4 cache、4 success、22 pending 不满足预期，不能用于性能对照。原 Cache.maintainArticleIndex 并发选择相同 journal 行；同一采集结果的多个请求也可重复保存相同 snapshot。这两个代码风险分别通过状态校验和写入计数测试约束；未单独进行只修复其中一个因素的因果 A/B。

- 同一 Cache 实例对完全相同的在途 source/payload 合并保存；不同 payload 或完成后再次观测不合并。旧快照不覆盖较新文章。实例内重放串行，跨实例仍依赖持久 journal/原子事务，不能宣称全局 exactly-once。
- 基准预热按 5 来源分组，正式波次仍为原定义。每波确认全部目标 cache 与 checkpoint 一致、journal/FTS 待处理为零且修复状态 ready；不只等待 HTTP。人工 stale timestamp 与匹配 checkpoint 原子调整，避免制造新的观察任务。响应状态校验未放宽。
- 增加 --source-concurrency 参数和进程环境 LATESTNEWS_SOURCE_MAX_CONCURRENT（1–16，默认 8）；不改变默认队列或每 Origin 限制。报告 formatVersion 2 分开记录响应窗口 RPS、完整波次 RPS、后台等待分位数和实际波次数。

## 校准结果

每档仅一轮、每场景 12 请求、4 并发客户端（3 波；预热另计），8 场景 × 12 × 3 = 288 测量请求，状态错配和 API 错误均为 0。30 来源：

| 来源并发 | 全命中 P95 ms | 冷 P95 ms | 部分 P95 ms | 部分后台等待 P95 ms |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 13.218 | 2932.535 | 567.164 | 961.418 |
| 6 | 11.601 | 2860.473 | 607.527 | 968.532 |
| 8 | 12.060 | 2852.864 | 553.963 | 1000.339 |

部分命中按交互响应允许合法 pending，随后后台完整补写；冷场景必须 30 success，无 pending。后台等待 P95 是每波剩余等待而不是每请求索引耗时；只有 3 个波次，分位数只供探索。与 11 月 22 日或上一失败 pilot 不做直接百分比对比；默认并发保持 8。原始结果：[n4n-api-calibration-2026-11-25.json](n4n-api-calibration-2026-11-25.json)。

复现：

```sh
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build
for n in 4 6 8; do
  pnpm exec tsx scripts/performance/api-baseline.ts --samples 12 --concurrency 4 --source-concurrency "$n"
done
```

正式验收仍需相同构建/机器，每档至少 3 次独立、每场景 >=1000 请求、4/6/8 对照。仍缺端到端上游 HTTP 阶段拆解、10 万 FTS 完整恢复、30 分钟长测、独立人工标注、目标 D1 成本/并发。此次不是正式性能验收。

## 回归

105 文件 572 项 Vitest；lint、Node/Web/Electron typecheck、Node/Pages build；实际 Pages 产物的 Miniflare D1 16 检查点全部通过（compatibility date 2026-08-06）。无 schema、生产配置和发布修改。
