# P0 Cloudflare Pages 数据库读取阻塞修复

日期：2026-11-25；基线：28cec555b5f22235fcd84e37002b69b56a43a4ad。生产域名：news.likanug.top。未手动写入、迁移或清理生产 D1。

## 线上证据

部署记录指向基线提交，LATESTNEWS_DB 绑定存在。来源目录和来源健康接口正常返回；deployment health 和 articles/search 各等待 25 秒仍未收到 HTTP 响应。D1 管理 API 的只读 SQL 正常；库约 1.95 MB，71 个缓存快照、818 篇文章、21 个待补写快照、4 个检查点、1 条已完成身份迁移记录，FTS repair phase=ready、pending FTS=0。缓存及 journal 单份快照最多 30 篇、20,982 字节。排除绑定缺失和主要 schema 缺失。尚无生产逐调用 trace，不能把单一 SQL 或跨请求异常写成已直接观测的唯一根因。

源码显示原 getCacheTable 在全局初始化 Promise 内等待 Cache.init（含迁移/FTS 完整性检查/至多 5 份快照补写）。每篇文章分别执行持久化 batch 和 FTS batch；远程 D1 的通信成本与本地 SQLite 不同。后续请求可能共同等待首个请求的 Promise。

## 修复边界

- Pages cache 绑定直接取自当前 H3 request，封装为 db0 connector；不依赖全局 D1 binding，不共用未结算的初始化、补写或在途写入 Promise。Node/SQLite 保持原机制。所有运行时 cache 使用点传递 event（洞察、单源、批量、feeds、刷新、文章、事件及部署健康）。
- 已迁移 Pages schema 只执行可用性探测；不在普通读取中执行 journal 重放、全库 FTS audit 或历史日期迁移。使用持久化 phase/pending 作为 FTS 状态依据；实际检索仍有 persisted guard 与字面回退。未迁移的旧库继续保留可读来源缓存，不自动重建历史关系；历史检索暂返回不可用，需要先按 N4-L1/L2 备份及显式维护流程完成迁移。首次全新库仍可自动建表；INIT_TABLE=false 不做 DDL。已有迁移但缺少独立注册表等新结构时允许原有增量初始化。
- 正常缓存写入先提交 cache 与 journal；Pages 通过所属 request.waitUntil 至多安排一份快照的补写及有界 FTS 恢复。成功的缓存洞察请求可推进既有积压；授权刷新也可推进积压。健康、历史检索及单源缓存读取不会等待补写；跨请求重复重放仍依赖现有原子/幂等边界，不承诺 exactly-once。普通采集最多 30 篇；大快照分 30 条组处理，未完成保留原 journal。
- D1 使用 JSON 参数集合及原子事务批次：规范 URL 决定身份，保留旧 key/event、较新 payload、来源关系、候选碰撞保护，FTS 失败保留待处理键。30 条以内通常两个 batch、七条语句，替代每篇两个 batch。批内重复 URL 保留最后一次观察，统计与逐篇实现一致。展示事件身份按最多 10 个 topic 一次读查询，不写事件归属。
- 无新依赖、schema 变更、部署参数或生产手工写入。生产数据库已迁移，无需为本热修复清理数据或回滚表。旧库升级、目标 D1 用量/跨区域并发、非缓存来源采集及源健康独立持久化边界仍须专门验收。

## 本地验收

Node 22.23.4 / pnpm 12.21.0，隔离 Linux。107 文件 592 项 Vitest、ESLint、Node/Web/Electron typecheck、Node/Pages 构建通过；新增三个单测覆盖独立请求 Promise、积压存在时非阻塞读取/延迟提交、旧 schema 只读降级。

实际 Pages 构建产物 + Miniflare/workerd（兼容日期 2026-08-06，生产兼容日期不变）：
- 新空库初始化；重启后 71 cache/818 articles/21 pending。12 个并发部署健康/历史检索/缓存源请求全部 200，约 42–149ms，读取期间没有补写。
- 55 来源全缓存洞察 HTTP 200，全部 55 来源返回，4,467.820ms（相似合成标题，单次 fixture 非生产 SLO）。请求后补写一份 30 篇，积压 21→20，下一请求推进至 19。
- 30 条快照（29 个规范 URL + 1 重复）实际 D1 binding 两个 batch、七条 SQL；候选 key 冲突不覆盖旧记录、重复条目保留最后来源 ID 和标题。
- 原事件、索引、并发、迁移、故障回滚和重启恢复 17 检查点全通过。最后缺失 registry 用例显式设置 INIT_TABLE=false，验证 503 与文章读取不受影响。

复现：
```sh
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build:pages
export LATESTNEWS_MINIFLARE_DIR=/path/to/isolated/miniflare
export LATESTNEWS_D1_TEST_COMPAT_DATE=2026-08-06
pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/pages-cache-availability-smoke.mjs
pnpm exec tsx --tsconfig tsconfig.node.json scripts/performance/event-registry-d1-smoke.mjs
```

合并后的生产验收需确认 Pages canonical deployment 提交已变更，再分别核对部署健康、文章检索、缓存源、默认洞察响应和实际 UI。不得以本地 D1 替代生产验收；pending 非零表示恢复尚未结束。
