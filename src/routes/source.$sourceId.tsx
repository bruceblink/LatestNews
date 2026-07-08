import type { SourceID } from "@shared/types";
import type { SourceMetadataItem } from "@shared/source-metadata";
import type { SourceHealthSnapshot } from "@shared/source-health-types";

import clsx from "clsx";
import { useTitle } from "react-use";
import { useMemo, useState } from "react";
import { useFocusWith } from "~/hooks/useFocus";
import { useHistory } from "~/hooks/useHistory";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useReadingState } from "~/hooks/useReadingState";
import { createUnifiedFeedView } from "@shared/unified-feed";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSourceHealthSummary } from "~/hooks/useSourceHealth";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";
import {
    fetchUnifiedFeed,
    fetchSourceItemsV1,
    fetchSourceMetadata,
    fetchSourceMetadataItem,
} from "~/services/source.service";
import {
    sourceMetadataCacheKey,
    getUnifiedFeedCacheKey,
    getSourceItemsV1CacheKey,
    getSourceMetadataItemCacheKey,
} from "@shared/source-api";

export const Route = createFileRoute("/source/$sourceId")({
    component: SourceDetailPage,
});

function SourceDetailPage() {
    const { sourceId } = Route.useParams();
    const requestedId = sourceId as SourceID;
    const queryClient = useQueryClient();
    const { history, addHistory } = useHistory();
    const { hiddenUrls, isHiddenUrl } = useReadingState();
    const [isClearingCache, setIsClearingCache] = useState(false);

    const metadataItemQuery = useQuery({
        queryKey: getSourceMetadataItemCacheKey(requestedId),
        queryFn: () => fetchSourceMetadataItem(requestedId),
        staleTime: 1000 * 60 * 10,
        retry: false,
    });
    const metadataItem = metadataItemQuery.data?.data;
    const id = metadataItemQuery.data?.meta.canonicalSourceId ?? requestedId;
    const { sourceHealthMap } = useSourceHealthSummary();
    const { isFocused, toggleFocus } = useFocusWith(id);
    const health = sourceHealthMap.get(id);
    const metadataQuery = useQuery({
        queryKey: sourceMetadataCacheKey,
        queryFn: fetchSourceMetadata,
        enabled: Boolean(metadataItem?.column),
        staleTime: 1000 * 60 * 10,
        retry: false,
    });

    useTitle(`${import.meta.env.VITE_APP_TITLE} | ${metadataItem?.name ?? sourceId}`);

    const sourceItemsQueryKey = useMemo(() => getSourceItemsV1CacheKey(id, { limit: 20 }), [id]);
    const itemsQuery = useQuery({
        queryKey: sourceItemsQueryKey,
        queryFn: () => fetchSourceItemsV1(id, { limit: 20 }),
        enabled: Boolean(metadataItem && !metadataItem.disabled),
        staleTime: 1000 * 60 * 2,
        retry: false,
    });

    const relatedFeedPayload = useMemo(
        () => ({
            sources: metadataItem?.column
                ? (metadataQuery.data?.data.columns
                      .find((column) => column.id === metadataItem.column)
                      ?.sourceIds.filter((source) => source !== id)
                      .slice(0, 8) ?? [])
                : [],
        }),
        [id, metadataItem?.column, metadataQuery.data?.data.columns]
    );

    const relatedFeedQuery = useQuery({
        queryKey: getUnifiedFeedCacheKey(relatedFeedPayload),
        queryFn: () => fetchUnifiedFeed(relatedFeedPayload),
        enabled: relatedFeedPayload.sources.length > 0,
        staleTime: 1000 * 60 * 3,
        retry: false,
    });
    const relatedFeed = useMemo(
        () =>
            createUnifiedFeedView(relatedFeedQuery.data?.data ?? [], {
                hiddenUrls,
                limit: 6,
            }),
        [hiddenUrls, relatedFeedQuery.data?.data]
    );
    const readUrls = useMemo(() => new Set(history.map((item) => item.url)), [history]);
    const visibleItems = useMemo(
        () => itemsQuery.data?.data.items.filter((item) => !isHiddenUrl(item.url)) ?? [],
        [isHiddenUrl, itemsQuery.data?.data.items]
    );
    const handleClearCacheRefresh = async () => {
        setIsClearingCache(true);
        try {
            const response = await fetchSourceItemsV1(id, { limit: 20, latest: true, clearCache: true });
            queryClient.setQueryData(sourceItemsQueryKey, response);
        } finally {
            setIsClearingCache(false);
        }
    };

    if (metadataItemQuery.isLoading) {
        return (
            <section className="mx-auto max-w-5xl px-1 md:px-4">
                <PanelEmpty label="正在加载来源详情" />
            </section>
        );
    }

    if (!metadataItem) {
        return (
            <section className="mx-auto max-w-5xl px-1 md:px-4">
                <div className="rounded-2xl bg-zinc-50/88 p-8 text-center text-sm text-zinc-600 shadow shadow-primary/6 dark:bg-zinc-900/68 dark:text-zinc-500">
                    未找到这个数据源。
                    <Link
                        to="/feed"
                        search={{ q: undefined, scope: undefined }}
                        className="ml-2 text-cyan-700 dark:text-cyan-300"
                    >
                        返回 Feed
                    </Link>
                </div>
            </section>
        );
    }

    return (
        <section className="mx-auto flex max-w-5xl flex-col gap-4 px-1 md:px-4">
            <div className="rounded-2xl border border-zinc-200/88 bg-zinc-50/90 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 gap-4">
                        <a
                            className="h-14 w-14 shrink-0 rounded-2xl bg-cover bg-center ring-1 ring-zinc-300/85 dark:ring-zinc-700/65"
                            href={metadataItem.home}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ backgroundImage: `url(/icons/${metadataItem.id.split("-")[0]}.png)` }}
                        />
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="m-0 text-2xl font-bold text-zinc-800 dark:text-zinc-100">
                                    {metadataItem.name}
                                </h1>
                                {metadataItem.title && (
                                    <span
                                        className={clsx(
                                            "rounded px-2 py-1 text-xs",
                                            `color-${metadataItem.color} bg-zinc-100/90 dark:bg-zinc-800/70 op-85`
                                        )}
                                    >
                                        {metadataItem.title}
                                    </span>
                                )}
                                <HealthBadge health={health} />
                            </div>
                            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-500">{metadataItem.id}</div>
                            {metadataItem.description && (
                                <p className="m-0 mt-3 max-w-2xl text-sm leading-6 text-zinc-700 dark:text-zinc-400">
                                    {metadataItem.description}
                                </p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                                <InfoPill label={metadataItem.columnName ?? "未分类"} icon="i-ph:folders-duotone" />
                                <InfoPill label={getSourceTypeLabel(metadataItem.type)} icon="i-ph:stack-duotone" />
                                <InfoPill
                                    label={`${Math.round(metadataItem.interval / 1000)} 秒间隔`}
                                    icon="i-ph:clock-duotone"
                                />
                                {itemsQuery.data?.data.status && (
                                    <InfoPill
                                        label={getSourceStatusLabel(itemsQuery.data.data.status)}
                                        icon="i-ph:database-duotone"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                        <button
                            type="button"
                            className={clsx(
                                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-all",
                                isFocused
                                    ? "bg-cyan-500 text-zinc-900 font-semibold"
                                    : "bg-cyan-500/14 text-cyan-800 hover:bg-cyan-500/24 dark:text-cyan-300"
                            )}
                            onClick={toggleFocus}
                        >
                            <span className={isFocused ? "i-ph:star-fill" : "i-ph:star-duotone"} />
                            <span>{isFocused ? "已关注" : "加入关注"}</span>
                        </button>
                        {metadataItem.home && (
                            <a
                                href={metadataItem.home}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-full bg-zinc-200/75 px-3 py-1.5 text-sm text-zinc-700 transition-all hover:bg-zinc-300/80 dark:bg-zinc-800/65 dark:text-zinc-300 dark:hover:bg-zinc-700/75"
                            >
                                <span className="i-ph:arrow-square-out-duotone" />
                                <span>源站</span>
                            </a>
                        )}
                        <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full bg-zinc-200/75 px-3 py-1.5 text-sm text-zinc-700 transition-all hover:bg-zinc-300/80 dark:bg-zinc-800/65 dark:text-zinc-300 dark:hover:bg-zinc-700/75"
                            onClick={() => void itemsQuery.refetch()}
                        >
                            <span
                                className={clsx(
                                    "i-ph:arrow-clockwise-duotone",
                                    itemsQuery.isFetching && "animate-spin"
                                )}
                            />
                            <span>{itemsQuery.isFetching ? "刷新中" : "刷新"}</span>
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full bg-amber-500/12 px-3 py-1.5 text-sm text-amber-800 transition-all hover:bg-amber-500/18 dark:text-amber-300"
                            onClick={() => void handleClearCacheRefresh()}
                        >
                            <span
                                className={clsx(
                                    isClearingCache ? "i-ph:spinner-gap-duotone animate-spin" : "i-ph:trash-duotone"
                                )}
                            />
                            <span>{isClearingCache ? "清理中" : "清缓存刷新"}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <MetricCard
                    label="最近条目"
                    value={itemsQuery.data?.meta.itemCount ?? 0}
                    icon="i-ph:newspaper-duotone"
                />
                <MetricCard label="健康状态" value={getHealthMetricLabel(health)} icon="i-ph:heartbeat-duotone" />
                <MetricCard label="成功次数" value={health?.successCount ?? 0} icon="i-ph:check-circle-duotone" />
                <MetricCard label="失败次数" value={health?.errorCount ?? 0} icon="i-ph:warning-circle-duotone" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                <section className="rounded-2xl border border-zinc-200/88 bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
                    <PanelTitle icon="i-ph:newspaper-duotone" title="最近更新" />
                    <div className="mt-4 flex flex-col gap-2">
                        {itemsQuery.isError && (
                            <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                                加载失败{itemsQuery.error instanceof Error ? `：${itemsQuery.error.message}` : ""}
                            </div>
                        )}
                        {visibleItems.length ? (
                            visibleItems.map((item) => {
                                const isRead = readUrls.has(item.url);
                                return (
                                    <article
                                        key={item.id}
                                        className={clsx(
                                            "group rounded-xl border px-3 py-3 transition-all",
                                            isRead
                                                ? "border-zinc-200/75 bg-zinc-100/70 dark:border-zinc-800/70 dark:bg-zinc-800/34"
                                                : "border-zinc-200/85 bg-white/84 hover:border-zinc-300/90 hover:bg-zinc-100/95 dark:border-zinc-700/32 dark:bg-zinc-800/54 dark:hover:border-zinc-600/55 dark:hover:bg-zinc-800/78"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <a
                                                href={item.mobileUrl ?? item.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="min-w-0 flex-1"
                                                onClick={() => addHistory(id, item.id, item.title, item.url)}
                                            >
                                                <div className="line-clamp-2 text-sm font-medium leading-5 text-zinc-800 transition-colors group-hover:text-cyan-700 dark:text-zinc-200 dark:group-hover:text-cyan-300">
                                                    {item.title}
                                                    {isRead && <ReadBadge />}
                                                </div>
                                            </a>
                                            <ReadingStateActions
                                                entry={{
                                                    newsId: item.id,
                                                    title: item.title,
                                                    url: item.url,
                                                    sourceId: id,
                                                    sourceName: metadataItem.name,
                                                }}
                                                className="shrink-0"
                                            />
                                        </div>
                                        {(item.pubDate ?? item.extra?.date) && (
                                            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-500">
                                                <RelativeTimeLabel time={(item.pubDate ?? item.extra?.date)!} />
                                            </div>
                                        )}
                                    </article>
                                );
                            })
                        ) : (
                            <PanelEmpty label={itemsQuery.isFetching ? "正在加载最近更新" : "暂无最近更新"} />
                        )}
                    </div>
                </section>

                <aside className="flex flex-col gap-4">
                    <HealthPanel health={health} />
                    <section className="rounded-2xl border border-zinc-200/88 bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
                        <PanelTitle icon="i-ph:compass-duotone" title="同类动态" />
                        <div className="mt-4 flex flex-col gap-2">
                            {relatedFeed.items.length ? (
                                relatedFeed.items.map((item) => (
                                    <Link
                                        key={item.id}
                                        to="/source/$sourceId"
                                        params={{ sourceId: item.sourceId }}
                                        className="rounded-xl bg-white/74 px-3 py-2 text-sm text-zinc-700 transition-all hover:bg-zinc-100/95 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-800/72"
                                    >
                                        <div className="line-clamp-2">{item.title}</div>
                                        <div className="mt-1 text-xs text-zinc-500">{item.sourceName}</div>
                                    </Link>
                                ))
                            ) : (
                                <PanelEmpty label="暂无同类动态" />
                            )}
                        </div>
                    </section>
                </aside>
            </div>
        </section>
    );
}

function HealthPanel({ health }: { health?: SourceHealthSnapshot }) {
    return (
        <section className="rounded-2xl border border-zinc-200/88 bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
            <PanelTitle icon="i-ph:heartbeat-duotone" title="健康摘要" />
            <div className="mt-4 grid gap-2 text-sm">
                <InfoRow label="状态" value={getHealthMetricLabel(health)} />
                <InfoRow label="连续失败" value={health ? String(health.consecutiveFailures) : "-"} />
                <InfoRow label="缓存降级" value={health?.cacheDegraded ? "是" : "否"} />
                <InfoRow label="最近耗时" value={health?.lastDurationMs ? `${health.lastDurationMs} ms` : "-"} />
                <InfoRow
                    label="最近条数"
                    value={health?.lastItemCount !== undefined ? String(health.lastItemCount) : "-"}
                />
                <InfoRow
                    label="最近错误"
                    value={health?.lastErrorAt ? new Date(health.lastErrorAt).toLocaleString("zh-CN") : "-"}
                />
            </div>
            {health?.lastErrorMessage && (
                <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {health.lastErrorMessage}
                </div>
            )}
        </section>
    );
}

function MetricCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
    return (
        <div className="rounded-2xl border border-zinc-200/88 bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
            <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-500">
                <span>{label}</span>
                <span className={clsx("text-lg text-cyan-600 dark:text-cyan-300", icon)} />
            </div>
            <div className="mt-2 text-2xl font-bold text-zinc-800 dark:text-zinc-100">{value}</div>
        </div>
    );
}

function PanelTitle({ icon, title }: { icon: string; title: string }) {
    return (
        <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-100">
            <span className={clsx("text-lg text-cyan-600 dark:text-cyan-300", icon)} />
            <h2 className="m-0 text-base font-semibold">{title}</h2>
        </div>
    );
}

function InfoPill({ icon, label }: { icon: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-100/80 px-2.5 py-1 text-zinc-700 dark:border-zinc-700/45 dark:bg-zinc-800/65 dark:text-zinc-400">
            <span className={icon} />
            <span>{label}</span>
        </span>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/74 px-3 py-2 dark:bg-zinc-800/50">
            <span className="text-zinc-600 dark:text-zinc-500">{label}</span>
            <span className="text-right text-zinc-800 dark:text-zinc-200">{value}</span>
        </div>
    );
}

function HealthBadge({ health }: { health?: SourceHealthSnapshot }) {
    const label = getHealthMetricLabel(health);
    const className =
        health?.status === "failing"
            ? "bg-red-500/10 text-red-700 dark:text-red-300"
            : health?.status === "healthy"
              ? "bg-green-500/10 text-green-700 dark:text-green-300"
              : "bg-zinc-200/75 text-zinc-700 dark:bg-zinc-700/35 dark:text-zinc-500";

    return <span className={clsx("rounded px-2 py-1 text-xs", className)}>{label}</span>;
}

function ReadBadge() {
    return (
        <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-zinc-200/75 px-1.5 py-0.5 text-[10px] leading-none text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-500">
            <span className="i-ph:check-duotone text-xs" />
            <span>已读</span>
        </span>
    );
}

function RelativeTimeLabel({ time }: { time: number | string }) {
    const relativeTime = useRelativeTime(time);
    return <>{relativeTime ?? "刚刚"}</>;
}

function PanelEmpty({ label }: { label: string }) {
    return (
        <div className="flex min-h-32 flex-1 items-center justify-center rounded-xl bg-zinc-100/70 text-sm text-zinc-500 dark:bg-zinc-800/45 dark:text-zinc-500">
            {label}
        </div>
    );
}

function getSourceTypeLabel(type: SourceMetadataItem["type"]) {
    if (type === "hottest") return "热门榜";
    if (type === "realtime") return "实时流";
    return "普通源";
}

function getSourceStatusLabel(status: string) {
    if (status === "cache") return "缓存";
    if (status === "degraded-cache") return "降级缓存";
    if (status === "stale-cache") return "旧缓存";
    if (status === "empty") return "空数据";
    return "最新";
}

function getHealthMetricLabel(health?: SourceHealthSnapshot) {
    if (!health) return "未采样";
    if (health.status === "healthy") return "正常";
    if (health.status === "failing") return "异常";
    return "未采样";
}
