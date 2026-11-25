# N4-M 持久事件治理与冲突语义

2026-11-25；基线 d93b3a4（N4-L2）。

- 展示聚类不再写入文章 event_id。读、隐藏、来源过滤、范围与排序不能决定全局归属。已注册事件及人工别名保留。
- 只有所有展示成员都存在于索引、已归属且规范事件一致时，返回 registered；其他返回 candidate、partial、conflict 或 unavailable。候选 ID 按规范 URL 排序去重后 SHA-256，与持久事件分开；候选不是可查询历史的承诺。
- SQLite 运维入口：备份并核实成员与证据后，使用 `pnpm events:assign --db <existing-db> --urls <json-array-file> --actor <reviewer> --evidence <reference> --confirm`；向已注册规范事件增补时指定 `--event <canonical-id>`。1–200 个 URL，拒绝缺失、跨事件冲突、未知目标和别名目标；审批、注册及成员归属使用同一原子批次。审核记录保留成员、证据、审核人和时间。不得使用展示候选 ID 注册或绕过审批。旧 fixture writer 仅用于测试及隔离 smoke。
- 101 文件、551 项 Vitest；lint、Node/Web/Electron 类型检查、Node/Pages 构建通过；Miniflare 隔离 D1 实际 Pages 产物验证只读洞察、人工审批、冲突并发、事务回滚和此前索引/缓存回归。兼容日期为 2026-08-06，非生产 D1。
- 无独立人工标签复核，不启用语义自动归属。尚无生产 D1 审批运维授权与验证；CLI 仅为本地 SQLite。数据库备份与恢复继续遵循 N4-L1/L2。回退不得以旧版自动归属覆盖新审批语义。
