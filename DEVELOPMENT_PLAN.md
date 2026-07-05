# LatestNews Development Plan

## 1. 项目定位

LatestNews 是一个轻量的新闻数据采集、聚合和阅读入口。它面向个人部署、团队内网部署以及低成本边缘环境，负责把公开来源的标题、链接、发布时间和来源状态等新闻元数据稳定地汇总起来，并提供一个简洁、可安装的阅读界面。

项目重点是：

- 稳定采集公开来源的新闻元数据。
- 提供可阅读、可自定义、可安装为 PWA 的前端门面。
- 提供基础 API、健康状态和导出能力，便于自动化工具或其他应用接入。
- 保持代码结构清晰，让数据源、抓取、缓存、接口和页面可以独立演进。

## 2. 产品边界

LatestNews 关注“公开新闻入口”和“轻量数据节点”两个核心场景：

- 数据源 adapter：维护不同站点的字段解析和源站差异。
- 抓取与缓存：统一处理请求去重、失败降级、缓存命中和过期策略。
- 数据标准化：输出稳定的新闻元数据类型，过滤无效项并补齐必要字段。
- 健康监控：记录来源可用性、最近错误、缓存状态和诊断摘要。
- 阅读体验：提供阅读页面、历史记录、关注源、搜索筛选和 PWA 支持。
- 开发者接入：提供基础 API、JSON Feed/RSS 导出、部署文档和排障工具。

以上范围覆盖从数据采集、标准化、缓存、健康诊断到阅读展示的完整闭环。后续扩展继续遵循轻量、可部署、可维护的方向，优先补强真实使用中最常见的新闻阅读和数据订阅场景。

## 3. 目标架构

```text
External public sources
    -> Source adapters
    -> Fetch / normalize / cache
    -> Source health
    -> Metadata API / Feed export
    -> Reader Web / PWA
```

当前 React + Vite + Nitro 单仓形态适合继续保留。短期不做微服务拆分，优先把内部模块边界梳理清楚，确保后续可以按 API、JSON Feed、RSS 或独立部署节点的方式接入其他系统。

### 模块边界

- `server/sources/*`：单源抓取和源站字段解析。
- `server/utils/source-fetch.ts`：统一抓取执行、请求去重、截断、健康记录和失败处理。
- `server/api/s/*`：面向前端和外部调用方的基础数据源 API。
- `server/utils/source-health.ts`：数据源健康状态和诊断摘要。
- `shared/source-api.ts`：前后端共享的源 API 契约、请求参数和 Query Key。
- `src/services/*.service.ts`：前端 API 访问层，页面和 hooks 不直接拼接接口路径。
- `src/routes/*`：阅读、历史、健康等用户界面。

## 4. 能力规划

### Phase 0: 稳定性补强

- 为 `NewsItem` 增加标准化管道：过滤空标题/URL、补齐稳定 id、按 URL 去重、统一时间字段。
- 为 source getter 增加结果校验和错误分类：网络错误、解析错误、空数据、限流、站点结构变化。
- 扩展 `SourceResponse.status`：`success`、`cache`、`degraded-cache`、`stale-cache`、`empty`。
- 为批量接口增加部分失败诊断信息，避免静默丢源。
- 增加 source fixture 测试，优先覆盖高价值且易变的数据源。

### Phase 1: 数据节点能力

- 新增只读版本化 API：
  - `GET /api/v1/sources`
  - `GET /api/v1/sources/:id/items`
  - `POST /api/v1/sources/batch`
  - `GET /api/v1/health/sources`
- 返回统一 envelope：`data`、`meta`、`errors`，支持部分成功。
- 支持筛选参数：source、column、type、since、limit。
- 提供 JSON Feed/RSS 导出，方便自动化工具和阅读器订阅。
- 为核心响应增加契约测试。

### Phase 2: 阅读门面增强

- 建立统一 Feed 页面：合并关注源、热门源和实时源，支持按时间、来源和分类过滤。
- 增强阅读状态：已读、稍后读、收藏、隐藏。
- 增加源详情页：源介绍、最近健康、最近更新、最近错误。
- 优化移动端阅读、横向卡片和 PWA 安装体验。
- PWA 离线能力从静态壳扩展到最近阅读列表和关注源快照。

### Phase 3: 运维与可观测性

- 将健康事件持久化，保留最近 N 次抓取结果。
- 增加数据源诊断导出，方便提交 issue 和排障。
- 支持手动探测、清缓存、刷新指定数据源。
- 增加部署健康检查，区分应用可用、缓存可用、数据源可用。

### Phase 4: 外部接入准备

- 明确 API 与外部系统之间的契约。
- 支持配置上游/下游 endpoint，让实例可以作为轻量采集节点。
- 提供节点标识、版本、数据源清单和健康摘要。
- 保持数据模型中立，避免把页面展示逻辑耦合进服务端响应。

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

4. 数据源元信息服务化。
    - 文件范围：新增 source metadata service，逐步替换页面中直接读取 `dataSources` 的位置。
    - 验证：`pnpm typecheck` + 相关页面冒烟。

5. API v1 契约草案。
    - 文件范围：`shared/source-api.ts`、新增 API 文档和契约测试。
    - 验证：`pnpm exec vitest -c vitest.config.ts test/source-api.test.ts`。

6. 文档与配置清理。
    - 检查文档、示例配置和贡献说明，确保部署路径、环境变量、API 用法和排障流程清晰。
    - 验证：`rg` 搜索敏感关键词，提交前确认密钥、用户信息或环境专用配置不会进入提交内容。

## 6. 验收门槛

- 每个小功能单独提交，提交前运行与风险匹配的测试。
- 涉及共享类型或 API 契约时，至少运行 `pnpm typecheck` 和对应 Vitest。
- 涉及页面交互时，除单元测试外需要本地 dev server 冒烟 `/`、`/health` 和相关 API。
- 阶段性合并前运行 `pnpm check`；涉及构建或部署配置时运行 `pnpm build`。
- 发布前检查文档、示例配置和提交内容，避免暴露密钥、用户信息或环境专用配置。

## 7. 当前验证记录

- `pnpm exec vitest -c vitest.config.ts server/utils/source-fetch.test.ts test/resolve-entire-sources.test.ts server/utils/source-health.test.ts` passed.
- `pnpm exec vitest -c vitest.config.ts test/source-api.test.ts` passed.
- `pnpm typecheck` passed.
