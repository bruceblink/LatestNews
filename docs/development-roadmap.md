# LatestNews 执行路线与历史记录

当前开发顺序以 [性能、新闻源扩展与插件化计划](02-performance-sources-platform-plan.md) 的 F0–F6 为准，产品概览见 [开发总计划](../DEVELOPMENT_PLAN.md)。本文件保留 `0.5.3` / `5ce4aa4` 时期的任务设计和 R1–R9 记录，旧排期与候选版本不再代表当前安排。

2026-10-26 更新：F2-C 至 F2-E、F3-A 已完成实现，F3-B 已增加 Electron 生命周期诊断、退出时 worker 回收和自动化探针；F3-C 已完成 Web/Electron 统一设置入口与桌面数据源 API 配置；F3-D 已增加 Playwright Web/Electron E2E 基线和 CI 工作流；F4-A Source SDK、F4-B 三类代表适配器迁移和 F5-A 运行期质量指标、重点源采样工具已完成。配置型 RSS/JSON 的 Node 适配器、H3 API 路由及 Web/Electron 远端服务契约测试已通过；生产配置验证待后续部署时确认。公网采样按用户要求暂缓；真实浏览器瀑布与真实桌面窗口证据仍待验收。执行细节见 [后续开发计划](08-next-development-plan.md)、[配置型来源记录](22-configured-source-rss-json.md)、[插件平台进度记录](04-crawler-plugin-implementation-progress.md) 和 [性能基线实施记录](07-performance-baseline-progress.md)。

2026-10-20 更新：采集插件 P0–P4（SDK/CLI、跨宿主接入、动态来源目录、包安装/更新/回退）已分批提交并推送；陌生插件隔离仍未评估。后续性能与新闻源主线已完成 F0 核对、F1 Node API 缓存状态的 1,000 样本测量，以及 F2-A/F2-B 服务端采集总并发、等待队列和上游 origin 调度边界。响应体限制、慢源、Web、Electron 和真实新闻源质量基线仍待完成。跨宿主证据见 [插件平台进度记录](04-crawler-plugin-implementation-progress.md)，性能进度见 [性能基线实施记录](07-performance-baseline-progress.md)。

2026-10-17 更新：桌面已采用“桌面客户端＋远程 API”，`0.6.0` 已发布全平台桌面、Web 和 Docker 产物。D1–D5 状态见 [多平台实施记录](01-web-electron-plan.md)。当前已有 PR/主分支检查与发布前验证；下文的开发启动失败和缺少检查是历史问题描述，不应直接列为当前未修复问题。离线、同步与联邦部署等未关闭验收项继续保留，由 F0 核对证据后更新。

## 历史基线（2026-10-15）

已实现：标准化与缓存降级、v1 API/Feed/OpenAPI、统一 Feed 与洞察、阅读状态与 SyncHub 合并/重试、离线快照、健康诊断、上游清单诊断和下游清单鉴权。另已交付：

- 2026-08-10：R5 已知源抓取修复与失效源隔离。
- 2026-08-11：统一 Feed 分批展示，版本升级至 `0.5.3`。
- 2026-08-31：Node 生产 SPA 路由回退及静态资源修复。

**最近一次运行证据来自 2026-10-15 云环境设置，本次文档更新未重跑应用测试：**

| 检查 | 记录结果 | 证据边界 |
| --- | --- | --- |
| Node 22.23.3 + pnpm 10.30.3 安装 | 通过 | SQLite 原生依赖可用；使用冻结锁文件 |
| lint / typecheck / Vitest | 通过 | 51 文件、237 测试 |
| Node 生产构建与重启 | 通过 | 首页及部署健康、节点清单、OpenAPI 通过响应校验；SQLite 缓存正常 |
| `pnpm dev` | 失败，已定位 | Nitro worker 无法解析 `#nitro/index`，安排 R6-A |
| 实时新闻源 | 最近设置未验收 | 2026-08 的修复证据不能代表当前源站状态 |
| 浏览器交互 / 真实 PWA 离线 | 未完成本轮验收 | 不能用产物存在或 HTTP 200 替代 |
| 真实 SyncHub / 联邦轮换与审计接收 | 部署待验收 | 单测与模拟故障验证不等于真实服务验收 |
| Cloudflare Pages / D1 | 本轮未重验 | 历史构建记录保留；D1 与 Edge 受限能力另验 |

