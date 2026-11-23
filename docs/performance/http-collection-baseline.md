# N4-C：可控 HTTP 采集与调度对照基准

这是一套**独立的、仅使用 127.0.0.1 的组件级实验**。它直接调用生产 SourceEngine 和 FetchScheduler，通过本地 Node HTTP 服务模拟源站。不依赖公网、Exa、生产数据库或订阅源。

> 本实验**不是**既有 api-baseline.ts 的替代品。它不启动 Nitro API，不包含 SQLite 缓存、HTTP API 序列化或真实源站。不得把组件 P95 与 2026-11-22 的 API P95（全命中 34ms、冷采集 2924ms、部分命中 327ms）直接比较。

## 运行

环境要求：Node 满足仓库 engines，使用锁定的 pnpm、相同 Git 提交与机器。保持 CPU/内存负载、客户端并发、种子和网络条件一致。

    pnpm install --frozen-lockfile
    pnpm test --run test/performance-http-collection.test.ts
    pnpm performance:http-collection -- --samples 1000 --clients 30 --source-concurrency 4,6,8 --seed 20261123

快速功能检查（**不作为性能结论**）：

    pnpm performance:http-collection -- --smoke --samples 40 --clients 12 --source-concurrency 4,6,8

输出默认位于 .data/performance/http-collection-baseline.json。也可用 --output PATH 指定路径，使用 --scenarios fixed-spread,jitter-spread 运行子集。建议在隔离环境重复完整基准至少三轮，分别记录结果，不覆盖旧报告。

## 测试内容

| 场景 | 测试源站 | 验证目的 |
| --- | --- | --- |
| fixed-spread | 四个本地 Origin，固定 16ms | SourceEngine 并发与双层调度 |
| jitter-spread | 四个 Origin，12–60ms 可复现抖动 | 长尾与公平性 |
| single-origin | 单 Origin，固定 16ms | FetchScheduler 每 Origin 最多 2 个并发 |
| http-errors | 四个 Origin，固定种子注入 429/503 | 错误分类、不中断其他来源 |
| client-cancel | 四个 Origin，64ms，固定比例客户端取消 | AbortSignal 传递与释放 |

使用与生产调度器相同的选项：FetchScheduler maxConcurrent=8、maxPerKey=2、maxQueued=100、queueTimeoutMs=8000、taskTimeoutMs=8000；SourceEngine maxQueued=100、queueTimeoutMs=8000，仅对 maxConcurrent=4/6/8 做对照。每个样本使用独立来源 ID，避免 Singleflight 改变采集次数；Singleflight 的正确性由原有专项测试覆盖。

每场景每并发档至少 1,000 个**逻辑采集请求**，30 个固定客户端 worker，5 次/Origin 预热，运行时按固定样本 ID 和种子计算上游延迟与失败类型。真实并发受两层队列与 Node/OS 调度影响。不同配置使用相同样本集合，但执行顺序可能不同。

## 报告及验收

JSON 保留 Git SHA、Node/OS/CPU、并发和随机种子、每场景端到端 P50/P95/P99、每阶段 source.queue、source.collect、source.normalize、http.queue、http.request 分布、成功/错误/取消率、429/503 计数、吞吐、上游并发峰值和未完成队列。

阶段 span **存在嵌套**：source.collect 包含 http.queue 和 http.request，不能将它们加总。http.request 测量请求函数执行与 JSON 提取，不是纯网络 RTT。超时或取消时 span 的记录时点可能晚于调用方 Promise 结束。

本实验不读写缓存，因此 cacheHitRate 和 backgroundCacheTasks 均为 null（**不适用**），不能报告为 0% 命中或无后台缓存任务。API 缓存命中率与后台待完成数量仍需由既有 performance:baseline 核实。最终优化要使用同构建、同机器、同场景重复测量，并在真实 API 基线复测后才能下结论。

验收：没有未预期的状态；所有采集请求完成/失败/取消与种子预期一致；结束时 SourceEngine/FetchScheduler 与 Fixture 的队列和在途数都归零；不修改生产默认策略、不接入外部 HTTP 服务、不写入现有简报任务。

回退：删除新增性能脚本、Fixture、专项测试和 package script，不影响 SourceEngine、FetchScheduler、缓存或公共 API。

## 2026-11-23 单轮实验记录

**执行环境**：隔离 Linux x64、AMD EPYC 8 逻辑核、约 16 GiB 内存，Node 22.23.4、pnpm 12.21.0。五个场景，每个 SourceEngine 并发档独立运行 1,000 个逻辑采集请求；30 个并发客户端、种子 20261123。报告来自候选代码的本地提交 e505afe（签名/提交 SHA 与最终 GitHub PR 不同）。每档仅运行一轮，没有置信区间，不用于生产参数调整。

### 端到端组件 P95（毫秒）

| 场景 | 并发 4 | 并发 6 | 并发 8 | 状态不匹配 |
| --- | ---: | ---: | ---: | ---: |
| fixed-spread | 159.45 | 99.21 | 82.24 | 0 |
| jitter-spread | 303.43 | 209.70 | 177.22 | 0 |
| single-origin | 277.94 | 273.97 | 270.25 | 0 |
| http-errors | 166.67 | 111.62 | 86.61 | 0 |
| client-cancel | 533.34 | 339.42 | 273.83 | 0 |

- **多 Origin**：增加 SourceEngine 并发缩短源队列 P95，但实际收益来自独立源站可以并行执行。固定延迟场景 source.queue P95 为 138.98 / 80.20 / 60.96ms；HTTP 请求 P95 约 20–21ms。
- **单 Origin**：受 FetchScheduler maxPerKey=2 约束，HTTP 最大并发均为 2；并发从 4→8 时 HTTP 队列 P95 从 18.67→54.55ms，端到端 P95 仅从 277.94→270.25ms。此场景不支持继续提高全局 SourceEngine 并发来优化单源瓶颈。
- **错误**：每档均有 901 成功、59 个 HTTP 429 和 40 个 HTTP 503，分类与预期一致。组件基准故意不重试这些响应，因此不可当作生产 ofetch 重试后的错误率。
- **取消**：每档均有 858 成功与 142 主动取消，状态与预期一致。实验结束后调度器无排队或在途请求。
- **缓存**：本组件实验没有缓存，指标为不适用；不能从本实验推断 API 缓存命中率或后台写入开销。

**与原基线的关系**：原 Node API 性能脚本仍保留且没有改动。曾在相同隔离环境尝试 60 样本烟测，但本地插件缓存预热有一次失败；另一次在 batch-10 冷采集场景中返回 8 个成功、2 个 pending，未达到脚本的严格状态预期。因此没有获得可用于对照的完整 API 新基线。这不能证明新代码影响了 API：N4-C 只增加独立脚本、测试、文档和 package script。需要在更稳定的隔离环境重跑现有 API 基线。

**工程判断**：暂不改变生产 SourceEngine=8 或 FetchScheduler 的限流/重试策略。先通过多轮相同构建的测试缩小噪声，再结合 API、缓存、真实上游的分层耗时确定优化点。
