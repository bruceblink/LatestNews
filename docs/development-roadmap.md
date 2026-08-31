# LatestNews 后续开发路线

本文件是 `DEVELOPMENT_PLAN.md` 的执行版，记录当前基线、已完成能力、下一阶段的可交付切片和每个切片的验收门槛。每个切片保持单一功能范围，完成验证后单独提交。

## 当前基线

截至 2026-08-09，以下能力已经落地：

- NewsItem 标准化、缓存状态扩展和批量接口错误透明化。
- v1 源元信息、源条目、批量查询、健康、诊断、节点清单、OpenAPI 和 JSON Feed/RSS。
- 统一 Feed、热点排行、话题聚合、词云、分类占比、来源活跃度和洞察到 Feed 的筛选联动。
- 来源健康事件持久化、手动探测、缓存刷新、部署健康检查和 `/insights` 健康概览。
- 已知爬虫源可用性修复：RSS 强制文本解析、Bilibili/知乎备用接口、FreeBuf RSS、Sputnik 直连和失效 MKTNews 源隔离。
- 本地阅读历史、稍后读、收藏、隐藏，以及 GitHub 布局同步和 SyncHub 阅读数据同步。
- Feed 离线快照、PWA 更新反馈和网络恢复反馈。
- 版本化离线阅读快照契约：历史、收藏和关注源均有 URL 规范化、数量上限、过期与损坏数据保护。
- Node/Docker 生产包的 SPA 路由回退和静态资源读取已修复，`/`、`/feed`、`/insights`、`/health` 及首个 JavaScript 资源均可通过真实 Node 产物访问。

当前功能基线已完成 R3 的代码/构建验证和 R4-A 至 R4-D 的服务端实现。部署环境的 Service Worker 离线切换仍是 M3 发布前人工验收项；当前自动化浏览器无法访问本机预览地址，因此不能把 Worker 产物检查误记为真实离线验收。

### R5 数据源可用性修复

状态：已完成（2026-08-10）。

本切片只处理已复现的上游失败，不改变 NewsItem 或 API 响应契约：

- FreeBuf 改用稳定 RSS，避免首页被 WAF 返回 `405` 后无法解析。
- Bilibili 热搜改用官方 JSON trending API，绕开旧热词端点的 `412`。
- 知乎保留网页热榜并在 `403` 时切换到 `api.zhihu.com` 公共热榜接口，同时规范化问题 URL。
- Sputnik 移除 Cloudflare 下会回调自身 `/api/s` 的代理配置，改为直接读取上游时间线。
- RSS 解析强制 `responseType: text`，兼容 `application/rss+xml` 返回的 feed（先知社区）。
- MKTNews 官网当前为占位页、原 flash API 持续返回 `403`，因此从可用源清单隔离，避免把确定不可用的上游伪装成空数据。

验收：

- `pnpm exec vitest -c vitest.config.ts test/source-adapter-regressions.test.ts server/utils/rss2json.test.ts`
- `pnpm typecheck`、`pnpm build`
- 本地 HTTP 冒烟：FreeBuf、Bilibili 热搜、知乎、Sputnik 和先知社区均返回非空成功数据。

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

状态：已完成（2026-08-09）。

目标：让后台上传失败可见、可重试，不再静默丢失。

文件范围：

- 新增 `src/atoms/syncHubStatusAtom.ts`，不复用现有登录元数据同步状态
- `src/hooks/useSyncHub.ts`
- `src/components/header/menu.tsx`
- 新增 `shared/synchub-status.ts` 和对应视图策略
- 对应测试

状态至少包括：`idle`、`pending`、`syncing`、`success`、`error`。每次上传记录待同步集合、最后尝试时间和可重试动作；新的本地变更到来时，错误状态回到 `pending`。错误信息经过共享脱敏函数，只展示用户可理解的信息，不展示 API Key、请求头或响应原文中的敏感字段。

实现结果：

- 独立持久化 SyncHub 状态，不与登录后的布局同步状态混用。
- 共享上传队列把连续修改合并为一批；失败集合保留到重试，新修改在上传中到达时进入下一批。
- 错误文本映射为安全提示，菜单展示状态、待处理数量和失败后的重试入口。

验收：

- 覆盖防抖排队、连续修改只上传最后状态、部分集合失败、重试成功和卸载清理计时器。
- 菜单在窄屏下仍能展示状态、时间和重试按钮，不阻塞本地阅读功能。
- `pnpm exec vitest -c vitest.config.ts test/synchub-status.test.ts test/synchub-upload-queue.test.ts test/synchub-service.test.ts`
- `pnpm typecheck`、`pnpm check` 和本地 `/history` 页面 HTTP 冒烟通过；真实 SyncHub 凭据配置、断网和恢复网络的手动验收留待部署环境执行。

