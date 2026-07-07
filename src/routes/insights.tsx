import type { SourceID } from "@shared/types";
import type { TopicEvent, HotNewsItem, WordCloudTerm, CategoryShare, SourceActivity } from "@shared/news-insights";

import clsx from "clsx";
import { useTitle } from "react-use";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { focusSourcesAtom } from "~/atoms";
import dataSources from "@shared/data-sources";
import { useHistory } from "~/hooks/useHistory";
import { useQuery } from "@tanstack/react-query";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useReadingState } from "~/hooks/useReadingState";
import { getNewsInsightsCacheKey } from "@shared/source-api";
import { fetchNewsInsights } from "~/services/source.service";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getUnifiedFeedScopeSources } from "@shared/unified-feed";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";

type InsightScope = "focus" | "hottest" | "realtime" | "broad";

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
    useTitle(`${import.meta.env.VITE_APP_TITLE} | 阅读洞察`);

    const focusSources = useAtomValue(focusSourcesAtom);
    const { history, addHistory } = useHistory();
    const { hiddenUrls } = useReadingState();
    const [scope, setScope] = useState<InsightScope>(focusSources.length ? "focus" : "hottest");

    const sources = useMemo(() => getScopeSources(scope, focusSources), [focusSources, scope]);
    const readUrls = useMemo(() => history.map((item) => item.url), [history]);
    const payload = useMemo(
        () => ({
            sources,
            hotLimit: 12,
            topicLimit: 8,
            wordLimit: 28,
            minTopicItems: 2,
            readUrls,
            hiddenUrls,
        }),
        [hiddenUrls, readUrls, sources]
    );

    const { data, isFetching, isError, error, refetch } = useQuery({
        queryKey: getNewsInsightsCacheKey(payload),
        queryFn: () => fetchNewsInsights(payload),
        enabled: sources.length > 0,
        staleTime: 1000 * 60 * 3,
        retry: false,
    });

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
        <section className="mx-auto flex max-w-6xl flex-col gap-4 px-1 md:px-4">
            <div className="flex flex-col gap-3 rounded-2xl bg-zinc-50/90 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68 md:flex-row md:items-center md:justify-between">
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
                                onClick={() => setScope(option.id)}
                            >
                                <span className={option.icon} />
                                <span>{option.label}</span>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full bg-zinc-200/75 px-3 py-1.5 text-sm text-zinc-700 transition-all hover:bg-zinc-300/80 dark:bg-zinc-800/65 dark:text-zinc-300 dark:hover:bg-zinc-700/75"
                        onClick={() => void refetch()}
                    >
                        <span className={clsx("i-ph:arrow-clockwise-duotone", isFetching && "animate-spin")} />
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

                    <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                        <HotRankingPanel items={insights?.hotRankings ?? []} onRead={handleReadHotItem} />
                        <TopicPanel topics={insights?.topicEvents ?? []} onRead={handleReadTopicItem} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                        <WordCloudPanel items={insights?.wordCloud ?? []} maxWeight={maxWordWeight} />
                        <CategorySharePanel items={insights?.categoryShares ?? []} maxCount={maxCategoryCount} />
                    </div>

                    <div className="grid gap-4">
                        <SourceActivityPanel items={insights?.sourceActivity ?? []} maxCount={maxSourceCount} />
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

function HotRankingPanel({ items, onRead }: { items: HotNewsItem[]; onRead: (item: HotNewsItem) => void }) {
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

function TopicPanel({ topics, onRead }: { topics: TopicEvent[]; onRead: (item: TopicEvent["items"][number]) => void }) {
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
                            <div className="line-clamp-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                {topic.title}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                                <span>{topic.itemCount} 条动态</span>
                                <span>{topic.sources.length} 个来源</span>
                                {topic.latestPublishedAt && <RelativeTimeLabel time={topic.latestPublishedAt} />}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {topic.keywords.slice(0, 5).map((keyword) => (
                                    <span
                                        key={keyword}
                                        className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-300"
                                    >
                                        {keyword}
                                    </span>
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

function WordCloudPanel({ items, maxWeight }: { items: WordCloudTerm[]; maxWeight: number }) {
    return (
        <section className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:cloud-duotone" title="词云图" />
            <div className="mt-4 flex min-h-48 flex-wrap content-start gap-2">
                {items.length ? (
                    items.map((item) => (
                        <Link
                            key={item.term}
                            to="/feed"
                            search={{ q: item.term, scope: "broad" }}
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

function CategorySharePanel({ items, maxCount }: { items: CategoryShare[]; maxCount: number }) {
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
                                        <div className="font-medium text-zinc-800 dark:text-zinc-200">
                                            {item.categoryName}
                                        </div>
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

function SourceActivityPanel({ items, maxCount }: { items: SourceActivity[]; maxCount: number }) {
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
                                <div className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                                    {item.sourceName ?? dataSources[item.sourceId]?.name ?? item.sourceId}
                                </div>
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

function MetricCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-2xl bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:bg-zinc-900/68">
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