R1、R2 的代码交付已完成；M3（离线）和 M4（联邦）的实现已完成，部署验收仍未关闭。Cloudflare 缺少受控 DNS 连接固定能力时，上游客户端安全返回不可用；这不是已交付的 Edge 联邦功能。

## 历史排期、依赖与状态（已由 F0–F6 替代）

估算假设：1 人投入，从下一轮开发起约 4–6 周；工作量不含外部账号、设备、网络和评审等待。没有实际完成记录前，任务保持“待开始”或“待验收”。

| 任务 | 优先级 / 状态 | 估算工作量 | 依赖 |
| --- | --- | --- | --- |
| R6-A 开发模式修复 | P0 / 待开始 | 1–2 天 | 无 |
| R6-B CI 与发布门禁 | P0 / 待开始 | 1–2 天 | R6-A；静态检查 job 可先做 |
| R6-C 运行约定与文档 | P1 / 待开始 | 1 天 | R6-A 的最终方案 |
| R7-A 代表源实测 | P1 / 待验收 | 2 天 | 目标源网络可达；fixture 可先做 |
| R7-B 浏览器与 PWA | P1 / 待验收 | 2–3 天 | R6、可控制网络的真实浏览器 |
| R7-C 同步与联邦 | P1 / 待验收 | 2–3 天 | R6、测试服务和独立测试凭据 |
| R7-D 发布与回滚 | P1 / 待开始 | 1–2 天 | R7-A–C 的必需项关闭 |
| R8-A Feed 筛选导航 | P2 / 待开始 | 2–3 天 | M6 完成 |
| R8-B 数据源质量治理 | P2 / 待开始 | 2–3 天 | R7-A 的样本基线 |
| R8-C 同步删除策略评估 | P2 / 待开始 | 1–2 天 | R7-C 的现象记录与服务契约 |
| R9 可选节点扩展设计 | 候选 / 未排期 | 评估后估算 | M7 后有明确接入需求 |

建议先交付 R6（第 1 周），再关闭 R7（第 2–3 周），最后推进 R8（第 4–6 周，余量用于回归与修复）。R7 的测试条件准备可以提前进行；因外部条件阻塞时记录具体前置条件，继续独立任务，不把未执行项改成通过。

候选版本：`0.5.4` 聚焦 R6/R7 的稳定性和验收，`0.6.0` 在 M6 完成后确定 R8 的实际范围。增加新同步协议或跨节点条目读取需重新估算，不计入当前承诺。

## M5：开发与回归基线

### R6-A 修复开发后端启动

问题：`nitro.config.ts` 在 Node 模式直接注册 `server/renderer.ts`，其 `#nitro/index` 导入仅在 `vite-plugin-with-nitro` 的生产构建流程中提供别名。开发 worker 因此初始化失败。

范围：`nitro.config.ts`、`vite.config.ts`、`server/renderer.ts`、必要的构建/开发冒烟脚本。按 Vite 的开发/构建阶段配置渲染器，保留生产包的 SPA 回退；先验证受支持的配置方式。

验收：

- 干净启动 `pnpm dev`，在 30 秒就绪窗口内取得首页与 `/api/v1/health/deployment`、`/api/v1/node`、`/api/v1/openapi.json` 的预期响应，日志没有该别名错误。
- 浏览器能进入 `/feed`、`/history`、`/health`，一次前端修改可热更新；一次后端修改可重新处理 API 请求。
- `pnpm build` 后启动真实 Node 产物；首页、客户端深链接和一个实际 JavaScript 静态资源可访问，API 仍返回 JSON。
- typecheck、相关回归测试通过；兼容路径执行 `CF_PAGES=1 pnpm build`，仅记录构建结果，D1 另验。

建议 PR：`fix: restore nitro development startup`。

### R6-B 增加 PR 检查与发布门禁