提交：`feat: surface synchub background status`

### R3 PWA 离线阅读扩展

状态：R3-A、R3-B、R3-C 已完成；真实 Service Worker 离线切换保留为部署前人工验收。

目标：将离线能力从 Feed 快照扩展到最近阅读、收藏和关注源。

阶段文件范围：

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

1. `R3-A` 已完成：在 `shared/offline-reading-state.ts` 定义 `OfflineReadingSnapshot`，版本固定为 `1`。历史按规范化 URL 去重且最多 200 条，收藏最多 300 条，关注源最多 100 个；快照分为 `fresh`、`stale`、`invalid` 三种状态。未知版本、损坏结构和超过 60 秒的未来时间均安全忽略。相关单测覆盖规范化、确定性排序、上限、迁移与过期状态，已运行 `pnpm check`。
2. `R3-B` 已完成：新增 `src/services/offline-reading-state.service.ts`，只负责浏览器存储读写，不直接修改 atom：
   - 使用独立存储键；读操作捕获 JSON/Storage 异常，并通过 R3-A 迁移函数丢弃无效数据。
   - `readOfflineReadingSnapshot` 返回 `missing`、`fresh`、`stale` 或 `invalid`；损坏和未知版本不会作为页面数据返回。
   - 服务通过 `globalThis` 受控访问浏览器存储，因此 Node 侧的测试配置和无存储环境都会安全退化，不依赖 `window` 全局。
   - 定向测试覆盖正常读写与规范化、过期快照、损坏 JSON、未知版本、配额/访问异常和无浏览器环境；已通过定向 Vitest 与 `pnpm typecheck`。
3. `R3-C` 已完成：根路由在初始 SyncHub 合并完成后持久化阅读快照，离线首次启动只读取旧快照，避免空 atom 覆盖已有副本；网络恢复后以当前本地状态写入新快照。
   - 历史、收藏和关注源各自优先使用本地持久化数据；仅在离线且主存储缺失时才回退到 `fresh` 或 `stale` 快照。
   - `/history` 对快照来源显示保存时间和过期提示；从快照移除历史或收藏会先恢复为本地状态再执行操作，因此阅读操作仍可用。
   - `pnpm check`（46 文件、205 测试）和 `pnpm build` 已通过；本地 `/history` 桌面与 390px 移动视图通过检查，状态提示不会遮挡筛选与操作区。
4. 部署前人工验收：在已注册 Service Worker 的构建环境中依次模拟首次离线、已有快照离线、过期快照、恢复网络和 SyncHub 合并后刷新，确认应用壳、`/history`、收藏、关注源和最后一次 Feed 快照均可打开。当前自动化环境不提供网络离线切换，不能把本地 HTTP 冒烟等同于该项验收。

提交边界：`feat: add offline reading snapshot policy`（已完成）、`feat: persist offline reading snapshots`（R3-B）、`feat: show offline reading snapshots`（R3-C）。每项完成后运行对应 Vitest 与 `pnpm typecheck`；R3 收尾追加 `pnpm check` 和 `pnpm build`。

### R4 外部节点接入

状态：R4-A、R4-B、R4-C、R4-D 已完成；R3 的部署前离线验收仍在发布清单中。

目标：在内部模型稳定后，才实现上游/下游节点的实际连接能力。

先完成协议设计，再实现代码：

- endpoint 超时、重试、熔断和错误分类。
- 只允许明确协议和配置来源，防止 SSRF。
- 节点身份、版本、源清单和健康摘要保持数据模型中立。
- 保持 `/api/v1/node` 只读，连接能力使用独立接口和明确鉴权。

执行顺序：

1. `R4-A` 已完成：新增 [节点联邦协议](node-federation-contract.md)，冻结现有 `/api/v1/node` 发现边界、可选能力扩展、服务器端 URL/SSRF 规则、超时/重试/熔断预算、错误码和独立鉴权命名空间；本切片没有新增网络请求或接口。
2. `R4-B` 已完成：新增服务端只读客户端和 `GET /api/v1/federation/upstream` 诊断接口。目标仅来自 `LATESTNEWS_UPSTREAM_ENDPOINT`，可选专用 `LATESTNEWS_FEDERATION_UPSTREAM_TOKEN`；不接受浏览器请求参数。客户端拒绝非 HTTPS（仅显式开发开关允许 HTTP）、路径/凭据/端口/IP 字面量、私网与保留 DNS 地址，禁用重定向，并在 Node server 上把连接固定到已验证的 DNS 地址以防止二次 DNS 解析绕过。接口未配置时返回 `configured: false`，上游失败只返回联邦错误，不影响本地 Feed。
   - Cloudflare Pages 构建仍然通过；为避免在缺少可控 DNS 连接固定能力的 Edge 运行时发生不安全降级，配置上游后会安全返回不可用，而不会直接使用未校验的 `fetch`。启用该能力需要 Node server 部署，或在后续平台适配中提供同等强度的受控解析器。
