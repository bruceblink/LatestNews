# N4-N：完整 API 正式样本对照

## 2026-11-25 第一轮

父提交 bb8c189；同一候选构建（Node server entry SHA-256 7d69c441240bc2d1fad64e392df7934bc4bf5731c1f83bb04a1ac1fed17a2a69）；Linux x64、AMD EPYC 8 逻辑核、Node 22.23.4、pnpm 12.21.0、16 GiB。原始报告为提交前 dirty tree，随本 PR 提交实际测量代码。隔离 SQLite、30 来源无网络权限插件，每来源 30 篇；各档新进程、独立数据库、5 次场景预热、30 并发客户端、每场景 1,000 个测量请求（34 波）。三档顺序 4/6/8，8 场景共 24,000 请求，全部 API/状态/追踪校验通过。尚非计划规定的三轮完整验收。

### 30 来源响应及后台指标

| 指标 | 4 | 6 | 8 |
| --- | ---: | ---: | ---: |
| 全命中 P95 ms | 69.409 | 68.070 | 69.210 |
| 冷缓存 P95 ms | 2998.992 | 3014.456 | 3068.616 |
| 部分命中 P95 ms | 590.197 | 610.197 | 590.595 |
| 过期缓存 P95 ms | 64.771 | 64.499 | 65.574 |
| 冷缓存完整吞吐 req/s | 9.81 | 9.96 | 9.83 |
| 部分命中完整吞吐 req/s | 19.05 | 18.74 | 19.00 |
| 部分命中后台等待 P95 ms/波 | 1259.309 | 1281.242 | 1006.983 |

### 冷缓存阶段 P95（ms）

| 阶段 | 4 | 6 | 8 |
| --- | ---: | ---: | ---: |
| source.queue | 2397.631 | 2175.652 | 2013.669 |
| source.collect | 408.455 | 600.556 | 813.985 |
| source.normalize | 0.154 | 0.218 | 0.223 |
| cache.read | 0.537 | 0.497 | 0.560 |
| cache.commit | 4.949 | 4.813 | 5.025 |
| index.queue | 0.008 | 0.007 | 0.008 |
| index.replay | 94.473 | 95.907 | 96.733 |

每波冷缓存共 30 个独立采集；30 个 API 客户端共享 Singleflight，因此 1,000 个 API 请求对应 1,020 次实际采集，而不是 30,000 次。各阶段样本单位不同，存在嵌套/重叠，不可相加。index.repair 包含在 index.replay 中。source.collect 含短生命周期插件子进程启动、IPC、执行与宿主处理；不是纯上游 RTT。无外网权限 fixture 没有 http.request/http.queue 样本，不应将缺失视为 0 ms。回环 HTTP 调度另见 http-collection-baseline.md。cache.commit 包括 cache/journal 持久化，index.replay 可能包括多条补写；返回成功的追踪不代替数据库一致性检查。后台等待为 HTTP 波次结束后至 cache/checkpoint 一致、journal/FTS 队列清空的时间。进程 RSS 只测 Node 服务主进程，不含所有插件子进程峰值。

**初步判断**：提高来源并发降低排队 P95，同时插件执行 P95 上升；端到端冷缓存 P95 仍约 3 秒。短生命周期进程资源竞争是待验证解释，不是已测量的 CPU 根因。不得用本轮结果修改默认并发、取消进程隔离或承诺生产 SLO。与 11 月 22 日不同构建/环境的基准不直接计算改善百分比。

## 追踪与复现

新增 formatVersion 3，Node 基准预加载器通过进程内 symbol 和 IPC 控制采样，生产未安装 sink 时不输出数据，不开放新 API 或文件路径。只保存阶段名、时长、结果聚合；不保存请求 URL、正文、认证信息。每场景预热后 reset，完成后台 drain 后 snapshot；100,000 span 上限，缺失/截断、采集数不符、缓存读取/提交与补写计数不符均导致验收失败。实际 HTTP 响应时延含完整响应体读取，客户端 JSON 解析单独记录。现有 API 校验与缓存准备条件不放宽。

```sh
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build
for n in 4 6 8; do
  pnpm exec tsx scripts/performance/api-baseline.ts --samples 1000 --concurrency 30 --source-concurrency "$n"
done
```

另两轮建议顺序 6/8/4、8/4/6；同构建、同机器，不并行执行不同档位，保留独立报告，不覆盖历史。至少 72,000 API 请求完成后才关闭正式多轮样本门槛。真实上游 HTTP 阶段与长测、独立标注及生产 D1 单列。

第一轮原始响应时延样本及完整阶段聚合：[n4n-api-formal-round1-2026-11-25.json](n4n-api-formal-round1-2026-11-25.json)。保留原始报告 SHA-256；发布记录移除临时 loopback URL，其他字段一致，已重新计算 P50/P95/P99 验证。源文件不含生产数据。

## 回归

106 文件、577/577 Vitest（新增 3 个 trace 测试）；lint、Node/Web/Electron typecheck、Node/Pages build；实际 Pages 构建的本地 Miniflare D1 17 检查点通过。无 schema、生产配置、版本或 Release 修改。远端 CI 未完成的检查不计为通过。

## 独立回环 HTTP 千样本对照（第一轮）

在完整 API 测试全部结束后，使用相同隔离主机运行既有 SourceEngine + FetchScheduler 实际回环 HTTP harness。固定 seed 20261123、四个回环 Origin、30 并发客户端；五类场景、三档来源并发度各 1,000 请求，共 15,000 请求。此测试不经过 Nitro API、不写 SQLite，也不是公网源站采集。

| 场景 P95 ms | 并发 4 | 并发 6 | 并发 8 |
| --- | ---: | ---: | ---: |
| fixed-spread | 153.58 | 98.22 | 80.99 |
| jitter-spread | 299.01 | 207.44 | 175.30 |
| single-origin | 263.02 | 261.29 | 262.79 |
| http-errors | 162.24 | 109.46 | 85.84 |
| client-cancel | 528.06 | 335.24 | 271.20 |

15 个场景全部符合预期状态：14,277 成功、297 个预期注入 HTTP 错误、426 个预期取消；状态错配为 0，每场景结束后调度器待处理数为 0。分散来源受益于来源并发上升，单 Origin 受每 Origin 最大并发 2 限制，三档相近。这个组件级观察不能推断完整 API P95 必然下降，且不是生产可用率或重试测试。

复现：

```sh
pnpm performance:http-collection --samples 1000 --clients 30 --source-concurrency 4,6,8 --seed 20261123 --output .data/performance/n4n-http-formal-r1.json
```

原始聚合报告：[n4n-http-formal-round1-2026-11-25.json](n4n-http-formal-round1-2026-11-25.json)。测量报告 commit 指向 bb8c189（第一轮 API 候选代码提交之前的主线）；运行时测试脚本未改动。当前仅完成一轮千样本组件对照；不得将 15,000 个组件请求计入正式 API 的 72,000 请求门槛。完整 API 和真实回环 HTTP 专项仍各需重复验证，公网及生产 D1、原生长测和独立标注保持未验收。
