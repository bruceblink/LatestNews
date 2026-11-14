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
    const sources = useMemo(
        () => (sourceFilter === "all" || !scopeSources.includes(sourceFilter) ? scopeSources : [sourceFilter]),
        [scopeSources, sourceFilter]
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
    const sourceOptions = useMemo(
        () =>
            (insights?.sourceActivity ?? []).map((item) => ({
                id: item.sourceId,
                label: getSourceName(item.sourceId, item.sourceName),
            })),
        [insights?.sourceActivity]
    );

    const heroTitle = "要闻聚焦：科技政策与产业进展受广泛关注";
    // API 发生部分失败或测试替身缺少元数据时，洞察页面仍应保留导航和空状态。
    const generatedAt = insights?.generatedAt ?? data?.meta?.generatedAt;

    const handleReadHotItem = (item: HotNewsItem) => {
        addHistory(item.sourceId, item.id, item.title, item.url);
    };

    const handleReadTopicItem = (item: TopicEvent["items"][number]) => {
        addHistory(item.sourceId, item.id, item.title, item.url);
    };

    return (
        <div className="insights-design-surface">
            <aside className="insights-sidebar" aria-label="洞察导航">
                <Link to="/" className="insights-sidebar-brand" aria-label="LatestNews 首页">
                    <img src="/icon.svg" alt="" width="36" height="36" />
                    <span>
                        <strong>LatestNews</strong>
                        <small>新闻简阅</small>
                    </span>
                </Link>
                <nav className="insights-sidebar-nav" aria-label="主要导航">
                    <InsightNavLink to="/" icon="i-ph:house-duotone" label="首页" active />
                    <InsightNavLink
                        to="/feed"
                        search={{ q: undefined, scope: "hottest" }}
                        icon="i-ph:fire-duotone"
                        label="热点追踪"
                    />
                    <InsightNavLink to="/history" icon="i-ph:article-duotone" label="选题参考" />
                    <InsightNavLink to="/health" icon="i-ph:stack-duotone" label="来源管理" />
                </nav>
                <Link to="/settings" className="insights-sidebar-settings">
                    <span className="i-ph:gear-six-duotone" aria-hidden="true" />
                    <span>设置</span>
                </Link>
            </aside>

            <main className="insights-workspace" id="insights-workspace">
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
                            <select value={scope} onChange={(event) => setScope(event.target.value as InsightScope)}>
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
                                value={sourceFilter}
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
                            disabled={isFetching}
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
                                        近 {trendWindow === "24h" ? "24 小时" : "7 天"}
                                        ，相关报道发文量与覆盖媒体数量持续变化，帮助编辑快速判断当前讨论焦点与后续跟踪方向。
                                    </p>
                                </div>
                                <div className="insights-brief-aside">
                                    <span className="i-ph:target-duotone" aria-hidden="true" />
                                    <strong>编辑洞察</strong>
                                    <span>关注跨来源重复出现的报道与持续升温的主题。</span>
                                </div>
                            </section>

                            <section className="insights-primary-grid" aria-label="主要洞察">
                                <UpdateFrequencyPanel
                                    buckets={updateFrequency}
                                    trendWindow={trendWindow}
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
                                <span className={clsx("insights-live-pill", data?.meta?.partial && "is-partial")}>
                                    <span className="i-ph:check-circle-fill" aria-hidden="true" />
                                    {data?.meta?.partial ? "部分数据" : "数据已更新"}
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
            </main>
        </div>
    );
}

/** 复用洞察工作区的左侧导航链接，保持移动端也有清晰的返回路径。 */
function InsightNavLink({
    to,
    search,
    icon,
    label,
    active = false,
}: {
    to: "/" | "/feed" | "/history" | "/health";
    search?: { q?: string; scope?: InsightScope };
    icon: string;
    label: string;
    active?: boolean;
}) {
    return (
        <Link
            to={to}
            search={search}
            className={clsx("insights-sidebar-link", active && "is-active")}
            aria-current={active ? "page" : undefined}
        >
            <span className={icon} aria-hidden="true" />
            <span>{label}</span>
        </Link>
    );
}

