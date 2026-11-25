import type { ReactNode } from "react";
import type { SourceID } from "@shared/types";
import type { SourceBatchResponse } from "@shared/source-api";
import type {
    UnifiedFeedItem,
    UnifiedFeedScope,
    UnifiedFeedSince,
    UnifiedFeedSearch,
    UnifiedFeedCategoryID,
} from "@shared/unified-feed";

import clsx from "clsx";
import { useTitle } from "react-use";
import { useAtomValue } from "jotai";
import { metadata } from "@shared/metadata";
import { APP_TITLE } from "~/utils/app-title";
import { feedScopeSourcesAtom } from "~/atoms";
import { useHistory } from "~/hooks/useHistory";
import { NewsLink } from "~/components/reading/NewsLink";
import { createFileRoute } from "@tanstack/react-router";
import { filterSourceItems } from "@shared/source-items";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useReadingState } from "~/hooks/useReadingState";
import { getUnifiedFeedCacheKey } from "@shared/source-api";
import { fetchUnifiedFeed } from "~/services/source.service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useMemo, useState, useEffect, useCallback } from "react";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";
import { saveOfflineFeedSnapshot, readOfflineFeedSnapshotStatus } from "~/services/offline-feed-snapshot.service";
import {
    unifiedFeedPageSize,
    createUnifiedFeedView,
    getUnifiedFeedVisibleItems,
    normalizeUnifiedFeedSearch,
    unifiedFeedInitialVisibleItems,
} from "@shared/unified-feed";

const scopeOptions: Array<{ id: UnifiedFeedScope; label: string; icon: string }> = [
    { id: "focus", label: "关注", icon: "i-ph:star-duotone" },
    { id: "hottest", label: "热门", icon: "i-ph:fire-duotone" },
    { id: "realtime", label: "实时", icon: "i-ph:lightning-duotone" },
    { id: "broad", label: "综合", icon: "i-ph:circles-three-plus-duotone" },
];

const sinceOptions: Array<{ label: string; value: UnifiedFeedSince }> = [
    { label: "不限", value: "all" },
    { label: "24小时", value: "24h" },
    { label: "3天", value: "3d" },
    { label: "7天", value: "7d" },
];

const categoryOptions: Array<{ id: UnifiedFeedCategoryID | "all"; label: string }> = [
    { id: "all", label: "全部分类" },
    ...(["china", "world", "tech", "finance", "hottest", "realtime"] as const).map((id) => ({
        id,
        label: metadata[id].name,
    })),
];

export const Route = createFileRoute("/feed")({
    component: FeedPage,
    validateSearch: normalizeUnifiedFeedSearch,
});

