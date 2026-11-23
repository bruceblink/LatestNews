# N4-E 文章索引首个切片

## 范围

本切片为 Node SQLite 增加文章级索引。现有按来源保存的 `cache` 表继续提供来源读取和快速回退。文章索引保存文章记录、来源映射、内容指纹和可选的 `eventId`。

采集成功后，缓存写入会尝试同步写入文章索引。洞察生成后会异步补充 `eventId`。索引写入失败只记录警告，来源缓存结果继续返回。文章索引初始化失败时，缓存服务仍可用。

## 身份与幂等

文章记录按以下顺序查找已有记录。

1. 来源 ID 与规范化 URL。
2. 来源 ID 与原始文章 ID。
3. 内容指纹。

匹配到已有记录时更新标题、发布时间、原始数据和最近更新时间。来源映射保留来源 ID 与原始文章 ID。重复采集不会创建重复文章。

## 全文能力

Node SQLite 使用 FTS5 保存标题检索数据，并提供重建入口。FTS5 创建失败时，文章记录仍然可以写入。查询会返回明确的 `unavailable` 状态。

当前切片只验证 Node better-sqlite3 的 FTS5。Cloudflare D1 文档列出 FTS5 为支持的 SQLite 扩展，但仓库没有目标 Pages D1 的真实数据库验收证据。Electron 使用 JSON 缓存，不接入这套 SQLite 索引。

Node 服务提供 `GET /api/v1/articles/search`。文章索引不可用时返回 HTTP 503，并保留来源读取路径。

## 验收

使用内存 SQLite 运行文章索引测试，覆盖重复 URL、原始 ID、内容指纹、标题更新、来源映射、事件关联、FTS 重建和查询结果。完整仓库检查继续使用 `pnpm lint:check`、`pnpm typecheck`、`pnpm test --run` 和 `pnpm build`。

Node 22.23.4、better-sqlite3 13.0.3、1,000 篇测试文章和 200 次查询的基准结果如下。

| 指标 | 结果 |
| --- | ---: |
| SQLite 文件大小 | 806,912 bytes |
| SQLite 页数 | 197 |
| 查询 P50 | 0.150 ms |
| 查询 P95 | 0.183 ms |
| 查询 P99 | 0.253 ms |

复现命令为 `pnpm performance:article-index`。该结果只代表本地 Node SQLite 数据集。中文分词质量和目标 Pages D1 的实际查询 P95 仍需要独立测量。
