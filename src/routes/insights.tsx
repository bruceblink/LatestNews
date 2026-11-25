import "~/styles/insights.css";

import type { SourceID } from "@shared/types";
import type { UnifiedFeedScope } from "@shared/unified-feed";
import type { ReadingStateItemInput } from "@shared/reading-state";
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
import { useDark } from "~/hooks/useDark";
import { APP_TITLE } from "~/utils/app-title";
import { feedScopeSourcesAtom } from "~/atoms";
import dataSources from "@shared/data-sources";
import { useHistory } from "~/hooks/useHistory";
import { useQuery } from "@tanstack/react-query";
import { NewsLink } from "~/components/reading/NewsLink";
import { useReadingState } from "~/hooks/useReadingState";
import { useRef, useMemo, useState, useEffect } from "react";
import { getNewsInsightsCacheKey } from "@shared/source-api";
import { fetchNewsInsights } from "~/services/source.service";
import { Link, createFileRoute } from "@tanstack/react-router";
import { NEWS_INSIGHTS_TIME_ZONE } from "@shared/news-insights";
import { useSourceHealthSummary } from "~/hooks/useSourceHealth";
type InsightScope = UnifiedFeedScope;
type SourceFilter = SourceID | "all";
type InsightFilters = {
    scope: InsightScope;
    source: SourceFilter;
};
type InsightSnapshotFilters = InsightFilters & { trendWindow: InsightTrendWindow };
type InsightsResponse = Awaited<ReturnType<typeof fetchNewsInsights>>;

const scopeOptions: Array<{ id: InsightScope; label: string }> = [
    { id: "broad", label: "全部内容" },
    { id: "focus", label: "关注内容" },
    { id: "hottest", label: "热门内容" },
    { id: "realtime", label: "实时内容" },
];

export const Route = createFileRoute("/insights")({
    component: InsightsPage,
});