/** 显示按 UTC 时间桶统计的发文量，并保留热点、峰值和回落的直接标注。 */
function UpdateFrequencyPanel({
    buckets,
    trendWindow,
    loading,
}: {
    buckets: InsightTimeBucket[];
    trendWindow: InsightTrendWindow;
    loading: boolean;
}) {
    const maxCount = Math.max(...buckets.map((bucket) => bucket.itemCount), 1);
    const totalCount = buckets.reduce((sum, bucket) => sum + bucket.itemCount, 0);
    const peakIndex = buckets.findIndex((bucket) => bucket.itemCount === maxCount);
    const firstActiveIndex = buckets.findIndex((bucket) => bucket.itemCount > 0);
    const lastActiveIndex = [...buckets].reverse().findIndex((bucket) => bucket.itemCount > 0);
    const tailIndex = lastActiveIndex < 0 ? -1 : buckets.length - 1 - lastActiveIndex;

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
                <div className="insights-window-toggle" aria-label="趋势时间范围">
                    <span className={trendWindow === "7d" ? "" : "is-active"}>7 天</span>
                    <span className={trendWindow === "24h" ? "is-active" : ""}>24 小时</span>
                </div>
            </div>
            {loading ? (
                <PanelEmpty label="趋势加载中" />
            ) : totalCount > 0 ? (
                <>
                    <div className="insights-chart-stage">
                        {firstActiveIndex >= 0 && (
                            <div
                                className="insights-chart-annotation is-start"
                                style={{ left: `${(firstActiveIndex / Math.max(buckets.length - 1, 1)) * 100}%` }}
                            >
                                <strong>上涨启动</strong>
                                <span>报道数量开始增加</span>
                            </div>
                        )}
                        {peakIndex >= 0 && (
                            <div
                                className="insights-chart-annotation is-peak"
                                style={{ left: `${(peakIndex / Math.max(buckets.length - 1, 1)) * 100}%` }}
                            >
                                <strong>当日峰值</strong>
                                <span>发文量 {maxCount} 篇</span>
                            </div>
                        )}
                        {tailIndex >= 0 && tailIndex !== peakIndex && (
                            <div
                                className="insights-chart-annotation is-tail"
                                style={{ left: `${(tailIndex / Math.max(buckets.length - 1, 1)) * 100}%` }}
                            >
                                <strong>热度回落</strong>
                                <span>仍保持较高覆盖</span>
                            </div>
                        )}
                        <div
                            className="insights-bar-chart"
                            role="img"
                            aria-label={`共 ${totalCount} 条具有发布时间的内容`}
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
                                    opacity: Math.max(
                                        0.18,
                                        bucket.sourceCount / Math.max(...buckets.map((item) => item.sourceCount), 1)
                                    ),
                                }}
                            />
                        ))}
                    </div>
                    <div className="insights-chart-footnote">
                        <span>共 {totalCount} 条具有发布时间的内容</span>
                        <span>时间桶按 UTC 对齐</span>
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
                <div className="insights-mini-toggle">
                    <span className="is-active">按热度</span>
                    <span>按增速</span>
                </div>
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
    const [expandedTopicId, setExpandedTopicId] = useState<string | undefined>(topics[0]?.id);
    return (
        <article className="insights-panel insights-topic-panel">
            <div className="insights-panel-header">
                <PanelTitle icon="i-ph:chat-circle-dots-duotone" title="话题事件" />
                <div className="insights-mini-toggle">
                    <span className="is-active">按热度</span>
                    <span>按发文量</span>
                </div>
            </div>
            <div className="insights-topic-list">
                {topics.length ? (
                    topics.slice(0, 5).map((topic) => {
                        const expanded = expandedTopicId === topic.id;
                        return (
                            <article key={topic.id} className={clsx("insights-topic-row", expanded && "is-expanded")}>
                                <button
                                    type="button"
                                    className="insights-topic-button"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedTopicId(expanded ? undefined : topic.id)}
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
            </div>
            {isError ? (
                <PanelEmpty label="暂时无法读取来源健康状态" />
            ) : isFetching && !data ? (
                <PanelEmpty label="来源状态加载中" />
            ) : (
                <div className="insights-health-sources">
                    {sources.slice(0, 6).map((source) => (
                        <div
                            key={source.id}
                            className={clsx(
                                "insights-health-source",
                                `is-${source.status}`,
                                source.cacheDegraded && "is-degraded"
                            )}
                        >
                            <strong>{source.name}</strong>
                            <span>
                                {source.status === "healthy"
                                    ? "正常"
                                    : source.cacheDegraded
                                      ? "缓存降级"
                                      : source.status === "failing"
                                        ? "异常"
                                        : "未采样"}
                            </span>
                        </div>
                    ))}
                </div>
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
                <div className="insights-mini-toggle">
                    <span className="is-active">发文量</span>
                    <span>覆盖度</span>
                </div>
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
    return <div className="insights-panel-empty insights-empty-state">暂无可用来源，请先在首页添加关注来源。</div>;
}

function getSourceName(sourceId: SourceID, sourceName?: string) {
    return sourceName ?? dataSources[sourceId]?.name ?? sourceId;
}

function getScopeSources(scope: InsightScope, focusSources: SourceID[]) {
    return getUnifiedFeedScopeSources(scope, focusSources, scope === "focus" ? 100 : 30);
}

function formatTrendBucketLabel(startAt: number, trendWindow: InsightTrendWindow) {
    const date = new Date(startAt);
    return trendWindow === "7d"
        ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
        : `${String(date.getUTCHours()).padStart(2, "0")}:00`;
}

function formatUpdatedAt(value: number) {
    return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}
