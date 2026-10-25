# 桌面菜单与独立包启动修复

日期：2026-10-25。范围：Windows 原生菜单栏，以及本次桌面预置功能引入的打包依赖遗漏。

## 行为与根因

- 主窗口和登录窗口均移除窗口菜单并关闭菜单栏可见性。应用级菜单仍为空，按 Alt 不重新显示菜单栏。
- `electron-vite` 原本把 `zod` 保留为主进程的外部依赖，独立桌面清单却没有运行时依赖。因此源码目录启动成功不能证明安装包可用；独立包启动时出现 `Cannot find module 'zod'`。
- 主进程构建设置 `externalizeDeps: false`，将第三方代码编译进主进程包。Electron 和 Node 内置模块继续由运行时提供。
- 准备桌面清单前，以 TypeScript 语法树检查 main/preload 及嵌套代码块中的固定 `require`、动态导入和 ESM 导入，拒绝遗漏的外部包。此检查不分析任意计算得到的模块名。
- Electron E2E 增加打包程序模式，直接启动 `release/win-unpacked/LatestNews.exe`，不再依赖源码目录中的 `node_modules` 解析外部包。

## 验证

- Windows x64 目录包重新生成，Electron 运行时为本机缓存的 44.8.0。
- 打包程序 E2E：5 个用例通过，覆盖菜单为空、Alt 后仍不可见、预置来源发现、设置读取、保存、恢复和仅本地模式。
- 额外读取打包程序状态：`app.isPackaged === true`、`Menu.getApplicationMenu() === null`，窗口 `menuVisible === false`，`autoHide === true`；四个本地来源均可发现。
- 依赖检查测试：允许 Electron/Node 和本地文件；拒绝 `require("zod")` 和嵌套 preload 中的 `zod/v4` 导入。
- 2026-10-25，Computer Use 打开隔离目录包 `.data/electron-validation/source-health-20261025-0938/win-unpacked/LatestNews.exe`。首页正常显示，未出现 `Cannot find module 'zod'`。Windows 标题栏下方没有 File/Edit 原生菜单栏。
- 同一隔离用户目录中，托盘选项初始为关闭。启用后按 Alt+F4，窗口隐藏且 Electron 进程仍运行。再次启动同一程序后，原窗口恢复。停用托盘选项并关闭窗口后，Electron 进程退出；用户目录中的偏好恢复为关闭。
- 本次没有实际点击系统托盘上下文菜单。Computer Use 窗口清单不包含任务栏和托盘通知区，因此“立即刷新本地来源”和“退出”菜单项的原生点击行为仍未验证。
- 没有新增外部服务。Docker 集成测试：不适用。

## 复验命令

```powershell
$env:LATESTNEWS_ELECTRON_EXECUTABLE=(Resolve-Path release/win-unpacked/LatestNews.exe).Path
$env:LATESTNEWS_ELECTRON_PACKAGED_TEST='1'
pnpm test:e2e:electron
```

菜单修复可独立回退。依赖打包和构建校验应成组保留，否则独立程序可能再次缺少 `zod`。本轮未创建安装程序、替换已安装版本或发布 Release。

后续远端验证：源码修复 `85456c9` 和菜单修复 `f35492b` 已推送；聚合提交 `9a181c4` 的 Windows 桌面 CI 已生成安装程序，Web/Electron E2E 同时通过，运行编号见 [Docker 修复远端记录](18-docker-native-dependency-fix.md)。本次真实窗口检查使用本地隔离目录包，没有安装 CI 产物。