问题：仓库现有验证运行于 nightly，缺少 `pull_request` 检查；tag 的镜像和 release 流程没有依赖同一验证门禁。

范围：`.github/workflows/*`、可复用本地冒烟脚本及贡献说明。固定 Node 22 验证线，使用 `packageManager` 指定的 pnpm 10.30.3，冻结安装并保留补丁/完整性校验。

验收：

- PR 和主分支自动执行 `pnpm lint:check`、`pnpm typecheck`、`pnpm test --run`、Node 构建、dev/生产 HTTP 冒烟。API 探针不依赖外部新闻源，设超时并在退出时清理所启动进程。
- PR 不要求发布密钥，也不发布制品；至少观察一次真实工作流成功。受控失败用来证明检查会阻止后续依赖 job，不能只校验 YAML。
- tag 镜像与 release 的发布 job 依赖同一提交的验证成功；构建失败时不发布。Cloudflare 构建作为独立兼容检查。
- 同一 SHA 的产物可追踪到测试结果；需要管理员启用 required checks 时记录该外部操作，未启用前不声称已强制阻止合并。

建议 PR：`ci: gate pull requests and releases on validation`。

### R6-C 对齐运行、配置与架构说明

范围：`README.md`、`CONTRIBUTING.md`、`docs/deployment.md`、`example.env.server` 与必要的版本约定文件。

验收：

- 明确 Node 22 验证线和精确 pnpm 版本，写清生成文件、首次初始化、本地启动与生产运行的工作目录。
- 无登录凭据可运行基本阅读；登录、SyncHub、Product Hunt 和联邦分别列出可选条件，不混用凭据。
- 根据现有代码和协议补齐联邦变量说明，说明 Node/Pages 的数据库差异及 Edge 上游限制。
- `pnpm start` 所需 `.env.server` 与无 env 文件的直接 Node 启动方式都有清晰说明。
- 用文档步骤完成一次新运行目录中的启动与核心 API 冒烟。跨系统架构提案不被描述为当前已部署组件。

建议 PR：`docs: align development and deployment workflows`。

## M6：发布验收

### R7-A 代表新闻源与降级行为

范围：现有 source fixture、`test/source-adapter-regressions.test.ts`、`server/utils/rss2json.test.ts`、必要的 adapter 修复和验收记录。

步骤与验收：

- 先在目标环境核对实际网络和可用凭据，选取至少 5 个代表源，覆盖 RSS、JSON 和 HTML；优先包含 R5 修复过的 FreeBuf、Bilibili、知乎，再补 RSS/HTML 样本。
- 每源记录部署目标、时间、请求次数、HTTP/抓取结果、有效条目数、耗时与缓存状态。成功判据是可解析的非空规范化条目，而非 HTTP 200。
- 区分网络策略阻断、凭据缺失、源站限流和解析错误；不得以空数组隐藏抓取失败。外部不可达不作为 adapter 已坏的唯一证据。
- 对已复现解析问题保存脱敏 fixture，覆盖空结果、字段变化和异常响应；离线回归使用 fixture，公网探测单独执行并尊重源站限频。
- 验证一次源站失败后的缓存降级与批量部分失败，健康页和 API 保留诊断。仍不可用的重点源须修复或有明确隔离/替代说明。

### R7-B 真实浏览器与离线阅读

范围：关键页面浏览器验收、`pwa.config.ts`、`src/hooks/usePWA.ts`、离线服务与相应回归测试。优先补能够稳定复现问题的自动化场景，保留真实设备检查。

验收：

- 桌面和 390px 移动视图：从洞察进入筛选 Feed、加载更多、标记已读、收藏/取消收藏、隐藏、查看历史；检查空数据、部分源失败和重试。
- 使用已构建产物、受支持的安全上下文和已接管页面的 Service Worker，区分首次访问即离线与曾在线后离线。
- 覆盖新用户无缓存、已有 Feed/阅读快照、过期/损坏快照、刷新/深链接、断网重启、恢复在线、应用版本更新；首次即离线且未缓存时明确记录不可用边界。
- 历史、收藏、关注源和最近 Feed 的离线可读范围与产品提示一致；损坏数据不使页面崩溃，恢复网络不覆盖较新本地状态。
- 使用键盘完成筛选和阅读操作，焦点可见；失败/同步状态可读，窄屏提示不遮挡操作。
- 保存浏览器/系统、构建 SHA、Worker 接管状态、步骤和结果。若环境不支持离线切换，标为未执行并转到具备能力的环境。

