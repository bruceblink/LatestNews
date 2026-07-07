import type { ReactNode } from "react";
import type { SourceID } from "@shared/types";
import type { UnifiedFeedItem, UnifiedFeedScope, UnifiedFeedCategoryID } from "@shared/unified-feed";

import clsx from "clsx";
import { useTitle } from "react-use";
import { useAtomValue } from "jotai";
import { focusSourcesAtom } from "~/atoms";
import { metadata } from "@shared/metadata";
import { useHistory } from "~/hooks/useHistory";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useReadingState } from "~/hooks/useReadingState";
import { getUnifiedFeedCacheKey } from "@shared/source-api";
import { fetchUnifiedFeed } from "~/services/source.service";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";
import { isUnifiedFeedScope, createUnifiedFeedView, getUnifiedFeedScopeSources } from "@shared/unified-feed";

const scopeOptions: Array<{ id: UnifiedFeedScope; label: string; icon: string }> = [
    { id: "focus", label: "关注", icon: "i-ph:star-duotone" },
    { id: "hottest", label: "热门", icon: "i-ph:fire-duotone" },
    { id: "realtime", label: "实时", icon: "i-ph:lightning-duotone" },
    { id: "broad", label: "综合", icon: "i-ph:circles-three-plus-duotone" },
];

const sinceOptions = [
    { label: "不限", value: "all" },
    { label: "24小时", value: "24h" },
    { label: "3天", value: "3d" },
    { label: "7天", value: "7d" },
] as const;

const categoryOptions: Array<{ id: UnifiedFeedCategoryID | "all"; label: string }> = [
    { id: "all", label: "全部分类" },
    ...(["china", "world", "tech", "finance", "hottest", "realtime"] as const).map((id) => ({
        id,
        label: metadata[id].name,
    })),
];

export const Route = createFileRoute("/feed")({
    component: FeedPage,
    validateSearch: (search: Record<string, unknown>) => ({
        q: typeof search.q === "string" ? search.q : undefined,
        scope: isUnifiedFeedScope(search.scope) ? search.scope : undefined,
    }),
});

