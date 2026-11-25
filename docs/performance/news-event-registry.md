# N4-G 事件注册表验收

## 功能与数据边界

N4-G 在 N4-F 的文章关联基础上新增 `news_events(event_id, registered_at)`。初始化将旧 `articles.event_id` 去重回填；插入或更新文章事件 ID 时，SQLite 触发器在同一语句中登记该 ID。重复初始化和关联不改注册时间。不为没有文章关联的临时候选登记记录。已有冲突不自动合并。注册时间不是新闻发布时间。

接口 `GET /api/v1/events/{eventId}` 从文章索引读取历史成员及来源映射，默认每页 30 条，最大 100 条。将返回的 `meta.nextCursor` 作为同一事件下一页的 `after`。排序键为文章主键，跨页不提供固定快照。文章索引或注册表不可用时返回 503，未注册 ID 返回 404。Node/Pages 支持；Electron 本地 JSON 缓存不提供该接口。

旧部署需先备份数据库并用 `INIT_TABLE=true` 完成一次 schema 初始化。回退代码不会删除数据库数据；若需要清理新表，应先移除依赖触发器，另行批准迁移和备份。

## 可复现实验

使用独立 Linux 工作树，Node 22.23.4，pnpm 12.21.0，better-sqlite3 13.0.3（SQLite 3.53.4）。

```bash
pnpm lint:check
pnpm typecheck
pnpm typecheck:electron
pnpm test --run
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build:pages
```

D1 专项脚本使用独立目录安装 Miniflare，避免改变应用依赖和锁文件。脚本读取实际 Pages 构建产物，以临时本地 D1 数据库和固定测试数据运行，禁止真实上游采集，完成后删除临时数据库。

```bash
D1_TEST_DIR="$(mktemp -d)"
npm install --prefix "$D1_TEST_DIR" --no-audit --no-fund --save-exact miniflare@4.20260730.0
LATESTNEWS_MINIFLARE_DIR="$D1_TEST_DIR" \
LATESTNEWS_D1_TEST_COMPAT_DATE=2026-08-06 \
pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/event-registry-d1-smoke.mjs
rm -rf "$D1_TEST_DIR"
```

已安装的 workerd 支持的最新兼容日期为 2026-08-06。该实验使用此日期及 nodejs_compat；跨请求 Promise 解析行为在该版本中已默认启用。生产配置仍为 2026-11-23，不做降级。若本地 runtime 支持仓库配置日期，可省略测试日期覆盖。测试不代表目标 Cloudflare D1 的多节点并发或生产负载。

## 实测记录（2026-11-25）

| 验收项 | 结果 |
| --- | --- |
| 全量 Vitest | 94 文件、501 项通过；比 N4-F 新增 6 项 |
| ESLint、Node/Web/Electron 类型检查 | 通过 |
| Node、Pages 生产构建 | 通过，跳过在线图标抓取 |
| 实际 Node HTTP 产物 | 临时 SQLite，验证事件 ID 复用、历史分页、缓存删除、节点清单、OpenAPI 和未知 ID 404 |
| 本地 D1 旧 schema 迁移 | 通过，旧 ID 保留 |
| 实际 Pages 洞察、文章搜索、历史 API | 通过，历史回填及部分、隐藏报道一致 |
| D1 大事件 | 150 篇关联，分页 100/50，无重复 |
| D1 并发关联 | 10 组重叠请求，只有获胜 ID 被注册 |
| D1 冲突保护与参数校验 | 保留原关联，验证 400/404 |
| D1 持久化 | 删除来源缓存后重启 workerd，历史和注册时间仍可读 |
| D1 注册表不可用 | 历史 API 503，文章搜索仍可用 |

本次未执行生产 D1 写入、真实 Web/Electron 窗口验收或大规模性能基准。无共同索引文章的跨窗口匹配、事件别名、显式合并以及候选哈希冲突仍需后续独立切片。
