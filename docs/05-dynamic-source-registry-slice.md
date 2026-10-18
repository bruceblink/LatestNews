# 动态来源目录实施切片

日期：2026-10-18。关联计划：[性能、新闻源扩展与插件化计划](02-performance-sources-platform-plan.md)、[插件平台调研](03-crawler-plugin-platform-research.md)。

## 范围

- 定义动态来源 ID：`ext.<plugin-id>.<channel-id>`。宿主只接受清单中声明、前缀与插件 ID 匹配且通过长度和字符校验的 ID。
- Node 宿主从已启用插件清单产生运行时来源目录。Electron 宿主通过受信任 IPC 返回本机启用插件的来源描述。
- 来源发现 API 返回内置源和插件源的合并目录。单源、详情、批量和 Feed 请求使用同一动态目录解析来源。
- Web 和 Electron renderer 在加载路由前合并已验证的来源目录。动态来源可以搜索、关注、渲染、打开详情、进入 Feed、历史与同步数据。
- 保持现有静态 `SourceID`、文章 URL 哈希、旧 API 和未启用插件时的内置 getter 行为。

## 验收条件

- 使用固定 JSON/RSS 插件可新增两个无静态 `sources.json` 条目的来源。
- Node API 的来源发现、详情、单源、批量和 Feed 返回这些来源；未知、重复、错误命名空间 ID 被拒绝。
- Web 和 Electron 共用界面都可显示动态来源；用户可关注、取消关注、查看详情和 Feed；来源 ID 写入阅读历史后可正确显示名称。
- Electron 本地插件列表只接受已验证的 ID 和清单；渲染器不能提交插件路径或命令；本地失败仍回退远程 API。
- Pages 构建仍使用无 Node 插件宿主适配器，且不包含 Node 子进程代码。
- 现有来源 ID、URL 哈希、默认关注项、Feed 缓存键和旧 API 回归测试通过。

## 验证命令

`pnpm lint:check`、`pnpm typecheck`、`pnpm typecheck:electron`、`pnpm test --run`、`pnpm build`、`CF_PAGES=1 pnpm build`、`pnpm electron:build`、`pnpm test:crawler:electron`、`pnpm test:crawler:docker`。动态 ID、来源目录合并、单源/批量解析和 renderer 注册另加固定测试。

## 回退边界

通过清除 Node 插件启用配置和 Electron `enabled.json` 停用插件。运行时目录不再返回插件频道；内置来源清单、getter、缓存键、收藏和历史记录保持原值。若客户端目录更新失败，客户端继续使用内置目录并显示明确错误。
