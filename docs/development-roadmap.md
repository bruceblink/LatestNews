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

状态：已完成（2026-08-09）。

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

实现结果：

- 默认来源权重只读取 `sources.json` 中的来源类型，分类权重由共享策略统一维护。
- 热点信号返回分类分布、来源/分类权重和确定性的排序原因。
- 页面在每个热点下展示排序原因及分类条目/来源数，API 抓取响应保持不变。
- 纯函数、洞察模型和解析链路测试覆盖权重覆盖、分类排序及解释文本。

提交：`feat: explain insight ranking signals`

### R2-A SyncHub 双端数据合并

状态：已完成（R2-A1、R2-A2，2026-08-09）。

目标：避免远端初始化或后台上传覆盖本地尚未同步的数据。

文件范围：

- 新增或扩展 `shared/synchub-merge.ts`
- `src/hooks/useSyncHub.ts`
- `src/services/synchub.service.ts`
- `test/synchub-merge.test.ts`
- `test/synchub-service.test.ts`

冲突规则：

- 阅读历史按规范化 URL 去重，保留最新阅读时间。
- 收藏按规范化 URL 合并，保留本地和远端并集；同 URL 保留 `updatedAt` 较新的记录。
- 布局元数据按 `PrimitiveMetadata.updatedTime` 选择较新版本；时间相同时本地优先。
- 主题偏好新增向后兼容的 `updatedAt`；旧远端数据缺少时间时不覆盖本地已设置值。
- 合并函数不访问浏览器 API，便于纯函数测试。

执行顺序：

1. `R2-A1` 已完成：新增纯函数合并契约，覆盖空远端、空本地、重复 URL、时间冲突、旧版偏好和数量上限。
2. `R2-A2` 已接入 `useSyncHub`：下载前保留本地快照，合并后更新 atom，并让每个成功集合只进入一次防抖上传以收敛双端。
3. 任一集合下载失败时保留本地数据；成功的集合仍可合并，失败集合不会被空值覆盖。
4. 初始化未完成前不触发防抖上传；初始化完成后才允许合并结果进入上传队列，避免把旧内存状态写回远端。

验收：

- `pnpm exec vitest -c vitest.config.ts test/synchub-merge.test.ts test/synchub-service.test.ts`
- `pnpm typecheck`
- 使用空远端、旧远端和网络失败三种桩验证本地数据不会丢失。

提交：`feat: add synchub merge policy`、`fix: merge local and remote sync state`

### R2-B SyncHub 后台状态

状态：下一阶段，依赖已完成的 R2-A。

目标：让后台上传失败可见、可重试，不再静默丢失。

文件范围：

- 新增 `src/atoms/syncHubStatusAtom.ts`，不复用现有登录元数据同步状态
- `src/hooks/useSyncHub.ts`
- `src/components/header/menu.tsx`
- 新增 `shared/synchub-status.ts` 和对应视图策略
- 对应测试

状态至少包括：`idle`、`pending`、`syncing`、`success`、`error`。每次上传记录待同步集合、最后尝试时间和可重试动作；新的本地变更到来时，错误状态回到 `pending`。错误信息经过共享脱敏函数，只展示用户可理解的信息，不展示 API Key、请求头或响应原文中的敏感字段。

验收：

- 覆盖防抖排队、连续修改只上传最后状态、部分集合失败、重试成功和卸载清理计时器。
- 菜单在窄屏下仍能展示状态、时间和重试按钮，不阻塞本地阅读功能。
- `pnpm exec vitest -c vitest.config.ts test/synchub-status.test.ts test/synchub-service.test.ts`
- `pnpm typecheck`，本地检查配置、断网、恢复网络三条路径。

提交：`feat: surface synchub background status`

### R3 PWA 离线阅读扩展

状态：依赖 R2-B，拆为数据契约和页面接入两个提交。

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
- 旧版本或损坏快照被安全忽略，不能导致页面启动失败。
- 恢复在线后以当前本地状态为准刷新快照，不自动覆盖较新的 SyncHub 合并结果。
- `pnpm build`、快照单测和本地离线提示检查通过。

执行顺序：

1. `R3-A` 定义 `OfflineReadingSnapshot`、迁移/过期策略和每类数据上限，复用阅读状态 URL 规范化规则。
2. `R3-B` 接入历史、收藏和关注源页面；在线/离线切换只改变数据来源提示，不改变阅读操作入口。
3. 使用 Service Worker 离线模式验证应用壳、历史、收藏和最后一次 Feed 快照均可打开。

提交：`feat: add offline reading snapshot policy`、`feat: extend offline reading snapshots`

### R4 外部节点接入

状态：必须在 R2、R3 稳定后开始；先文档，后实现。

目标：在内部模型稳定后，才实现上游/下游节点的实际连接能力。

先完成协议设计，再实现代码：

- endpoint 超时、重试、熔断和错误分类。
- 只允许明确协议和配置来源，防止 SSRF。
- 节点身份、版本、源清单和健康摘要保持数据模型中立。
- 保持 `/api/v1/node` 只读，连接能力使用独立接口和明确鉴权。

执行顺序：

1. `R4-A` 只提交协议文档：握手、版本协商、能力发现、错误码、超时预算和鉴权边界。
2. `R4-B` 实现只读上游客户端，endpoint 必须来自服务端环境配置并通过 URL/网段校验；不接受浏览器传入任意地址。
3. `R4-C` 增加熔断、指数退避和健康摘要，失败时继续服务本节点数据。
4. `R4-D` 最后实现下游接入鉴权、审计字段和速率限制，不与 SyncHub API Key 混用。

验收：

- 契约测试覆盖版本不兼容、超时、非 JSON、5xx、私网/回环地址和重试耗尽。
- `/api/v1/node` 保持向后兼容；上游不可用时本地 `/api/v1/sources` 与 Feed 仍可用。
- 每个实现提交运行对应 Vitest、`pnpm typecheck` 和本地 API 探针；阶段结束运行 `pnpm check`。

提交边界：`docs: define node federation contract`、`feat: add upstream node client`、`feat: add node circuit breaker`、`feat: authenticate downstream nodes`。

## 后续里程碑

| 里程碑 | 可交付结果 | 前置依赖 | 完成标志 |
| --- | --- | --- | --- |
| M1 洞察闭环 | R1-A 至 R1-C | 已完成 | 趋势、权重和排序原因可在 `/insights` 查看 |
| M2 同步可靠性 | R2-A1、R2-A2、R2-B | M1 | 本地/远端合并无数据丢失，失败可见且可重试 |
| M3 离线阅读 | R3-A、R3-B | M2 | 离线可打开历史、收藏、关注源和最后 Feed 快照 |
| M4 节点联邦 | R4-A 至 R4-D | M2、M3 | 受控上游接入和鉴权下游均通过故障与安全测试 |

## 每个切片的交付门槛

1. 先补共享契约或纯函数测试，再接服务端和页面。
2. 一个可验收小功能对应一个 Conventional Commit。
3. 共享类型或 API 变更必须运行 `pnpm typecheck` 和对应 Vitest。
4. 页面交互必须启动本地服务，检查 `/`、`/feed`、`/insights`、`/health` 和相关 API。
5. 阶段合并前运行 `pnpm check`；涉及构建、PWA 或部署配置时追加 `pnpm build`。
6. 提交前使用 `git diff --check`，并检查密钥、用户数据和环境专用配置没有进入提交。

## 下一步

下一次开发执行 R2-B：新增独立的 SyncHub 后台状态模型，让上传失败可见、可重试，并补齐敏感错误信息脱敏测试；通过后以 `feat: surface synchub background status` 单独提交。
