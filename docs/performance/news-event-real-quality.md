# N4-H 真实新闻事件聚类质量基线

## 数据与标签

基准代码：`4f8fed4`（N4-G 已合并）。2026-11-25 07:24:55 UTC 固定样本。数据文件为 [news-event-real-corpus.json](../../test/fixtures/news-event-real-corpus.json)，评测程序为 [news-event-evaluation.ts](../../scripts/performance/news-event-evaluation.ts)。

73 条报道记录、70 个不同的规范化原文 URL、43 个事件标签、6 个采集渠道。包括 14 条中文、59 条英文。采集入口为 [IT之家](https://www.ithome.com/rss/)、[Solidot](https://www.solidot.org/index.rss)、[The Verge](https://www.theverge.com/rss/index.xml)、[TechCrunch](https://techcrunch.com/feed/)、[Ars Technica](https://feeds.arstechnica.com/arstechnica/index) 的 RSS/Atom 和 [Hacker News Algolia](https://hn.algolia.com/api) 搜索。部分英文媒体条目来自真实的外部报道而非当前内置来源；47 条记录来自 HN。HN 标题、讨论 URL、原文 URL、提交时间和证据链接分别保留，RSS 保留标题、链接和发布时间。不保存正文；RSS 入口会更新，不能视为永久快照。原始标题保留报道本身的表述，不等于项目认可其事实判断。

标签状态是 `proposed`（助手初标，尚无独立人工审核）。按一次具体发布、公告、事故、产品动作或披露划分事件。相同产品或主题不等于同一事件；有关联的后续版本、缺陷报告、漏洞披露分开标注。例：

- [Kagi Mail 官方公告](https://blog.kagi.com/kagi-mail-public-beta)；不同语言报道指向同一次公开 beta。
- [Google 个性化 AI 频道专利](https://patentlyze.com/patent/google-ai-made-tv-channel-built-around-you/)（US20260370899A1）与 [Solidot 报道](https://www.solidot.org/story?sid=85973)；IT之家 RSS 描述引用同一申请号。标题中“获批”和“申请”并不意味着法律状态一致，本标签只对应同一被报道的专利申请。
- [Tidal AI Policy](https://support.tidal.com/hc/en-us/articles/48031883413521-AI-Policy)；同一次政策公告。
- [Rust 发布记录](https://blog.rust-lang.org/releases/)；不同版本和后续缺陷是不同事件。
- React RSC 的 [2025-12-03 公告](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components) 与 [2025-12-11 后续公告](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components) 属于不同披露；后续更新与原始披露的边界由报道时间及标题决定。

这些是定向选取的难例，不是随机生产流量。不能将指标外推为生产准确率。没有对全部原文逐篇独立核验；后续须复核事件标签、边界案例和来源时间，并另外建立未参与调参的保留集。

## 可复现评测

```bash
pnpm performance:news-events
pnpm performance:news-events > news-event-quality.json
pnpm performance:news-events /path/to/corpus.json
pnpm exec vitest -c vitest.config.ts run test/news-event-evaluation.test.ts test/news-insights.test.ts
```

离线评测直接调用生产 `collectInsightItems` 和 `createTopicEvents`。标签不传入生产聚类输入；评价使用唯一报道 ID 对照聚类成员，而不是将可能变化的事件哈希用作判断依据。各 cohort 独立评测：近期报道、版本发布、安全公告。令同一事件为正类，遍历每组所有无序配对（共 1038 对，59 正、979 负）。不同 cohort 不组成配对。分别执行每一对的独立聚类与 cohort 整组聚类。整组结果设置最小成员数 1、展示上限为输入记录数，以免默认展示截断污染聚类指标。报告顺序反转、错误样本 ID、同主题难例、跨来源、不同原文 URL 及中英文分层指标。Precision/Recall 的分母为零时输出 null，F1 按 2TP/(2TP+FP+FN) 计算。HN 提交时间不是发布时间；主模式使用已记录的时间；近期报道另运行 HN 不提供发布时间、使用快照时间的敏感性模式（并非实际 front page 回放）。

## 实测（Node 22.23.4 / pnpm 12.21.0）

| 分组 | 报道 | 标签事件 | 预测组 | TP | FP | FN | TN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 近期报道 | 39 | 25 | 26 | 18 | 2 | 5 | 716 | 90.00% | 78.26% | 83.72% |
| 软件发布 | 22 | 14 | 14 | 10 | 1 | 3 | 217 | 90.91% | 76.92% | 83.33% |
| 安全公告 | 12 | 4 | 6 | 16 | 0 | 7 | 43 | 100.00% | 69.57% | 82.05% |
| 全部整组聚类 | 73 | 43 | 46 | 44 | 3 | 15 | 976 | 93.62% | 74.58% | 83.02% |

- 独立配对：42 TP、8 FP、17 FN、971 TN；Precision 84.00%、Recall 71.19%、F1 77.06%。独立配对和整组聚类不能混用。
- 同主题难例：225 对（包括 59 正例），44 TP、3 FP、15 FN、163 TN。
- 跨来源：595 对（17 正例），13 TP、0 FP、4 FN；Precision 100%、Recall 76.47%。
- 排除相同原文规范化 URL 的配对：1035 对（56 正例），41 TP、3 FP、15 FN；Precision 93.18%、Recall 73.21%、F1 82.00%。
- 中英混合：350 对（8 正例），4 TP、0 FP、4 FN；Precision 100%、Recall 50%。只有 8 个跨语种正例，不宜据此设定质量 SLA。
- 32/43 个标签组与预测组完全一致；三个 cohort 的正反顺序配对判定相同。近期 HN 时间敏感性模式的整组指标与主模式相同。此结果不代表任意输入排列不变性或真实采集状态。
- N4-D 的 200 对合成数据仍保留。新增回归要求固定真实语料的整组 FP 不超过 3、FN 不超过 15，避免以一种错误掩盖另一种错误。

## 误差与对照试验

当前整组误合并集中于同公司、同技术领域但不同动作的新闻。漏合并集中于中英文表述差异、名称与版本格式差异、对事件不同特征的报道。下一轮优先研究实体别名和事件类型/版本约束，而不是仅提高文本相似度。必须使用新的人工复核保留集评估。

本轮候选变更：只在事件聚类通用词表中增加 `AI`，未修改其他业务逻辑。用相同数据、相同入口比较：

| 方案 | TP | FP | FN | TN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 原主线 | 44 | 3 | 15 | 976 | 93.62% | 74.58% | 83.02% |
| 候选：AI 通用词 | 43 | 2 | 16 | 977 | 95.56% | 72.88% | 82.69% |

候选减少 1 对误合并，也新增 1 对漏合并。未满足两类错误都不增加的回归条件，已撤销。生产聚类算法保持原样，没有引入 Embedding、外部搜索服务、数据库变更或自动事件合并。

## 人工复核与后续准入

1. 复核证据链接、原文、报道时间及事件范围，逐条保留审核理由；不确定样本移出正式评分集，不能强行分类。
2. 对真实生产采集按时间、来源、语言、事件类型分层抽样，单独建立未用于调参的验证集。对有争议标签进行独立复核。
3. 以固定回归集和独立验证集分别报告整组和独立配对指标、难例及跨语种指标。新增合并和别名策略首先提供只读候选及证据，不得依据本轮初标数据自动改写历史事件成员。

全量验收：95 个 Vitest 文件、505 项测试通过，新增 4 项评测回归；ESLint、Node/Web 与 Electron 类型检查通过。没有运行时代码改动，本轮未重新构建或部署生产产物。

本切片是离线质量基础设施。没有新增运行时功能或 API。回退只撤销评测脚本、语料及文档，不涉及生产数据。

## 后续独立复核工具

N4-N 已交付[双人复核及候选保留集流程](n4n-quality-review.md)。旧 corpus 仍为 proposed，候选数据未评分、未确认独立性；工具通过不等于人工审核或生产准入。
