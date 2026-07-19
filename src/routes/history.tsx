import type { SourceID } from "@shared/types";
import type { ReadingStateKind } from "@shared/reading-state";

import clsx from "clsx";
import { useTitle } from "react-use";
import { useMemo, useState } from "react";
import { getDateLabel } from "~/utils/date";
import { useToast } from "~/hooks/useToast";
import dataSources from "@shared/data-sources";
import { useHistory } from "~/hooks/useHistory";
import { createFileRoute } from "@tanstack/react-router";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useReadingState } from "~/hooks/useReadingState";
import { getReadingStateList } from "@shared/reading-state";
import { formatReadingHistoryExport } from "@shared/history-export";
import { verifyLatestNewsSyncHubConnection } from "@shared/synchub-contract";
import { filterReadingHistory, hasReadingHistoryFilters } from "@shared/history-filter";
import {
    getSyncHubConfig,
    saveSyncHubConfig,
    clearSyncHubConfig,
    defaultSyncHubEndpoint,
} from "~/services/synchub.service";

export const Route = createFileRoute("/history")({
    component: HistoryPage,
});

function HistoryItem({
    title,
    url,
    sourceName,
    readAt,
    onRemove,
}: {
    title: string;
    url: string;
    sourceName: string;
    readAt: number;
    onRemove: () => void;
}) {
    const relativeTime = useRelativeTime(readAt);

    return (
        <div className="group flex items-start justify-between gap-3 rounded-xl bg-white/82 dark:bg-zinc-900/70 border border-zinc-200/90 dark:border-zinc-700/30 px-4 py-3 transition-all hover:border-zinc-300/80 dark:hover:border-zinc-600/50 hover:bg-zinc-100/95 dark:hover:bg-zinc-800/60">
            <div className="min-w-0 flex-1">
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-cyan-300 transition-colors visited:text-zinc-600 dark:visited:text-zinc-500"
                >
                    {title}
                </a>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-700/40 border border-zinc-200/90 dark:border-zinc-700/40 px-2 py-0.5 text-zinc-700 dark:text-zinc-400">
                        {sourceName}
                    </span>
                    <span>{relativeTime ?? "刚刚"}</span>
                </div>
            </div>
            <button
                type="button"
                title="移除此条记录"
                className="mt-0.5 shrink-0 i-ph:x-duotone op-0 group-hover:op-40 hover:op-80! transition-opacity btn text-base"
                onClick={onRemove}
            />
        </div>
    );
}

