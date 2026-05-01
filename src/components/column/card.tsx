import type { NewsItem, SourceID } from "@shared/types";
import type { SourceHealthStatus } from "@shared/source-health-types";

import clsx from "clsx";
import { useWindowSize } from "react-use";
import { useHistory } from "~/hooks/useHistory";
import dataSources from "@shared/data-sources.ts";
import { useNewsSource } from "~/hooks/useNewsSource";
import { useRelativeTime } from "~/hooks/useRelativeTime.ts";
import { CardHeader } from "~/components/column/cardHeader.tsx";
import { motion, useInView, AnimatePresence } from "framer-motion";
import React, { useRef, useState, useEffect, forwardRef, useCallback, useImperativeHandle } from "react";

import { OverlayScrollbar } from "../common/overlay-scrollbar";

export interface ItemsProps extends React.HTMLAttributes<HTMLDivElement> {
    id: SourceID;
    healthStatus?: SourceHealthStatus;
    /**
     * 是否显示透明度，拖动时原卡片的样式
     */
    isDragging?: boolean;
    setHandleRef?: (ref: HTMLElement | null) => void;
}

interface NewsCardProps {
    id: SourceID;
    healthStatus?: SourceHealthStatus;
    setHandleRef?: (ref: HTMLElement | null) => void;
}

export const CardWrapper = forwardRef<HTMLElement, ItemsProps>(
    ({ id, healthStatus, isDragging, setHandleRef, style, ...props }, dndRef) => {
        const ref = useRef<HTMLDivElement>(null);

        const inView = useInView(ref, {
            once: true,
        });

        useImperativeHandle(dndRef, () => ref.current! as HTMLDivElement);

        return (
            <div
                ref={ref}
                className={clsx(
                    "flex flex-col h-500px rounded-2xl p-4 cursor-default",
                    "transition-opacity-300",
                    isDragging && "op-50",
                    healthStatus === "failing" && "ring-1 ring-red-500/30 saturate-85 op-90",
                    healthStatus === "idle" && "ring-1 ring-neutral-500/20",
                    `bg-${dataSources[id].color}-500 dark:bg-${dataSources[id].color} bg-op-9! dark:bg-op-6!`,
                    "border border-zinc-300/65 dark:border-zinc-700/30"
                )}
                style={{
                    transformOrigin: "50% 50%",
                    ...style,
                }}
                {...props}
            >
                {inView && <NewsCard id={id} healthStatus={healthStatus} setHandleRef={setHandleRef} />}
            </div>
        );
    }
);

function NewsCard({ id, healthStatus, setHandleRef }: NewsCardProps) {
    const { data, isFetching, isError } = useNewsSource(id);

    return (
        <>
            <CardHeader
                id={id}
                data={data}
                healthStatus={healthStatus}
                isFetching={isFetching}
                isError={isError}
                setHandleRef={setHandleRef}
            />

            <OverlayScrollbar
                className={clsx([
                    "h-full p-2 overflow-y-auto rounded-xl bg-zinc-50/76 dark:bg-zinc-900/68",
                    "border border-zinc-300/70 dark:border-zinc-800/65",
                    isFetching && "animate-pulse",
                ])}
                options={{
                    overflow: { x: "hidden" },
                }}
                defer
            >
                <div className={clsx("transition-opacity-500", isFetching && "op-50")}>
                    {!!data?.items?.length && RenderNewsList(id, data.items)}
                </div>
            </OverlayScrollbar>
        </>
    );
}

/**
 * 渲染不同卡片类型的新闻
 * @param id
 * @param items
 */
function RenderNewsList(id: SourceID, items: any[]) {
    switch (dataSources[id].type) {
        case "hottest":
            return <NewsListHot id={id} items={items} />;
        case "realtime":
            return <NewsListTimeLine id={id} items={items} />;
        default:
            return <NewsListHot id={id} items={items} />;
    }
}

function DiffNumber({ diff }: { diff: number }) {
    const [shown, setShown] = useState(true);
    useEffect(() => {
        setShown(true);
        const timer = setTimeout(() => {
            setShown(false);
        }, 5000);
        return () => clearTimeout(timer);
    }, [setShown, diff]);

    return (
        <AnimatePresence>
            {shown && (
                <motion.span
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 0.5, y: -7 }}
                    exit={{ opacity: 0, y: -15 }}
                    className={clsx("absolute left-0 text-xs", diff < 0 ? "text-green" : "text-red")}
                >
                    {diff > 0 ? `+${diff}` : diff}
                </motion.span>
            )}
        </AnimatePresence>
    );
}