### R7-C SyncHub 与联邦部署集成

使用隔离测试数据与凭据，预先确认已有配置是否可用；缺失值通过环境设置安全提供。等待期间完成本地桩、契约测试和操作步骤。两个场景分别记录结果。

**SyncHub：**

- 两个浏览器上下文验证空远端初始化、旧数据兼容、本地/远端并发新增、部分集合下载/上传失败、断网重试和恢复收敛。
- 历史/收藏新增不丢失，未成功下载的集合不被空值覆盖；失败可见、可重试且不阻塞本地阅读。
- 记录“设备 A 删除、设备 B 保留旧副本、再次同步”的当前行为，供 R8-C 决策；不把现有并集策略写成已支持删除传播。
- GitHub 布局同步与 SyncHub 阅读同步分开验收；没有对应测试服务或凭据时保持待验收。

**联邦：**

- 验证未配置上游、兼容清单、超时、熔断及恢复；上游异常时本地源/API 与 Feed 仍可用。
- 下游清单接口覆盖正确/缺失/错误 bearer、node allow-list、scope、过期/撤销、双 key 轮换及 429；记录 request ID 和实际审计接收结果。
- `/api/v1/node` 维持公开兼容；`lnf_` 与其他凭据 namespace 隔离。
- Node 部署执行上游成功场景；Pages 没有等价连接固定器时应安全拒绝，并在能力表标注，不绕过地址校验来通过验收。
- 审计记录不包含原始 token、verifier 或 Authorization header。

### R7-D 发布候选与回滚演练

范围：`docs/deployment.md`、版本/变更说明、验收记录；实际发布另行安排。

验收：

- 汇总 R6/R7 通过、失败、跳过和未执行项，说明支持的部署目标。发布范围内的必需项有失败或缺失证据时，候选状态保持未通过。
- 从持久化数据目录完成备份、升级启动、重启检查和恢复演练，确认历史/布局/缓存数据的保留边界；演练使用副本。
- Node 验证核心页面与 API；本地 Docker 构建与启动追加数据卷重启检查；Pages 验证预览部署及 D1 绑定。只对有证据的目标声明支持。
- 记录上一稳定制品、配置差异、回滚命令、数据兼容条件和回滚后探针结果。
- 候选 `0.5.4` 发布说明区分本轮修复与既有功能，避免把历史特性记为新增。未执行发布前不标“已发布”。

## M7：阅读体验与维护效率

### R8-A Feed 筛选与导航状态

当前 Feed 已分批展示；下一步先提高筛选状态的可恢复性，再根据性能数据决定是否需要虚拟列表。

范围：`src/routes/feed.tsx`、`shared/unified-feed.ts`、共享 Query Key 与路由参数测试。

验收：

- 来源、分类、关键词、时间窗和范围能写入 URL，刷新、分享链接、浏览器前进/后退恢复一致；“重置”同步清理 URL。
- 筛选变化后可见条数正确复位，“加载更多”不重复条目，已读/隐藏状态按现有语义保留。
- 使用固定样本记录首屏展示条数、DOM 节点量和交互耗时，在相同浏览器/设备与样本下比对；未测量前不承诺虚拟化收益。
- 桌面与移动端完成 R7-B 的相关阅读路径。

### R8-B 数据源质量与回归维护

范围：`server/sources/*`、来源元信息、健康诊断、fixture 与维护文档。

验收：

