# N4-I 事件关系审核

仅面向有数据库文件访问权限的运维人员。新增表由 INIT_TABLE=true 初始化。先备份数据库；以下命令仅对指定 SQLite 文件操作，不连接生产 D1，不提供公共写 API。

```bash
pnpm events:review --db /path/to/isolated.sqlite compare event-a event-b
pnpm events:review --db /path/to/isolated.sqlite approve event-a event-b --actor reviewer --evidence "Independent verification reference" --confirm
```

compare 只读，分别返回最多 20 篇按主键排序的成员及截断标志、原文链接、发布时间、共享词、相同规范标题。相似标题不是同一事件的证明；操作员必须核实证据与事件范围。approve 的方向是 a → b，表示旧 ID a 成为规范 ID b 的别名。必须明确确认、填写审核者及证据。仅允许已注册事件，拒绝自身、未知 ID、链式关系、循环和冲突批准；同一方向重复执行保留首次审核记录。多个叶节点可指向同一根，但已有子别名的根不可再作为叶节点。未开放修改或撤销批准的命令；如需撤销，另行审核数据库备份、历史及新关联，不能只删除别名即宣称完全恢复。

历史查询请求 a 或 b 都返回合并后的成员；a 的响应额外返回 canonicalEventId=b。文章原始 eventId 和已有成员记录不改写。新报道存在唯一已批准规范 ID 时可关联该 ID。未经批准的冲突仍不写入。按主键分页不提供跨请求固定快照。注册时间取规范事件注册时间。

只读对比是有界人工候选审查，不是全库自动发现。无重叠报道的自动匹配仍未启用；N4-H 初标语料不能授权自动合并。

## 验收

Linux / Node 22.23.4 / pnpm 12.21.0：510 项 Vitest，lint、Node/Web 与 Electron 类型检查，Node、Pages 构建通过。使用 N4-G D1 脚本验证实际 Pages API 的显式别名、循环拒绝、规范关联、原始成员保留与 workerd 重启。兼容日期 2026-08-06；生产环境和分布式并发未验收。回退只撤销代码，保留数据库及审批证据。
