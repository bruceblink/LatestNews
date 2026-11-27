# N4-N.4 后续：证据补验与维护者筛查

基线：PR #48 合并提交 d71b7a387ee83fc8fd5e0813f4c1a88ce5ea481e。固定 103 篇、48 条查询及原截止时间不变。未修改原冻结文件、候选、生产策略、正式评测参数或审核声明。此文档和补充证据仅供维护者使用，不交给独立审核人员。

## 1. 当前证据补验

2026-11-27 06:10:48–06:10:53 UTC。在原冻结的 26 个失败位置各重试一次；另对 20 个失败 HN item 从 HN 官方 Firebase item API 取当前提交元数据。采用原固定 HTTPS 主机范围（新增 hacker-news.firebaseio.com）、原 2 MiB 响应限制、8 秒 socket 超时、每个初始主机最多两个并行请求。只对 SHA-256 固定的候选及基线观测进行补验。保留失败记录、每次请求的时间、状态、响应长度、SHA-256 和受限元数据；不保存全文或评论。

| 角色 | 原有失败位置 | 本轮恢复 | 本轮仍失败 | 合并最新观测 |
| --- | ---: | ---: | ---: | ---: |
| 原文 | 5 | 4 | 1 | 102/103 |
| HN 讨论 | 1 | 1 | 0 | 45/45 |
| HN item | 20 | 20 | 0 | 45/45 |
| GitHub Release API | 0 | 0 | 0 | 1/1 |

共 46 次补验观测，45 次取得内容与元数据、1 次失败。20 个 Firebase 结果均与对应冻结 HN ID、标题、原文 URL、提交时间匹配，无身份差异；这不是 20 条独立报道，也不代替 Algolia 原始位置。原 201 次观测与新增 46 次观测分别保留，合计 247 次。合并视图的 194 个原位置中 193 个取得当前内容及元数据；102/103 篇所有适用观测角色均已访问。沿用原文 URL 规范化函数，合并视图未发现与旧集合或其他候选的规范 URL/原文最终 URL 冲突。仅表示当前可访问性和元数据匹配，不代表报道事实、历史内容、事件独立性或相关性已核验。

唯一失败：candidate-060 原文 regresshion.io；HN 提交和讨论身份仍可读取。建议在正式冻结前隔离，或提供可核查的历史原文证据。此次没有删除该样本。

## 2. 时间与内容漂移

合并视图有 22 篇 Solidot 报道的页面时间仅精确到分钟。将其中 8 条 V1 原 RSS 导出的 UTC 时间转成 UTC+8 并取分钟，candidate-009–016 的 8/8 与本轮页面显示一致。这是 UTC+8 假设的额外支持，原 RSS 原始响应仍未保留；另外 14 条 coverage-zh 时间本身按 UTC+8 解释生成，14/14 一致是重读一致性而不是独立时区证据。不能外推源站在全部历史日期均采用相同配置，更不能补造秒数。

其他风险保持：
- candidate-019、candidate-022：当前明确 publication metadata 与原候选时间不符，标题也改变；建议隔离动态礼物指南，或取得截止时间前的固定历史版本。
- candidate-020：当前标题与冻结标题的动作阶段不同；建议以历史原文核验为先，不能取得时隔离。
- candidate-057：无 HTML 标题的文本安全公告，需要按文本原件检查，不能仅凭无标题判为无效。
- 12 条发布者时间未明确，39 条历史 RSS 原始响应未保留。22 条分钟级时间的时区仍属待确认。HN 的 45 条提交时间匹配和 1 条 Release 公开发布时间匹配，不等于所有原文的发布时间均已确认。

## 3. 事件语义及查询意图初筛（维护者线索，非标签）

本轮逐条浏览旧 73 篇和新 103 篇标题、原始来源及新旧查询文本。理论跨集合空间为 7,519 个报道配对、1,728 个查询配对。未对全部配对执行原文级审查；标题/同实体关系不能据以断定事件相同或不同。没有新增已确认的跨集合底层事件泄漏结论。上一轮 candidate-017 与 report-037 的隔离以及 candidate-query-006 的隔离仍保持。