function HistoryPage() {
    useTitle(`${import.meta.env.VITE_APP_TITLE} | 阅读历史`);
    const { history, clearHistory, clearSourceHistory, removeHistory } = useHistory();
    const { readingState, removeState } = useReadingState();
    const toaster = useToast();
    const [keyword, setKeyword] = useState("");
    const [sourceFilter, setSourceFilter] = useState<SourceID | "">("");
    const [stateTab, setStateTab] = useState<HistoryTab>("history");
    const [syncHubEndpoint, setSyncHubEndpoint] = useState(() => getSyncHubConfig().endpoint);
    const [syncHubApiKey, setSyncHubApiKey] = useState(() => getSyncHubConfig().apiKey);
    const [syncHubChecking, setSyncHubChecking] = useState(false);

    const sourceOptions = useMemo(() => {
        const map = new Map<string, { count: number; name: string }>();
        for (const item of history) {
            const current = map.get(item.sourceId) ?? {
                count: 0,
                name: dataSources[item.sourceId]?.name ?? item.sourceName,
            };
            current.count += 1;
            map.set(item.sourceId, current);
        }
        return Array.from(map.entries())
            .map(([id, item]) => ({ id, ...item }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }, [history]);

    const hasActiveFilters = hasReadingHistoryFilters({ keyword, sourceId: sourceFilter });

    const filtered = useMemo(
        () => filterReadingHistory(history, { keyword, sourceId: sourceFilter }),
        [history, keyword, sourceFilter]
    );

    const groups = useMemo(() => {
        const map = new Map<string, typeof filtered>();
        for (const item of filtered) {
            const label = getDateLabel(item.readAt);
            const group = map.get(label) ?? [];
            map.set(label, group);
            group.push(item);
        }
        return Array.from(map.entries());
    }, [filtered]);

    const handleClearAll = () => {
        if (history.length === 0) return;
        if (!window.confirm(`确认清空全部 ${history.length} 条阅读历史？`)) return;
        clearHistory();
    };

    const selectedSource = sourceOptions.find((source) => source.id === sourceFilter);

    const handleClearSource = () => {
        if (!sourceFilter || !selectedSource) return;
        if (!window.confirm(`确认清空「${selectedSource.name}」的 ${selectedSource.count} 条阅读历史？`)) return;
        clearSourceHistory(sourceFilter);
        setSourceFilter("");
    };

    const resetFilters = () => {
        setKeyword("");
        setSourceFilter("");
    };

    const copyFilteredHistory = async () => {
        if (filtered.length === 0) return;

        try {
            await navigator.clipboard.writeText(formatReadingHistoryExport(filtered));
            toaster(`已复制 ${filtered.length} 条阅读历史`, { type: "success" });
        } catch {
            toaster("复制失败，请检查浏览器剪贴板权限", { type: "error" });
        }
    };

    const stateKind = getHistoryTabReadingKind(stateTab);
    const stateItems = stateKind ? getReadingStateList(readingState, stateKind) : [];

    return (
        <section className="mx-auto flex max-w-4xl flex-col gap-4 px-1 md:px-4">
            <div className="flex flex-col gap-3 rounded-2xl bg-zinc-50/90 dark:bg-zinc-900/68 border border-zinc-200/88 dark:border-zinc-700/32 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="m-0 text-2xl font-bold text-zinc-800 dark:text-zinc-100">阅读历史</h1>
                    <p className="m-0 mt-2 text-sm text-zinc-600 dark:text-zinc-500">
                        记录最近点击阅读的文章，最多保留 200 条，数据存储在本地浏览器中。
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/90 dark:border-zinc-700/50 px-3 py-1 text-zinc-700 dark:text-zinc-300">
                        共 {history.length} 条
                    </span>
                    <button
                        type="button"
                        className={clsx(
                            "flex items-center gap-2 rounded-full px-3 py-1.5 transition-all",
                            "bg-red-500/8 text-red-700 dark:text-red-300 hover:bg-red-500/14",
                            history.length === 0 && "op-40 pointer-events-none"
                        )}
                        onClick={handleClearAll}
                    >
                        <span className="i-ph:trash-duotone" />
                        <span>清空历史</span>
                    </button>
                </div>
            </div>

            <section className="grid gap-2 rounded-2xl border border-zinc-200/90 bg-white/78 p-3 dark:border-zinc-700/40 dark:bg-zinc-900/70 md:grid-cols-[1fr_1fr_auto_auto]">
                <input
                    value={syncHubEndpoint}
                    onChange={(event) => setSyncHubEndpoint(event.target.value)}
                    placeholder={defaultSyncHubEndpoint}
                    className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <input
                    type="password"
                    value={syncHubApiKey}
                    onChange={(event) => setSyncHubApiKey(event.target.value)}
                    placeholder="LatestNews API Key (shk_...)"
                    className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <button
                    type="button"
                    disabled={syncHubChecking}
                    onClick={() => {
                        setSyncHubChecking(true);
                        void verifyLatestNewsSyncHubConnection(syncHubEndpoint, syncHubApiKey).then((result) => {
                            setSyncHubChecking(false);
                            toaster(result.message, { type: result.ok ? "success" : "error" });
                            if (!result.ok) return;
                            saveSyncHubConfig({ endpoint: syncHubEndpoint, apiKey: syncHubApiKey });
                            window.location.reload();
                        });
                    }}
                    className="rounded-xl bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-900 disabled:cursor-wait disabled:opacity-60"
                >
                    {syncHubChecking ? "正在验证" : "验证并保存"}
                </button>
                {(syncHubEndpoint !== defaultSyncHubEndpoint || syncHubApiKey) && (
                    <button
                        type="button"
                        onClick={() => {
                            clearSyncHubConfig();
                            setSyncHubEndpoint(defaultSyncHubEndpoint);
                            setSyncHubApiKey("");
                            window.location.reload();
                        }}
                        className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                    >
                        移除
                    </button>
                )}
            </section>

            <div className="flex flex-wrap gap-2 rounded-2xl border border-zinc-200/90 bg-white/78 p-2 dark:border-zinc-700/40 dark:bg-zinc-900/70">
                <TabButton
                    active={stateTab === "history"}
                    label={`已读 ${history.length}`}
                    onClick={() => setStateTab("history")}
                />
                <TabButton
                    active={stateTab === "later"}
                    label={`稍后读 ${readingState.later.length}`}
                    onClick={() => setStateTab("later")}
                />
                <TabButton
                    active={stateTab === "favorites"}
                    label={`收藏 ${readingState.favorites.length}`}
                    onClick={() => setStateTab("favorites")}
                />
                <TabButton
                    active={stateTab === "hidden"}
                    label={`隐藏 ${readingState.hidden.length}`}
                    onClick={() => setStateTab("hidden")}
                />
            </div>

            {stateTab === "history" && history.length > 0 && (
                <div className="flex flex-col gap-3 rounded-2xl bg-white/78 dark:bg-zinc-900/70 border border-zinc-200/90 dark:border-zinc-700/40 p-3 md:flex-row md:items-center">
                    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-zinc-50/80 dark:bg-zinc-950/30 border border-zinc-200/80 dark:border-zinc-700/35 px-3 py-2">
                        <span className="i-ph:magnifying-glass-duotone text-lg op-50" />
                        <input
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            placeholder="搜索标题或来源名称"
                            className="w-full bg-transparent text-sm text-zinc-700 dark:text-zinc-300 outline-none placeholder:text-zinc-500 dark:placeholder:text-zinc-600"
                        />
                        {keyword && (
                            <button
                                type="button"
                                title="清除搜索"
                                className="i-ph:x-circle-duotone op-50 hover:op-80 transition-opacity"
                                onClick={() => setKeyword("")}
                            />
                        )}
                    </label>
                    <select
                        value={sourceFilter}
                        className="rounded-xl bg-zinc-50/80 dark:bg-zinc-950/30 border border-zinc-200/80 dark:border-zinc-700/35 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 outline-none"
                        onChange={(e) => setSourceFilter(e.target.value as SourceID | "")}
                    >
                        <option value="">全部来源</option>
                        {sourceOptions.map((source) => (
                            <option value={source.id} key={source.id}>
                                {source.name} ({source.count})
                            </option>
                        ))}
                    </select>
                    {hasActiveFilters && (
                        <button
                            type="button"
                            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 transition-all hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-700/70"
                            onClick={resetFilters}
                        >
                            <span className="i-ph:arrow-counter-clockwise-duotone" />
                            <span>重置筛选</span>
                        </button>
                    )}
                    {sourceFilter && (
                        <button
                            type="button"
                            className="flex items-center justify-center gap-2 rounded-xl bg-red-500/8 px-3 py-2 text-sm text-red-700 transition-all hover:bg-red-500/14 dark:text-red-300"
                            onClick={handleClearSource}
                        >
                            <span className="i-ph:trash-duotone" />
                            <span>清空来源</span>
                        </button>
                    )}
                    <button
                        type="button"
                        className={clsx(
                            "flex items-center justify-center gap-2 rounded-xl bg-cyan-500/12 px-3 py-2 text-sm text-cyan-800 transition-all hover:bg-cyan-500/20 dark:text-cyan-300",
                            filtered.length === 0 && "pointer-events-none op-40"
                        )}
                        onClick={() => void copyFilteredHistory()}
                    >
                        <span className="i-ph:copy-duotone" />
                        <span>复制结果</span>
                    </button>
                </div>
            )}

            {stateTab === "history" && filtered.length > 0 ? (
                <div className="flex flex-col gap-5">
                    {groups.map(([label, items]) => (
                        <div key={label}>
                            <div className="mb-2 px-1 text-xs font-semibold text-zinc-600 dark:text-zinc-500 tracking-wide">
                                {label}
                            </div>
                            <div className="flex flex-col gap-2">
                                {items.map((item) => (
                                    <HistoryItem
                                        key={`${item.url}-${item.readAt}`}
                                        title={item.title}
                                        url={item.url}
                                        sourceName={item.sourceName}
                                        readAt={item.readAt}
                                        onRemove={() => removeHistory(item.url)}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : stateTab !== "history" && stateItems.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {stateItems.map((item) => (
                        <SavedReadingItem
                            key={`${item.url}-${item.updatedAt}`}
                            title={item.title}
                            url={item.url}
                            sourceName={item.sourceName}
                            updatedAt={item.updatedAt}
                            removeTitle={stateTab === "hidden" ? "取消隐藏" : "移除此条记录"}
                            onRemove={() => {
                                if (stateKind) removeState(stateKind, item.url);
                            }}
                        />
                    ))}
                </div>
            ) : (
                <div className="rounded-2xl bg-white/68 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-700/30 p-10 text-center text-sm text-zinc-600 dark:text-zinc-500">
                    {getEmptyLabel(stateTab, history.length)}
                </div>
            )}
        </section>
    );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className={clsx(
                "rounded-xl px-3 py-2 text-sm transition-all",
                active
                    ? "bg-cyan-500/16 text-cyan-800 dark:text-cyan-300"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800/70"
            )}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

type HistoryTab = "history" | "later" | "favorites" | "hidden";

function SavedReadingItem({
    title,
    url,
    sourceName,
    updatedAt,
    removeTitle = "移除此条记录",
    onRemove,
}: {
    title: string;
    url: string;
    sourceName: string;
    updatedAt: number;
    removeTitle?: string;
    onRemove: () => void;
}) {
    const relativeTime = useRelativeTime(updatedAt);

    return (
        <div className="group flex items-start justify-between gap-3 rounded-xl bg-white/82 dark:bg-zinc-900/70 border border-zinc-200/90 dark:border-zinc-700/30 px-4 py-3 transition-all hover:border-zinc-300/80 dark:hover:border-zinc-600/50 hover:bg-zinc-100/95 dark:hover:bg-zinc-800/60">
            <div className="min-w-0 flex-1">
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-cyan-300 transition-colors visited:text-zinc-600 dark:visited:text-zinc-500"
                >
                    {title}
                </a>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-700/40 border border-zinc-200/90 dark:border-zinc-700/40 px-2 py-0.5 text-zinc-700 dark:text-zinc-400">
                        {sourceName}
                    </span>
                    <span>{relativeTime ?? "刚刚"}</span>
                </div>
            </div>
            <button
                type="button"
                title={removeTitle}
                className="mt-0.5 shrink-0 i-ph:x-duotone op-0 group-hover:op-40 hover:op-80! transition-opacity btn text-base"
                onClick={onRemove}
            />
        </div>
    );
}

function getHistoryTabReadingKind(tab: HistoryTab): ReadingStateKind | undefined {
    if (tab === "later") return "later";
    if (tab === "favorites") return "favorite";
    if (tab === "hidden") return "hidden";
    return undefined;
}

function getEmptyLabel(tab: HistoryTab, historyLength: number) {
    if (tab === "later") return "还没有稍后读内容";
    if (tab === "favorites") return "还没有收藏内容";
    if (tab === "hidden") return "还没有隐藏内容";
    return historyLength === 0 ? "还没有阅读记录，点击任意新闻即可自动记录" : "没有匹配的记录";
}
