# Electron 采集模式切换计划

日期：2026-10-25。基线：`b25715f`。

## 范围

Electron 新闻读取增加 `auto`、`remote` 和 `local` 三种持久模式。`auto` 保留当前远端优先、网络错误或 5xx 回退本地的行为；`remote` 只读远端；`local` 只使用已启用的本地插件。数据源 API 地址与模式分开保存。旧配置没有模式字段时按 `auto` 读取。

本切片覆盖来源条目、批量、来源目录、来源详情和健康读取。仅本地模式不调用远端新闻代理。认证和 SyncHub 保持独立。远端模式未配置 API 地址时应拒绝保存并显示明确错误。仅本地模式下不支持的来源继续显示来源不可用；新闻洞察不伪装成已支持的本地功能。

## 验收条件

- 模式和 API origin 可保存、重启后可读；旧版 `{ url }` 配置继续按 `auto` 工作。
- `remote` 只请求远端，API 地址为空时拒绝保存；远端错误不会触发本地采集。
- `local` 不经新闻 API 代理发送请求；已启用插件、来源元数据和本地健康记录可用。
- `auto` 保留远端优先，网络错误或 5xx 可对受支持来源回退；401、403、429 和普通 4xx 不回退。
- 设置面板清楚说明三种模式，并在保存后刷新应用状态。安全 IPC 继续只接受可信主窗口。

## 验证命令

- `pnpm exec vitest -c vitest.config.ts run test/electron-news-api-storage.test.ts src/services/desktop-settings.service.test.ts src/services/source.service.test.ts test/electron-api-proxy.test.ts`
- `pnpm check` 和 `pnpm typecheck:electron`
- `pnpm electron:build` 和 `pnpm test:e2e:electron`
- Electron 设置页使用隔离配置分别验证三种模式；真实窗口证据单独记录。

本切片不增加外部服务。Docker 集成测试不适用。

## 实现与验证

- `shared/desktop-collection-mode.ts` 定义三种模式和统一校验。Electron 配置文件独立保存 API origin 与模式。旧版只有 `url` 字段的配置按 `auto` 读取。
- 设置面板可以保存 `auto`、`remote`、`local`。远端模式没有 API 地址时会显示错误并拒绝保存。本地模式保留已填写的 URL，但不设置新闻 API 代理目标。
- 来源条目、分页、批量、来源目录、详情和健康请求按所选模式路由。`local` 不发送远端新闻 API 请求；本地洞察明确返回不支持。动态来源元数据会合并到内置来源目录。
- 本地批量结果对未启用的来源返回来源级错误。成功的本地来源不会被标记成远端回退结果。
- `pnpm check`：通过，76 个测试文件、383 个测试通过。`pnpm typecheck:electron`：通过。
- `pnpm electron:build`：通过。4 个站点图标请求超时，构建使用已有默认图标。
- `pnpm test:e2e:electron`：通过，6 个测试覆盖菜单、插件预置、URL 设置和三种模式。E2E 使用隔离目录中的 Windows Electron 运行时，并装入本次构建的 `app.asar`。
- Windows 原生窗口检查：设置面板显示 API 地址和三种模式选项；原生标题栏下没有菜单栏。检查时没有保存或修改用户设置。
- ESLint 忽略 `.data/`，避免扫描采样记录和本地验收产生的数据文件。

## 回退边界

恢复 `auto` 默认路由和仅 URL 的配置即可回退。保留上一切片提供的来源目录、健康 IPC、插件和持久缓存，不迁移收藏、阅读记录或缓存格式。
