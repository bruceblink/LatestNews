# N5-A15 联邦响应边界验收（2026-11-26）

基线为主线提交 `1bdd322`。本切片只加固服务端读取已配置上游节点 `/api/v1/node` 的响应边界，不增加联邦端点，不改变上游地址校验、DNS 地址固定、鉴权头、禁止重定向、熔断或重试策略。

## 实现范围

- 响应体上限固定为 256 KiB。调用方不能通过请求参数扩大上限。
- 读取 `Content-Length` 后先拒绝已超过上限的响应，并取消其响应流。
- 对没有可靠长度的响应执行分块读取。累计字节超过上限时立即取消流并返回 `federation_manifest_invalid`。
- DNS 解析、建立连接、读取响应头和读取完整响应体共用原有 3 秒总期限。截止时间触发时发送 `AbortSignal`，同时取消标准 `ReadableStream` 读取器。
- Node pinned transport 在读取分块时再次执行长度检查。超限或取消会销毁响应和请求，避免继续收集字节。
- 重定向和非成功 HTTP 响应会取消未读取的响应体。超大响应不重试，连接错误和读取中断仍按原有暂时性失败策略处理。

## 本地验收

执行以下检查：

```text
pnpm exec vitest -c vitest.config.ts run test/upstream-node-client.test.ts
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec eslint server/utils/upstream-node-client.ts test/upstream-node-client.test.ts
```

17 项联邦客户端测试通过，覆盖合法清单、已声明超限、chunked 超限、慢响应截止时间与流取消、重定向、非 JSON、DNS 重绑定、重试、熔断和协议版本。`git diff --check` 通过。

## 未完成项

本轮未连接真实上游、目标 Pages、生产网络或真实 DNS。未据本地夹具推断生产带宽、连接回收时间或部署计费。目标宿主、真实上游负载和已配置 upstream 的部署仍需单独授权验收。
