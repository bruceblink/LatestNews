# F5 配置型 RSS/JSON 来源首轮实现

日期：2026-10-26。关联计划：[性能、新闻源扩展与插件化计划](02-performance-sources-platform-plan.md) 和 [后续开发计划](08-next-development-plan.md)。

## 范围与状态

Node 服务端现在可从环境变量读取运维维护的 RSS 与 JSON 来源清单。来源加入现有动态目录，由原有发现、详情、单源和批量 API 使用；不需要修改 Web 或 Electron renderer，也不需要重新打包客户端。配置默认关闭，变更后重启 Node 服务生效。

Cloudflare Pages 和 Vercel Edge 继续使用不含 Node DNS/HTTPS 适配器的运行时，不能启用任意 URL 配置源。Electron 的本地插件模式也不读取这份 Node 环境配置；Electron 若连接配置该清单的 Node API，则走现有远端来源目录。

本切片未执行公网采样。完整 F5 验收仍需继续检查 Node API 端到端、Web/Electron 远端目录兼容，以及配置部署和回退流程。

## 配置

通过服务端环境变量设置精确主机名白名单和版本化 JSON 清单：

```text
LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS=feeds.example.com,api.example.com
LATESTNEWS_CONFIGURED_SOURCES={"version":1,"sources":[...]}
```

清单最多 128 KiB、32 个来源。来源 ID 由 `key` 生成 `ext.config.<key>`；`key` 只能包含小写字母、数字、下划线和连字符。`intervalMs` 范围为 30 秒至 24 小时。可选 `column`、`title`、`description` 和 `home` 用于现有来源目录显示。

RSS 示例：

```json
{
  "key": "engineering-blog",
  "name": "Engineering Blog",
  "type": "rss",
  "endpoint": "https://feeds.example.com/engineering.xml",
  "enabled": true,
  "intervalMs": 900000,
  "column": "tech"
}
```

受限 JSON 映射示例：

```json
{
  "key": "engineering-api",
  "name": "Engineering API",
  "type": "json",
  "endpoint": "https://api.example.com/news",
  "enabled": true,
  "intervalMs": 900000,
  "column": "tech",
  "mapping": {
    "itemsPath": "data.items",
    "titlePath": "title",
    "urlPath": "url",
    "idPath": "id",
    "publishedAtPath": "publishedAt",
    "mobileUrlPath": "mobileUrl"
  }
}
```

JSON 路径最多八段，只读取对象自有属性；不支持脚本、模板、数组索引语法或原型属性。将条目的 `enabled` 设为 `false` 可从目录和请求入口停用该来源。

## 网络边界

- 只有精确白名单内的 HTTPS 主机名可用；不接受 IP 字面量、凭据、非默认端口或通配符白名单。
- Node 要求 A 记录全部为公网 IPv4，并固定首个地址直接连接，同时保留原主机的 TLS SNI 和 HTTP Host，避免连接阶段再次解析 DNS。当前不支持只有 IPv6 地址的来源。
- 最多跟随三次 HTTPS 重定向；每个目标都重新验证白名单、解析结果并固定地址。
- 请求不带用户认证、Cookie 或自定义配置头；单次响应上限为解压前 2 MiB、请求期限 12 秒，每个主机最多并发 2 个任务。
- RSS/JSON 输出最多保留 30 条；标题、URL、条目 ID 和时间字段有长度上限，文章链接只允许 HTTP/HTTPS，之后继续经过现有新闻条目校验和质量统计。
- 清单无效时，Node 记录错误并保持配置型来源关闭；静态来源与已启用的独立插件不受影响。

配置清单属于运维信任边界。不要把它暴露为匿名用户可写的 API，也不要把凭据写进来源 URL。

## 离线验证与回退

本地 fixture 注入 DNS 解析结果和 HTTP 响应，不连接公网：

```bash
./node_modules/.bin/vitest -c vitest.config.ts run server/configured-source-runtime.node.test.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json
./node_modules/.bin/eslint server/configured-source-runtime.node.ts server/configured-source-runtime.node.test.ts server/crawler-plugin-runtime.node.ts
```

测试覆盖 RSS/JSON 字段映射、动态目录描述、停用项、私网解析拒绝、非白名单重定向、危险 JSON 路径、错误响应形状和配置大小上限。回退时清空 `LATESTNEWS_CONFIGURED_SOURCES` 并重启 Node 服务；动态目录移除对应 ID，已保存文章仍保留原有数据。