- 从 R7-A 选择 10 个重点源作为维护集，记录负责人或待认领状态、抓取类型、fixture、最近实测时间和已知限制。
- 离线 fixture 回归进入普通 CI；公网探测使用单独、低频、可配置的执行路径，不让外站瞬时失败阻断全部 PR。
- 质量报告区分成功率、延迟、空条目、陈旧缓存与未采样；用固定采样窗口，不能把 `unknown` 计为成功。
- 给出失败源隔离、备用源切换和恢复条件；优先修复已有重点源，按质量证据逐步新增源。

### R8-C 同步删除与兼容策略评估

当前收藏按 URL 做并集合并，尚无跨设备删除传播契约。本任务先交付设计和可复现场景；实现成本与远端服务支持明确后单独排期。

范围：`shared/synchub-merge.ts`、SyncHub 契约、阅读状态模型及现有测试。

验收：

- 用 R7-C 的双端场景说明当前行为，区分产品规则与代码缺陷。
- 对比删除标记、保留期限、再次收藏、同时间冲突、离线旧设备回归及旧客户端兼容方案，明确历史清理是否采用相同语义。
- 确认 SyncHub 服务能承载版本化数据与所选策略；若不能，记录所需服务变更，不仅修改本地合并函数。
- 输出协议草案、迁移/回滚方案、场景测试矩阵和实现估算。方案未实现时不宣称已解决删除回流。

## M8：候选扩展

### R9 跨节点条目读取与平台能力评估

仅在存在明确下游使用者后开始。现有联邦能力只覆盖清单发现、诊断和受控清单读取，不等于远端条目已接入本地 Feed。

设计交付：

- 定义同 origin 的源/条目读取契约、显式 capability、来源归属、去重、缓存隔离和故障回退。
- 延续独立凭据、SSRF/DNS 防护、请求预算和本地数据优先原则。
- 单独评估 Pages 的受控解析能力；缺少等价安全能力时继续限制为 Node。
- 先评审协议、性能预算和真实需求，再估算实现；不在本轮引入写入联邦、自动节点发现或微服务拆分。

## 每个切片的交付门槛

1. 新行为或缺陷修复补充能复现问题的测试；文档变更做链接、内容一致性和差异检查。
2. 共享类型/API 运行 typecheck 与相关 Vitest；阶段合并前执行全量检查。
3. 非交互环境使用 `pnpm lint:check && pnpm typecheck && pnpm test --run`（需要时加 `--maxWorkers=3`）。构建相关变更追加 `pnpm build`。
4. 服务就绪检查验证返回内容；浏览器交互、Service Worker 与外部服务分别记录，不用端口监听或 HTTP 200 替代。
5. 记录格式：任务 ID、commit、运行环境、命令/操作步骤、预期与实际结果、证据位置、遗留项。诊断附件脱敏，不保存真实用户数据。
6. 每周更新状态；只有满足对应验收条件才标完成。线上故障优先，提交前运行 `git diff --check`。

## 下一次开发

先执行 **R6-A**，恢复 `pnpm dev` 的 Nitro 后端，并将 dev 与生产 HTTP 冒烟纳入 R6-B；同时准备 R7 的浏览器、代表源与测试服务条件。M3/M4 的部署验收继续保留，不能因计划重排而关闭。

## 历史交付记录（R1–R5）

以下保留原有实现规则与当时的验证记录，不表示本次重跑或已经发布。历史环境中的浏览器能力限制仅说明当时未验收的原因；后续任务需重新检查可用能力。

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

## M9：Web 与 Electron 共用前端（已交付 0.6.0，部分验收待完成）

采用“桌面客户端＋远程 API”，共用 React 页面、路由、状态和 service 层。桌面端使用随 Windows 安装包分发的前端资源，不在本机启动 Nitro 或新闻采集服务。

本里程碑已完成共用前端、受限远程请求和全平台构建发布；Windows 已有部分真实窗口及覆盖安装证据。D3 真实登录与同步、Windows 安装后任务栏以及 macOS/Linux 原生验收尚未完成；证据、限制和回退边界见 [Web 与 Electron 共用前端开发计划](01-web-electron-plan.md)。

后续优先执行 F0/F1，核对未关闭验收项并建立性能基线。新增业务优先进入共用 Web 前端；桌面继续通过同一前端和远程 API 获得功能。
