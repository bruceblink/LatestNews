# LatestNews Development Plan

## 1. 当前定位

LatestNews 的下一阶段目标是同时承担两个角色：

- 新闻数据源：稳定采集、标准化、缓存并对外提供可消费的新闻数据。
- 新闻阅读门面：为 Web/PWA 用户提供轻量、可定制、可追踪阅读状态的信息流体验。

当前仓库仍以 React + Vite + Nitro 单仓形态推进。短期不急于拆分服务，先把数据契约、采集稳定性、缓存策略和前端访问边界打牢；当采集量、调度复杂度或外部 API 消费明显增长后，再演进为独立采集服务、分析服务和 BFF。

## 2. 本轮审查结论

### 已修复

1. 数据源抓取入口分散。
    - 单源 `/api/s` 与批量 `/api/s/entire` 原先各自调用 getter，批量抓取不会记录健康状态，也不能复用单源请求去重。
    - 已抽出 `server/utils/source-fetch.ts`，统一 30 条截断、健康成功/失败记录、同源并发请求去重。

2. 请求伪装信息偏弱。
    - 许多站点对默认请求头更敏感，只设置 `User-Agent` 容易触发不稳定返回。
    - 已为服务端抓取补充 `Accept` 与 `Accept-Language`，并显式保留可重试状态码与重试间隔。

3. 前端直接拼接源 API 路径。
    - 多个 hook 和页面直接写 `/s`、`/s/entire`、`/s/health`，使前端与 Nitro 路由强耦合。
    - 已新增 `shared/source-api.ts` 与 `src/services/source.service.ts`，集中 API 路径、请求参数、Query Key 和 Bearer header 构造。

### 仍需处理

1. 数据项缺少统一运行时校验。
    - 各 source getter 返回 `NewsItem[]`，但异常字段、空标题、空 URL、重复 URL 目前主要靠各源自觉。

2. 缓存响应缺少明确新鲜度语义。
    - `status: "cache"` 只能说明来自缓存，无法区分正常缓存、降级缓存、过期兜底和无权限强刷回退。

3. 健康状态只存在进程内存。
    - 重启后健康历史丢失，无法做跨部署趋势分析。

4. 前端仍直接依赖 `shared/data-sources` 和 `metadata`。
    - 这对同仓开发很方便，但会限制未来把 LatestNews 当作外部新闻数据 API 使用。

5. 抓取调度仍偏被动。
    - 当前主要由用户访问触发刷新，缺少后台定时预热、失败队列、分级重试与源级熔断管理。

## 3. 目标架构

```text
External sources
    -> Source adapters
    -> Normalize and validate
    -> Cache / persistence
    -> Source API
    -> Reading facade
    -> Web / PWA / MCP / future clients
```

### 模块边界

- `server/sources/*`：只做单源抓取和源站字段解析。
- `server/utils/source-fetch.ts`：统一抓取执行、去重、截断、健康记录和后续熔断策略。
- `shared/source-api.ts`：前后端共享的源 API 契约、请求参数和 Query Key。
- `src/services/*.service.ts`：前端唯一的 API 访问层，页面和 hooks 不再直接拼接接口路径。
- `shared/types.ts`：保留通用数据模型，后续引入 Zod schema 做运行时校验。

## 4. 分阶段规划

### Phase 0: 稳定性补强，当前优先级最高

- 为 `NewsItem` 增加标准化管道：过滤空标题/URL、补齐稳定 id、按 URL 去重、统一时间字段。
- 为 source getter 增加结果 schema 校验和错误分类：网络错误、解析错误、空数据、鉴权/限流、站点结构变化。
- 扩展 `SourceResponse.status`：`success`、`cache`、`degraded-cache`、`stale-cache`、`empty`。
- 为批量接口增加部分失败诊断信息，避免静默丢源。
- 将健康状态持久化到数据库，保留最近 N 次事件和最近 7/30 天成功率。
- 增加 source fixture 测试，优先覆盖高价值且易变的抓取源。

