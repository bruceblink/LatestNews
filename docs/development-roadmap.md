# LatestNews 后续开发路线

本文件是 `DEVELOPMENT_PLAN.md` 的执行版，记录当前基线、已完成能力、下一阶段的可交付切片和每个切片的验收门槛。每个切片保持单一功能范围，完成验证后单独提交。

## 当前基线

截至 2026-08-09，以下能力已经落地：

- NewsItem 标准化、缓存状态扩展和批量接口错误透明化。
- v1 源元信息、源条目、批量查询、健康、诊断、节点清单、OpenAPI 和 JSON Feed/RSS。
- 统一 Feed、热点排行、话题聚合、词云、分类占比、来源活跃度和洞察到 Feed 的筛选联动。
- 来源健康事件持久化、手动探测、缓存刷新、部署健康检查和 `/insights` 健康概览。
- 本地阅读历史、稍后读、收藏、隐藏，以及 GitHub 布局同步和 SyncHub 阅读数据同步。
- Feed 离线快照、PWA 更新反馈和网络恢复反馈。

当前主线提交为 `131fff9`，后续开发从洞察趋势模型开始，不重复建设已经完成的 Phase 0/1 能力。

## 交付顺序

### R1-A 洞察趋势数据模型

状态：已完成（2026-08-09）。

目标：补齐 Phase 2 中“更新频率”和“关键词趋势”的服务端纯函数能力。

文件范围：

- `shared/news-insights.ts`
- `shared/source-api.ts`
- `server/api/s/insights.post.ts`
- `server/utils/resolve-news-insights.ts`
- `test/news-insights.test.ts`
- `test/resolve-news-insights.test.ts`

建议契约：

```ts
interface InsightTimeBucket {
    startAt: number;
    endAt: number;
    itemCount: number;
    sourceCount: number;
}

interface KeywordTrend {
    term: string;
    totalCount: number;
    sourceCount: number;
    latestPublishedAt?: number;
    buckets: InsightTimeBucket[];
}
```

实现规则：

- 支持 `24h` 和 `7d` 两种趋势窗口，默认 `24h`。
- 时间桶边界使用固定 UTC 规则，避免服务端和浏览器时区造成不同结果。
- 没有可解析发布时间的条目继续参与热点和分类统计，但不进入趋势桶。
- 同一个关键词在同一来源同一桶中只计一次来源覆盖数。
- 结果按总计数、来源数、最近更新时间和词面稳定排序。
- API 对 `trendWindow`、`trendLimit` 做 zod 校验，并纳入洞察 Query Key。

验收：

- 覆盖空数据、单来源、多来源、缺失时间、跨桶边界和重复关键词。
- `pnpm exec vitest -c vitest.config.ts test/news-insights.test.ts test/resolve-news-insights.test.ts`
- `pnpm typecheck`

提交：`feat: add insight trend metrics`

### R1-B 洞察趋势页面

状态：已完成（2026-08-09）。

目标：在 `/insights` 展示更新频率和关键词趋势，并保留到 `/feed` 的筛选入口。

文件范围：

- `src/routes/insights.tsx`
- 必要时新增 `src/components/insights/*`
- `test` 中的纯函数或路由参数测试

交互规则：

- 更新频率面板展示时间桶、条目数和来源数。
- 关键词趋势默认展示前 10 项，点击关键词进入 `/feed?q=...`。
- 加载、空数据、部分来源失败和健康 API 失败都显示独立状态。
- 移动端保持时间桶横向可滚动，不遮挡热点和话题面板。

验收：

- `pnpm typecheck`
- `pnpm exec vitest -c vitest.config.ts test/news-insights.test.ts`
- 本地冒烟 `/insights`、`/feed`、`/api/s/insights` 和 `/api/v1/health/sources`

提交：`feat: show insight trends`

### R1-C 热点排序解释增强

目标：让热点排行完整体现来源权重、分类权重、覆盖度、时效性和已读影响。

文件范围：

- `shared/news-insights.ts`
- `shared/source-ranking-policy.ts`
- `test/news-insights.test.ts`
- `test/source-ranking-policy.test.ts`
- `src/routes/insights.tsx`

规则：

- 来源权重从稳定的源元信息推导，不读取页面状态。
- 分类分布进入热点信号，但不改变抓取层返回结构。
- 每个热点展示命中来源数、更新时间、分类分布和排序原因。
- 排序策略必须是纯函数，并对相同输入保持确定性。

提交：`feat: explain insight ranking signals`

### R2-A SyncHub 双端数据合并

目标：避免远端初始化或后台上传覆盖本地尚未同步的数据。

文件范围：

- 新增或扩展 `shared/synchub-merge.ts`
- `src/hooks/useSyncHub.ts`
- `src/services/synchub.service.ts`
- `test/synchub-service.test.ts`

冲突规则：

- 阅读历史按规范化 URL 去重，保留最新阅读时间。
- 收藏按 URL 合并，保留本地和远端并集。
- 偏好按 `updatedTime` 选择较新版本；时间相同时本地优先。
- 合并函数不访问浏览器 API，便于纯函数测试。

提交：`fix: merge local and remote sync state`

### R2-B SyncHub 后台状态

目标：让后台上传失败可见、可重试，不再静默丢失。

文件范围：

- `src/atoms/syncStatusAtom.ts`
- `src/hooks/useSyncHub.ts`
- `src/components/header/menu.tsx`
- `shared/metadata-sync-view.ts` 或新增 SyncHub 状态视图策略
- 对应测试

状态至少包括：`idle`、`pending`、`syncing`、`success`、`error`。错误状态只展示用户可理解的信息，不展示 API Key 或响应原文中的敏感字段。

提交：`feat: surface synchub background status`

### R3 PWA 离线阅读扩展

目标：将离线能力从 Feed 快照扩展到最近阅读、收藏和关注源。

文件范围：

- `shared/offline-reading-state.ts`
- `src/services/offline-reading-state.service.ts`
- `src/hooks/usePWA.ts`
- `src/routes/history.tsx`
- 相关测试和 PWA 构建配置

验收：

- 快照带版本号、最大年龄和数量上限。
- 离线时历史和收藏可读，过期快照被明确标记而不是伪装成在线数据。
- `pnpm build`、快照单测和本地离线提示检查通过。

提交：`feat: extend offline reading snapshots`

### R4 外部节点接入

目标：在内部模型稳定后，才实现上游/下游节点的实际连接能力。

先完成协议设计，再实现代码：

- endpoint 超时、重试、熔断和错误分类。
- 只允许明确协议和配置来源，防止 SSRF。
- 节点身份、版本、源清单和健康摘要保持数据模型中立。
- 保持 `/api/v1/node` 只读，连接能力使用独立接口和明确鉴权。

提交边界：先 `docs: define node federation contract`，再分别提交连接和鉴权功能。

## 每个切片的交付门槛

1. 先补共享契约或纯函数测试，再接服务端和页面。
2. 一个可验收小功能对应一个 Conventional Commit。
3. 共享类型或 API 变更必须运行 `pnpm typecheck` 和对应 Vitest。
4. 页面交互必须启动本地服务，检查 `/`、`/feed`、`/insights`、`/health` 和相关 API。
5. 阶段合并前运行 `pnpm check`；涉及构建、PWA 或部署配置时追加 `pnpm build`。
6. 提交前使用 `git diff --check`，并检查密钥、用户数据和环境专用配置没有进入提交。

## 下一步

下一次开发执行 R1-C：补齐来源权重、分类权重和热点排序原因，保持排序策略可解释且可测试。