function ExtraInfo({ item }: { item: NewsItem }) {
    if (item?.extra?.info) {
        return <>{item.extra.info}</>;
    }
    if (item?.extra?.icon) {
        const { url, scale } =
            typeof item.extra.icon === "string"
                ? {
                      url: item.extra.icon,
                      scale: undefined,
                  }
                : item.extra.icon;
        return (
            <img
                src={url}
                style={{
                    transform: `scale(${scale ?? 1})`,
                }}
                className="h-4 inline mt--1"
                onError={(e) => (e.currentTarget.style.display = "none")}
                alt={url}
            />
        );
    }
}

function NewsUpdatedTime({ date }: { date: string | number }) {
    const relativeTime = useRelativeTime(date);
    return <>{relativeTime}</>;
}

function NewsListHot({ id, items }: { id: SourceID; items: NewsItem[] }) {
    const { width } = useWindowSize();
    const { addHistory } = useHistory();
    const handleClick = useCallback(
        (item: NewsItem) => {
            addHistory(id, item.id, item.title, item.url);
        },
        [id, addHistory]
    );
    return (
        <ol className="flex flex-col gap-2">
            {items?.map((item, i) => (
                <a
                    href={width < 768 ? item.mobileUrl || item.url : item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    key={item.id}
                    title={item.extra?.hover}
                    onClick={() => handleClick(item)}
                    className={clsx(
                        "flex gap-2 items-center items-stretch relative cursor-pointer [&_*]:cursor-pointer transition-all",
                        "hover:bg-zinc-300/40 dark:hover:bg-cyan-500/6 rounded-md pr-1 visited:(text-zinc-500 dark:text-zinc-500)"
                    )}
                >
                    <span
                        className={clsx(
                            "bg-zinc-200/65 dark:bg-zinc-700/25 text-zinc-700 dark:text-zinc-500 min-w-6 flex justify-center items-center rounded-md text-sm"
                        )}
                    >
                        {i + 1}
                    </span>
                    {!!item.extra?.diff && <DiffNumber diff={item.extra.diff} />}
                    <span className="self-start line-height-none">
                        <span className="mr-2 text-base text-zinc-800 dark:text-zinc-200/90">{item.title}</span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 truncate align-middle">
                            <ExtraInfo item={item} />
                        </span>
                    </span>
                </a>
            ))}
        </ol>
    );
}

function NewsListTimeLine({ id, items }: { id: SourceID; items: NewsItem[] }) {
    const { width } = useWindowSize();
    const { addHistory } = useHistory();
    const handleClick = useCallback(
        (item: NewsItem) => {
            addHistory(id, item.id, item.title, item.url);
        },
        [id, addHistory]
    );
    return (
        <ol className="border-s border-zinc-300/70 dark:border-zinc-700/60 flex flex-col ml-1">
            {items?.map((item) => (
                <li key={`${item.id}-${item.pubDate || item?.extra?.date || ""}`} className="flex flex-col">
                    <span className="flex items-center gap-1 text-zinc-700 dark:text-zinc-600 ml--1px">
                        <span className="">-</span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500">
                            {(item.pubDate || item?.extra?.date) && (
                                <NewsUpdatedTime date={(item.pubDate || item?.extra?.date)!} />
                            )}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500">
                            <ExtraInfo item={item} />
                        </span>
                    </span>
                    <a
                        className={clsx(
                            "ml-2 px-1 hover:bg-zinc-300/40 dark:hover:bg-cyan-500/6 rounded-md visited:(text-zinc-500 dark:text-zinc-500)",
                            "cursor-pointer [&_*]:cursor-pointer transition-all"
                        )}
                        href={width < 768 ? item.mobileUrl || item.url : item.url}
                        title={item.extra?.hover}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handleClick(item)}
                    >
                        <span className="text-zinc-800 dark:text-zinc-300/90">{item.title}</span>
                    </a>
                </li>
            ))}
        </ol>
    );
}