### Phase 1: 数据源 API 化

- 新增版本化 API：
    - `GET /api/v1/sources`
    - `GET /api/v1/sources/:id/items`
    - `POST /api/v1/sources/batch`
    - `GET /api/v1/health/sources`
- 返回统一 envelope：`data`、`meta`、`errors`，支持部分成功。
- 支持筛选参数：source、column、type、since、limit、cursor。
- 提供只读 JSON Feed/RSS 导出，方便把 LatestNews 作为外部聚合器数据源。
- 文档化 API 契约，并为核心响应增加契约测试。

### Phase 2: 阅读门面增强

- 建立统一 Feed 页面：合并关注源、热门源和实时源，支持按时间/热度/来源过滤。
- 增强阅读状态：已读、稍后读、收藏、隐藏、不感兴趣。
- 增加源详情页：源介绍、最近健康、最近更新、历史趋势和相关文章。
- 增强搜索：前端本地搜索先保留，后续接入服务端索引。
- PWA 离线能力从静态壳扩展到最近阅读列表和关注源快照。

### Phase 3: 调度与持久化

- 引入后台预热任务：按 source interval 和健康状态调度。
- 对失败源使用指数退避和熔断窗口，避免用户访问时集中打爆源站。
- 将新闻条目持久化，支持 cursor 分页、历史回看和去重合并。
- 增加管理/诊断视图：失败原因排行、空数据源、慢源、最近结构变化源。

### Phase 4: 分析与平台化

- 增加热点分数：来源权重、发布时间、重复报道数、点击/阅读行为。
- 增加话题聚类：相似标题合并、同事件多源追踪。
- 增加 API Token、简单限流和调用审计，支持外部客户端消费。
- 根据负载决定是否拆分为采集服务、分析服务、BFF 和阅读前端。

## 5. 近期可执行 Backlog

1. `NewsItem` 标准化与校验。
    - 文件范围：`shared/types.ts`、新增 `shared/news-item-schema.ts`、`server/utils/source-fetch.ts`。
    - 验证：新增单元测试，运行 `pnpm exec vitest -c vitest.config.ts server/utils/source-fetch.test.ts`。

2. 缓存状态语义扩展。
    - 文件范围：`shared/types.ts`、`server/api/s/index.ts`、`server/utils/resolve-entire-sources.ts`、卡片状态 UI。
    - 验证：相关 Vitest + `pnpm typecheck`。

3. 批量接口错误透明化。
    - 文件范围：`server/api/s/entire.post.ts`、`server/utils/resolve-entire-sources.ts`、前端 `useEntireQuery`。
    - 验证：`test/resolve-entire-sources.test.ts`。

4. 前端数据源元信息解耦。
    - 文件范围：新增 source metadata service，逐步替换页面中直接读取 `dataSources` 的位置。
    - 验证：`pnpm typecheck` + 相关页面冒烟。

5. API v1 契约草案。
    - 文件范围：`shared/source-api.ts`、新增 API 文档和契约测试。
    - 验证：`pnpm exec vitest -c vitest.config.ts test/source-api.test.ts`。

## 6. 验收门槛

- 每个小功能单独提交，提交前运行与风险匹配的测试。
- 涉及共享类型或 API 契约时，至少运行 `pnpm typecheck` 和对应 Vitest。
- 涉及页面交互时，除单元测试外需要本地 dev server 冒烟 `/`、`/health` 和相关 API。
- 阶段性合并前运行 `pnpm check`；涉及构建或部署配置时运行 `pnpm build`。

## 7. 当前验证记录

- `pnpm exec vitest -c vitest.config.ts server/utils/source-fetch.test.ts test/resolve-entire-sources.test.ts server/utils/source-health.test.ts` passed.
- `pnpm exec vitest -c vitest.config.ts test/source-api.test.ts` passed.
- `pnpm typecheck` passed.
