# N4-N 新闻质量独立复核与候选保留集

基线：`4f961c9d970237456d1557d3f2243eea3cc2c46a`。2026-11-25。仅离线质量工具与固定样本；不修改生产聚类、文章索引、事件归属、API 或运行时检索策略。不启用自动归属或混合检索。

## 已有回归集与新增候选集

| 数据集 | 报道 | 查询 | 近期 | 发布 | 安全 | 中文 / 英文 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N4-H/J/K 已知回归 | 73 | 36 | 39 | 22 | 12 | 14 / 59 |
| 新增未审核候选保留集 | 63 | 22 | 48 | 8 | 7 | 16 / 47 |

已有查询为 N4-J 15 个中文字面案例与 N4-K 21 个相关性案例的文本集合；原有标签仍为 proposed 系列状态，不合并两者原始标签。人工评审的新查询语义是完整候选报道集合上的二元相关性，不是 N4-J 纯字面回归标签。

新增 [news-quality-holdout-candidate.json](../../test/fixtures/news-quality-holdout-candidate.json) 来自 2026-11-25 11:58–12:00 UTC 的公开只读采样，固定标题、来源、原文/讨论链接、时间和证据链接。每个日常 RSS/HN 入口按原返回顺序最多 8 条有效记录；Go 1.25/1.26 发布与 OpenSSH CVE-2024-6387 / CVE-2025-26465 的 HN 查询每个最多 6 条，实际 2/6/6/1 条。没有按任何模型预测筛选样本。六种采集渠道为 IT之家、Solidot、The Verge、TechCrunch、Ars Technica、HN（23 条）。来源均是公开报告，标题是被报道的陈述，不是经本项目事实核验的结论。HN 时间是提交时间，不是原文发布时间。

冻结文件内 captures 保存实际请求 URL、采样时间、原始响应字节数、SHA-256、可解析记录数与选入数量；未保存完整响应正文，不能用当前会变化的 RSS 重新获取同一原始字节。保留了抽取后的固定评测输入。采样先排除旧语料规范 URL、标题和重复报告 URL，再用 TypeScript 的正式 guard 复核。查询在评分前按候选标题拟定，包括中英/混合、版本、不同安全披露、可能无答案的意图；**没有预设其相关集或无答案状态**。

候选通过既有 73 篇与全部 36 个已知查询的精确重叠检查，但并不因此成为已批准的独立保留集：需要人工检查同一底层事件、语义近重复、历史调参接触记录和证据质量。例如既有 Microsoft 云服务故障与新候选 Outlook 报道可能具有事件关系，须审核。版本和安全 cohort 暂均为英文 HN 提交，不能替代充分的跨来源/跨语言正例。不是随机生产流量；不得外推生产准确率。候选尚未执行任何质量评分。

## 复核操作

```sh
# 输出目录必须尚不存在。
pnpm performance:quality-review prepare /tmp/latestnews-review
pnpm performance:quality-review prepare-holdout test/fixtures/news-quality-holdout-candidate.json /tmp/latestnews-holdout
# 或用经筛选的新 unlabeled dataset.json，字段同候选文件。
# 等独立审核者完成后才执行：
pnpm performance:quality-review score /tmp/latestnews-review/packet.json /tmp/latestnews-review/review-a.json /tmp/latestnews-review/review-b.json > /tmp/review-report.json
pnpm performance:quality-review score /tmp/latestnews-holdout/packet.json /tmp/latestnews-holdout/review-a.json /tmp/latestnews-holdout/review-b.json > /tmp/holdout-report.json
```

每包生成 packet.json、两个空白 review JSON。正式生成的回归包规范 JSON SHA-256（packetDigest）为 `8b19e5b90113f14e9a68bf5b1fccae4b5e88c59c958dadfa9bd214def526ea4a`，候选包为 `2c77f760218777d76c5dded5ef666089aa63e330570624b202158f3b3d7d42a0`。这是规范序列化内容哈希，不是带缩进文件的原始字节哈希。只传入固定白名单字段，报告和查询 ID 用哈希替代原顺序 ID 并排序；不导出初标、事件 family、相关性答案、无答案标记或任何预测排名。cohort 仍供分组评测。盲审格式不是保密系统，不能证明审核者未自行查看公开原数据或调参记录。

