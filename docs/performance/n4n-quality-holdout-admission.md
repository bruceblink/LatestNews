# N4-N.4 候选保留集 V2：证据冻结与准入检查

状态：`blocked-draft`，不是正式准入。基于 PR #47 合并提交 `75040dc5721b58f2a486ef7c08a54aff3eb98d77`。候选仍为 103 篇、48 查询，原评测截止时间不变。不修改生产聚类、检索、索引、API 或评分策略。

## 实际证据访问

2026-11-27 05:59:56–06:03:45 UTC。对固定候选的原文、HN 讨论页、HN item 接口和版本专属 GitHub Release 接口进行只读访问。194 个必要的当前观测位置；初次采集后修复 HTML title 混入 SVG 导航标题的问题，对 candidate-018–024 重新采集 7 次，保留旧观测。总计 201 次，175 次获得响应内容及抽取元数据，25 次网络失败，1 次 HTTP 503。

| 最新观测角色 | 取得内容及元数据 | 未取得 |
| --- | ---: | ---: |
| 原文 | 98 / 103 | 5 |
| HN 讨论页 | 44 / 45 | 1 |
| HN item 接口 | 25 / 45 | 20 |
| GitHub Release API | 1 / 1 | 0 |

79 篇报道所有适用的当前观测角色均取得内容及元数据。25 条 HN item 身份、标题、原文 URL 和提交时间匹配候选，GitHub Release 身份及发布时间匹配 1 条。无当前规范 URL/已访问原文最终 URL 与旧集合或另一候选冲突；不代表事件语义独立性已确认。

当前检查发现：
- candidate-019、candidate-022：当前页面显式 publication meta 与原候选时间不同（分别是 2026-11-13 16:00Z / 2026-11-10 16:00Z，而原记录为 11-24）。页面标题也发生变化；可能是动态更新，需核对历史版本及 RSS 时间语义。
- candidate-020：当前标题与冻结标题的动作阶段不同；保留原样本，不用后来标题覆盖截止时的输入。
- candidate-057：原文为无 HTML 标题的文本记录，不据此判为无效。
- candidate-060、coverage-zh-79925、coverage-zh-82598、coverage-zh-84269、coverage-zh-74771：本轮原文访问未完成；candidate-058 讨论页 HTTP 503。另 20 条 HN item 接口超时或网络失败；部分条目有 N4-N.3 的旧观测。不能将当前失败视为历史链接无效，也不能用旧观测冒充本轮成功。
- 18 篇的当前页面只识别到分钟级本地时间，时区仍待确认；39 篇原 RSS 响应没有保留，未重新抓取新 RSS 冒充历史原始响应。12 篇当前页面未确认发布时间；另 4 篇非 HN 发布页访问未完成。
- 中文 34/103（33.0%）、来源集中及跨语言同事件正例数量仍不足以证明代表性。所有历史证据、事件语义独立性、调参接触记录待人工核验。

采集器限制固定候选 SHA-256、HTTPS、固定域名集合、有限重定向、每请求最多 2 MiB、8 秒 socket 超时及每请求起始域名最多 2 个并行访问；不是通用不可信 URL 抓取器。保留响应字节数、SHA-256、请求/最终 URL、状态、访问时间及有限的标题/时间/API 身份字段。没有存储完整响应正文或评论；响应摘要无法独立重建原始字节。HTTP 200 不证明原文真实性、历史内容一致性或相关性。修复后的 7 条观测仍需历史核查；其他观测保留第一次抽取结果，不宣称全部 HTML 均完成语义验证。

## 冻结与核验

在仓库根目录使用 Node 22：

```sh
node scripts/performance/holdout-admission.mjs freeze . /tmp/latestnews-holdout-freeze
node scripts/performance/holdout-admission.mjs verify . /tmp/latestnews-holdout-freeze
node scripts/performance/holdout-admission.mjs inspect-review . /tmp/latestnews-holdout-freeze /tmp/latestnews-holdout-freeze/admission-review.blank.json
```

目录必须为新目录；冻结包含 candidate.json、maintainer-manifest.json、current-evidence.json、readiness.json、freeze.json、admission-review.blank.json。锁定候选、上阶段维护清单和本轮观测文件的 SHA-256。verify 从锁定的仓库输入重新构建并逐字节比对全部六个文件，拒绝篡改后重算摘要、额外文件和符号链接。该机制是内容完整性检查，不是 WORM 存储、签名认证或抵抗具有仓库修改权限的对手的安全保证。六文件均属维护者资料，不分发给盲审者。

- 候选数据 SHA-256：`43fd4e225559996704ecc6fd504a152c7b4011325ca6b2ca2cdd5b90f5671c79`。
- 当前证据文件 SHA-256：`9215e597254f3f4b5b9e90e12e314cd228890fc98de5123015242e11aaa58010`。
- 冻结索引 SHA-256：`94eaf6d6da3b6fde4ac29da679fbaa364373d0f0769a7e71a51b946b525680dc`。

如需重新采集，在新目录构建上一阶段候选后显式执行 Python 3 标准库工具：

```sh
python3 scripts/performance/holdout-evidence-capture.py /path/to/pinned-candidate.json /tmp/new-current-evidence.json
```

新采集不应自动覆盖冻结输入；由维护者审查差异、重新固定摘要并产生新冻结版本。

## 人工准入仍单列

空白清单有 362 项：103 篇报道各 3 项（历史证据、时间、与旧集合的事件独立性），48 个查询各 1 项意图独立性，5 个全局门槛。真实维护者复制空白清单至冻结目录之外，记录各项 pending/resolved/blocked、依据及证据引用；inspect-review 检查冻结摘要、记录覆盖、ID 唯一性和声明完整性。全部 resolved 也只返回 awaiting-explicit-maintainer-decision，不会自动批准、创建正式包或评分。当前 0 项 resolved，362 项未解决。所有输出 automaticAdmission=false。维护者需处理上述证据问题、补足覆盖或明确记录例外，并确认候选未参与调参，再单独批准。正式审核人只获得现有工具输出的 packet 及各自空白 review，独立完成标注；不能获得维护者报告。

## 验证

Node 22.23.4 / pnpm 12.21.0：冻结锁文件安装、38 项 Node 测试（原 26、新 12）、7 项 Python 标准库测试（离线解析与请求边界）、119 个 Vitest 文件 664 项、ESLint、Node/Web/Electron 类型检查通过。官方 prepare-holdout 对冻结候选的隔离结构测试成功，packet digest `dd956a00c6b2d424395b4c79eab9f037cabef8aad077b3cbaf7c56caf9660285` 与 N4-N.3 相同。该包未分发、未准入；两份审核文件为空白，不执行 score，不新增正式人工标签。不更改生产策略。
