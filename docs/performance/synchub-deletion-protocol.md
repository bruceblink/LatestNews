# N2-D — SyncHub 删除协议设计与本地参考验收

基线 LatestNews 3ac0354；SyncHub 主线 44e8b370faf270aa83bd8f63127fca08cc2637fb（2026-11-25 核对源码，未访问生产同步数据）。

## 已核实的服务端边界

- [HTTP handler](https://github.com/bruceblink/SyncHub/blob/44e8b370faf270aa83bd8f63127fca08cc2637fb/internal/api/server.go) 的 putMetadataDocument 只接受 payload。
- [metadata service](https://github.com/bruceblink/SyncHub/blob/44e8b370faf270aa83bd8f63127fca08cc2637fb/internal/metadata/service.go) 校验集合、JSON 和 1 MiB 大小上限；能力接口未声明删除协议或条件写入。
- [repository](https://github.com/bruceblink/SyncHub/blob/44e8b370faf270aa83bd8f63127fca08cc2637fb/internal/db/repository.go) 的 PutMetadataDocument 无条件替换 payload 并递增 version；版本号仅作为返回信息，不是 CAS 前置条件。
- LatestNews 当前按 URL 合并数组。删除后缺少墓碑，旧设备能够恢复记录（A07）。两个客户端的 GET→PUT 并非原子操作，单纯新增客户端墓碑不能解决覆盖竞争。

## 提议的 v2 契约（未启用）

1. 服务端先声明协议版本 2、账户/应用/集合作用域、不可复用的 epoch 和大小限制。客户端只在明确支持后使用新协议。读写必须按认证主体隔离；不能信任客户端自报账户，不记录 API Key。
2. 将 put/remove/clear 作为显式操作。不存在于限长列表不代表删除。统一使用现有 URL 规范化与合法 URL 检查，保存服务端版本与墓碑，不依赖客户端时钟。
3. 每次请求携带 expectedVersion、epoch、operationId 与操作体；服务端事务中检查作用域、重复请求、版本并更新文档和幂等回执。重复的同一请求返回原提交版本及当前快照；相同 ID 的不同内容拒绝。版本冲突返回当前版本，不自动用旧快照重试，不盲目重放旧删除或旧新增。
4. 清空是显式集合级操作；新读/收藏必须基于清空后的版本。客户端在发送前持久化操作，收到明确回执再出队。账户或服务切换不得将旧队列提交到新作用域。
5. v1/v2 禁止混合无条件写入同一已迁移集合。服务端原子迁移、拒绝旧写入、回退和版本冲突提示须先落地；未协商成功保留现有 v1 行为并说明限制。不能擅自升级线上 payload 形状。
6. 墓碑与幂等回执的容量/保留期需要单独设计。不能简单按时间删除而接受更旧写入。可在确认备份及审计后通过 epoch 切换实现压缩；旧 epoch 请求全部拒绝并要求重建快照。服务端实际 1 MiB 限制、队列上限、事务及故障恢复需验收。

## 本地证据

参考模型 test/fixtures/synchub-deletion-model.ts 不被运行时导入。test/synchub-deletion-protocol.test.ts 六个测试分别覆盖：A07 的 v1 复现与 v2 旧写拒绝、重加后旧删除冲突、清空与离线设备、丢回执后重试与 ID 复用、跨账户/集合/epoch 拒绝、列表截断与不安全 URL。两个模拟客户端基于同一服务端内存模型取不同快照；不是两台真实设备或 SyncHub/PostgreSQL 集成验收。参考模型没有实现服务端持久化、容量治理、HTTP 传输或客户端队列 UI。

本地专项 13/13（含原合并测试）、Node/Web/Electron 类型检查通过。原生产合并、同步服务、认证与存储未改变。

## 阻塞与交付顺序

先在 SyncHub 单独实现 v2 capability、数据库 CAS/事务回执、认证作用域、迁移与旧客户端写屏障，并在隔离 PostgreSQL 验证；再为 LatestNews 实现持久队列、协议协商及冲突处理，使用两套隔离客户端验证离线恢复、账户切换、升级和回退。未获得外部服务改造与部署授权前，不声称 A07 运行时修复或 N2-D 通过。
