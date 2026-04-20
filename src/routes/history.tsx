import clsx from "clsx";
import { useState } from "react";
import { useTitle } from "react-use";
import { useHistory } from "~/hooks/useHistory";
import { createFileRoute } from "@tanstack/react-router";
import { useRelativeTime } from "~/hooks/useRelativeTime";

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
        <div className="group flex items-start justify-between gap-3 rounded-xl bg-base/80 px-4 py-3 shadow shadow-primary/5 transition-all hover:shadow-primary/12">
            <div className="min-w-0 flex-1">
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary transition-colors visited:text-neutral-400"
                >
                    {title}
                </a>
                <div className="mt-1.5 flex items-center gap-2 text-xs op-55">
                    <span className="rounded-full bg-neutral-500/8 px-2 py-0.5">{sourceName}</span>
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
    const { history, clearHistory, removeHistory } = useHistory();
    const [keyword, setKeyword] = useState("");

    const filtered = keyword.trim()
        ? history.filter(
              (item) =>
                  item.title.toLowerCase().includes(keyword.trim().toLowerCase()) ||
                  item.sourceName.toLowerCase().includes(keyword.trim().toLowerCase())
          )
        : history;

    const handleClearAll = () => {
        if (history.length === 0) return;
        if (!window.confirm(`确认清空全部 ${history.length} 条阅读历史？`)) return;
        clearHistory();
    };

    return (
        <section className="mx-auto flex max-w-4xl flex-col gap-4 px-1 md:px-4">
            <div className="flex flex-col gap-3 rounded-2xl bg-primary/6 p-4 shadow shadow-primary/10 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="m-0 text-2xl font-bold">阅读历史</h1>
                    <p className="m-0 mt-2 text-sm op-75">
                        记录最近点击阅读的文章，最多保留 200 条，数据存储在本地浏览器中。
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <span className="rounded-full bg-base/70 px-3 py-1">共 {history.length} 条</span>
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

            {history.length > 0 && (
                <label className="flex items-center gap-2 rounded-2xl bg-base/70 px-4 py-2.5 shadow shadow-primary/5">
                    <span className="i-ph:magnifying-glass-duotone text-lg op-50" />
                    <input
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="搜索标题或来源名称"
                        className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
                    />
                    {keyword && (
                        <button
                            type="button"
                            className="i-ph:x-circle-duotone op-50 hover:op-80 transition-opacity"
                            onClick={() => setKeyword("")}
                        />
                    )}
                </label>
            )}

            {filtered.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {filtered.map((item) => (
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
            ) : (
                <div className="rounded-2xl bg-base/60 p-10 text-center text-sm op-60">
                    {history.length === 0 ? "还没有阅读记录，点击任意新闻即可自动记录" : "没有匹配的记录"}
                </div>
            )}
        </section>
    );
}
