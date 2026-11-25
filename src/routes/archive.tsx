import type { FormEvent } from "react";
import type { ArticleSearchItem } from "@shared/source-api";

import { useTitle } from "react-use";
import { useState, useEffect } from "react";
import { usePWAStatus } from "~/hooks/usePWA";
import { APP_TITLE } from "~/utils/app-title";
import dataSources from "@shared/data-sources";
import { useHistory } from "~/hooks/useHistory";
import { articleTimestamp } from "@shared/article-time";
import { NewsLink } from "~/components/reading/NewsLink";
import { useReadingState } from "~/hooks/useReadingState";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { safeNewsUrl, safeNewsItemLinks } from "@shared/news-url-policy";
import { ReadingStateActions } from "~/components/reading/ReadingStateActions";
import { fetchArchiveEvent, searchArticleArchive } from "~/services/source.service";
import { validArchiveKey, archiveErrorLabel, normalizeArchiveSearch } from "@shared/article-archive";

const limit = 50;
export const Route = createFileRoute("/archive")({
    validateSearch: normalizeArchiveSearch,
    component: ArchivePage,
});

function ArchivePage() {
    useTitle(APP_TITLE + " | 新闻档案");
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const { isOffline } = usePWAStatus();
    const [q, setQ] = useState(search.q ?? "");
    const [source, setSource] = useState(search.source ?? "");
    const [since, setSince] = useState(search.since ?? "");
    const [showHidden, setShowHidden] = useState(false);
    useEffect(() => {
        setQ(search.q ?? "");
        setSource(search.source ?? "");
        setSince(search.since ?? "");
        setShowHidden(false);
    }, [search.q, search.source, search.since, search.event]);
    const query = useQuery({
        queryKey: ["article-archive", search.q, search.source, search.since],
        queryFn: ({ signal }) =>
            searchArticleArchive({ q: search.q!, source: search.source, since: search.since, limit }, signal),
        enabled: Boolean(search.q && !search.event && !isOffline),
        retry: false,
    });
    const event = useInfiniteQuery({
        queryKey: ["article-event", search.event],
        queryFn: ({ signal, pageParam }) => fetchArchiveEvent(search.event!, pageParam, signal),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last, allPages) => {
            const next = last.meta.nextCursor;
            return validArchiveKey(next) && !allPages.slice(0, -1).some((page) => page.meta.nextCursor === next)
                ? next
                : undefined;
        },
        enabled: Boolean(search.event && !isOffline),
        retry: false,
    });
    const active = search.event ? event : query;
    const eventPages = search.event ? (event.data?.pages ?? []) : [];
    const articles = search.event ? eventPages.flatMap((page) => page.data.items) : (query.data?.data.items ?? []);
    const { isHiddenUrl } = useReadingState();
    const seen = new Set<string>();
    const safe = articles.flatMap((article) => {
        if (
            !article ||
            typeof article.articleKey !== "string" ||
            typeof article.title !== "string" ||
            !Array.isArray(article.sourceIds)
        )
            return [];
        const item = safeNewsItemLinks(article.item);
        if (!item || !safeNewsUrl(article.canonicalUrl) || seen.has(article.articleKey)) return [];
        seen.add(article.articleKey);
        return [{ ...article, item }];
    });
    const visible = showHidden ? safe : safe.filter((article) => !isHiddenUrl(article.item.url));
    const sources = Object.entries(dataSources).sort(([, a], [, b]) => a.name.localeCompare(b.name, "zh"));
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!q.trim()) return;
        void navigate({ search: normalizeArchiveSearch({ q, source, since }) });
    }
    const eventInfo = eventPages[0]?.data;
    const resultMode = query.data?.data.searchMode;
    const hasQuery = Boolean(search.q || search.event);
    return (
        <section className="page-stack archive-page min-w-0">
            <div className="surface-panel flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h1 className="m-0 text-2xl font-bold">{search.event ? "事件历史" : "新闻档案"}</h1>
                    <Link to="/history" className="text-sm text-primary">
                        我的阅读历史
                    </Link>
                </div>
                <p className="m-0 text-sm text-zinc-600 dark:text-zinc-400">
                    查询远端已收录的历史文章，与本机阅读历史及实时 Feed 分开。
                </p>
                {search.event ? (
                    <div className="flex flex-col gap-2 text-sm">
                        <Link to="/archive" search={{}} className="text-primary">
                            返回历史检索
                        </Link>
                        <div className="break-all">事件 ID：{search.event}</div>
                        {eventInfo?.canonicalEventId && (
                            <div className="break-all">规范事件：{eventInfo.canonicalEventId}</div>
                        )}
                        {eventInfo && <div>注册时间：{formatTime(eventInfo.registeredAt)}</div>}
                        <p className="m-0 text-zinc-500">只展示服务端持久归属的文章；注册时间不代表事件发生时间。</p>
                    </div>
                ) : (
                    <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1 text-sm md:col-span-2">
                            关键词
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                maxLength={256}
                                required
                                placeholder="输入历史新闻关键词"
                                className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-600"
                            />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">
                            来源
                            <select
                                aria-label="来源"
                                value={source}
                                onChange={(e) => setSource(e.target.value)}
                                className="min-w-0 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-600"
                            >
                                <option value="">全部来源</option>
                                {source && !sources.some(([id]) => id === source) && (
                                    <option value={source}>{source}</option>
                                )}
                                {sources.map(([id, value]) => (
                                    <option key={id} value={id}>
                                        {value.name} ({id})
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">
                            发布时间起点（UTC）
                            <input
                                type="date"
                                value={since}
                                onChange={(e) => setSince(e.target.value)}
                                className="min-w-0 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-600"
                            />
                        </label>
                        <button
                            type="submit"
                            disabled={!q.trim() || isOffline}
                            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-zinc-600"
                        >
                            检索历史文章
                        </button>
                    </form>
                )}
            </div>
            <div className="surface-panel flex flex-col gap-3" aria-live="polite">
                {isOffline ? (
                    <p role="status">
                        当前离线。历史索引需要远端服务；不会使用实时 Feed 或本地阅读记录冒充历史检索结果。
                    </p>
                ) : !hasQuery ? (
                    <p>输入关键词开始检索。</p>
                ) : active.isPending ? (
                    <p role="status">正在读取历史索引…</p>
                ) : active.isError && (!search.event || !eventInfo) ? (
                    <div role="alert">
                        <p>{archiveErrorLabel(active.error, Boolean(search.event))}</p>
                        <button
                            type="button"
                            onClick={() => void active.refetch()}
                            className="rounded-lg border px-3 py-2 text-sm"
                        >
                            重试
                        </button>
                    </div>
                ) : (
                    <>
                        {!search.event && (
                            <div className="text-sm text-zinc-500">
                                关键词：{search.q} ·{" "}
                                {resultMode === "fts"
                                    ? "全文检索"
                                    : resultMode === "like"
                                      ? "字面匹配（包含中文及索引降级情形）"
                                      : "索引状态未知"}{" "}
                                · 最多 {limit} 条，非全部匹配数。
                            </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span>
                                已返回 {safe.length} 篇 · 当前可见 {visible.length} 篇
                            </span>
                            <label className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={showHidden}
                                    onChange={(e) => setShowHidden(e.target.checked)}
                                />
                                显示隐藏文章
                            </label>
                        </div>
                        {active.isFetching && !event.isFetchingNextPage && (
                            <p role="status" className="text-sm">
                                更新中…
                            </p>
                        )}
                        {!visible.length && (
                            <p>没有可展示的文章。{search.event && event.hasNextPage ? "可以继续读取下一页。" : ""}</p>
                        )}
                        {visible.map((article) => (
                            <ArchiveArticle
                                key={article.articleKey}
                                article={article}
                                currentEvent={eventInfo?.canonicalEventId ?? search.event}
                            />
                        ))}
                        {search.event && event.isError && (
                            <div role="alert">
                                <p>{archiveErrorLabel(event.error, true)} 已加载的结果保留。</p>
                                {!event.isFetchNextPageError && (
                                    <button
                                        type="button"
                                        onClick={() => void event.refetch()}
                                        className="rounded-lg border px-3 py-2 text-sm"
                                    >
                                        重试
                                    </button>
                                )}
                            </div>
                        )}
                        {search.event && event.hasNextPage && (
                            <button
                                type="button"
                                disabled={event.isFetchingNextPage}
                                onClick={() => void event.fetchNextPage()}
                                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
                            >
                                {event.isFetchingNextPage ? "加载中…" : "加载更多事件文章"}
                            </button>
                        )}
                        {!search.event && safe.length === limit && (
                            <p className="text-sm text-zinc-500">已达到结果上限，请缩小关键词、来源或日期范围。</p>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

function formatTime(value: unknown) {
    const timestamp = articleTimestamp(value);
    return timestamp === null ? "时间未知" : new Date(timestamp).toLocaleString();
}

function ArchiveArticle({ article, currentEvent }: { article: ArticleSearchItem; currentEvent?: string }) {
    const { addHistory, history } = useHistory();
    const sourceId = article.sourceIds[0];
    const sourceName = sourceId ? (dataSources[sourceId]?.name ?? sourceId) : "来源未知";
    const url = article.item.url;
    const read = history.some((item) => item.url === url);
    return (
        <article className="flex min-w-0 flex-col gap-2 border-t border-zinc-200 py-3 dark:border-zinc-700">
            <NewsLink
                href={url}
                preferredHref={article.item.mobileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-words font-medium"
                onClick={() => {
                    if (sourceId) addHistory(sourceId, article.item.id, article.title, url);
                }}
            >
                {article.title}
            </NewsLink>
            <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                <span>{article.sourceIds.map((id) => dataSources[id]?.name ?? id).join(" · ") || sourceName}</span>
                <span>{formatTime(article.publishedAt)}</span>
                {read && <span>已读</span>}
                {validArchiveKey(article.eventId) && !currentEvent && !article.eventId.startsWith("candidate-") && (
                    <Link to="/archive" search={{ event: article.eventId }} className="text-primary">
                        查看事件历史
                    </Link>
                )}
            </div>
            {sourceId && (
                <ReadingStateActions
                    entry={{ newsId: article.item.id, title: article.title, url, sourceId, sourceName }}
                />
            )}
        </article>
    );
}
