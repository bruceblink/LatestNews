import type { SourceID } from "@shared/types";
import type { UnifiedFeedScope } from "@shared/unified-feed";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type {
    TopicEvent,
    HotNewsItem,
    KeywordTrend,
    CategoryShare,
    SourceActivity,
    InsightTimeBucket,
    InsightTrendWindow,
} from "@shared/news-insights";

import clsx from "clsx";
import { useTitle } from "react-use";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { focusSourcesAtom } from "~/atoms";
import { APP_TITLE } from "~/utils/app-title";
import dataSources from "@shared/data-sources";
import { useHistory } from "~/hooks/useHistory";
import { useQuery } from "@tanstack/react-query";
import { useReadingState } from "~/hooks/useReadingState";
import { getNewsInsightsCacheKey } from "@shared/source-api";
import { fetchNewsInsights } from "~/services/source.service";
import { Link, createFileRoute } from "@tanstack/react-router";
import { NEWS_INSIGHTS_TIME_ZONE } from "@shared/news-insights";
import { useSourceHealthSummary } from "~/hooks/useSourceHealth";
import { getUnifiedFeedScopeSources } from "@shared/unified-feed";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";

type InsightScope = UnifiedFeedScope;
type SourceFilter = SourceID | "all";

const scopeOptions: Array<{ id: InsightScope; label: string }> = [
    { id: "broad", label: "全部内容" },
    { id: "focus", label: "关注内容" },
    { id: "hottest", label: "热门内容" },
    { id: "realtime", label: "实时内容" },
];

export const Route = createFileRoute("/insights")({
    component: InsightsPage,
});

