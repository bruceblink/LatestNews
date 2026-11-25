# N3-F — 来源与真实宿主本地专项验收

基线 058afa8；2026-11-25；隔离 Linux x64，Node 22.23.4，pnpm 12.21.0，Electron 44.9.0。所有测试数据为固定 fixture，未向生产服务提交刷新、审核或迁移请求。

## 复现

```sh
pnpm exec vitest run server/configured-source-api.integration.test.ts server/configured-source-runtime.node.test.ts server/source-refresh.integration.test.ts test/source-adapter-regressions.test.ts test/crawler-plugin-platform.test.ts test/crawler-process-host.test.ts test/electron-crawler-provider.test.ts test/source-quality-commands.test.ts test/source-quality-window.test.ts test/source-quality-sampling.test.ts test/source-quality-policy.test.ts test/source-quality-records.test.ts
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build
pnpm test:crawler:node-api
xvfb-run --auto-servernum pnpm test:crawler:electron
pnpm exec playwright test --config=playwright.config.ts e2e/configured-source-flow.e2e.spec.ts --workers=1
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build:pages
LATESTNEWS_MINIFLARE_DIR=/path/to/isolated/miniflare LATESTNEWS_D1_TEST_COMPAT_DATE=2026-08-06 pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/event-registry-d1-smoke.mjs
```

## 结果

| 边界 | 实测结果 |
| --- | --- |
| 来源与刷新集成、RSS/JSON/HTML 固定数据、宿主回归和质量统计工具 | 12 个测试文件，84/84 通过 |
| 新增真实 Node 构建产物 smoke | 8 项检查通过：目录、冷采集、文章索引、批量缓存、CORS、未知来源拒绝、重启缓存、重启身份一致性 |
| 真实 Electron utility process / Node 子进程 | RSS 与 JSON 包哈希相同、输出相同；Node 306 ms / Electron 302 ms（单次，不作为性能基线） |
| Web 来源目录与阅读流 | 5/5 通过 |
| 本地 Pages worker + Miniflare D1 | 16 个 PASS 检查点，覆盖迁移、并发、故障恢复、重启、索引和事件 API |
| Node/Pages 构建、类型检查 | 通过 |

新增 test:crawler:node-api 使用独立临时工作目录、仅回环监听、无外网权限的固定插件、SQLite 及两次真实 Nitro 进程启动。退出后清理临时数据；不是 Docker 镜像测试。配置型 HTTPS 来源的请求与 DNS 通过 fixture 注入，不代表真实 TLS/公网可达性。

RSS 插件 SHA-256：b7e584c27fe39627da7ca5c7ae086664f603916750eafe22d46c2d8445f6092d。
JSON 插件 SHA-256：85b030959f38824f0ef6c45a4f951c14cf2dd9f7fb090c0e1da477972985aa39。

## 未验收

- 本环境无 Docker，容器镜像与真实部署 smoke 未执行。
- Miniflare 本地兼容日期 2026-08-06；生产配置 2026-11-23。分布式 D1 并发、真实绑定与版本、迁移备份、刷新及断线行为需在已确认的目标环境独立验证。
- 七天公网质量观察未启动；不将 fixture 结果视为来源可用率或公网数据质量。须确认指定部署和观察授权，按既有采样间隔、窗口和质量阈值执行。
- N4-N 的全 API 性能门槛仍未通过；本专项只验证单来源功能链路。
