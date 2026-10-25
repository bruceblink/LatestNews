# F5-A 采样窗口校验与记录追溯

日期：2026-10-24。基线：`main` 的 `b39cfc1`。本切片承接 [后续开发计划](08-next-development-plan.md) 的 7 天公网采样要求。

## 范围

- 质量判定同时检查样本数和实际观察跨度。默认跨度为 7 天，样本数保持 96。
- JSONL 读取校验状态、采集方式、时间、数量和可选指标，保留旧格式读取能力。
- 报告支持按目标地址和带时区的起止时间筛选；没有样本时仍展示指定地址的重点源。
- 新采样记录保存运行 ID、开始时间、Git 提交、工作区状态、Node 版本、轮次和间隔。报告列出运行信息及缺少追溯信息的样本数。Git 提交表示采样工具版本，不表示远端部署版本。
- 使用用户指定的 `https://news.likanug.top` 执行一轮低频公网采样，单独记录结果；实际观察满 7 天后才能复核长期阈值。

## 验收条件

- 样本数量达标但跨度不足时，结果为 `insufficient-data`。跨度恰好 7 天且其他指标达标时，结果为 `passing`。
- 时间筛选包含两个端点；不同地址和筛选范围之外的记录不影响当前窗口。未来样本默认不计入报告。
- 非法状态、负数、无效可选字段和非法运行信息带 JSONL 行号报错；旧记录可读取并明确标注缺少追溯信息。
- 采样与报告命令支持现有参数和帮助；首轮真实采样不得表述为 7 天验收通过。

## 验证命令

- `pnpm exec vitest -c vitest.config.ts run test/source-quality-sampling.test.ts test/source-quality-window.test.ts test/source-quality-policy.test.ts test/source-quality-records.test.ts test/source-quality-commands.test.ts`
- `pnpm lint:check`
- `pnpm typecheck`
- `pnpm typecheck:electron`
- `pnpm test --run`
- `LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build`（PowerShell 使用环境变量赋值）
- `pnpm source-quality:sample -- --help` 和 `pnpm source-quality:report -- --help`

本切片不改变用户界面，真实窗口验收不适用。没有新增外部服务集成，Docker 集成验收不适用。公网采样属于观察记录，不能替代本地代码测试。

## 回退边界

撤回新增的窗口字段、JSONL 校验、运行信息和命令参数即可回退。保留已经生成的 JSONL 原始记录；不改变来源 ID、生产 API、缓存和桌面配置。

## 交付记录

- 定向测试：5 个文件、37 个测试通过。全套测试：71 个文件、344 个测试通过。
- `pnpm lint:check`、`pnpm typecheck`、`pnpm typecheck:electron` 和跳过图标下载的 `pnpm build` 通过。
- 首轮公网采样在 2026-10-24 17:59（UTC+08:00）执行。目标为用户指定的 `https://news.likanug.top`，10 个来源接口全部返回 HTTP 500。记录的运行 ID 为 `a6068c34-5389-4c60-a2d8-d601f63e6f80`，工具提交为 `b39cfc1943bdce4d8c2966b6477c25cf3f588900`，工作区包含本切片尚未提交的修改。
- 原始记录：`.data/source-quality/news-likanug-top-2026-10-24.jsonl`。报告：`.data/source-quality/news-likanug-top-2026-10-24-report.json`。两者均由 Git 忽略，不保存响应正文或认证信息。
- 首轮报告的 10 个来源均为 `insufficient-data`。此结果不证明源站失败，也不代表 7 天验收通过。
- 补充只读检查：首页和 OpenAPI 返回 200；来源目录、来源健康、部署健康及旧来源 ID 接口返回未处理的 500。远端部署日志不可见，尚不能确定远端根因。

### 2026-10-25 第二轮观察

- 部署修复并确认来源接口恢复后，已启动新的 7 天低频观察。运行 ID 为 `2bb5df91-8c5e-4325-8369-ffaaa303878a`，目标为 `https://news.likanug.top`，计划 673 轮、间隔 15 分钟、单次超时 20 秒。
- 工具提交为 `f10a813f9584c9db53942e11e7c2a0cfdd2db9f0`，开始时工作区干净，Node 为 `v24.15.0`。启动时间为 2026-10-25 09:18（UTC+08:00）。
- 首轮 10 个来源中 7 个成功；FreeBuf、Hacker News 和 Bilibili 热搜接口报错。此结果不代表 7 天验收通过。
- 截至 2026-10-25 09:34（UTC+08:00），已完成 2/673 轮，共 20 条记录。两轮均有 7 个来源成功、3 个来源失败，累计 14 条成功、6 条失败。第 2 轮中 FreeBuf、Hacker News 和 Bilibili 热搜返回 HTTP 500。观察窗口仍在运行。
- 原始记录与日志分别为 `.data/source-quality/news-likanug-top-window-2026-10-25.jsonl` 和 `.data/source-quality/news-likanug-top-window-2026-10-25.log`，均由 Git 忽略。采样仍在运行。

## 运行说明

在稳定的运行环境执行低频采样；当前 7 天任务已运行，完成后再生成窗口报告：

```bash
pnpm source-quality:sample -- --origin https://news.likanug.top --samples 673 --output .data/source-quality/news-likanug-top-window.jsonl
pnpm source-quality:report -- --input .data/source-quality/news-likanug-top-window.jsonl --origin https://news.likanug.top --from 2026-10-25T09:18:58+08:00
```

默认轮次间隔为 15 分钟，673 轮包含 672 次等待，实际跨度至少 7 天。命令需要稳定在线的运行环境。报告中的 `commit` 仅描述采样工具，远端部署版本需单独记录。