function FeedPage() {
    const queryClient = useQueryClient();
    useTitle(`${APP_TITLE} | 统一 Feed`);

    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const scopeSources = useAtomValue(feedScopeSourcesAtom);
    const hasFocus = scopeSources.focus.length > 0;
    const { history, addHistory } = useHistory();
    const { hiddenUrls } = useReadingState();
    const [scope, setScope] = useState<UnifiedFeedScope>(search.scope ?? (hasFocus ? "focus" : "hottest"));
    const [keyword, setKeyword] = useState(search.q ?? "");
    const [sourceId, setSourceId] = useState<SourceID | "all">(search.source ?? "all");
    const [categoryId, setCategoryId] = useState<UnifiedFeedCategoryID | "all">(search.category ?? "all");
    const [since, setSince] = useState<UnifiedFeedSince>(search.since ?? "24h");
    const updateSearch = useCallback(
        (patch: Partial<UnifiedFeedSearch>, replace = false) => {
            void navigate({
                replace,
                search: (previous) => normalizeUnifiedFeedSearch({ ...previous, ...patch }),
            });
        },
        [navigate]
    );

    useEffect(() => {
        setKeyword(search.q ?? "");
        setScope(search.scope ?? (hasFocus ? "focus" : "hottest"));
        setSourceId(search.source ?? "all");
        setCategoryId(search.category ?? "all");
        setSince(search.since ?? "24h");
    }, [hasFocus, search.category, search.q, search.scope, search.since, search.source]);

    const sources = scopeSources[scope];
    const sinceValue = useMemo(() => getSinceValue(since), [since]);
    const payload = useMemo(
        () => ({
            sources,
            ...(sinceValue && { since: sinceValue }),
        }),
        [sinceValue, sources]
    );
    const offlineSnapshotPayload = useMemo(
        () => ({
            scope,
            since,
            sources,
        }),
        [scope, since, sources]
    );

    const savedSnapshot = useMemo(
        () => readOfflineFeedSnapshotStatus(offlineSnapshotPayload),
        [offlineSnapshotPayload]
    );
    const offlineSnapshot = savedSnapshot.snapshot;
    const { data, isFetching, isError, refetch } = useQuery({
        queryKey: getUnifiedFeedCacheKey(payload),
        queryFn: async ({ queryKey }) => {
            const response = await fetchUnifiedFeed(payload);
            const previous = queryClient.getQueryData<SourceBatchResponse>(queryKey);
            const historical = previous ?? offlineSnapshot?.response;
            const display = mergeFeedHistory(response, historical);
            // Preserve a complete offline snapshot across partial refreshes.
            if (
                display === response &&
                (!response.meta.partial || !historical) &&
                response.data.some((source) => source.items.length)
            ) {
                saveOfflineFeedSnapshot(offlineSnapshotPayload, display);
            }
            return display;
        },
        enabled: sources.length > 0,
        staleTime: 1000 * 60 * 2,
        retry: false,
    });

    const isOfflineSnapshotActive = !data && Boolean(offlineSnapshot);
    const activeResponse = data ?? offlineSnapshot?.response;
    const loadedResponses = useMemo(
        () =>
            (activeResponse?.data ?? []).map((source) => {
                const items = filterSourceItems(source.items, { since: sinceValue });
                return items === source.items ? source : { ...source, items };
            }),
        [activeResponse, sinceValue]
    );
    const hasLoadedItems = loadedResponses.some((source) => source.items.length > 0);
    const isShowingHistory = loadedResponses.some(
        (source) => source.items.length && (source.status === "stale-cache" || source.status === "degraded-cache")
    );
    const sourceOptionView = useMemo(() => createUnifiedFeedView(loadedResponses), [loadedResponses]);
    const feedView = useMemo(
        () =>
            createUnifiedFeedView(loadedResponses, {
                keyword,
                sourceId,
                categoryId,
                hiddenUrls,
                limit: 120,
            }),
        [categoryId, hiddenUrls, keyword, loadedResponses, sourceId]
    );
    const [visibleItemCount, setVisibleItemCount] = useState(unifiedFeedInitialVisibleItems);
    const visibleItems = useMemo(
        () => getUnifiedFeedVisibleItems(feedView.items, visibleItemCount),
        [feedView.items, visibleItemCount]
    );

    useEffect(() => {
        setVisibleItemCount(unifiedFeedInitialVisibleItems);
    }, [feedView.items]);

    const readUrls = useMemo(() => new Set(history.map((item) => item.url)), [history]);
    const sourceOptions = sourceOptionView.sourceSummaries.slice(0, 80);
    const hasActiveFilters = Boolean(
        feedView.activeFilters.keyword || sourceId !== "all" || categoryId !== "all" || since !== "24h"
    );

    const handleRead = useCallback(
        (item: UnifiedFeedItem) => {
            addHistory(item.sourceId, item.item.id, item.title, item.url);
        },
        [addHistory]
    );

    return (
        <section className="page-stack feed-page">
            <div className="surface-panel feed-toolbar">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h1 className="m-0 text-2xl font-bold text-zinc-800 dark:text-zinc-100">统一 Feed</h1>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                            <SignalPill icon="i-ph:database-duotone" label={`${sources.length} 个来源`} />
                            <SignalPill
                                icon="i-ph:newspaper-duotone"
                                label={
                                    feedView.items.length < feedView.filteredItemCount
                                        ? `${feedView.items.length}/${feedView.filteredItemCount} 条内容`
                                        : `${feedView.filteredItemCount} 条内容`
                                }
                            />
                            {activeResponse?.meta.partial && (
                                <SignalPill icon="i-ph:warning-circle-duotone" label="部分来源未返回" tone="warning" />
                            )}
                            {isOfflineSnapshotActive && offlineSnapshot ? (
                                <SnapshotSignalPill savedAt={offlineSnapshot.savedAt} />
                            ) : (
                                <SignalPill
                                    icon="i-ph:clock-clockwise-duotone"
                                    label={isFetching ? "更新中" : isError ? "更新失败" : "已就绪"}
                                />
                            )}
                        </div>
                    </div>
                    <div className="feed-toolbar-actions">
                        <div className="feed-mode-switch">
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
                                    onClick={() => {
                                        setScope(option.id);
                                        updateSearch({ scope: option.id });
                                    }}
                                >
                                    <span className={option.icon} />
                                    <span>{option.label}</span>
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="feed-refresh inline-flex items-center gap-2 rounded-full bg-zinc-200/75 px-3 py-1.5 text-sm text-zinc-700 transition-all hover:bg-zinc-300/80 dark:bg-zinc-800/65 dark:text-zinc-300 dark:hover:bg-zinc-700/75"
                            disabled={isFetching}
                            aria-busy={isFetching}
                            onClick={() => void refetch()}
                        >
                            <span
                                className={clsx(
                                    "i-ph:arrow-clockwise-duotone",
                                    isFetching && "motion-safe:animate-spin"
                                )}
                                aria-hidden="true"
                            />
                            <span>{isFetching ? "刷新中" : "刷新"}</span>
                        </button>
                    </div>
                </div>

                <div className="feed-filters mt-4 grid gap-3 lg:grid-cols-[1fr_160px_160px_130px_auto]">
                    <label className="relative block">
                        <span className="i-ph:magnifying-glass-duotone absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                            value={keyword}
                            onChange={(event) => {
                                const value = event.currentTarget.value;
                                setKeyword(value);
                                updateSearch({ q: value }, true);
                            }}
                            placeholder="搜索标题、来源或分类"
                            className="h-10 w-full rounded-xl border border-zinc-200/90 bg-white/86 pl-9 pr-3 text-sm outline-none transition-all focus:border-cyan-500/55 dark:border-zinc-700/40 dark:bg-zinc-800/64"
                        />
                    </label>
                    <select
                        value={sourceId}
                        aria-label="筛选来源"
                        onChange={(event) => {
                            const value = event.currentTarget.value as SourceID | "all";
                            setSourceId(value);
                            updateSearch({ source: value === "all" ? undefined : value });
                        }}
                        className="h-10 rounded-xl border border-zinc-200/90 bg-white/86 px-3 text-sm outline-none focus:border-cyan-500/55 dark:border-zinc-700/40 dark:bg-zinc-800/64"
                    >
                        <option value="all">全部来源</option>
                        {sourceOptions.map((source) => (
                            <option key={source.sourceId} value={source.sourceId}>
                                {source.sourceName}
                            </option>
                        ))}
                    </select>
                    <select
                        value={categoryId}
                        aria-label="筛选分类"
                        onChange={(event) => {
                            const value = event.currentTarget.value as UnifiedFeedCategoryID | "all";
                            setCategoryId(value);
                            updateSearch({ category: value === "all" ? undefined : value });
                        }}
                        className="h-10 rounded-xl border border-zinc-200/90 bg-white/86 px-3 text-sm outline-none focus:border-cyan-500/55 dark:border-zinc-700/40 dark:bg-zinc-800/64"
                    >
                        {categoryOptions.map((category) => (
                            <option key={category.id} value={category.id}>
                                {category.label}
                            </option>
                        ))}
                    </select>
                    <select
                        value={since}
                        aria-label="筛选时间范围"
                        onChange={(event) => {
                            const value = event.currentTarget.value as UnifiedFeedSince;
                            setSince(value);
                            updateSearch({ since: value });
                        }}
                        className="h-10 rounded-xl border border-zinc-200/90 bg-white/86 px-3 text-sm outline-none focus:border-cyan-500/55 dark:border-zinc-700/40 dark:bg-zinc-800/64"
                    >
                        {sinceOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="h-10 rounded-xl bg-zinc-200/75 px-4 text-sm text-zinc-700 transition-all enabled:hover:bg-zinc-300/80 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-zinc-800/65 dark:text-zinc-300 dark:enabled:hover:bg-zinc-700/75"
                        disabled={!hasActiveFilters}
                        onClick={() => {
                            setKeyword("");
                            setSourceId("all");
                            setCategoryId("all");
                            setSince("24h");
                            updateSearch({ q: undefined, source: undefined, category: undefined, since: undefined });
                        }}
                    >
                        重置
                    </button>
                </div>
            </div>

            {isOfflineSnapshotActive && offlineSnapshot && (
                <OfflineSnapshotNotice
                    savedAt={offlineSnapshot.savedAt}
                    stale={savedSnapshot.state === "stale"}
                    updateFailed={isError}
                />
            )}

            {!isOfflineSnapshotActive && (isError || isShowingHistory || activeResponse?.meta.partial) && (
                <div
                    className="rounded-lg border border-amber-500/25 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
                    role="status"
                >
                    {isError
                        ? hasLoadedItems
                            ? "Feed 更新失败，已保留上次内容。"
                            : "暂时无法加载 Feed。请点击刷新重试。"
                        : isShowingHistory
                          ? "部分来源正在显示历史数据。"
                          : "部分来源暂未返回，已加载的内容仍可阅读。"}
                </div>
            )}

            {!sources.length ? (
                <EmptyState />
            ) : (
                <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
                    <FeedList
                        items={visibleItems}
                        availableCount={feedView.items.length}
                        filteredCount={feedView.filteredItemCount}
                        emptyLabel={
                            isFetching && !activeResponse
                                ? "正在加载 Feed"
                                : (isError || activeResponse?.meta.partial) && !hasLoadedItems
                                  ? "暂无可用内容"
                                  : "暂无匹配内容"
                        }
                        readUrls={readUrls}
                        onRead={handleRead}
                        onLoadMore={() =>
                            setVisibleItemCount((current) =>
                                Math.min(current + unifiedFeedPageSize, feedView.items.length)
                            )
                        }
                    />
                    <FeedAside
                        categories={feedView.categorySummaries}
                        sources={feedView.sourceSummaries}
                        selectedCategory={categoryId}
                        selectedSource={sourceId}
                        onSelectCategory={(value) => {
                            setCategoryId(value);
                            updateSearch({ category: value === "all" ? undefined : value });
                        }}
                        onSelectSource={(value) => {
                            setSourceId(value);
                            updateSearch({ source: value === "all" ? undefined : value });
                        }}
                    />
                </div>
            )}
        </section>
    );
}

/** Restore unavailable sources within the same scope and window, preserving successful filtered results. */
function mergeFeedHistory(response: SourceBatchResponse, historical?: SourceBatchResponse): SourceBatchResponse {
    if (!historical) return response;
    const available = new Map(response.data.map((source) => [source.id, source]));
    const omitted = new Set(response.meta.omittedSourceIds);
    let restored = false;
    for (const source of historical.data) {
        if (!source.items.length || (!omitted.has(source.id) && available.get(source.id)?.status !== "empty")) continue;
        available.set(source.id, { ...source, status: "stale-cache" });
        restored = true;
    }
    return restored ? { ...response, data: [...available.values()] } : response;
}

// Renders a bounded feed page and lets readers request more entries on demand.
const FeedList = memo(function FeedListContent({
    items,
    availableCount,
    filteredCount,
    emptyLabel,
    readUrls,
    onRead,
    onLoadMore,
}: {
    items: UnifiedFeedItem[];
    availableCount: number;
    filteredCount: number;
    emptyLabel: string;
    readUrls: Set<string>;
    onRead: (item: UnifiedFeedItem) => void;
    onLoadMore: () => void;
}) {
    return (
        <section className="surface-panel feed-list-panel">
            <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs text-zinc-500">
                <span>
                    已显示 {items.length} / {availableCount} 条
                    {filteredCount > availableCount ? `（匹配 ${filteredCount} 条）` : ""}
                </span>
            </div>
            <div className="flex flex-col gap-2">
                {items.length ? (
                    items.map((item) => {
                        const isRead = readUrls.has(item.url);

                        return (
                            <article key={item.id} className={clsx("feed-article group", isRead && "is-read")}>
                                <div className="flex items-start justify-between gap-3">
                                    <NewsLink
                                        href={item.url}
                                        preferredHref={item.mobileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="min-w-0 flex-1"
                                        onClick={() => onRead(item)}
                                    >
                                        <div className="feed-article-title line-clamp-2">
                                            {item.title}
                                            {isRead && <ReadBadge />}
                                        </div>
                                    </NewsLink>
                                    <ReadingStateActions
                                        entry={{
                                            newsId: item.item.id,
                                            title: item.title,
                                            url: item.url,
                                            sourceId: item.sourceId,
                                            sourceName: item.sourceName,
                                        }}
                                        className="shrink-0"
                                    />
                                </div>
                                <div className="feed-article-meta">
                                    <span>{item.sourceName}</span>
                                    <span>{item.categoryName}</span>
                                    {(item.publishedAt ?? item.responseUpdatedTime) && (
                                        <RelativeTimeLabel time={(item.publishedAt ?? item.responseUpdatedTime)!} />
                                    )}
                                </div>
                            </article>
                        );
                    })
                ) : (
                    <PanelEmpty label={emptyLabel} />
                )}
            </div>
            {items.length < availableCount && (
                <button
                    type="button"
                    className="mt-3 h-10 w-full rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-sm font-medium text-cyan-700 transition-colors hover:bg-cyan-500/18 dark:text-cyan-300"
                    onClick={onLoadMore}
                >
                    加载更多（{Math.min(unifiedFeedPageSize, availableCount - items.length)} 条）
                </button>
            )}
        </section>
    );
});

FeedList.displayName = "FeedList";

function FeedAside({
    categories,
    sources,
    selectedCategory,
    selectedSource,
    onSelectCategory,
    onSelectSource,
}: {
    categories: ReturnType<typeof createUnifiedFeedView>["categorySummaries"];
    sources: ReturnType<typeof createUnifiedFeedView>["sourceSummaries"];
    selectedCategory: UnifiedFeedCategoryID | "all";
    selectedSource: SourceID | "all";
    onSelectCategory: (categoryId: UnifiedFeedCategoryID | "all") => void;
    onSelectSource: (sourceId: SourceID | "all") => void;
}) {
    return (
        <aside className="flex flex-col gap-4">
            <SummaryPanel icon="i-ph:chart-pie-slice-duotone" title="分类分布">
                <FilterButton
                    active={selectedCategory === "all"}
                    label="全部分类"
                    count={categories.reduce((sum, item) => sum + item.itemCount, 0)}
                    onClick={() => onSelectCategory("all")}
                />
                {categories.slice(0, 8).map((category) => (
                    <FilterButton
                        key={category.categoryId}
                        active={selectedCategory === category.categoryId}
                        label={category.categoryName}
                        count={category.itemCount}
                        onClick={() => onSelectCategory(category.categoryId)}
                    />
                ))}
            </SummaryPanel>
            <SummaryPanel icon="i-ph:broadcast-duotone" title="来源分布">
                <FilterButton
                    active={selectedSource === "all"}
                    label="全部来源"
                    count={sources.reduce((sum, item) => sum + item.itemCount, 0)}
                    onClick={() => onSelectSource("all")}
                />
                {sources.slice(0, 10).map((source) => (
                    <FilterButton
                        key={source.sourceId}
                        active={selectedSource === source.sourceId}
                        label={source.sourceName}
                        count={source.itemCount}
                        onClick={() => onSelectSource(source.sourceId)}
                    />
                ))}
            </SummaryPanel>
        </aside>
    );
}

function SummaryPanel({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
    return (
        <section className="rounded-2xl border border-zinc-200/88 bg-zinc-50/88 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
            <div className="mb-3 flex items-center gap-2 text-zinc-800 dark:text-zinc-100">
                <span className={clsx("text-lg text-cyan-600 dark:text-cyan-300", icon)} />
                <h2 className="m-0 text-base font-semibold">{title}</h2>
            </div>
            <div className="flex flex-col gap-2">{children}</div>
        </section>
    );
}

function FilterButton({
    active,
    label,
    count,
    onClick,
}: {
    active: boolean;
    label: string;
    count: number;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            className={clsx(
                "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all",
                active
                    ? "bg-cyan-500/16 text-cyan-800 dark:text-cyan-300"
                    : "bg-white/74 text-zinc-700 hover:bg-zinc-100/95 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-800/72"
            )}
            onClick={onClick}
        >
            <span className="truncate">{label}</span>
            <span className="rounded-full bg-zinc-200/75 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-500">
                {count}
            </span>
        </button>
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
            <span className={icon} aria-hidden="true" />
            <span>{label}</span>
        </span>
    );
}

function SnapshotSignalPill({ savedAt }: { savedAt: number }) {
    const relativeTime = useRelativeTime(savedAt);

    return <SignalPill icon="i-ph:hard-drives-duotone" label={`${relativeTime ?? "刚刚"}的快照`} tone="warning" />;
}

function OfflineSnapshotNotice({
    savedAt,
    stale,
    updateFailed,
}: {
    savedAt: number;
    stale: boolean;
    updateFailed: boolean;
}) {
    const relativeTime = useRelativeTime(savedAt);

    return (
        <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300" role="status">
            当前展示{relativeTime ?? "较早"}保存的 Feed 快照。
            {stale && "快照已过期，内容仅供回顾。"}
            {updateFailed && "更新失败，可点击刷新重试。"}
        </div>
    );
}

function ReadBadge() {
    return (
        <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-zinc-200/75 px-1.5 py-0.5 text-[10px] leading-none text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-500">
            <span className="i-ph:check-duotone text-xs" />
            <span>已读</span>
        </span>
    );
}

function RelativeTimeLabel({ time }: { time: number }) {
    const relativeTime = useRelativeTime(time);
    return <span>{relativeTime ?? "刚刚"}</span>;
}

function PanelEmpty({ label }: { label: string }) {
    return (
        <div className="flex min-h-60 flex-1 items-center justify-center rounded-xl bg-zinc-100/70 text-sm text-zinc-500 dark:bg-zinc-800/45 dark:text-zinc-500">
            {label}
        </div>
    );
}

function EmptyState() {
    return (
        <div className="rounded-2xl bg-zinc-50/88 p-8 text-center text-sm text-zinc-600 shadow shadow-primary/6 dark:bg-zinc-900/68 dark:text-zinc-500">
            关注栏为空，先添加关注源后可查看统一 Feed。
        </div>
    );
}

function getSinceValue(value: UnifiedFeedSince) {
    const now = Date.now();
    if (value === "24h") return now - 24 * 60 * 60 * 1000;
    if (value === "3d") return now - 3 * 24 * 60 * 60 * 1000;
    if (value === "7d") return now - 7 * 24 * 60 * 60 * 1000;
    return undefined;
}