由两位真实审核人员各自获得同一 packet 和各自空白文件，不互看另一份答案或任何预测。在正式持有者确认候选未用于规则调整，并完成近重复和证据核验后，才用于独立评分。

- reviewer：填写不同的审核标识。只有真实符合条件才将 independent、withoutPredictions 置为 true；不要由自动脚本代填正式人工评审。
- events：每篇报告填写 reviewer 本地的 group（一次具体发布、披露或动作）和 family（同实体/同产品主题），并给出 evidence/reason 文本中的审核依据。group 名称可任意，但同一 cohort 内相同 group 的 family 必须一致；不确定使用两个 null，保留理由。HN 讨论和原文应分别核对。
- retrieval：每个查询在审阅全部报告后列出相关 ID、未能确定的 ID；只有已检查剩余全部报告且判为不相关才将 reviewedAllReports 置为 true。提供理由。不得把遗漏当成不相关或将空 relevant 自动当成已证实无答案。
- 每份审核文件绑定 packetSha256。不同 ID/重复/缺失记录、空白理由、无完整性声明、不一致 group family 均拒绝。不得更改 packet。两个审核标识去空白且规范化后必须不同。此机制检查数据完整性与声明，不验证身份或真实独立性，也不是签名认证。

## 评分边界

按 cohort 完整输入实际生产聚类函数，不向算法传入标签。对两位审核者各自 group 的成对关系进行比较，不比较 group 名字。只在同意且非未知的配对上计算独立配对、完整 cohort 聚类的 TP/FP/TN/FN、Precision/Recall/F1；另外报告语言、跨来源、不同原文、两方同意的同 family 难例、输入逆序差异。争议或不确定配对单列，不删掉原聚类输入；孤立 cohort 中未知报告也保留。family 争议保留理由，只排除相应难例分层，不改写已同意的事件关系。

相关性如有一个报告不确定或两方相关集不同，整条查询暂不评分，以免误判无答案或召回率。对双方一致且已完整检查的查询，使用实际 SQLite ArticleIndex、字符 N-gram、RRF 的现有参数（候选深度 20，输出深度 5），输出 TP/FP/FN、微 Precision/Recall、正答案查询的 nDCG@5/MRR@5、无答案误返回及查询语言分层。二元相关性，分母为零返回 null，不输出虚假 0 或 100%。各查询和模型的具体排名供审核完成后的误差分析。没有独立相关性标签时不评分；空白文件不能运行 score。新增代码不引入网络模型或外部依赖。

输出 status 为 submitted-consensus 或 review-disagreements，automaticAdmission 始终 false。覆盖率、争议及正/负例支持不足必须在人工准入报告中解释；submitted-consensus 不等于真实审核已获确认，更不等于质量 SLO 或生产准入通过。争议需由独立第三方审查并保留原始审核记录和裁决依据；不能为了提高指标改写原意见或把争议算作负例。当前工具未实现第三方自动裁决，也不自动改写 corpus.labelStatus。候选确认、真实审核者和足够的代表性跨语种/同实体难例仍是阻塞。

## 验收

107 个 Vitest 文件 589 项通过（新增 12 项，含生成白名单、固定候选重复校验、空白/缺失/重复/不一致声明拒绝、不同 group 名的等价、争议/未知及真实 ArticleIndex 三种检索通道）；lint、Node/Web/Electron 类型检查通过。真实 CLI 已生成两包并验证空白审核不能评分。测试中的审核者及理由均是明确的合成 fixture，不是对真实新闻的人工审核。

既有评测脚本实际重新运行：事件整组 44 TP/3 FP/15 FN，中文检索 21 TP/1 FP/0 FN，混合检索仍与字符通道同 nDCG@5=0.8583887（基线全文 0.6746470）。原有 proposed 标签和指标不变。此次没有运行新候选的聚类或检索评分。回退只撤销离线脚本和测试数据。未修改生产环境，不发布版本。与既有客户端长测同机开展工具回归，长测结果用于稳定性验收而非独占性能测量。
