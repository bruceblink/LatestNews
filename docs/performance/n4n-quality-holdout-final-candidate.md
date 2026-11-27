# N4-N：最终候选修订与人工准入交接

状态：`blocked-draft`，不是正式批准的 holdout。基于证据补验 PR #49 合并提交 `bf61b325b56916b45c9480bbbe654953a6b97a77`。本轮结束已知高风险样本修订及离线交接工具开发。后续需要真实维护者与独立审核人参与，不能通过自动化代码代填声明或完成质量评分。

## 1. 最小候选修订

保持 2026-11-25T12:00:15.000793Z 截止时间，保留 103 篇、48 条查询。原 V1、V2、扩充数据、冻结和补验观测均不变。具体隔离原因和新增响应指纹固定在 [revision fixture](../../test/fixtures/news-quality-holdout-final-revision.json)。

| 隔离 ID | 理由 |
| --- | --- |
| candidate-019、candidate-022 | 当前发布时间及标题与原冻结记录不同，属于会更新的礼物指南；历史版本不足 |
| candidate-020 | 当前报道标题描述的动作阶段已变化，无法取得截止时的固定版本 |
| candidate-060 | 两轮原文访问未成功；HN 讨论和 item 元数据不替代原文 |

新增四篇中文候选，均在截止时间前有出版记录；2026-11-27 06:31:13–06:31:15 UTC 实际获取当前页面，HTTP 200，保留响应字节数、SHA-256、最终 URL、标题和时间字段。未保存页面全文，不声称是截止时的原始内容。

