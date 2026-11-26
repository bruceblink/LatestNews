# N3-G2 请求级观测与健康持久化

日期：2026-11-26。基线：N4-P1 合并提交 c9b93db。范围：A13 与 Pages 请求 I/O 生命周期；不修改生产 D1。

## 实现与边界

- Pages 请求在采集开始时捕获 D1 binding、ENABLE_CACHE 与 INIT_TABLE。请求级 WeakMap 复用同一请求的初始化 promise，不跨请求复用 D1 connector 或 promise。删除旧 middleware 对 globalThis.__env__/__cf_env__ 的写入。
- Node 保留进程级采集执行器、网络调度器及健康数据库实例。采集成功或非取消失败只记录一次；同一执行器内的 singleflight join 不重复记账。若拥有者取消但其他 caller 仍有效，原拥有者保留该采集的健康写；所有 caller 取消则不记成功/失败。
- 采集启动时通过 waitUntil 注册涵盖采集及其健康持久化的 promise。写入或初始化失败记录 G1 安全诊断，不阻塞主采集。历史事件仍为每来源最近 20 条，读写错误文本继续安全投影；无历史重写和 schema 迁移。
- 首轮真实 workerd 并发测试复现第二个请求 500：跨请求读取 RefcountedCanceler（AbortController）。因此 Pages 采集执行器和网络队列按请求隔离，不跨请求共享 I/O、abort handle 或 promise。不同请求各自真实执行的采集各记录一次。Node singleflight 不变。
- Pages 保持请求内 8 个来源任务默认上限及网络队列限制；共享的网络 admission gate 仅持有同步计数/租约，无跨请求 promise/timer，默认总量 8、每 origin 2。跨请求饱和返回 QUEUE_FULL，交由现有失败/缓存降级路径处理；不再跨请求排队。任务正常结束释放租约；异常请求终止未释放时，30 秒租约在后续 admission 中回收。该期限不是跨实例全局硬限流保证。
- 来源健康 JSON、诊断文本、部署/节点摘要、联邦本地摘要和 Web/Electron UI 增加可选 sampleScope=instance，表示当前运行实例统计，重启可归零。持久化近期事件不是累计统计，也不是完整七天质量数据。旧客户端/旧服务不含此字段仍可使用。

## 验收

- 112 个 Vitest 文件，623 项（包括 4 项请求绑定/取消/故障测试、2 项 admission 测试、1 项 scope 兼容测试）；另有 A09 等既有回归。
- lint、Node/Web/Electron typecheck、Node 与 Pages 生产构建通过。
- 使用实际 Pages worker 产物、隔离 Miniflare/workerd + 独立 D1、兼容日期 2026-08-06、受控 HN fixture，无真实上游请求：同源并发各自成功且每次实际采集一条事件；失败安全投影与缓存回退；冷启动/重启保留 D1 行而实例计数归零；stale-cache 已返回后 waitUntil 保留健康写；插入触发器故障不影响采集且下一请求恢复写入；第三个同 origin 并发请求使用缓存并安全记录 QUEUE_FULL。6 个检查点通过。
- 原有 FTS 审核 4、恢复 2、事件注册 17 个隔离 D1 smoke 检查点通过。同 origin 饱和行为由实际 Pages worker 与 admission 单测共同验证；未把本地数据外推到生产。

重现：先 LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build:pages，再设置 LATESTNEWS_MINIFLARE_DIR 指向独立安装 Miniflare 的目录，运行 pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/source-health-d1-smoke.mjs。

目标 D1、跨实例流量和真实上游负载仍属于 N3-F/N4-P4，另行验收。下一切片 N4-P2。
