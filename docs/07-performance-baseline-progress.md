# 性能基线实施记录

日期：2026-10-18。主计划：[性能、新闻源扩展与插件化计划](02-performance-sources-platform-plan.md)。

## F0：0.6.0 验收、CI 与前置条件核对

- 当前已发布版本为 `v0.6.1`，标签提交 `93dfe43`，发布日期为 2026-10-17。F0 核对起点为主线提交 `fb3d63c57a2dcfa8fb8d04929b7063b46a0dc470`。该提交已包含标签之后的插件生命周期和 CI 修复。F1 报告会记录实际构建并测量的提交，不把结果归到 `v0.6.1` 发布标签。
- [多平台实施记录](01-web-electron-plan.md) 保留未关闭验收项：D3 的真实认证和 SyncHub 流程仍需可用的测试服务；D5 的 Windows 任务栏图标、macOS/Linux 真实窗口和安装升级仍需相应设备。它们不阻塞本地、离线性能基准。
- `.github/workflows/electron-desktop.yml` 在 Pull Request 和 `main` 上执行 lint、类型检查、测试、Web/Electron 构建和 Windows 安装包检查。提交 `fb3d63c` 的 [Electron desktop #17](https://github.com/bruceblink/LatestNews/actions/runs/39112369146) 全部通过。
- `.github/workflows/release.yml` 在版本标签上验证源码，再构建六个平台桌面包、Web 包和 Docker 镜像；`.github/workflows/nightly.yml` 执行项目检查和 Docker 镜像构建。当前 CI 没有性能预算回归。
- 仓库没有性能基准命令或已冻结的性能数据。计划没有为性能阶段分配具体人员；本记录将执行责任留给仓库维护者。公网源站、认证服务和其他操作系统设备是后续验收的外部前置条件。
- 本机基准环境：Windows 11 专业工作站版 `10.0.26300`、AMD Ryzen 9 5900X、12 核/24 逻辑处理器、47.9 GiB 内存、Node `v24.15.0`、pnpm `10.30.3`。实际性能报告仍须记录基准开始时的提交、样本数、并发、缓存状态和启动时间。

F0 已完成。F1 的 Node 生产 API 缓存命中基准已实现；默认 1,000 样本实测待提交后运行。Web 浏览器、Electron 真实窗口、冷缓存、部分缺失缓存、旧缓存和真实新闻源采样仍保持未完成，不能由本切片的 API 数据替代。

## F1：Node API 基准切片计划

### 范围

- 增加仅供本地基准使用的 30 个静态插件来源。插件不加入正式目录，不访问网络，也不默认启用。
- 基准命令构建并启动 Node 生产产物。服务使用临时工作目录、临时 SQLite 数据和临时插件存储；所有临时资源在退出时清理。
- 基准构建设置 `LATESTNEWS_SKIP_FAVICON_FETCH=true`，沿用仓库已有图标，不向图标服务发出公网请求。
- 预热插件来源后，测量单源 API 及 10/30 个来源批量 API 的缓存命中路径。默认每种场景至少发送 1,000 个请求，并记录预热次数。
- 报告记录 p50/p95/p99、吞吐、错误率、解码后响应大小、缓存响应状态、服务启动时间、服务进程 CPU/RSS、操作系统、处理器、Node/pnpm 版本和 Git 提交。
- 服务进程 CPU/RSS 每 250 ms 采样一次，时间范围从进程启动到停止，包含启动、缓存预热和三个 API 场景；这些资源指标不按 API 场景拆分。
- 目标地址只允许 `localhost`、`127.0.0.1` 或 `::1`。运行不得访问公网，也不得读取用户凭据。

### 验收

- 小样本冒烟可启动生产 Node 服务，验证三个单源/批量场景，并自动清理子进程、临时数据库和插件目录。
- 完整命令按冻结配置执行 1,000 个样本；响应必须有效，缓存状态可识别，错误率与响应字节数有报告。
- 基准 JSON 默认写入被 Git 忽略的 `.data/performance/`，不把本机结果混入应用发布产物。
- 插件样例通过清单验证和离线回放；项目 lint、Node/Web 类型检查及相关测试通过。

### 验证命令

`pnpm crawler validate crawler-platform/examples/performance`、`pnpm crawler test crawler-platform/examples/performance`、`pnpm performance:baseline -- --samples 10 --concurrency 2`、`pnpm lint:check`、`pnpm typecheck`、`pnpm typecheck:electron`、`pnpm test --run`、`git diff --check`。

交付后再运行默认 1,000 样本命令并保存本机报告。性能数值只代表记录中的提交、硬件、操作系统、运行版本、缓存状态和并发配置。

### 回退边界

本切片新增基准脚本、离线样例、npm 命令、测试工具对空 HTTP 回放的支持和本记录。`scripts/favicon.ts` 只在明确设置 `LATESTNEWS_SKIP_FAVICON_FETCH=true` 时跳过图标下载；默认构建行为不变。上述改动不改变生产 API、插件默认状态、数据库格式、部署流程或发布门禁。需要回退时，删除基准文件和命令，并撤销这两个测试/构建辅助选项即可。