/** Loads the real insight snapshot and presents its primary reading path. */
function InsightsPage() {
    useTitle(`${APP_TITLE} | 阅读洞察`);

    const availableSources = useAtomValue(feedScopeSourcesAtom);
    const { history, addHistory } = useHistory();
    const { hiddenUrls, toggleLater, toggleFavorite, toggleHidden, isLaterUrl, isFavoriteUrl } = useReadingState();
    const { isDark, toggleDark } = useDark();
    const [scope, setScope] = useState<InsightScope>("broad");
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [trendWindow, setTrendWindow] = useState<InsightTrendWindow>("24h");
    const [draftFilters, setDraftFilters] = useState<InsightFilters>({ scope: "broad", source: "all" });
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
    );
    const chartRef = useRef<HTMLElement>(null);
    const filterRef = useRef<HTMLDivElement>(null);
    const filterTriggerRef = useRef<HTMLButtonElement>(null);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const lastSuccessfulResult = useRef<{ response: InsightsResponse; filters: InsightSnapshotFilters }>();

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 767px)");
        const updateLayout = () => setIsMobile(mediaQuery.matches);
        mediaQuery.addEventListener("change", updateLayout);
        updateLayout();
        return () => mediaQuery.removeEventListener("change", updateLayout);
    }, []);

    useEffect(() => {
        if (!isMobile || !isFilterOpen) return undefined;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !filterRef.current?.contains(event.target)) {
                setIsFilterOpen(false);
            }
        };
        const dismissWithKeyboard = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setIsFilterOpen(false);
            filterTriggerRef.current?.focus();
        };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("keydown", dismissWithKeyboard);
        return () => {
            document.removeEventListener("pointerdown", dismiss);
            document.removeEventListener("keydown", dismissWithKeyboard);
        };
    }, [isFilterOpen, isMobile]);

    const scopeSources = useMemo(() => getScopeSources(scope, availableSources), [scope, availableSources]);
    const selectedSource = sourceFilter !== "all" && scopeSources.includes(sourceFilter) ? sourceFilter : "all";
    const sources = useMemo(
        () => (selectedSource === "all" ? scopeSources : [selectedSource]),
        [scopeSources, selectedSource]
    );
    const draftScopeSources = useMemo(
        () => getScopeSources(draftFilters.scope, availableSources),
        [draftFilters.scope, availableSources]
    );
    const draftSourceOptions = useMemo(
        () => draftScopeSources.map((id) => ({ id, label: getSourceName(id) })),
        [draftScopeSources]
    );
    const sourceOptions = useMemo(() => scopeSources.map((id) => ({ id, label: getSourceName(id) })), [scopeSources]);
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

    const { data, isFetching, isError, refetch, isPlaceholderData } = useQuery({
        queryKey: getNewsInsightsCacheKey(payload),
        queryFn: () => fetchNewsInsights(payload),
        placeholderData: (previousData) => previousData,
        enabled: sources.length > 0,
        staleTime: 1000 * 60 * 3,
        retry: false,
    });
    const allSourcesUnavailable = Boolean(data?.meta?.partial && data.meta.resolvedSourceCount === 0);
    const updateFailed = isError || allSourcesUnavailable;
    const previous = lastSuccessfulResult.current;
    const usePreviousResult = Boolean(previous && (allSourcesUnavailable || (isError && !data)));
    useEffect(() => {
        if (!data || updateFailed || isPlaceholderData) return;
        lastSuccessfulResult.current = {
            response: data,
            filters: { scope, source: selectedSource, trendWindow },
        };
    }, [data, updateFailed, isPlaceholderData, scope, selectedSource, trendWindow]);
    const { data: healthSummary, isFetching: isHealthFetching, isError: isHealthError } = useSourceHealthSummary();
    const displayedData = usePreviousResult ? previous?.response : data;
    // Cached fallback marks keep their original scope and time encoding, not the failed request's labels.
    const displayedFilters = (isPlaceholderData || usePreviousResult
        ? lastSuccessfulResult.current?.filters
        : undefined) ?? { scope, source: selectedSource, trendWindow };
    const displayedFiltersLabel = formatActiveFilters(
        displayedFilters.scope,
        displayedFilters.source,
        displayedFilters.trendWindow
    );
    const isShowingPreviousFilter =
        Boolean(lastSuccessfulResult.current) &&
        displayedFiltersLabel !== formatActiveFilters(scope, selectedSource, trendWindow) &&
        (isPlaceholderData || usePreviousResult);
    const insights = displayedData?.data;
    const generatedAt = insights?.generatedAt ?? displayedData?.meta?.generatedAt;
    const healthUpdatedAt = healthSummary?.updatedAt;
    const statusLabel = isFetching
        ? insights
            ? isShowingPreviousFilter
                ? "查询中 · 显示上次范围"
                : "更新中 · 显示上次结果"
            : "更新中"
        : updateFailed
          ? insights
              ? isShowingPreviousFilter
                  ? "更新失败 · 显示上次范围"
                  : "更新失败 · 显示上次结果"
              : "更新失败"
          : !insights
            ? "等待数据"
            : data?.meta?.partial
              ? "部分数据"
              : insights.itemCount === 0
                ? "暂无内容"
                : "数据已更新";

    const applyMobileFilters = () => {
        setScope(draftFilters.scope);
        setSourceFilter(draftFilters.source);
        setIsFilterOpen(false);
        requestAnimationFrame(() => {
            chartRef.current?.scrollIntoView({ block: "nearest" });
            chartRef.current?.focus({ preventScroll: true });
        });
    };

    const resetMobileFilters = () => {
        setDraftFilters({ scope: "broad", source: "all" });
    };

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
                    <h1>阅读洞察</h1>
                    <button
                        type="button"
                        className="insights-header-theme-toggle"
                        aria-label="切换明暗主题"
                        onClick={toggleDark}
                    >
                        <span className={isDark ? "i-ph:sun" : "i-ph:moon-stars"} aria-hidden="true" />
                    </button>
                    <div
                        className={clsx(
                            "insights-page-status",
                            "insights-page-status-desktop",
                            (updateFailed || displayedData?.meta?.partial) && "is-warning",
                            isFetching && "is-fetching"
                        )}
                        role="status"
                        aria-live="polite"
                    >
                        <span aria-hidden="true" />
                        <span>{generatedAt ? `更新于 ${formatUpdatedAt(generatedAt)}` : "等待首次数据"}</span>
                        <span className="insights-status-divider" aria-hidden="true">
                            ·
                        </span>
                        <span>{statusLabel}</span>
                    </div>
                </header>
                {isMobile && (
                    <div
                        className={clsx(
                            "insights-page-status",
                            "insights-page-status-mobile",
                            (updateFailed || displayedData?.meta?.partial) && "is-warning",
                            isFetching && "is-fetching"
                        )}
                        role="status"
                        aria-live="polite"
                    >
                        <span aria-hidden="true" />
                        <span>{generatedAt ? `更新于 ${formatUpdatedAt(generatedAt)}` : "等待首次数据"}</span>
                        <span>{statusLabel}</span>
                    </div>
                )}

                <section className="insights-filter-bar" aria-label="洞察筛选">
                    <label className="insights-filter-field">
                        <span>时间范围</span>
                        <select
                            value={trendWindow}
                            onChange={(event) => setTrendWindow(event.target.value as InsightTrendWindow)}
                        >
                            <option value="24h">最近 24 小时</option>
                            <option value="7d">最近 7 天</option>
                        </select>
                    </label>
                    <div ref={filterRef} className="insights-scope-filters">
                        <button
                            type="button"
                            ref={filterTriggerRef}
                            className="insights-filter-summary"
                            aria-expanded={isFilterOpen}
                            aria-controls="insights-scope-filter-fields"
                            onClick={() => {
                                setDraftFilters({ scope, source: selectedSource });
                                setIsFilterOpen((open) => !open);
                            }}
                        >
                            <span className="i-ph:sliders-horizontal-duotone" aria-hidden="true" />
                            <span>筛选</span>
                            <span className="insights-summary-selection">{getScopeLabel(scope)}</span>
                        </button>
                        <div
                            id="insights-scope-filter-fields"
                            className={clsx("insights-scope-filter-fields", isFilterOpen && "is-open")}
                        >
                            <label className="insights-filter-field">
                                <span>内容范围</span>
                                <select
                                    value={isMobile ? draftFilters.scope : scope}
                                    onChange={(event) => {
                                        const nextScope = event.target.value as InsightScope;
                                        if (isMobile) {
                                            setDraftFilters({ scope: nextScope, source: "all" });
                                        } else {
                                            setScope(nextScope);
                                            setSourceFilter("all");
                                        }
                                    }}
                                >
                                    {scopeOptions.map((option) => (
                                        <option key={option.id} value={option.id}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="insights-filter-field">
                                <span>来源</span>
                                <select
                                    value={isMobile ? draftFilters.source : selectedSource}
                                    onChange={(event) => {
                                        const nextSource = event.target.value as SourceFilter;
                                        if (isMobile) {
                                            setDraftFilters((current) => ({ ...current, source: nextSource }));
                                        } else {
                                            setSourceFilter(nextSource);
                                        }
                                    }}
                                >
                                    <option value="all">全部来源</option>
                                    {(isMobile ? draftSourceOptions : sourceOptions).map((option) => (
                                        <option key={option.id} value={option.id}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {isMobile && (
                                <div className="insights-filter-actions">
                                    <button
                                        type="button"
                                        className="insights-filter-reset"
                                        onClick={resetMobileFilters}
                                    >
                                        重置
                                    </button>
                                    <button
                                        type="button"
                                        className="insights-query-button"
                                        onClick={applyMobileFilters}
                                    >
                                        应用筛选
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="insights-filter-active" aria-live="polite">
                        {getScopeLabel(scope)} · {selectedSource === "all" ? "全部来源" : getSourceName(selectedSource)}
                    </div>
                    <button
                        type="button"
                        className="insights-query-button insights-desktop-query"
                        disabled={isFetching || !sources.length}
                        aria-busy={isFetching}
                        onClick={() => void refetch()}
                    >
                        <span
                            className={clsx("i-ph:magnifying-glass-duotone", isFetching && "motion-safe:animate-spin")}
                            aria-hidden="true"
                        />
                        <span>{isFetching ? "更新中" : "查询"}</span>
                    </button>
                </section>

                <div className="insights-content-stack">
                    {updateFailed && (
                        <div className="insights-data-error" role="alert">
                            <span>
                                洞察加载失败
                                {isShowingPreviousFilter
                                    ? `。当前筛选失败，以下保留${displayedFiltersLabel}的上次结果。`
                                    : usePreviousResult || (isError && insights)
                                      ? "。当前保留上次结果。"
                                      : "。"}
                            </span>
                            <button
                                type="button"
                                disabled={isFetching || !sources.length}
                                onClick={() => void refetch()}
                            >
                                重试
                            </button>
                        </div>
                    )}

                    {!sources.length ? (
                        <section ref={chartRef} aria-label="主要洞察" tabIndex={-1}>
                            <EmptyState />
                        </section>
                    ) : (
                        <>
                            <section
                                ref={chartRef}
                                className="insights-primary-grid"
                                aria-label="主要洞察"
                                tabIndex={-1}
                            >
                                <UpdateFrequencyPanel
                                    key={displayedFilters.trendWindow}
                                    buckets={insights?.updateFrequency ?? []}
                                    trendWindow={displayedFilters.trendWindow}
                                    selectedTrendWindow={trendWindow}
                                    loading={isFetching && !insights}
                                    onTrendWindowChange={setTrendWindow}
                                />
                                <HotRankingPanel
                                    items={insights?.hotRankings ?? []}
                                    onRead={handleReadHotItem}
                                    isMobile={isMobile}
                                    isLaterUrl={isLaterUrl}
                                    isFavoriteUrl={isFavoriteUrl}
                                    onToggleLater={toggleLater}
                                    onToggleFavorite={toggleFavorite}
                                    onToggleHidden={toggleHidden}
                                />
                            </section>

                            <section className="insights-middle-grid" aria-label="话题与来源健康">
                                <details className="insights-topic-disclosure" open={!isMobile}>
                                    <summary>
                                        <span>补充分析与统计说明</span>
                                        <span className="i-ph:caret-down-duotone" aria-hidden="true" />
                                    </summary>
                                    <div className="insights-topic-disclosure-content">
                                        <TopicPanel
                                            topics={insights?.topicEvents ?? []}
                                            scope={displayedFilters.scope}
                                            onRead={handleReadTopicItem}
                                        />
                                        <details className="insights-supplemental">
                                            <summary>
                                                <span>补充统计</span>
                                                <span className="i-ph:caret-down-duotone" aria-hidden="true" />
                                            </summary>
                                            <div className="insights-supplemental-grid">
                                                <KeywordTrendMatrix items={insights?.keywordTrends ?? []} />
                                                <CategorySharePanel items={insights?.categoryShares ?? []} />
                                                <SourceActivityPanel items={insights?.sourceActivity ?? []} />
                                            </div>
                                        </details>
                                    </div>
                                </details>
                                <SourceHealthPanel
                                    data={healthSummary}
                                    isFetching={isHealthFetching}
                                    isError={isHealthError}
                                    updatedAt={healthUpdatedAt}
                                />
                            </section>

                            <footer className="insights-data-footer">
                                <span>时间范围仅影响发布时间和关键词趋势。</span>
                                <span>其他统计基于当前来源返回内容；不代表增长率。</span>
                                {!!displayedData?.errors?.length && (
                                    <details className="insights-source-errors">
                                        <summary>部分来源信息</summary>
                                        <div className="insights-data-error insights-data-error-muted">
                                            {(displayedData.errors ?? []).slice(0, 3).map((item) => (
                                                <div key={`${item.sourceId ?? "source"}-${item.message}`}>
                                                    {item.sourceId ? `${item.sourceId}: ` : ""}
                                                    {item.message}
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </footer>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Displays actual server buckets; the selected bar exposes its exact counts. */
function UpdateFrequencyPanel({
    buckets,
    trendWindow,
    selectedTrendWindow,
    loading,
    onTrendWindowChange,
}: {
    buckets: InsightTimeBucket[];
    trendWindow: InsightTrendWindow;
    selectedTrendWindow: InsightTrendWindow;
    loading: boolean;
    onTrendWindowChange: (value: InsightTrendWindow) => void;
}) {
    const [selectedStartAt, setSelectedStartAt] = useState<number | null>(null);
    const maxCount = Math.max(...buckets.map((bucket) => bucket.itemCount), 1);
    const totalCount = buckets.reduce((sum, bucket) => sum + bucket.itemCount, 0);
    const selectedBucket = buckets.find((bucket) => bucket.startAt === selectedStartAt);
    const chartDescriptionId = `insights-chart-description-${trendWindow}`;

    return (
        <article className="insights-panel insights-frequency-panel">
            <div className="insights-panel-header">
                <h2>发布时间分布</h2>
                <span className="insights-panel-subtitle">北京时间（UTC+8）</span>
                <div className="insights-window-toggle" role="group" aria-label="趋势时间范围">
                    {(
                        [
                            ["24h", "24 小时"],
                            ["7d", "7 天"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={selectedTrendWindow === value}
                            onClick={() => onTrendWindowChange(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="insights-chart-metric">
                <strong>{loading ? "—" : totalCount.toLocaleString("zh-CN")}</strong>
                <span>条具有发布时间</span>
            </div>
            {trendWindow !== selectedTrendWindow && (
                <p className="insights-chart-snapshot-range">
                    当前图表：{trendWindow === "24h" ? "最近 24 小时" : "最近 7 天"}的上次结果
                </p>
            )}
            {loading ? (
                <PanelEmpty label="趋势加载中" />
            ) : totalCount > 0 ? (
                <>
                    <p id={chartDescriptionId} className="insights-sr-only">
                        {trendWindow === "24h" ? "最近 24 小时" : "最近 7 天"}的发布时间分布，共 {totalCount} 条。
                        选择任一柱形，可查看该时间段的内容数和来源数。
                    </p>
                    <div
                        className="insights-bar-chart"
                        role="group"
                        aria-label="发布时间分布"
                        aria-describedby={chartDescriptionId}
                        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
                    >
                        {buckets.map((bucket, index) => {
                            const label = formatTrendBucketLabel(bucket.startAt, trendWindow);
                            const selected = selectedStartAt === bucket.startAt;
                            const barHeight = (bucket.itemCount / maxCount) * 100;
                            return (
                                <button
                                    key={bucket.startAt}
                                    type="button"
                                    className={clsx(
                                        "insights-bar-column",
                                        index === 0 ||
                                            index === Math.floor((buckets.length - 1) / 2) ||
                                            index === buckets.length - 1
                                            ? "is-label-visible"
                                            : "is-label-compact",
                                        bucket.itemCount === 0 && "is-zero"
                                    )}
                                    aria-label={`${label}：${bucket.itemCount} 条内容，${bucket.sourceCount} 个来源`}
                                    aria-pressed={selected}
                                    title={`${label} · ${bucket.itemCount} 条 · ${bucket.sourceCount} 个来源`}
                                    onClick={() => setSelectedStartAt(selected ? null : bucket.startAt)}
                                >
                                    <span className="insights-bar-track" aria-hidden="true">
                                        <span
                                            className="insights-bar-value"
                                            style={{ bottom: `calc(${barHeight}% + 2px)` }}
                                        >
                                            {bucket.itemCount}
                                        </span>
                                        <span className="insights-bar" style={{ height: `${barHeight}%` }} />
                                    </span>
                                    <span className="insights-bar-label">
                                        {formatTrendBucketTickLabel(bucket.startAt, trendWindow)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <p className="insights-chart-detail" aria-live="polite">
                        {selectedBucket
                            ? `${formatTrendBucketLabel(selectedBucket.startAt, trendWindow)} · ${selectedBucket.itemCount} 条 · ${selectedBucket.sourceCount} 个来源`
                            : `${getTrendRangeLabel(buckets, trendWindow)} · 按发布时间统计`}
                    </p>
                    <p className="insights-chart-caveat">分桶依据文章发布时间；不表示内容增长率。</p>
                </>
            ) : (
                <PanelEmpty label="当前时间范围内暂无可统计的发布时间" />
            )}
        </article>
    );
}

/** Keeps the top-ranked rows compact while retaining all reading-state actions. */
function HotRankingPanel({
    items,
    onRead,
    isMobile,
    isLaterUrl,
    isFavoriteUrl,
    onToggleLater,
    onToggleFavorite,
    onToggleHidden,
}: {
    items: HotNewsItem[];
    onRead: (item: HotNewsItem) => void;
    isMobile: boolean;
    isLaterUrl: (url: string) => boolean;
    isFavoriteUrl: (url: string) => boolean;
    onToggleLater: (entry: ReadingStateItemInput) => void;
    onToggleFavorite: (entry: ReadingStateItemInput) => void;
    onToggleHidden: (entry: ReadingStateItemInput) => void;
}) {
    return (
        <article className="insights-panel insights-hot-panel">
            <div className="insights-panel-header">
                <h2>热点新闻</h2>
                <span className="insights-panel-subtitle">综合排序</span>
            </div>
            <div className="insights-hot-list">
                {items.length ? (
                    items.slice(0, isMobile ? 3 : 4).map((item) => (
                        <article key={item.id} className="insights-hot-row">
                            <span className="insights-rank-badge">{item.rank}</span>
                            <div className="insights-hot-main">
                                <NewsLink
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => onRead(item)}
                                >
                                    {item.title}
                                </NewsLink>
                                <div className="insights-hot-meta">
                                    <span>{getSourceName(item.sourceId, item.sourceName)}</span>
                                    {item.publishedAt && (
                                        <time dateTime={new Date(item.publishedAt).toISOString()}>
                                            {formatRelativeTime(item.publishedAt)}
                                        </time>
                                    )}
                                </div>
                            </div>
                            <HotItemActions
                                item={item}
                                isLater={isLaterUrl(item.url)}
                                isFavorite={isFavoriteUrl(item.url)}
                                onToggleLater={onToggleLater}
                                onToggleFavorite={onToggleFavorite}
                                onToggleHidden={onToggleHidden}
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

function HotItemActions({
    item,
    isLater,
    isFavorite,
    onToggleLater,
    onToggleFavorite,
    onToggleHidden,
}: {
    item: HotNewsItem;
    isLater: boolean;
    isFavorite: boolean;
    onToggleLater: (entry: ReadingStateItemInput) => void;
    onToggleFavorite: (entry: ReadingStateItemInput) => void;
    onToggleHidden: (entry: ReadingStateItemInput) => void;
}) {
    const entry: ReadingStateItemInput = {
        newsId: item.id,
        title: item.title,
        url: item.url,
        sourceId: item.sourceId,
        sourceName: getSourceName(item.sourceId, item.sourceName),
    };

    return (
        <div className="insights-hot-actions">
            <button
                type="button"
                className="insights-favorite-button"
                aria-label={isFavorite ? "取消收藏" : "收藏"}
                aria-pressed={isFavorite}
                title={isFavorite ? "取消收藏" : "收藏"}
                onClick={() => onToggleFavorite(entry)}
            >
                <span
                    className={isFavorite ? "i-ph:bookmark-simple-fill" : "i-ph:bookmark-simple-duotone"}
                    aria-hidden="true"
                />
            </button>
            <details className="insights-hot-more">
                <summary aria-label="更多阅读操作" title="更多阅读操作">
                    <span className="i-ph:dots-three" aria-hidden="true" />
                </summary>
                <div className="insights-hot-more-menu">
                    <button type="button" onClick={() => onToggleLater(entry)}>
                        <span className={isLater ? "i-ph:clock-fill" : "i-ph:clock-duotone"} aria-hidden="true" />
                        {isLater ? "移出稍后读" : "稍后读"}
                    </button>
                    <button type="button" onClick={() => onToggleHidden(entry)}>
                        <span className="i-ph:eye-slash-duotone" aria-hidden="true" />
                        隐藏
                    </button>
                </div>
            </details>
        </div>
    );
}

/** Shows one expanded topic at a time with article links available on demand. */
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
    const visibleExpandedId = expandedTopicId === undefined ? getTopicKey(topics[0]) : expandedTopicId;

    return (
        <article className="insights-panel insights-topic-panel">
            <div className="insights-panel-header">
                <h2>话题事件</h2>
                <span className="insights-panel-subtitle">按当前内容聚合</span>
            </div>
            <div className="insights-topic-list">
                {topics.length ? (
                    topics.slice(0, 5).map((topic) => {
                        const topicKey = getTopicKey(topic);
                        const expanded = visibleExpandedId === topicKey;
                        return (
                            <article key={topicKey} className={clsx("insights-topic-row", expanded && "is-expanded")}>
                                <button
                                    type="button"
                                    className="insights-topic-button"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedTopicId(expanded ? null : topicKey)}
                                >
                                    <span className="insights-topic-title">{topic.title}</span>
                                    <span className="insights-topic-count">
                                        {topic.itemCount} 篇 · {topic.sources.length} 个来源
                                    </span>
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
                                            <NewsLink
                                                key={item.id}
                                                href={item.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() => onRead(item)}
                                            >
                                                {getSourceName(item.sourceId, item.sourceName)} · {item.title}
                                            </NewsLink>
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

/** 使用新稳定事件 ID，兼容仍只返回旧 id 的缓存响应。 */
function getTopicKey(topic: TopicEvent | undefined) {
    return topic?.eventId ?? topic?.id;
}

/** Health is a separate global snapshot and is not affected by insight filters. */
function SourceHealthPanel({
    data,
    isFetching,
    isError,
    updatedAt,
}: {
    data: SourceHealthSummary | undefined;
    isFetching: boolean;
    isError: boolean;
    updatedAt?: number;
}) {
    const sources = data?.sources ?? [];
    const visibleSources = sources.slice(0, 6);

    return (
        <article className="insights-panel insights-health-panel">
            <div className="insights-panel-header">
                <h2>来源健康</h2>
                <Link to="/health" className="insights-inline-link">
                    查看详情 <span className="i-ph:arrow-up-right-duotone" aria-hidden="true" />
                </Link>
            </div>
            <div className="insights-health-meta">
                <span>全局快照{updatedAt ? ` · ${formatUpdatedAt(updatedAt)}` : ""}</span>
                {isFetching && <span role="status">更新中</span>}
                {isError && <span className="is-warning">显示最近一次可用状态</span>}
            </div>
            <div className="insights-health-legend">
                <span>
                    <i className="is-healthy" aria-hidden="true" />
                    正常 {data?.healthy ?? "--"}
                </span>
                <span>
                    <i className="is-failing" aria-hidden="true" />
                    异常 {data?.failing ?? "--"}
                </span>
                <span>
                    <i className="is-idle" aria-hidden="true" />
                    未采样 {data?.idle ?? "--"}
                </span>
                <span>
                    <i className="is-degraded" aria-hidden="true" />
                    缓存降级 {data?.cacheDegraded ?? "--"}
                </span>
            </div>
            {isError && !data ? (
                <PanelEmpty label="暂时无法读取来源健康状态" />
            ) : isFetching && !data ? (
                <PanelEmpty label="来源状态加载中" />
            ) : visibleSources.length ? (
                <div className="insights-health-sources">
                    {visibleSources.map((source) => (
                        <div
                            key={source.id}
                            className={clsx(
                                "insights-health-source",
                                `is-${source.status}`,
                                source.cacheDegraded && source.status !== "failing" && "is-degraded"
                            )}
                        >
                            <strong>{source.name}</strong>
                            <span className="insights-health-indicator" aria-hidden="true" />
                            <span className="insights-health-state">
                                {source.status === "failing"
                                    ? "抓取失败"
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

function KeywordTrendMatrix({ items }: { items: KeywordTrend[] }) {
    const topItems = items.slice(0, 6);
    return (
        <article className="insights-panel insights-keyword-matrix">
            <div className="insights-panel-header">
                <h2>关键词趋势</h2>
                <span className="insights-panel-subtitle">按当前时间范围</span>
            </div>
            <div className="insights-keyword-grid">
                {topItems.length ? (
                    topItems.map((item) => (
                        <div key={item.term} className="insights-keyword-cell">
                            <strong>{item.term}</strong>
                            <Sparkline
                                values={item.buckets.map((bucket) => bucket.itemCount)}
                                label={`${item.term}：${item.buckets.map((bucket) => bucket.itemCount).join("、")}`}
                            />
                            <span>
                                {item.totalCount} 次 · {item.sourceCount} 个来源
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

function Sparkline({ values, label }: { values: number[]; label: string }) {
    const max = Math.max(...values, 1);
    const points = values
        .map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${34 - (value / max) * 28}`)
        .join(" ");
    return (
        <svg className="insights-sparkline" viewBox="0 0 100 36" role="img" aria-label={label}>
            <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** Presents category composition with labels that remain readable without color. */
function CategorySharePanel({ items }: { items: CategoryShare[] }) {
    const colors = [
        "var(--chart-blue)",
        "var(--text-primary)",
        "var(--text-secondary)",
        "var(--text-muted)",
        "var(--border-strong)",
        "var(--border)",
    ];
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
                <h2>内容分类占比</h2>
            </div>
            {items.length ? (
                <div className="insights-category-content">
                    <div
                        className="insights-donut"
                        role="img"
                        aria-label={`内容分类占比：${items
                            .slice(0, 6)
                            .map((item) => `${item.categoryName} ${Math.round(item.ratio * 100)}%`)
                            .join("，")}`}
                        style={{ background: `conic-gradient(${gradient})` }}
                    >
                        <div>
                            <strong>
                                {items.reduce((sum, item) => sum + item.itemCount, 0).toLocaleString("zh-CN")}
                            </strong>
                            <span>条内容</span>
                        </div>
                    </div>
                    <div className="insights-category-legend">
                        {items.slice(0, 6).map((item, index) => (
                            <Link
                                key={item.categoryId}
                                to="/feed"
                                search={{ category: item.categoryId, scope: "broad", since: "all" }}
                            >
                                <i style={{ background: colors[index % colors.length] }} aria-hidden="true" />
                                <span>{item.categoryName}</span>
                                <strong>{Math.round(item.ratio * 100)}%</strong>
                                <small>{item.itemCount} 篇</small>
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

function SourceActivityPanel({ items }: { items: SourceActivity[] }) {
    const visibleItems = items.slice(0, 8);
    const maxCount = Math.max(...visibleItems.map((item) => item.itemCount), 1);
    return (
        <article className="insights-panel insights-source-panel">
            <div className="insights-panel-header">
                <h2>来源活跃度</h2>
                <span className="insights-panel-subtitle">按内容数量</span>
            </div>
            {visibleItems.length ? (
                <div className="insights-source-bars">
                    {visibleItems.map((item) => (
                        <Link
                            key={item.sourceId}
                            to="/feed"
                            search={{ source: item.sourceId, scope: "broad", since: "all" }}
                            className="insights-source-bar-row"
                            aria-label={`${getSourceName(item.sourceId, item.sourceName)}，${item.itemCount} 篇`}
                        >
                            <span>{getSourceName(item.sourceId, item.sourceName)}</span>
                            <span className="insights-source-bar-track" aria-hidden="true">
                                <i style={{ width: `${Math.max(4, (item.itemCount / maxCount) * 100)}%` }} />
                            </span>
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

function getScopeSources(scope: InsightScope, availableSources: Record<InsightScope, SourceID[]>) {
    return scope === "focus" ? availableSources.focus : availableSources[scope].slice(0, 30);
}

function getScopeLabel(scope: InsightScope) {
    return scopeOptions.find((option) => option.id === scope)?.label ?? "全部内容";
}

function formatActiveFilters(scope: InsightScope, source: SourceFilter, trendWindow: InsightTrendWindow) {
    const sourceLabel = source === "all" ? "全部来源" : getSourceName(source);
    const windowLabel = trendWindow === "24h" ? "最近 24 小时" : "最近 7 天";
    return `${getScopeLabel(scope)} · ${sourceLabel} · ${windowLabel}`;
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
    return trendWindow === "7d"
        ? `${parts.get("month")}/${parts.get("day")}`
        : `${parts.get("month")}/${parts.get("day")} ${parts.get("hour")}:00`;
}

function formatTrendBucketTickLabel(startAt: number, trendWindow: InsightTrendWindow) {
    if (trendWindow === "7d") return formatTrendBucketLabel(startAt, trendWindow);
    const hour = new Intl.DateTimeFormat("en-GB", {
        timeZone: NEWS_INSIGHTS_TIME_ZONE,
        hour: "2-digit",
        hourCycle: "h23",
    }).format(new Date(startAt));
    return `${hour}:00`;
}

function getTrendRangeLabel(buckets: InsightTimeBucket[], trendWindow: InsightTrendWindow) {
    if (!buckets.length) return trendWindow === "24h" ? "最近 24 小时" : "最近 7 天";
    const start = formatTrendBucketLabel(buckets[0].startAt, trendWindow);
    const end = formatTrendBucketLabel(buckets[buckets.length - 1].startAt, trendWindow);
    return `${start} – ${end}`;
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

function formatRelativeTime(value: number) {
    const elapsed = Math.max(0, Date.now() - value);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
}