3. `R4-C` 已完成：上游客户端按已规范化 origin 维护进程内熔断器。每个终态可重试请求只计为一次失败，连续 3 次失败后打开 30 秒；到期后只允许一个半开探测，探测成功关闭，失败重新打开。连接失败的重试改为带抖动的指数退避（250ms 起、1s 上限），并保持现有单次重试预算。
   - `GET /api/v1/federation/upstream` 的 `meta` 新增 `localHealth` 与 `upstream` 状态/熔断快照。上游失败或熔断时远端 `data` 仍为 `null`，但本节点来源健康摘要始终返回且明确标记为 `degraded`，不会把远端空结果当作本地空数据。
   - 定向测试覆盖打开、半开并发隔离、成功恢复、半开失败重开、终态失败计数、退避上限和本地健康降级回退。
4. `R4-D` 已完成：新增 `GET /api/v1/federation/downstream/node`，它始终要求专用 `lnf_` bearer 与 `X-LatestNews-Node-Id`，只返回本地节点清单。既有 `/api/v1/node` 保持公开兼容，不修改其原字段。
   - `LATESTNEWS_FEDERATION_DOWNSTREAM_KEYS` 只接收 SHA-256 verifier、唯一 key ID、node allow-list、scopes 和可选过期/撤销时间；配置存在任意无效记录时整体安全拒绝。多 key 并存支持轮换，`shk_` key 与其他 namespace 都不会被接受。
   - `node:read` scope 被明确校验。响应和 headers 提供 request ID、rate-limit 额度/剩余/重置时间；已认证响应额外提供 key ID、node ID 与 granted scopes，认证失败不会回显这些字段。
   - 限流按已认证 key/node 组合划分；未认证请求使用匿名桶，不能通过伪造 node ID 消耗有效节点预算。所有接受、拒绝、限流均输出脱敏审计事件，审计载荷不含 token、verifier 或 Authorization header。
   - 节点清单仅在存在有效下游配置时声明 `downstream-node-manifest` bearer capability。OpenAPI 同时描述 bearer scheme、必需 node header 与 401/403/429 响应。

验收：

- 契约测试覆盖版本不兼容、超时、非 JSON、5xx、私网/回环地址和重试耗尽。
- `/api/v1/node` 保持向后兼容；上游不可用时本地 `/api/v1/sources` 与 Feed 仍可用。
- 每个实现提交运行对应 Vitest、`pnpm typecheck` 和本地 API 探针；阶段结束运行 `pnpm check`。

提交边界：`docs: define node federation contract`、`feat: add upstream node client`、`feat: add federation circuit breaker`、`feat: authenticate downstream nodes`。

## 后续里程碑

| 里程碑 | 可交付结果 | 前置依赖 | 完成标志 |
| --- | --- | --- | --- |
| M1 洞察闭环 | R1-A 至 R1-C | 已完成 | 趋势、权重和排序原因可在 `/insights` 查看 |
| M2 同步可靠性 | R2-A1、R2-A2、R2-B | M1 | 本地/远端合并无数据丢失，失败可见且可重试 |
| M3 离线阅读 | R3-A 至 R3-C | M2 | 实现与构建验证完成；部署前 Service Worker 离线切换验收通过 |
| M4 节点联邦 | R4-A 至 R4-D | M2、M3 | 代码、构建、故障/安全测试和本地 API 探针通过；部署前执行 key 轮换与审计接收验收 |

## 每个切片的交付门槛

1. 先补共享契约或纯函数测试，再接服务端和页面。
2. 一个可验收小功能对应一个 Conventional Commit。
3. 共享类型或 API 变更必须运行 `pnpm typecheck` 和对应 Vitest。
4. 页面交互必须启动本地服务，检查 `/`、`/feed`、`/insights`、`/health` 和相关 API。
5. 阶段合并前运行 `pnpm check`；涉及构建、PWA 或部署配置时追加 `pnpm build`。
6. 提交前使用 `git diff --check`，并检查密钥、用户数据和环境专用配置没有进入提交。

## 下一步

下一次开发优先完成 M3 部署前离线验收（需要允许切换网络状态的已注册 Service Worker 环境），随后做 M4 部署验收：使用真实 `lnf_` 凭据验证下游成功、缺失/错误凭据拒绝、allow-list 与 scope 拒绝、双 key 轮换、旧 key 撤销、限流响应和脱敏审计事件接收。两项均通过后再安排发布版本与回滚演练。
