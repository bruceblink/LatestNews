# 桌面内置插件预置计划

日期：2026-10-25。基线：`main` 的 `8614166`。

## 范围

承接未完成的插件预置代码。Electron 构建使用现有插件打包器生成 Pcbeta、FreeBuf、掘金和 Hacker News 四个已审核包。开发构建和安装包携带相同的插件资源。主进程在创建采集运行时之前，校验资源并安装到 `userData/crawler-plugins`。

## 验收条件

- 全新配置安装并启用四个包；重复启动不改写已有包。
- 已有目录只补缺失包，不覆盖版本、固定版本或启用设置；显式指定的外部插件目录由用户维护。
- 缺少资源、摘要不符或包身份不符时不发布全新目录，远端阅读仍可启动。
- 安装包包含独立的 `manifest.json`、`artifact.json` 和 `plugin.mjs`，资源不依赖源码目录。
- Windows 程序目录与 `userData` 位于不同磁盘时仍可安装；同目录及相互包含的目录仍被拒绝。
- 验证真实 Electron 进程能发现预置来源；真实窗口验收单独记录。

## 验证命令

- `pnpm exec vitest -c vitest.config.ts run test/electron-crawler-seeder.test.ts test/electron-crawler-provider.test.ts`
- `pnpm check`、`pnpm typecheck:electron`、`pnpm electron:build`
- `pnpm test:e2e:electron`、Windows 目录打包及资源摘要核验

此切片不接入新的外部服务。外部依赖集成测试：不适用。

## 实施与验证记录

- 构建资源由固定清单驱动，输出到 `out/crawler-platform/builtin-plugins`。electron-builder 把资源放在 `app.asar` 外，四个包的脚本与清单 SHA-256 均与各自 `artifact.json` 一致。
- 全新目录先在同磁盘临时目录安装完整集合，再重命名发布；已有目录只补缺失包，保留用户选择和固定版本。资源损坏或身份不符会在写用户目录前被拒绝。
- 修复插件安装器的跨磁盘判断：Windows 的 `relative` 可返回绝对路径，不能把这种结果当成父子目录。测试同时确认相同目录和包含关系继续拒绝。
- 预置测试 8 个、provider 测试 3 个通过；完整 `pnpm check` 为 76 文件、373 个测试通过，Electron 类型检查通过。
- `pnpm electron:build` 与 Windows x64 目录打包通过；打包程序 E2E 为 5 个用例通过，临时用户目录启用并发现四个来源。未使用公网内容证明离线采集成功。
- 独立包遗漏 `zod` 的启动问题、菜单修复和 Windows 真实窗口复验见 [独立记录](17-desktop-menu-package-fix.md)。系统托盘上下文菜单的原生点击仍未验证。

## 回退边界

移除构建命令、额外资源和启动预置调用即可回退。已安装插件继续使用既有版本化包格式，不删除用户数据。托盘后台、独立模式选择和长期公网采样按各自计划继续。