function FeedPage() {
    useTitle(`${import.meta.env.VITE_APP_TITLE} | 统一 Feed`);

    const search = Route.useSearch();
    const focusSources = useAtomValue(focusSourcesAtom);
    const { history, addHistory } = useHistory();
    const { hiddenUrls } = useReadingState();
    const [scope, setScope] = useState<UnifiedFeedScope>(search.scope ?? (focusSources.length ? "focus" : "hottest"));
    const [keyword, setKeyword] = useState(search.q ?? "");
    const [sourceId, setSourceId] = useState<SourceID | "all">("all");
    const [categoryId, setCategoryId] = useState<UnifiedFeedCategoryID | "all">("all");
    const [since, setSince] = useState<(typeof sinceOptions)[number]["value"]>("24h");

    useEffect(() => {
        setKeyword(search.q ?? "");
        if (search.scope) setScope(search.scope);
    }, [search.q, search.scope]);

    const sources = useMemo(() => getUnifiedFeedScopeSources(scope, focusSources), [focusSources, scope]);
    const sinceValue = useMemo(() => getSinceValue(since), [since]);
    const payload = useMemo(
        () => ({
            sources,
            ...(sinceValue && { since: sinceValue }),
        }),
        [sinceValue, sources]
    );

    const { data, isFetching, isError, error, refetch } = useQuery({
        queryKey: getUnifiedFeedCacheKey(payload),
        queryFn: () => fetchUnifiedFeed(payload),
        enabled: sources.length > 0,
        staleTime: 1000 * 60 * 2,
        retry: false,
    });

    const loadedResponses = useMemo(() => data?.data ?? [], [data?.data]);
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
    const readUrls = useMemo(() => new Set(history.map((item) => item.url)), [history]);
    const sourceOptions = sourceOptionView.sourceSummaries.slice(0, 80);
    const hasActiveFilters = Boolean(feedView.activeFilters.keyword || sourceId !== "all" || categoryId !== "all");

    const handleRead = (item: UnifiedFeedItem) => {
        addHistory(item.sourceId, item.item.id, item.title, item.url);
    };

    const resetFilters = () => {
        setKeyword("");
        setSourceId("all");
        setCategoryId("all");
    };

    return (
        <section className="mx-auto flex max-w-6xl flex-col gap-4 px-1 md:px-4">
            <div className="rounded-2xl border border-zinc-200/88 bg-zinc-50/90 p-4 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h1 className="m-0 text-2xl font-bold text-zinc-800 dark:text-zinc-100">统一 Feed</h1>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                            <SignalPill icon="i-ph:database-duotone" label={`${sources.length} 个来源`} />
                            <SignalPill icon="i-ph:newspaper-duotone" label={`${feedView.filteredItemCount} 条内容`} />
                            {data?.meta.partial && (
                                <SignalPill icon="i-ph:warning-circle-duotone" label="部分来源未返回" tone="warning" />
                            )}
                            <SignalPill icon="i-ph:clock-clockwise-duotone" label={isFetching ? "更新中" : "已就绪"} />
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

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_160px_160px_130px_auto]">
                    <label className="relative block">
                        <span className="i-ph:magnifying-glass-duotone absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                            value={keyword}
                            onChange={(event) => setKeyword(event.currentTarget.value)}
                            placeholder="搜索标题、来源或分类"
                            className="h-10 w-full rounded-xl border border-zinc-200/90 bg-white/86 pl-9 pr-3 text-sm outline-none transition-all focus:border-cyan-500/55 dark:border-zinc-700/40 dark:bg-zinc-800/64"
                        />
                    </label>
                    <select
                        value={sourceId}
                        onChange={(event) => setSourceId(event.currentTarget.value as SourceID | "all")}
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
                        onChange={(event) => setCategoryId(event.currentTarget.value as UnifiedFeedCategoryID | "all")}
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
                        onChange={(event) => setSince(event.currentTarget.value as typeof since)}
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
                        onClick={resetFilters}
                    >
                        重置
                    </button>
                </div>
            </div>

            {isError && (
                <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                    Feed 加载失败{error instanceof Error ? `：${error.message}` : ""}
                </div>
            )}

            {!sources.length ? (
                <EmptyState />
            ) : (
                <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
                    <FeedList items={feedView.items} readUrls={readUrls} onRead={handleRead} />
                    <FeedAside
                        categories={feedView.categorySummaries}
                        sources={feedView.sourceSummaries}
                        selectedCategory={categoryId}
                        selectedSource={sourceId}
                        onSelectCategory={setCategoryId}
                        onSelectSource={setSourceId}
                    />
                </div>
            )}

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
        </section>
    );
}

function FeedList({
    items,
    readUrls,
    onRead,
}: {
    items: UnifiedFeedItem[];
    readUrls: Set<string>;
    onRead: (item: UnifiedFeedItem) => void;
}) {
    return (
        <section className="rounded-2xl border border-zinc-200/88 bg-zinc-50/88 p-3 shadow shadow-primary/6 dark:border-zinc-700/32 dark:bg-zinc-900/68">
            <div className="flex flex-col gap-2">
                {items.length ? (
                    items.map((item) => {
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
                                        onClick={() => onRead(item)}
                                    >
                                        <div className="line-clamp-2 text-sm font-medium leading-5 text-zinc-800 transition-colors group-hover:text-cyan-700 dark:text-zinc-200 dark:group-hover:text-cyan-300">
                                            {item.title}
                                            {isRead && <ReadBadge />}
                                        </div>
                                    </a>
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
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
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
                    <PanelEmpty label="暂无匹配内容" />
                )}
            </div>
        </section>
    );
}

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
            <span className={icon} />
            <span>{label}</span>
        </span>
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

function getSinceValue(value: (typeof sinceOptions)[number]["value"]) {
    const now = Date.now();
    if (value === "24h") return now - 24 * 60 * 60 * 1000;
    if (value === "3d") return now - 3 * 24 * 60 * 60 * 1000;
    if (value === "7d") return now - 7 * 24 * 60 * 60 * 1000;
    return undefined;
}