/** 读取洞察数据，并按参考图的编辑式工作区组织页面。 */
function InsightsPage() {
    useTitle(`${APP_TITLE} | 阅读洞察`);

    const focusSources = useAtomValue(focusSourcesAtom);
    const { history, addHistory } = useHistory();
    const { hiddenUrls } = useReadingState();
    const [scope, setScope] = useState<InsightScope>("broad");
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [trendWindow, setTrendWindow] = useState<InsightTrendWindow>("24h");

    const scopeSources = useMemo(() => getScopeSources(scope, focusSources), [focusSources, scope]);
    const selectedSource = sourceFilter !== "all" && scopeSources.includes(sourceFilter) ? sourceFilter : "all";
    const sources = useMemo(
        () => (selectedSource === "all" ? scopeSources : [selectedSource]),
        [scopeSources, selectedSource]
    );
    const readUrls = useMemo(() => history.map((item) => item.url), [history]);
    const payload = useMemo(
        () => ({
            sources,
            hotLimit: 12,
            topicLimit: 8,
            wordLimit: 28,
            trendLimit: 10,
            trendWindow,
            minTopicItems: 2,
            readUrls,
            hiddenUrls,
        }),
        [hiddenUrls, readUrls, sources, trendWindow]
    );

    const { data, isFetching, isError, error, refetch } = useQuery({
        queryKey: getNewsInsightsCacheKey(payload),
        queryFn: () => fetchNewsInsights(payload),
        enabled: sources.length > 0,
        staleTime: 1000 * 60 * 3,
        retry: false,
    });
    const { data: healthSummary, isFetching: isHealthFetching, isError: isHealthError } = useSourceHealthSummary();
    const insights = data?.data;
    const updateFrequency = insights?.updateFrequency ?? [];
    const hotRankings = insights?.hotRankings ?? [];
    const topicEvents = insights?.topicEvents ?? [];
    const keywordTrends = insights?.keywordTrends ?? [];
    const categoryShares = insights?.categoryShares ?? [];
    const sourceActivity = insights?.sourceActivity ?? [];
    const sourceOptions = useMemo(() => scopeSources.map((id) => ({ id, label: getSourceName(id) })), [scopeSources]);

    const heroTitle = hotRankings[0]?.title
        ? `要闻聚焦：${hotRankings[0].title}`
        : isFetching
          ? "正在汇总当前来源"
          : isError
            ? "暂时无法生成洞察"
            : insights && insights.itemCount > 0
              ? "当前来源内容概览"
              : "当前范围暂无内容";
    const generatedAt = insights?.generatedAt ?? data?.meta?.generatedAt;
    const statusLabel = isFetching
        ? "更新中"
        : isError
          ? "更新失败"
          : !insights
            ? "等待数据"
            : data?.meta?.partial
              ? "部分数据"
              : insights.itemCount === 0
                ? "暂无内容"
                : "数据已更新";

    const handleReadHotItem = (item: HotNewsItem) => {
        addHistory(item.sourceId, item.id, item.title, item.url);
    };

    const handleReadTopicItem = (item: TopicEvent["items"][number]) => {
        addHistory(item.sourceId, item.id, item.title, item.url);
    };

    return (
        <div className="insights-design-surface">
            <div className="insights-workspace" id="insights-workspace">
                <header className="insights-workspace-header">
                    <div className="insights-workspace-title">
                        <div className="insights-page-kicker">READING INTELLIGENCE</div>
                        <h1>
                            阅读洞察 <span>Reading Insights</span>
                        </h1>
                        <p>基于多来源新闻内容的编辑视角数据分析，发现热点、趋势与选题线索。</p>
                    </div>
                    <div className="insights-filter-bar" aria-label="洞察筛选">
                        <label>
                            <span>时间范围</span>
                            <select
                                value={trendWindow}
                                onChange={(event) => setTrendWindow(event.target.value as InsightTrendWindow)}
                            >
                                <option value="24h">最近 24 小时</option>
                                <option value="7d">最近 7 天</option>
                            </select>
                        </label>
                        <label>
                            <span>内容范围</span>
                            <select
                                value={scope}
                                onChange={(event) => {
                                    setScope(event.target.value as InsightScope);
                                    setSourceFilter("all");
                                }}
                            >
                                {scopeOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span>来源</span>
                            <select
                                value={selectedSource}
                                onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
                            >
                                <option value="all">全部来源</option>
                                {sourceOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            className="insights-query-button"
                            disabled={isFetching || !sources.length}
                            aria-busy={isFetching}
                            onClick={() => void refetch()}
                        >
                            <span
                                className={clsx("i-ph:magnifying-glass-duotone", isFetching && "animate-spin")}
                                aria-hidden="true"
                            />
                            <span>{isFetching ? "更新中" : "查询"}</span>
                        </button>
                    </div>
                </header>

                <div className="insights-content-stack">
                    {isError && (
                        <div className="insights-data-error" role="alert">
                            洞察加载失败{error instanceof Error ? `：${error.message}` : ""}
                            {insights ? "。当前保留上次结果，请重新查询。" : "。请重新查询。"}
                        </div>
                    )}

                    {!sources.length ? (
                        <EmptyState />
                    ) : (
                        <>
                            <section className="insights-brief" aria-labelledby="insights-brief-title">
                                <div className="insights-brief-copy">
                                    <h2 id="insights-brief-title">{heroTitle}</h2>
                                    <p>
                                        {insights
                                            ? `本次返回 ${insights.sourceCount} 个来源、${insights.itemCount} 条内容。时间范围仅控制发布时间趋势，其他统计基于来源当前返回的内容。`
                                            : "热点与统计以来源返回的数据为准，不代表全部新闻。"}
                                    </p>
                                </div>
                                <div className="insights-brief-aside">
                                    <span className="i-ph:target-duotone" aria-hidden="true" />
                                    <strong>编辑洞察</strong>
                                    <span>结合来源覆盖和发布时间比较内容，不将单次快照视为增长趋势。</span>
                                </div>
                            </section>

                            <section className="insights-primary-grid" aria-label="主要洞察">
                                <UpdateFrequencyPanel
                                    buckets={updateFrequency}
                                    trendWindow={trendWindow}
                                    onTrendWindowChange={setTrendWindow}
                                    loading={isFetching && !insights}
                                />
                                <HotRankingPanel items={hotRankings} scope={scope} onRead={handleReadHotItem} />
                            </section>

                            <section className="insights-middle-grid" aria-label="事件与来源分析">
                                <TopicPanel topics={topicEvents} scope={scope} onRead={handleReadTopicItem} />
                                <div className="insights-middle-right">
                                    <SourceHealthPanel
                                        data={healthSummary}
                                        isFetching={isHealthFetching}
                                        isError={isHealthError}
                                    />
                                    <KeywordTrendMatrix items={keywordTrends} />
                                </div>
                            </section>

                            <section className="insights-bottom-grid" aria-label="分类与来源统计">
                                <CategorySharePanel items={categoryShares} />
                                <SourceActivityPanel items={sourceActivity} />
                            </section>

                            <footer className="insights-data-footer">
                                <span className="i-ph:info-duotone" aria-hidden="true" />
                                <span>
                                    数据来源：LatestNews 聚合的公开新闻来源（含主流媒体、行业媒体及地方媒体等）。
                                </span>
                                <span className="insights-footer-divider" aria-hidden="true" />
                                <span>使用提示与声明：数据为内容聚合与统计结果，可能存在延迟、去重影响。</span>
                                <span className="insights-footer-updated">
                                    <span className="i-ph:arrow-clockwise-duotone" aria-hidden="true" />
                                    最后更新：{generatedAt ? formatUpdatedAt(generatedAt) : "等待数据"}
                                </span>
                                <span
                                    role="status"
                                    className={clsx(
                                        "insights-live-pill",
                                        (data?.meta?.partial || isError || !insights) && "is-partial"
                                    )}
                                >
                                    <span
                                        className={
                                            isFetching
                                                ? "i-ph:spinner-gap-duotone animate-spin"
                                                : isError
                                                  ? "i-ph:warning-circle-duotone"
                                                  : "i-ph:info-duotone"
                                        }
                                        aria-hidden="true"
                                    />
                                    {statusLabel}
                                </span>
                            </footer>

                            {!!data?.errors?.length && (
                                <div className="insights-data-error insights-data-error-muted">
                                    {(data.errors ?? []).slice(0, 3).map((item) => (
                                        <div key={`${item.sourceId ?? "source"}-${item.message}`}>
                                            {item.sourceId ? `${item.sourceId}: ` : ""}
                                            {item.message}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

/** 按北京时间（UTC+8）显示发布时间分布，不从单次快照推断增长或回落。 */
function UpdateFrequencyPanel({
    buckets,
    trendWindow,
    loading,
    onTrendWindowChange,
}: {
    buckets: InsightTimeBucket[];
    trendWindow: InsightTrendWindow;
    loading: boolean;
    onTrendWindowChange: (value: InsightTrendWindow) => void;
}) {
    const maxCount = Math.max(...buckets.map((bucket) => bucket.itemCount), 1);
    const totalCount = buckets.reduce((sum, bucket) => sum + bucket.itemCount, 0);
    const maxSourceCount = Math.max(...buckets.map((bucket) => bucket.sourceCount), 1);

    return (
        <article className="insights-panel insights-frequency-panel">
            <div className="insights-panel-header">
                <div>
                    <PanelTitle
                        icon="i-ph:chart-bar-duotone"
                        title={trendWindow === "24h" ? "24 小时发文走势" : "7 天发文走势"}
                    />
                    <span className="insights-panel-subtitle">发文量（篇）</span>
                </div>
                <div className="insights-window-toggle" role="group" aria-label="趋势时间范围">
                    {(
                        [
                            ["7d", "7 天"],
                            ["24h", "24 小时"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={trendWindow === value}
                            onClick={() => onTrendWindowChange(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {loading ? (
                <PanelEmpty label="趋势加载中" />
            ) : totalCount > 0 ? (
                <>
                    <div className="insights-chart-stage">
                        <div
                            className="insights-bar-chart"
                            role="img"
                            aria-label={`共 ${totalCount} 条具有发布时间的内容`}
                            style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
                        >
                            {buckets.map((bucket) => (
                                <div
                                    key={bucket.startAt}
                                    className="insights-bar-column"
                                    title={`${bucket.itemCount} 条 · ${bucket.sourceCount} 个来源`}
                                >
                                    <span className="insights-bar-value">{bucket.itemCount || ""}</span>
                                    <div className="insights-bar-track">
                                        <span
                                            className="insights-bar"
                                            style={{
                                                height: `${Math.max(bucket.itemCount ? 10 : 0, (bucket.itemCount / maxCount) * 100)}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="insights-bar-label">
                                        {formatTrendBucketLabel(bucket.startAt, trendWindow)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="insights-heat-strip" aria-label="各时间段来源覆盖">
                        {buckets.map((bucket) => (
                            <span
                                key={`${bucket.startAt}-coverage`}
                                style={{
                                    opacity: Math.max(0.18, bucket.sourceCount / maxSourceCount),
                                }}
                            />
                        ))}
                    </div>
                    <div className="insights-chart-footnote">
                        <span>共 {totalCount} 条具有发布时间的内容</span>
                        <span>时间桶按北京时间（UTC+8）对齐</span>
                    </div>
                </>
            ) : (
                <PanelEmpty label="当前时间范围内暂无可统计的发布时间" />
            )}
        </article>
    );
}

/** 以紧凑排行呈现跨来源热点，同时保留阅读记录和 Feed 追踪入口。 */
function HotRankingPanel({
    items,
    scope,
    onRead,
}: {
    items: HotNewsItem[];
    scope: InsightScope;
    onRead: (item: HotNewsItem) => void;
}) {
    return (
        <article className="insights-panel insights-hot-panel">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:fire-duotone" title="热点新闻榜" />
                <span className="insights-sort-label">按综合热度排序</span>
            </div>
            <div className="insights-hot-head">
                <span>#</span>
                <span>新闻标题（简要）</span>
                <span>覆盖来源</span>
                <span>舆情热度</span>
            </div>
            <div className="insights-hot-list">
                {items.length ? (
                    items.slice(0, 5).map((item) => (
                        <article key={item.id} className="insights-hot-row">
                            <span className={clsx("insights-rank-badge", item.rank <= 3 && `rank-${item.rank}`)}>
                                {item.rank}
                            </span>
                            <div className="insights-hot-main">
                                <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => onRead(item)}
                                >
                                    {item.title}
                                </a>
                                <div className="insights-hot-meta">
                                    <span>{getSourceName(item.sourceId, item.sourceName)}</span>
                                    <span>{item.sources.length} 源覆盖</span>
                                    <span>分数 {item.score}</span>
                                    <FeedFilterLink q={item.keywords[0] ?? item.title} scope={scope} label="相关" />
                                </div>
                            </div>
                            <div className="insights-source-chips">
                                {item.sourceNames.slice(0, 3).map((name) => (
                                    <span key={name}>{name}</span>
                                ))}
                            </div>
                            <div className="insights-score-bars" aria-label={`热度 ${item.score}`}>
                                {Array.from({ length: 6 }, (_, index) => (
                                    <span
                                        key={index}
                                        className={index < Math.min(6, Math.ceil(item.score / 40)) ? "is-filled" : ""}
                                    />
                                ))}
                            </div>
                            <ReadingStateActions
                                entry={{
                                    newsId: item.id,
                                    title: item.title,
                                    url: item.url,
                                    sourceId: item.sourceId,
                                    sourceName: getSourceName(item.sourceId, item.sourceName),
                                }}
                                className="insights-inline-actions"
                            />
                        </article>
                    ))
                ) : (
                    <PanelEmpty label="暂无热点" />
                )}
            </div>
        </article>
    );
}

/** 让话题聚合保持列表式密度，并用选中行打开跨来源内容。 */
function TopicPanel({
    topics,
    scope,
    onRead,
}: {
    topics: TopicEvent[];
    scope: InsightScope;
    onRead: (item: TopicEvent["items"][number]) => void;
}) {
    const [expandedTopicId, setExpandedTopicId] = useState<string | null>();
    const visibleExpandedId = expandedTopicId === undefined ? topics[0]?.id : expandedTopicId;
    return (
        <article className="insights-panel insights-topic-panel">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:chat-circle-dots-duotone" title="话题事件" />
                <span className="insights-sort-label">按聚合结果排序</span>
            </div>
            <div className="insights-topic-list">
                {topics.length ? (
                    topics.slice(0, 5).map((topic) => {
                        const expanded = visibleExpandedId === topic.id;
                        return (
                            <article key={topic.id} className={clsx("insights-topic-row", expanded && "is-expanded")}>
                                <button
                                    type="button"
                                    className="insights-topic-button"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedTopicId(expanded ? null : topic.id)}
                                >
                                    <span className="insights-topic-hash">#</span>
                                    <span className="insights-topic-title">{topic.title}</span>
                                    <span className="insights-topic-count">{topic.itemCount} 篇</span>
                                    <span className="i-ph:caret-right-duotone" aria-hidden="true" />
                                </button>
                                {expanded && (
                                    <div className="insights-topic-detail">
                                        <div className="insights-topic-keywords">
                                            {topic.keywords.slice(0, 6).map((keyword) => (
                                                <FeedFilterLink
                                                    key={keyword}
                                                    q={keyword}
                                                    scope={scope}
                                                    label={keyword}
                                                />
                                            ))}
                                        </div>
                                        {topic.items.slice(0, 3).map((item) => (
                                            <a
                                                key={item.id}
                                                href={item.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() => onRead(item)}
                                            >
                                                {getSourceName(item.sourceId, item.sourceName)} · {item.title}
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </article>
                        );
                    })
                ) : (
                    <PanelEmpty label="暂无话题" />
                )}
            </div>
        </article>
    );
}

/** 显示来源健康摘要，保留异常、缓存降级和未采样状态。 */
function SourceHealthPanel({
    data,
    isFetching,
    isError,
}: {
    data: SourceHealthSummary | undefined;
    isFetching: boolean;
    isError: boolean;
}) {
    const sources = data?.sources ?? [];
    return (
        <article className="insights-panel insights-health-panel">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:stack-duotone" title="来源健康状态" />
                <Link to="/health" className="insights-inline-link">
                    查看详情 <span className="i-ph:arrow-up-right-duotone" aria-hidden="true" />
                </Link>
            </div>
            <div className="insights-health-legend">
                <span>
                    <i className="is-healthy" />
                    正常 {data?.healthy ?? "--"}
                </span>
                <span>
                    <i className="is-failing" />
                    异常 {data?.failing ?? "--"}
                </span>
                <span>
                    <i className="is-degraded" />
                    缓存降级 {data?.cacheDegraded ?? "--"}
                </span>
                <span>
                    <i className="is-idle" />
                    未采样 {data?.idle ?? "--"}
                </span>
            </div>
            {isError ? (
                <PanelEmpty label="暂时无法读取来源健康状态" />
            ) : isFetching && !data ? (
                <PanelEmpty label="来源状态加载中" />
            ) : sources.length ? (
                <div className="insights-health-sources">
                    {sources.slice(0, 6).map((source) => (
                        <div
                            key={source.id}
                            className={clsx(
                                "insights-health-source",
                                `is-${source.status}`,
                                source.cacheDegraded && source.status !== "failing" && "is-degraded"
                            )}
                        >
                            <strong>{source.name}</strong>
                            <span>
                                {source.status === "failing"
                                    ? "异常"
                                    : source.cacheDegraded
                                      ? "缓存降级"
                                      : source.status === "healthy"
                                        ? "正常"
                                        : "未采样"}
                            </span>
                        </div>
                    ))}
                </div>
            ) : (
                <PanelEmpty label="暂无来源健康记录" />
            )}
        </article>
    );
}

/** 用小型 SVG 线图展示关键词在时间桶中的变化，不依赖 hover 才能读懂趋势。 */
function KeywordTrendMatrix({ items }: { items: KeywordTrend[] }) {
    const topItems = items.slice(0, 6);
    return (
        <article className="insights-panel insights-keyword-matrix">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:trend-up-duotone" title="关键词趋势矩阵" />
                <span className="insights-panel-subtitle">对比关键词（最多 6 个）</span>
            </div>
            <div className="insights-keyword-grid">
                {topItems.length ? (
                    topItems.map((item) => (
                        <div key={item.term} className="insights-keyword-cell">
                            <strong>{item.term}</strong>
                            <Sparkline values={item.buckets.map((bucket) => bucket.itemCount)} />
                            <span>
                                {item.totalCount} 次 · {item.sourceCount} 源
                            </span>
                        </div>
                    ))
                ) : (
                    <PanelEmpty label="暂无关键词趋势" />
                )}
            </div>
        </article>
    );
}

function Sparkline({ values }: { values: number[] }) {
    const max = Math.max(...values, 1);
    const points = values
        .map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${34 - (value / max) * 28}`)
        .join(" ");
    return (
        <svg className="insights-sparkline" viewBox="0 0 100 36" role="img" aria-label="关键词趋势线">
            <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** 用环形占比和可读图例呈现分类结构。 */
function CategorySharePanel({ items }: { items: CategoryShare[] }) {
    const colors = ["#0a9e95", "#42bfb0", "#7ed5c4", "#b9dfbd", "#e9c778", "#e6e7df"];
    let offset = 0;
    const gradient = items
        .slice(0, 6)
        .map((item, index) => {
            const start = offset * 100;
            offset += item.ratio;
            return `${colors[index % colors.length]} ${start}% ${offset * 100}%`;
        })
        .join(", ");
    return (
        <article className="insights-panel insights-category-panel">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:chart-pie-slice-duotone" title="内容分类占比" />
            </div>
            {items.length ? (
                <div className="insights-category-content">
                    <div
                        className="insights-donut"
                        style={{ background: `conic-gradient(${gradient || "#dfe5e5 0 100%"})` }}
                    >
                        <div>
                            <strong>
                                {items.reduce((sum, item) => sum + item.itemCount, 0).toLocaleString("zh-CN")}
                            </strong>
                            <span>内容总量</span>
                        </div>
                    </div>
                    <div className="insights-category-legend">
                        {items.slice(0, 6).map((item, index) => (
                            <Link
                                key={item.categoryId}
                                to="/feed"
                                search={{ category: item.categoryId, scope: "broad", since: "all" }}
                            >
                                <i style={{ background: colors[index % colors.length] }} />
                                <span>{item.categoryName}</span>
                                <strong>{Math.round(item.ratio * 100)}%</strong>
                                <small>({item.itemCount} 篇)</small>
                            </Link>
                        ))}
                    </div>
                </div>
            ) : (
                <PanelEmpty label="暂无分类统计" />
            )}
        </article>
    );
}

/** 以横向柱状图比较各来源的发文活跃度。 */
function SourceActivityPanel({ items }: { items: SourceActivity[] }) {
    const visibleItems = items.slice(0, 8);
    const maxCount = Math.max(...visibleItems.map((item) => item.itemCount), 1);
    return (
        <article className="insights-panel insights-source-panel">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:chart-bar-duotone" title="来源活跃度" />
                <span className="insights-sort-label">按内容数量排序</span>
            </div>
            {visibleItems.length ? (
                <div className="insights-source-bars">
                    {visibleItems.map((item) => (
                        <Link
                            key={item.sourceId}
                            to="/feed"
                            search={{ source: item.sourceId, scope: "broad", since: "all" }}
                            className="insights-source-bar-row"
                        >
                            <span>{getSourceName(item.sourceId, item.sourceName)}</span>
                            <div>
                                <i style={{ width: `${Math.max(4, (item.itemCount / maxCount) * 100)}%` }} />
                            </div>
                            <strong>{item.itemCount}</strong>
                        </Link>
                    ))}
                </div>
            ) : (
                <PanelEmpty label="暂无统计" />
            )}
        </article>
    );
}

function PanelTitle({ icon, title }: { icon: string; title: string }) {
    return (
        <div className="insights-panel-title">
            <span className={icon} aria-hidden="true" />
            <h2>{title}</h2>
            <span className="i-ph:info-duotone insights-info-icon" aria-hidden="true" />
        </div>
    );
}

function FeedFilterLink({ q, scope, label }: { q: string; scope: InsightScope; label: string }) {
    return (
        <Link to="/feed" search={{ q, scope, since: "all" }} className="insights-filter-link">
            {label}
        </Link>
    );
}

function PanelEmpty({ label }: { label: string }) {
    return <div className="insights-panel-empty">{label}</div>;
}

function EmptyState() {
    return (
        <div className="insights-panel-empty insights-empty-state">
            <div>
                <p>当前范围暂无可用来源。</p>
                <Link to="/c/$column" params={{ column: "focus" }} className="insights-inline-link">
                    管理关注来源
                </Link>
            </div>
        </div>
    );
}

function getSourceName(sourceId: SourceID, sourceName?: string) {
    return sourceName ?? dataSources[sourceId]?.name ?? sourceId;
}

function getScopeSources(scope: InsightScope, focusSources: SourceID[]) {
    return getUnifiedFeedScopeSources(scope, focusSources, scope === "focus" ? 100 : 30);
}

function formatTrendBucketLabel(startAt: number, trendWindow: InsightTrendWindow) {
    const parts = new Map(
        new Intl.DateTimeFormat("zh-CN", {
            timeZone: NEWS_INSIGHTS_TIME_ZONE,
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            hourCycle: "h23",
        })
            .formatToParts(new Date(startAt))
            .map(({ type, value }) => [type, value])
    );
    return trendWindow === "7d" ? `${parts.get("month")}/${parts.get("day")}` : `${parts.get("hour")}:00`;
}

function formatUpdatedAt(value: number) {
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: NEWS_INSIGHTS_TIME_ZONE,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}