| ID | 来源与主题 | 发布时间依据 |
| --- | --- | --- |
| final-zh-001 | [IT之家：Debian 13](https://www.ithome.com/0/874/345.htm) | 页面 pubtime_baidu，2025-08-10 16:05:31 |
| final-zh-002 | [IT之家：Fedora 42](https://www.ithome.com/0/845/556.htm) | 页面 pubtime_baidu，2025-04-16 08:51:23 |
| final-zh-003 | [腾讯云开发者社区：Debian 13.4](https://developer.cloud.tencent.com/article/2644977) | 嵌入 publishTime=1774351332，2026-03-24T11:22:12Z |
| final-zh-004 | [香港01：华为案件报道](https://global.hk01.com/%E5%8D%B3%E6%97%B6%E5%9B%BD%E9%99%85/60414681/%E5%8D%8E%E4%B8%BA%E9%81%AD%E7%BE%8E%E5%9B%BD%E6%B3%95%E9%99%A2%E8%A3%81%E5%AE%9A10%E9%A1%B9%E7%BD%AA%E5%90%8D%E6%88%90%E7%AB%8B-%E6%B6%89%E9%9A%90%E7%9E%92%E4%BC%8A%E9%83%8E%E4%B8%9A%E5%8A%A1%E5%92%8C%E7%AA%83%E5%8F%96%E5%95%86%E4%B8%9A%E6%9C%BA%E5%AF%86) | article:published_time=2026-11-25T02:53:14.000Z |

两个 IT之家页面按 UTC+8 解释当地时间，这是显式待核验假设。香港01 使用明确出版时间 metadata，而非文章更新时刻。新 ID hk01 只是离线采集来源标识，未加入生产源。补充报道提供跨语言版本候选和同版本系列难例，不预标同事件、相关集或无答案。

## 2. 构建结果与覆盖

| 指标 | 上一冻结 | 本次修订 |
| --- | ---: | ---: |
| 报道 / 查询 | 103 / 48 | 103 / 48 |
| 中文 / 英文 | 34 / 69 | 38 / 65 |
| 中文比例 | 33.0% | 36.9% |
| Daily 中文 / 英文 | 17 / 30 | 18 / 27 |
| Release 中文 / 英文 | 11 / 25 | 14 / 25 |
| Security 中文 / 英文 | 6 / 14 | 6 / 13 |
| 采集来源标识 | 9 | 10 |
| 原文有当前访问证据 | 102 / 103（补验后） | 103 / 103 |
| 原始 RSS 响应未保留 | 39 | 36 |

查询仍为 4 个纯中文、19 个混合、25 个拉丁字符，未增删查询。达到建议的样本总量和中文数量比例；不表示语言、事件或来源代表性已证明。HN 44/103（42.7%）、Solidot 22/103（21.4%）仍然集中；release/security 既有采样结构和真实跨语言正例支持仍需检查。旧 73 篇及 36 查询的精确 URL/标题/查询 guard 和已观察的原文跳转 URL 比对均通过；不等于底层事件语义独立性通过。

## 3. 确定性冻结与交接

```sh
node scripts/performance/holdout-final-candidate.mjs freeze . /tmp/latestnews-final-candidate
node scripts/performance/holdout-final-candidate.mjs verify . /tmp/latestnews-final-candidate
node scripts/performance/holdout-final-candidate.mjs inspect-review . /tmp/latestnews-final-candidate /tmp/latestnews-final-candidate/admission-review.blank.json
```

输出目录必须不存在。新工具复用 PR #48/#49 的已固定输入验证和补验视图；固定本次 revision plan SHA-256，拒绝输入漂移、未知隔离理由、日期不匹配、重复或冲突 URL、仍不可访问的保留原文。私有输出包括 candidate.json、maintainer-manifest.json、freeze.json、admission-review.blank.json。verify 从原固定输入重建并逐字节比较四文件；不修改上一轮冻结，也不认可旧摘要的审核文件。该机制是内容一致性验证，不是签名、WORM 存储或可信人工身份认证。

- revision plan SHA-256：`538dc8d55bb260e591f650b7dc664af3b188122d3c54392a543f87ac343684a5`
- candidate SHA-256：`26d9e51a2c428a3324f57fc5086aa4042648f989b0dbcdb5309ec9419a2c7d4b`
- freeze SHA-256：`4c2b67123b688264d24c393faad9554e28b800c4821af5b1f1187741ee39addc`
- 隔离结构测试包 packet digest：`fa474c3c07827f25655337bf0ce327d87fbf85d07a7325e86acd071bf0010ebd`

原冻结摘要仍为 94eaf6d6da3b6fde4ac29da679fbaa364373d0f0769a7e71a51b946b525680dc。新的候选不是旧冻结的原地覆盖。两份测试包的审核文件不可混用。

## 4. 正式人工准入和盲审（硬门槛）

当前 362 项维护者核验为 0 resolved、362 pending。自动化工具不代填。本轮仍存在以下非代码阻塞：

- 36 篇保留报道的历史 RSS 原始响应未保存；必须由维护者明确历史证据接受标准，核查替代证据，或排除不能满足标准的样本。现行页面不能重建过去的响应。
- 22 条 Solidot 页面分钟时间、IT之家等本地时间假设、其他未确认发布时间，以及历史原文变化必须复核。
- 新旧底层事件独立性及同一意图改写关联，需要真实人工按原文核查。此前的标题级线索仅用于优先级。
- 候选是否接触规则调整需要实际维护者确认；来源集中、跨语言同事件、同实体难例、潜在无答案覆盖由维护者明确接受或要求修订。

复制空白维护者清单至冻结目录外，记录真实维护者标识、每项决策、理由与证据引用；inspect-review 只检验声明完整性，即使所有项 resolved 仍需明确独立准入决定。禁止将维护者文件、筛查记录及预测交给两名盲审者。获得真实准入批准后才运行现有 `pnpm performance:quality-review prepare-holdout /tmp/latestnews-final-candidate/candidate.json /tmp/latestnews-final-review` 并分发同一 packet 与各自空白审核文件。两位真实审核人员独立填写完整记录，第三方处理争议；没有真实共识标签时不得执行正式 score。保持 `automaticAdmission=false`，不启用自动事件归属、混合检索或改变生产权重。

## 5. 实际测试

Node 22.23.4 / pnpm 12.21.0：冻结锁文件安装、48 项 Node 测试（新增 9 项）、16 项 Python 离线测试、119 个 Vitest 文件 664 项通过；ESLint 与 Node/Web/Electron 类型检查通过。对新候选实际运行官方 prepare-holdout，仅核验结构、字段白名单和既有回归集精确重叠；两份审核文件保持空白，未执行 score，未生成独立人工标签。全量回归通过不等于质量 SLO 或生产准入。本次仅离线代码、数据、测试和文档变更。
