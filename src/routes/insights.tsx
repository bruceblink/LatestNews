import type { SourceID } from "@shared/types";
import type { UnifiedFeedScope } from "@shared/unified-feed";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type {
    TopicEvent,
    HotNewsItem,
    KeywordTrend,
    WordCloudTerm,
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
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useReadingState } from "~/hooks/useReadingState";
import { getNewsInsightsCacheKey } from "@shared/source-api";
import { fetchNewsInsights } from "~/services/source.service";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useSourceHealthSummary } from "~/hooks/useSourceHealth";
import { getUnifiedFeedScopeSources } from "@shared/unified-feed";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";

type InsightScope = UnifiedFeedScope;

const scopeOptions: Array<{ id: InsightScope; label: string; icon: string }> = [
    { id: "focus", label: "关注", icon: "i-ph:star-duotone" },
    { id: "hottest", label: "热门", icon: "i-ph:fire-duotone" },
    { id: "realtime", label: "实时", icon: "i-ph:lightning-duotone" },
    { id: "broad", label: "综合", icon: "i-ph:circles-three-plus-duotone" },
];

export const Route = createFileRoute("/insights")({
    component: InsightsPage,
});

function InsightsPage() {
    useTitle(`${APP_TITLE} | 阅读洞察`);

    const focusSources = useAtomValue(focusSourcesAtom);
    const { history, addHistory } = useHistory();
    const { hiddenUrls } = useReadingState();
    const [scope, setScope] = useState<InsightScope>(focusSources.length ? "focus" : "hottest");
    const [trendWindow, setTrendWindow] = useState<InsightTrendWindow>("24h");

    const sources = useMemo(() => getScopeSources(scope, focusSources), [focusSources, scope]);
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
    const maxWordWeight = Math.max(...(insights?.wordCloud.map((item) => item.weight) ?? [0]));
    const maxSourceCount = Math.max(...(insights?.sourceActivity.map((item) => item.itemCount) ?? [0]));
    const maxCategoryCount = Math.max(...(insights?.categoryShares.map((item) => item.itemCount) ?? [0]));

    const handleReadHotItem = (item: HotNewsItem) => {
        addHistory(item.sourceId, item.id, item.title, item.url);
    };

    const handleReadTopicItem = (item: TopicEvent["items"][number]) => {
        addHistory(item.sourceId, item.id, item.title, item.url);
    };

    return (
        <section className="page-stack insights-page">
            <div className="surface-panel insights-hero flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="m-0 text-2xl font-bold text-zinc-800 dark:text-zinc-100">阅读洞察</h1>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                        <SignalPill icon="i-ph:database-duotone" label={`${sources.length} 个来源`} />
                        <SignalPill icon="i-ph:clock-clockwise-duotone" label={isFetching ? "更新中" : "已就绪"} />
                        {data?.meta.partial && (
                            <SignalPill icon="i-ph:warning-circle-duotone" label="部分来源未返回" tone="warning" />
                        )}
                    </div>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                    <div className="flex flex-wrap gap-2">
                        {scopeOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                className={clsx(
                                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-all",
                                    scope === option.id
                                        ? "bg-cyan-500 text-zinc-900 font-semibold"
                                        : "bg-zinc-200/75 text-zinc-700 hover:bg-zinc-300/80 dark:bg-zinc-800/65 dark:text-zinc-400 dark:hover:bg-zinc-700/75"
                                )}
                                aria-pressed={scope === option.id}
                                onClick={() => setScope(option.id)}
                            >
                                <span className={option.icon} aria-hidden="true" />
                                <span>{option.label}</span>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full bg-zinc-200/75 px-3 py-1.5 text-sm text-zinc-700 transition-all hover:bg-zinc-300/80 dark:bg-zinc-800/65 dark:text-zinc-300 dark:hover:bg-zinc-700/75"
                        disabled={isFetching}
                        aria-busy={isFetching}
                        onClick={() => void refetch()}
                    >
                        <span
                            className={clsx("i-ph:arrow-clockwise-duotone", isFetching && "animate-spin")}
                            aria-hidden="true"
                        />
                        <span>{isFetching ? "刷新中" : "刷新"}</span>
                    </button>
                </div>
            </div>

            {isError && (
                <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                    洞察加载失败{error instanceof Error ? `：${error.message}` : ""}
                </div>
            )}

            {!sources.length ? (
                <EmptyState />
            ) : (
                <>
                    <div className="grid gap-3 md:grid-cols-4">
                        <MetricCard label="新闻条目" value={insights?.itemCount ?? 0} icon="i-ph:newspaper-duotone" />
                        <MetricCard
                            label="热点排行"
                            value={insights?.hotRankings.length ?? 0}
                            icon="i-ph:fire-duotone"
                        />
                        <MetricCard
                            label="话题事件"
                            value={insights?.topicEvents.length ?? 0}
                            icon="i-ph:git-branch-duotone"
                        />
                        <MetricCard label="关键词" value={insights?.wordCloud.length ?? 0} icon="i-ph:cloud-duotone" />
                    </div>

                    <SourceHealthOverview data={healthSummary} isFetching={isHealthFetching} isError={isHealthError} />

                    <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
                        <UpdateFrequencyPanel
                            buckets={insights?.updateFrequency ?? []}
                            loading={isFetching && !insights}
                            trendWindow={trendWindow}
                            onTrendWindowChange={setTrendWindow}
                        />
                        <KeywordTrendPanel
                            items={insights?.keywordTrends ?? []}
                            loading={isFetching && !insights}
                            scope={scope}
                            trendWindow={trendWindow}
                        />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                        <HotRankingPanel items={insights?.hotRankings ?? []} scope={scope} onRead={handleReadHotItem} />
                        <TopicPanel topics={insights?.topicEvents ?? []} scope={scope} onRead={handleReadTopicItem} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                        <WordCloudPanel items={insights?.wordCloud ?? []} maxWeight={maxWordWeight} scope={scope} />
                        <CategorySharePanel
                            items={insights?.categoryShares ?? []}
                            maxCount={maxCategoryCount}
                            scope={scope}
                        />
                    </div>

                    <div className="grid gap-4">
                        <SourceActivityPanel
                            items={insights?.sourceActivity ?? []}
                            maxCount={maxSourceCount}
                            scope={scope}
                        />
                    </div>

                    {!!data?.errors.length && (
                        <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
                            {data.errors.slice(0, 3).map((item) => (
                                <div key={`${item.sourceId ?? "source"}-${item.message}`}>
                                    {item.sourceId ? `${item.sourceId}: ` : ""}
                                    {item.message}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

/**
 * Shows the source-health counters that help readers judge whether insight coverage is trustworthy.
 * It keeps the summary compact while linking operational follow-up to the full health page.
 */
function SourceHealthOverview({
    data,
    isFetching,
    isError,
}: {
    data: SourceHealthSummary | undefined;
    isFetching: boolean;
    isError: boolean;
}) {
    const attentionSourceCount = (data?.sources ?? []).filter(
        (source) => source.status === "failing" || source.cacheDegraded
    ).length;
    const attentionSources = (data?.sources ?? [])
        .filter((source) => source.status === "failing" || source.cacheDegraded)
        .sort((left, right) => {
            const statusWeight = (status: SourceHealthSummary["sources"][number]["status"]) =>
                status === "failing" ? 2 : 1;
            return (
                statusWeight(right.status) - statusWeight(left.status) ||
                right.consecutiveFailures - left.consecutiveFailures
            );
        })
        .slice(0, 4);

    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <PanelTitle icon="i-ph:heartbeat-duotone" title="来源健康概览" />
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                    {isFetching && <span className="i-ph:spinner-gap-duotone animate-spin text-cyan-600" />}
                    <Link
                        to="/health"
                        className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2.5 py-1 text-cyan-700 transition-colors hover:bg-cyan-500/18 dark:text-cyan-300"
                    >
                        <span>查看健康详情</span>
                        <span className="i-ph:arrow-up-right-duotone" />
                    </Link>
                </div>
            </div>

            {isError ? (
                <div className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    暂时无法读取来源健康状态，请前往健康页重试。
                </div>
            ) : data ? (
                <>
                    <div className="mt-4 grid gap-2 sm:grid-cols-5">
                        <HealthMetric label="总数据源" value={data.total} tone="neutral" />
                        <HealthMetric label="正常" value={data.healthy} tone="green" />
                        <HealthMetric label="异常" value={data.failing} tone="red" />
                        <HealthMetric label="未采样" value={data.idle} tone="slate" />
                        <HealthMetric label="缓存降级" value={data.cacheDegraded} tone="amber" />
                    </div>

                    {attentionSources.length > 0 && (
                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-zinc-600 dark:text-zinc-500">需要关注：</span>
                            {attentionSources.map((source) => (
                                <Link
                                    key={source.id}
                                    to="/health"
                                    className={clsx(
                                        "rounded-full border px-2.5 py-1 transition-colors hover:border-cyan-500/40 hover:text-cyan-700 dark:hover:text-cyan-300",
                                        source.status === "failing"
                                            ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                                            : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    )}
                                >
                                    {source.name}
                                </Link>
                            ))}
                            {attentionSources.length < attentionSourceCount && (
                                <Link to="/health" className="text-cyan-700 dark:text-cyan-300">
                                    查看全部
                                </Link>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <div className="mt-4 rounded-xl bg-zinc-100/70 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800/45 dark:text-zinc-500">
                    正在加载来源健康状态…
                </div>
            )}
        </section>
    );
}

/** Renders one compact health counter with a color that matches its operational meaning. */
function HealthMetric({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: "neutral" | "green" | "red" | "slate" | "amber";
}) {
    const toneClass = {
        neutral: "bg-zinc-100/80 text-zinc-700 dark:bg-zinc-800/65 dark:text-zinc-300",
        green: "bg-green-500/10 text-green-700 dark:text-green-300",
        red: "bg-red-500/10 text-red-700 dark:text-red-300",
        slate: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
        amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    }[tone];

    return (
        <div className={clsx("rounded-xl px-3 py-2", toneClass)}>
            <div className="text-xs op-75">{label}</div>
            <div className="mt-1 text-xl font-bold">{value}</div>
        </div>
    );
}

/** Displays UTC-aligned publication buckets and controls the shared trend window. */
function UpdateFrequencyPanel({
    buckets,
    loading,
    trendWindow,
    onTrendWindowChange,
}: {
    buckets: InsightTimeBucket[];
    loading: boolean;
    trendWindow: InsightTrendWindow;
    onTrendWindowChange: (window: InsightTrendWindow) => void;
}) {
    const maxCount = Math.max(...buckets.map((bucket) => bucket.itemCount), 0);
    const totalCount = buckets.reduce((total, bucket) => total + bucket.itemCount, 0);

    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <PanelTitle icon="i-ph:chart-line-up-duotone" title="更新频率" />
                <div className="flex rounded-lg bg-zinc-200/75 p-0.5 dark:bg-zinc-800/75" aria-label="趋势时间范围">
                    {(
                        [
                            ["24h", "24 小时"],
                            ["7d", "7 天"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={clsx(
                                "rounded-md px-2.5 py-1 text-xs transition-colors",
                                trendWindow === value
                                    ? "bg-white font-medium text-zinc-800 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                                    : "text-zinc-600 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
                            )}
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
                <div className="mt-4 overflow-x-auto pb-1">
                    <div
                        className="grid h-48 min-w-560px items-end gap-2"
                        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(56px, 1fr))` }}
                    >
                        {buckets.map((bucket) => {
                            const barHeight =
                                bucket.itemCount && maxCount
                                    ? Math.max(8, Math.round((bucket.itemCount / maxCount) * 128))
                                    : 0;

                            return (
                                <div
                                    key={bucket.startAt}
                                    className="grid h-full grid-rows-[20px_1fr_20px] items-end text-center"
                                    title={`${bucket.itemCount} 条 · ${bucket.sourceCount} 个来源`}
                                >
                                    <span className="text-xs text-zinc-600 dark:text-zinc-500">
                                        {bucket.itemCount || ""}
                                    </span>
                                    <div className="flex h-full items-end justify-center">
                                        <div
                                            className="w-7 rounded-t-md bg-cyan-500/75 transition-[height] dark:bg-cyan-400/65"
                                            style={{ height: `${barHeight}px` }}
                                        />
                                    </div>
                                    <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-500">
                                        {formatTrendBucketLabel(bucket.startAt, trendWindow)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-500">
                        共 {totalCount} 条具有发布时间的内容 · 时间桶按 UTC 对齐
                    </div>
                </div>
            ) : (
                <div className="mt-4">
                    <PanelEmpty label="当前时间范围内暂无可统计的发布时间" />
                </div>
            )}
        </section>
    );
}

/** Lists the strongest keyword trends and links each term to the matching Feed time range. */
function KeywordTrendPanel({
    items,
    loading,
    scope,
    trendWindow,
}: {
    items: KeywordTrend[];
    loading: boolean;
    scope: InsightScope;
    trendWindow: InsightTrendWindow;
}) {
    const maxCount = Math.max(...items.flatMap((item) => item.buckets.map((bucket) => bucket.itemCount)), 0);

    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:trend-up-duotone" title="关键词趋势" />
            <div className="mt-4 flex flex-col gap-2">
                {loading ? (
                    <PanelEmpty label="关键词趋势加载中" />
                ) : items.length ? (
                    items.map((item) => (
                        <div
                            key={item.term}
                            className="grid gap-2 rounded-xl border border-zinc-200/80 bg-white/82 px-3 py-2.5 dark:border-zinc-700/35 dark:bg-zinc-800/54 md:grid-cols-[minmax(110px,0.8fr)_1.4fr_auto] md:items-center"
                        >
                            <div className="min-w-0">
                                <Link
                                    to="/feed"
                                    search={{ q: item.term, scope, since: trendWindow }}
                                    className="block truncate text-sm font-medium text-zinc-800 transition-colors hover:text-cyan-700 dark:text-zinc-200 dark:hover:text-cyan-300"
                                >
                                    {item.term}
                                </Link>
                                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                                    {item.totalCount} 次 · {item.sourceCount} 个来源
                                </div>
                            </div>
                            <div
                                className="grid h-8 min-w-0 items-end gap-1"
                                style={{ gridTemplateColumns: `repeat(${item.buckets.length}, minmax(4px, 1fr))` }}
                                title={item.buckets.map((bucket) => bucket.itemCount).join(" / ")}
                            >
                                {item.buckets.map((bucket) => {
                                    const barHeight =
                                        bucket.itemCount && maxCount
                                            ? Math.max(3, Math.round((bucket.itemCount / maxCount) * 28))
                                            : 0;
                                    return (
                                        <span
                                            key={bucket.startAt}
                                            className="block min-w-1 rounded-sm bg-blue-500/65 dark:bg-blue-400/60"
                                            style={{ height: `${barHeight}px` }}
                                        />
                                    );
                                })}
                            </div>
                            <Link
                                to="/feed"
                                search={{ q: item.term, scope, since: trendWindow }}
                                className="inline-flex items-center justify-self-start gap-1 rounded-full bg-cyan-500/10 px-2 py-1 text-xs text-cyan-700 transition-colors hover:bg-cyan-500/18 dark:text-cyan-300 md:justify-self-end"
                            >
                                <span>查看</span>
                                <span className="i-ph:arrow-right-duotone" />
                            </Link>
                        </div>
                    ))
                ) : (
                    <PanelEmpty label="当前时间范围内暂无关键词趋势" />
                )}
            </div>
        </section>
    );
}

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
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:fire-duotone" title="热点排行" />
            <div className="mt-4 flex flex-col gap-2">
                {items.length ? (
                    items.map((item) => (
                        <article
                            key={item.id}
                            className="group flex gap-3 rounded-xl border border-zinc-200/85 bg-white/82 px-3 py-3 transition-all hover:border-zinc-300/90 hover:bg-zinc-100/95 dark:border-zinc-700/32 dark:bg-zinc-800/54 dark:hover:border-zinc-600/55 dark:hover:bg-zinc-800/78"
                        >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/12 text-sm font-bold text-cyan-700 dark:text-cyan-300">
                                {item.rank}
                            </span>
                            <div className="min-w-0 flex-1">
                                <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => onRead(item)}
                                >
                                    <span className="line-clamp-2 text-sm font-medium leading-5 text-zinc-800 transition-colors group-hover:text-cyan-700 dark:text-zinc-200 dark:group-hover:text-cyan-300">
                                        {item.title}
                                    </span>
                                </a>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                                    <span>{item.sourceName ?? dataSources[item.sourceId]?.name ?? item.sourceId}</span>
                                    <span>{item.sources.length} 源覆盖</span>
                                    <span>分数 {item.score}</span>
                                    {item.publishedAt && <RelativeTimeLabel time={item.publishedAt} />}
                                    <FeedFilterLink q={item.keywords[0] ?? item.title} scope={scope} label="相关" />
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-500">
                                    <span className="rounded-md bg-zinc-100/85 px-2 py-1 dark:bg-zinc-900/55">
                                        {item.signals.rankingReason}
                                    </span>
                                    {item.signals.categoryDistribution.map((category) => (
                                        <span
                                            key={category.categoryId}
                                            className="rounded-md bg-cyan-500/8 px-2 py-1 text-cyan-800 dark:text-cyan-300"
                                        >
                                            {category.categoryName} {category.itemCount} 条 / {category.sourceCount} 源
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <ReadingStateActions
                                entry={{
                                    newsId: item.id,
                                    title: item.title,
                                    url: item.url,
                                    sourceId: item.sourceId,
                                    sourceName: item.sourceName ?? dataSources[item.sourceId]?.name ?? item.sourceId,
                                }}
                                className="shrink-0"
                            />
                        </article>
                    ))
                ) : (
                    <PanelEmpty label="暂无热点" />
                )}
            </div>
        </section>
    );
}

function TopicPanel({
    topics,
    scope,
    onRead,
}: {
    topics: TopicEvent[];
    scope: InsightScope;
    onRead: (item: TopicEvent["items"][number]) => void;
}) {
    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:git-branch-duotone" title="话题事件" />
            <div className="mt-4 flex flex-col gap-3">
                {topics.length ? (
                    topics.map((topic) => (
                        <article
                            key={topic.id}
                            className="rounded-xl border border-zinc-200/85 bg-white/82 p-3 dark:border-zinc-700/32 dark:bg-zinc-800/54"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="line-clamp-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                    {topic.title}
                                </div>
                                <FeedFilterLink q={getTopicFeedKeyword(topic)} scope={scope} label="追踪" />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                                <span>{topic.itemCount} 条动态</span>
                                <span>{topic.sources.length} 个来源</span>
                                {topic.latestPublishedAt && <RelativeTimeLabel time={topic.latestPublishedAt} />}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {topic.keywords.slice(0, 5).map((keyword) => (
                                    <Link
                                        key={keyword}
                                        to="/feed"
                                        search={{ q: keyword, scope, since: "all" }}
                                        className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-300"
                                    >
                                        {keyword}
                                    </Link>
                                ))}
                            </div>
                            <div className="mt-3 flex flex-col gap-1.5">
                                {topic.items.slice(0, 3).map((item) => (
                                    <div
                                        key={item.id}
                                        className="flex items-center gap-2 rounded-lg bg-zinc-100/75 px-2 py-1.5 dark:bg-zinc-900/45"
                                    >
                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="line-clamp-1 min-w-0 flex-1 text-xs text-zinc-700 transition-all hover:text-cyan-700 dark:text-zinc-400 dark:hover:text-cyan-300"
                                            onClick={() => onRead(item)}
                                        >
                                            {item.sourceName ?? dataSources[item.sourceId]?.name ?? item.sourceId} ·{" "}
                                            {item.title}
                                        </a>
                                        <ReadingStateActions
                                            entry={{
                                                newsId: item.id,
                                                title: item.title,
                                                url: item.url,
                                                sourceId: item.sourceId,
                                                sourceName:
                                                    item.sourceName ??
                                                    dataSources[item.sourceId]?.name ??
                                                    item.sourceId,
                                            }}
                                            className="shrink-0"
                                        />
                                    </div>
                                ))}
                            </div>
                        </article>
                    ))
                ) : (
                    <PanelEmpty label="暂无话题" />
                )}
            </div>
        </section>
    );
}

function WordCloudPanel({
    items,
    maxWeight,
    scope,
}: {
    items: WordCloudTerm[];
    maxWeight: number;
    scope: InsightScope;
}) {
    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:cloud-duotone" title="词云图" />
            <div className="mt-4 flex min-h-48 flex-wrap content-start gap-2">
                {items.length ? (
                    items.map((item) => (
                        <Link
                            key={item.term}
                            to="/feed"
                            search={{ q: item.term, scope, since: "all" }}
                            className={clsx(
                                "rounded-full border px-3 py-1.5 font-medium transition-all hover:-translate-y-0.5 hover:border-cyan-500/35 hover:bg-cyan-500/12",
                                getWordClass(item.weight, maxWeight)
                            )}
                            title={`${item.count} 次 · ${item.sources.length} 个来源`}
                        >
                            {item.term}
                        </Link>
                    ))
                ) : (
                    <PanelEmpty label="暂无关键词" />
                )}
            </div>
        </section>
    );
}

function CategorySharePanel({
    items,
    maxCount,
    scope,
}: {
    items: CategoryShare[];
    maxCount: number;
    scope: InsightScope;
}) {
    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:chart-pie-slice-duotone" title="分类占比" />
            <div className="mt-4 flex flex-col gap-3">
                {items.length ? (
                    items.map((item) => {
                        const percent = Math.round(item.ratio * 100);
                        const barWidth = maxCount ? Math.max(6, Math.round((item.itemCount / maxCount) * 100)) : 0;

                        return (
                            <div key={item.categoryId} className="rounded-xl bg-white/82 p-3 dark:bg-zinc-800/54">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <Link
                                            to="/feed"
                                            search={{ category: item.categoryId, scope, since: "all" }}
                                            className="font-medium text-zinc-800 transition-colors hover:text-cyan-700 dark:text-zinc-200 dark:hover:text-cyan-300"
                                        >
                                            {item.categoryName}
                                        </Link>
                                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                                            {item.sourceCount} 个来源 · {item.itemCount} 条
                                        </div>
                                    </div>
                                    <div className="text-lg font-bold text-cyan-700 dark:text-cyan-300">{percent}%</div>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-900/70">
                                    <div
                                        className="h-full rounded-full bg-cyan-500"
                                        style={{ width: `${barWidth}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <PanelEmpty label="暂无分类统计" />
                )}
            </div>
        </section>
    );
}

function SourceActivityPanel({
    items,
    maxCount,
    scope,
}: {
    items: SourceActivity[];
    maxCount: number;
    scope: InsightScope;
}) {
    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:chart-bar-duotone" title="来源活跃度" />
            <div className="mt-4 flex flex-col gap-3">
                {items.length ? (
                    items.slice(0, 12).map((item) => {
                        const percent = maxCount ? Math.max(6, Math.round((item.itemCount / maxCount) * 100)) : 0;

                        return (
                            <div
                                key={item.sourceId}
                                className="grid gap-2 md:grid-cols-[120px_1fr_48px] md:items-center"
                            >
                                <Link
                                    to="/feed"
                                    search={{ scope, since: "all", source: item.sourceId }}
                                    className="truncate text-sm text-zinc-700 transition-colors hover:text-cyan-700 dark:text-zinc-300 dark:hover:text-cyan-300"
                                >
                                    {item.sourceName ?? dataSources[item.sourceId]?.name ?? item.sourceId}
                                </Link>
                                <div className="h-2 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800">
                                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${percent}%` }} />
                                </div>
                                <div className="text-right text-xs text-zinc-600 dark:text-zinc-500">
                                    {item.itemCount} 条
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <PanelEmpty label="暂无统计" />
                )}
            </div>
        </section>
    );
}

function FeedFilterLink({ q, scope, label }: { q: string; scope: InsightScope; label: string }) {
    return (
        <Link
            to="/feed"
            search={{ q, scope, since: "all" }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 transition-all hover:bg-cyan-500/18 dark:text-cyan-300"
        >
            <span className="i-ph:funnel-duotone" />
            <span>{label}</span>
        </Link>
    );
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="insights-metric-card rounded-2xl p-4">
            <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-500">
                <span>{label}</span>
                <span className={clsx("text-lg text-cyan-600 dark:text-cyan-300", icon)} />
            </div>
            <div className="mt-2 text-3xl font-bold text-zinc-800 dark:text-zinc-100">{value}</div>
        </div>
    );
}

function PanelTitle({ icon, title }: { icon: string; title: string }) {
    return (
        <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-100">
            <span className={clsx("text-lg text-cyan-600 dark:text-cyan-300", icon)} />
            <h2 className="m-0 text-lg font-semibold">{title}</h2>
        </div>
    );
}

function SignalPill({ icon, label, tone = "neutral" }: { icon: string; label: string; tone?: "neutral" | "warning" }) {
    return (
        <span
            className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                tone === "warning"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-zinc-200/80 bg-zinc-100/80 text-zinc-700 dark:border-zinc-700/45 dark:bg-zinc-800/65 dark:text-zinc-400"
            )}
        >
            <span className={icon} />
            <span>{label}</span>
        </span>
    );
}

function PanelEmpty({ label }: { label: string }) {
    return (
        <div className="flex min-h-28 flex-1 items-center justify-center rounded-xl bg-zinc-100/70 text-sm text-zinc-500 dark:bg-zinc-800/45 dark:text-zinc-500">
            {label}
        </div>
    );
}

function EmptyState() {
    return (
        <div className="rounded-2xl bg-zinc-50/88 p-8 text-center text-sm text-zinc-600 shadow shadow-primary/6 dark:bg-zinc-900/68 dark:text-zinc-500">
            关注栏为空，先添加关注源后可查看专属洞察。
        </div>
    );
}

function RelativeTimeLabel({ time }: { time: number }) {
    const relativeTime = useRelativeTime(time);
    return <span>{relativeTime ?? "刚刚"}</span>;
}

function getScopeSources(scope: InsightScope, focusSources: SourceID[]) {
    return getUnifiedFeedScopeSources(scope, focusSources, scope === "focus" ? 100 : 30);
}

function getTopicFeedKeyword(topic: TopicEvent) {
    return topic.keywords[0] ?? topic.title;
}

function getWordClass(weight: number, maxWeight: number) {
    const ratio = maxWeight ? weight / maxWeight : 0;
    if (ratio > 0.72) {
        return "border-cyan-500/20 bg-cyan-500/16 text-base text-cyan-700 dark:text-cyan-300";
    }
    if (ratio > 0.45) {
        return "border-blue-500/18 bg-blue-500/12 text-sm text-blue-700 dark:text-blue-300";
    }
    return "border-zinc-200/90 bg-white/82 text-xs text-zinc-700 dark:border-zinc-700/40 dark:bg-zinc-800/62 dark:text-zinc-400";
}

/** Formats fixed UTC bucket boundaries consistently across browser time zones. */
function formatTrendBucketLabel(startAt: number, trendWindow: InsightTrendWindow) {
    const date = new Date(startAt);
    if (trendWindow === "7d") {
        return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    }
    return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
}
