# Web 与桌面安装指引更新

基线：`v0.7.0`。本次更新版本：`0.7.1`。

## 范围

- README 按在线使用、浏览器应用、桌面安装和源码开发组织内容。
- 菜单新增统一的“安装与下载”面板。通过桌面客户端、浏览器应用两个页签提供安装步骤。手机浏览器默认选中浏览器应用。
- 浏览器原生安装事件只在 Web 端使用。区分可安装、已安装、等待用户选择和请求失败。
- Web 随网站部署更新；桌面安装包由后续 Release 提供。

## 验收条件

- Windows、macOS 和 Linux 的文件类型与仓库打包配置一致，不硬编码尚未发布的文件地址。
- Chrome、Edge、Android 和 iPhone/iPad 用户能找到对应安装步骤。桌面端显示当前版本与更新入口。
- 安装面板可从鼠标、触屏和键盘打开，可以关闭并恢复焦点。窄屏没有横向溢出。
- PWA 安装取消或失败后不产生未处理错误；已安装状态不继续显示安装操作。
- README 区分浏览器缓存与桌面本地采集。离线缓存不表示可以离线抓取新新闻。

## 验证命令

- `pnpm lint:check`
- `pnpm typecheck`
- `pnpm typecheck:electron`
- `pnpm test --run`
- `pnpm build:pages`
- `pnpm electron:build`
- 定向 Web 安装交互与 Electron 安装面板检查。
- Computer Use 真实窗口检查，以及桌面和移动尺寸的 Playwright 截图。

本次未接入外部服务。Docker 集成验证：不适用。浏览器安装步骤参照 Google、Microsoft 和 Apple 官方帮助。

## 实施与验证记录

- README 补充 Web / PWA / Electron 使用方式、六种桌面系统与架构的文件名、首次配置和更新步骤，修正 Vite 与开发环境要求。
- 安装入口指向 `releases/latest`，文件类型与 `electron-builder.yml` 一致，不依赖尚未发布的 `0.7.1` 安装包。
- Web 安装交互：8 个用例通过，包含键盘打开、页签切换、关闭后焦点恢复、375 像素宽触屏、PWA 安装确认、取消、失败与已安装状态。安装事件由测试代码模拟，未实际安装 PWA。
- Electron 安装面板交互：1 个定向用例通过。首次使用依赖声明的 Electron 44.9.0 时，本机二进制缺失，自动下载报 `fetch failed`。随后使用已缓存且与发布打包配置一致的 Electron 44.8.0 验证，面板显示当前源码版本，且不提供 PWA 安装操作。
- `pnpm lint:check`、Web / Electron 类型检查和 408 项单元测试通过。Pages 与 Electron 构建通过。
- Web E2E 的 8 项安装与页面检查通过，包括桌面键盘操作、移动触屏、PWA 安装确认 / 取消 / 失败和已安装状态。Electron E2E 的桌面更新面板检查通过。
- Playwright 截图覆盖 1440 × 1000 与 390 × 844、深色与浅色主题。页面标题正确，无未处理 JavaScript 异常和横向溢出。截图使用本地 API 测试数据，不证明公网采集状态。
- Pages 输出检查会用无效来源 ID 验证错误处理；输出中出现对应的 HTTP 400，随后验证脚本以成功状态结束。
- Electron E2E 使用本机缓存的 Electron 44.8.0 运行；`package.json` 声明 44.9.0，当前机器缺少该版本的二进制，下载失败。Electron 构建本身通过。
- 本会话没有 Browser 插件。Computer Use 已尝试真实窗口及恢复：Firefox 窗口处于最小化状态，恢复时报告用户输入；重新观察仍为最小化。独立可见 Chromium 启动报 `spawn UNKNOWN`，独立 Electron 窗口未保持可用。因此真实窗口人工操作验收未完成，当前界面证据来自 Playwright；不把该证据写成已完成真实窗口验收。
- 本切片未发布 Release，也未部署 Web。Web 可在后续部署时独立更新。

## 回退边界

撤回本次版本号、README、菜单入口和安装面板即可回退。不改变采集、缓存、登录、同步和发布流水线。
