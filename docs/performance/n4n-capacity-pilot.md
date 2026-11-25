# N4-N 容量与性能 pilot（2026-11-25）

基线 029a405，Linux x64，Node 22.23.4，AMD EPYC，8 逻辑核，约 16 GiB RAM。全部测试为隔离本地 SQLite 或回环夹具，不是生产 D1。单次执行，不是正式三轮对照。

## 容量

`pnpm performance:article-capacity` 构造 1k/10k/100k 确定性文章和映射，批量导入只用于测试夹具，不代表采集写入吞吐。实际 ArticleIndex API 验证 30 次各查询结果、模式、去重与事件分页完整性；10 次双来源并发更新要求各有一次插入/更新。重建按 12 秒预算停止并保留 pending 状态，最终检查一致性仅适用于完成重建的库。临时数据库删除，不接触生产。

| 文章数 | 英文 P95 | 中文 P95 | 混合 P95 | 事件分页 P95 | 双来源写入 P95 | SQLite 文件 | 修复 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1,000 | 0.814 ms | 2.097 ms | 2.683 ms | 1.026 ms | 7.034 ms | 1,470,464 B | 71.4 ms 完成 |
| 10,000 | 3.133 ms | 9.059 ms | 10.491 ms | 1.088 ms | 10.170 ms | 13,209,600 B | 2,046.7 ms 完成 |
| 100,000 | 76.474 ms | 119.526 ms | 125.974 ms | 1.117 ms | 72.236 ms | 121,774,080 B | 12,067.5 ms；5,500 键；pending |

文件含追加的 10 条文章，RSS 为进程采样值而非各库独立峰值；100k RSS 1,602,125,824 B，不能归因于单个索引组件。英文常见词与中文全表字面搜索的增长，以及 FTS 修复扫描成本需进一步优化。P99 样本小，仅供探索。

## 采集

`pnpm performance:http-collection --smoke --samples 60 --clients 30 --source-concurrency 4,6,8 --output /tmp/n4n-http.json`：五类场景 × 三档 × 60，共 900 请求，预期状态错配为 0；固定延迟分散来源 P95 141.22/105.18/96.26 ms，单源 P95 272.55/277.39/270.10 ms。不是完整 HTTP API，也不足以调整默认并发。

`pnpm exec tsx scripts/performance/api-baseline.ts --samples 12 --concurrency 4`：首次 30 来源预热发生 worker code 0 但未接收结果。Node host 从 exit 改为 close，避免进程退出先于缓冲 IPC 关闭的竞争；30 fixture worker 并发批次回归通过。再测进入冷缓存场景，但 batch-30-sources-cold-cache-miss 预热期望 30 success，实得 HTTP 200、4 cache、4 success、22 pending、1 error；本次无有效全 API 对照。基准保留失败上下文，不能将部分结果记为通过。后续应先隔离重复 journal replay、前一波后台写入与缓存准备，校准状态再执行全样本。未对这三个因素完成因果定位。

原始聚合记录：[n4n-pilot-2026-11-25.json](n4n-pilot-2026-11-25.json)。

## 状态

552 Vitest、lint、三端 typecheck、Node 构建通过。尚未完成 1000 请求/场景/档 × 3 独立运行、100k 全修复、冷暖启动和 30 分钟长测、目标 D1 行数/成本、独立人工复核及保留集。N4-N 仅完成 pilot，不通过正式性能质量门槛，不改变生产默认值。基础历史查询产品闭环不因独立标注未完成而被阻断，语义自动归属及混合检索继续禁用。
