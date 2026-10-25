# 桌面远端到本地采集回退

日期：2026-10-24。基线：203e6c6。本切片实现桌面端在远端新闻 API 不可用或未配置时读取本地采集插件。

## 行为

- 配置远端地址时，单源、条目和批量读取优先请求远端。
- 远端连接失败、超时或返回 5xx 时，只对已启用且获得信任的本地来源执行回退。
- 401、403、429 和普通成功响应不触发本地回退。合法空结果保持为空，不由本地结果覆盖。
- 远端批量响应遗漏某个本地来源时，只为该来源补取本地数据，远端已返回的来源保持不变。
- 设置面板允许保存空地址。空地址写入 url 为 null 的配置，桌面端进入仅本地模式。
- 仅本地模式下，已支持来源直接读取插件；不支持的来源返回明确错误，不发起远端请求。
- 主进程在仅本地模式下不再代理新闻 API 请求。认证 API 和 SyncHub 路径保持独立。
- 本地持久缓存和插件采集失败时的缓存回退见 [桌面本地采集持久缓存](14-desktop-persistent-crawler-cache.md)。

## 实现

- electron/news-api-storage.ts：解析和序列化空地址配置。
- electron/api-proxy.ts：新闻目标可以为空；为空时拒绝新闻代理，认证代理不受影响。
- electron/main.ts：保存空地址后关闭新闻代理；设置 IPC 返回空字符串。
- src/components/settings/settings-panel.tsx：允许保存空地址并说明仅本地模式。
- src/services/source.service.ts：单源、条目和批量读取改为远端优先；按错误状态决定是否本地回退；缓存桌面新闻 API 配置。
- electron-e2e/settings.smoke.e2e.spec.ts：增加空地址保存和恢复默认流程。

## 验证结果

- pnpm test --run：72 个测试文件、355 个测试通过。
- src/services/source.service.test.ts：12 个测试覆盖远端优先、5xx 回退、401/403 不回退、空结果保留、仅本地模式、批量合并和动态来源回退。
- test/electron-news-api-storage.test.ts：5 个测试覆盖空配置解析和序列化。
- test/electron-api-proxy.test.ts：8 个测试覆盖新闻代理关闭和认证代理保留。
- pnpm test:e2e:web：4 个用例通过。
- pnpm test:e2e:electron：3 个用例通过，包含真实 Electron 设置面板保存空地址和恢复默认。
- pnpm lint:check、pnpm typecheck、pnpm typecheck:electron 和 pnpm electron:build 通过。

## 验收边界

- 持久缓存由后续独立切片增加，容量和失败回退规则见 [桌面本地采集持久缓存](14-desktop-persistent-crawler-cache.md)。
- 首批 Pcbeta、FreeBuf、稀土掘金和 Hacker News 四个适配器已随安装包预置，首次安装及已有配置规则见 [插件预置记录](16-desktop-builtin-plugin-plan.md)。
- 来源健康和洞察接口仍以远端为主，仅本地模式下会显示不可用。Feed 和来源条目读取已支持回退。
- Electron E2E 验证设置与配置 IPC，不替代真实窗口中的插件采集、断网恢复和长期后台刷新验收。
- 远端地址为空的配置只适用于桌面构建，不改变 Web 同源或自托管边缘节点行为。

## 回退边界

恢复空地址校验和原本地优先路由，并移除回退错误分类与 E2E 用例即可回退。不改变来源 ID、插件包格式、缓存格式或远端 API 响应结构。