| 新集合 ID | 旧集合 ID | 人工复核重点 |
| --- | --- | --- |
| candidate-002 | report-025/026/027 | GTA 6 同一游戏；性能爆料、下架、评价与玩家统计的主要动作不同，检查是否互相引用同一新闻动作 |
| candidate-007 | report-014–017 | 音乐版权合作与平台 AI 音乐治理的主题接近，主体及动作标题不同 |
| candidate-025；candidate-023/026/027/028 | report-022 | Nvidia 与产业竞争、管理层会议、政治表态和 Amazon 收购，检查共同消息源与动作阶段 |
| candidate-036 | report-018–024 | Amazon 共同实体；航天发射、无人机事故、收购及汽车销售不应仅按品牌合并 |
| candidate-029 | report-032 | Agent 评测与 AI 评测框架；必须核查是否引用同一研究或基准 |
| candidate-009/041/044/047 | report-023/028/029 | AI Agent 通用主题，检查实际对象、研究或产品动作 |
| candidate-043 | report-014–017 | 工作环境中的 AI slop 与音乐平台治理，避免词汇重叠造成误判 |
| candidate-011/018/031 | report-038 | 多个安全事件，检查组织、事件时间与是否存在共同攻击活动 |
| candidate-057–063、supplement-004、coverage 安全系列 | report-062–073 | 安全公告类型近似；OpenSSH、XZ、curl 与 React 的产品和 CVE 需分别核对，不按安全词汇合并 |

上述范围仅为优先复核线索，未给出事件 group/family 标签。新增 Linux、Debian、GNOME、KDE、Fedora 版本系列也需区分 GA、RC、Beta、补丁与功能报道。

查询意图需进一步去相关：
- candidate-query-013/019 与 supplement-query-002：同版本候选阶段的改写。
- candidate-query-014 与 supplement-query-001/003：宽泛 release、正式版和精确版本号之间存在意图重叠及边界差异。
- candidate-query-016 与 supplement-query-005/010：明确 CVE、宽泛漏洞类型和拼写错误；不得预设相关集一致。
- candidate-query-017 与 supplement-query-006：CVE 编号与语义表达；需独立检查联合披露。
- candidate-query-004 与 supplement-query-008，candidate-query-010 与 supplement-query-009：跨语言改写线索，不能当成完全独立意图。

保留现有 48 条查询，不改评分口径。正式维护者可记录改写家族及准入例外，但真实审核者仍需审阅完整集合；不预标无答案。中文 34/103（33.0%）及采集来源集中仍需明确接受或继续补充，不能外推生产准确率。

## 4. 可复现工具与测试

```sh
node scripts/performance/holdout-admission.mjs freeze . /tmp/latestnews-holdout-freeze
node scripts/performance/holdout-admission.mjs verify . /tmp/latestnews-holdout-freeze
python3 -B scripts/performance/holdout-evidence-followup.py verify /tmp/latestnews-holdout-freeze/candidate.json /tmp/latestnews-holdout-freeze/current-evidence.json test/fixtures/news-quality-holdout-v2-evidence-followup.json
node scripts/performance/holdout-admission.mjs followup . /tmp/latestnews-holdout-freeze
```

补验文件 SHA-256：a6226f00df1f49955a349358b9b44a1f7724044c20ecd652300418c399786be2。Python verifier 检查固定原输入、请求集合、角色、时间、元数据和备用 API 匹配。Node followup 命令重新核对原冻结六文件与补验文件固定摘要，只对失败原角色构建内存合并视图，不以备用 API 顶替原角色。原冻结摘要 94eaf6d6da3b6fde4ac29da679fbaa364373d0f0769a7e71a51b946b525680dc 不变。使用 capture 子命令可生成新的补验文件；新结果不得自动覆盖已有冻结或固定补验输入。

Node 22.23.4 / pnpm 12.21.0：39 项 Node 测试（新增 1 项）；Python 3.13.17：16 项离线测试（新增 9 项）；119 个 Vitest 文件 664 项通过；ESLint、Node/Web/Electron 类型检查通过。官方 prepare-holdout 隔离结构验证仍生成相同 packet digest dd956a00c6b2d424395b4c79eab9f037cabef8aad077b3cbaf7c56caf9660285。无正式评审、无评分，无生产检索修改。

## 5. 仍需真实维护者决策

冻结保持 blocked-draft，automaticAdmission=false，362 项维护者声明仍为空白。建议先处理 060、019、020、022 的隔离或历史证据，核对所有剩余事件风险、调参接触记录、历史时间及来源覆盖，再明确决定候选是否准入或生成新版本。代码及当前证据核验不能替代真实双人盲审。此阶段不进入评分或生产策略调整。
