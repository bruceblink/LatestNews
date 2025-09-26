import type { NewsItem, SourceID, SourceResponse } from "@shared/types";

import clsx from "clsx";
import { delay } from "@shared/utils.ts";
import { useWindowSize } from "react-use";
import { useQuery } from "@tanstack/react-query";
import dataSources from "@shared/data-sources.ts";
import { useRefetch } from "~/hooks/useRefetch.ts";
import { useFocusWith } from "~/hooks/useFocus.ts";
import { myFetch, safeParseString } from "~/utils";
import { useRelativeTime } from "~/hooks/useRelativeTime.ts";
import { cacheSources, refetchSources } from "~/utils/data.ts";
import { motion, useInView, AnimatePresence } from "framer-motion";
import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";

import { OverlayScrollbar } from "../common/overlay-scrollbar";

export interface ItemsProps extends React.HTMLAttributes<HTMLDivElement> {
    id: SourceID;
    /**
     * 是否显示透明度，拖动时原卡片的样式
     */
    isDragging?: boolean;
    setHandleRef?: (ref: HTMLElement | null) => void;
}

interface NewsCardProps {
    id: SourceID;
    setHandleRef?: (ref: HTMLElement | null) => void;
}

export const CardWrapper = forwardRef<HTMLElement, ItemsProps>(
    ({ id, isDragging, setHandleRef, style, ...props }, dndRef) => {
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
                    // "backdrop-blur-5",
                    "transition-opacity-300",
                    isDragging && "op-50",
                    `bg-${dataSources[id].color}-500 dark:bg-${dataSources[id].color} bg-op-40!`
                )}
                style={{
                    transformOrigin: "50% 50%",
                    ...style,
                }}
                {...props}
            >
                {inView && <NewsCard id={id} setHandleRef={setHandleRef} />}
            </div>
        );
    }
);

function NewsCard({ id, setHandleRef }: NewsCardProps) {
    const { refresh } = useRefetch();
    const { data, isFetching, isError } = useQuery({
        queryKey: ["source", id],
        queryFn: async ({ queryKey }) => {
            const sid = queryKey[1] as SourceID;
            let url = `/s?id=${sid}`;
            const headers: Record<string, any> = {};
            if (refetchSources.has(sid)) {
                url = `/s?id=${sid}&latest`;
                const jwt = safeParseString(localStorage.getItem("access_token"));
                if (jwt) headers.Authorization = `Bearer ${jwt}`;
                refetchSources.delete(sid);
            } else if (cacheSources.has(sid)) {
                // wait animation
                await delay(200);
                return cacheSources.get(sid);
            }

            const response: SourceResponse = await myFetch(url, {
                headers,
            });

            function diff() {
                try {
                    if (response.items && dataSources[sid].type === "hottest" && cacheSources.has(sid)) {
                        response.items.forEach((item, i) => {
                            const o = cacheSources.get(sid)!.items.findIndex((k) => k.id === item.id);
                            item.extra = {
                                ...item?.extra,
                                diff: o === -1 ? undefined : o - i,
                            };
                        });
                    }
                } catch (e) {
                    console.error(e);
                }
            }

            diff();

            cacheSources.set(sid, response);
            return response;
        },
        placeholderData: (prev) => prev,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
    });

    const { isFocused, toggleFocus } = useFocusWith(id);

    return (
        <>
            <div className={clsx("flex justify-between mx-2 mt-0 mb-2 items-center")}>
                <div className="flex gap-2 items-center">
                    <a
                        className={clsx("w-8 h-8 rounded-full bg-cover")}
                        target="_blank"
                        href={dataSources[id].home}
                        title={dataSources[id].desc}
                        style={{
                            backgroundImage: `url(/icons/${id.split("-")[0]}.png)`,
                        }}
                    />
                    <span className="flex flex-col">
                        <span className="flex items-center gap-2">
                            <span className="text-xl font-bold" title={dataSources[id].desc}>
                                {dataSources[id].name}
                            </span>
                            {dataSources[id]?.title && (
                                <span
                                    className={clsx(
                                        "text-sm",
                                        `color-${dataSources[id].color} bg-base op-80 bg-op-50\\! px-1 rounded`
                                    )}
                                >
                                    {dataSources[id].title}
                                </span>
                            )}
                        </span>
                        <span className="text-xs op-70">
                            <UpdatedTime isError={isError} updatedTime={data?.updatedTime} />
                        </span>
                    </span>
                </div>
                <div className={clsx("flex gap-2 text-lg", `color-${dataSources[id].color}`)}>
                    <button
                        type="button"
                        className={clsx(
                            "btn i-ph:arrow-counter-clockwise-duotone",
                            isFetching && "animate-spin i-ph:spinner-duotone"
                        )}
                        onClick={() => refresh(id)}
                    />
                    <button
                        type="button"
                        className={clsx("btn", isFocused ? "i-ph:star-fill" : "i-ph:star-duotone")}
                        onClick={toggleFocus}
                    />
                    {/* firefox cannot drag a button */}
                    {setHandleRef && (
                        <div
                            ref={setHandleRef}
                            className={clsx("btn", "i-ph:dots-six-vertical-duotone", "cursor-grab")}
                        />
                    )}
                </div>
            </div>

            <OverlayScrollbar
                className={clsx([
                    "h-full p-2 overflow-y-auto rounded-2xl bg-base bg-op-70!",
                    isFetching && "animate-pulse",
                    `sprinkle-${dataSources[id].color}`,
                ])}
                options={{
                    overflow: { x: "hidden" },
                }}
                defer
            >
                <div className={clsx("transition-opacity-500", isFetching && "op-20")}>
                    {!!data?.items?.length &&
                        (dataSources[id].type === "hottest" ? (
                            <NewsListHot items={data.items} />
                        ) : (
                            <NewsListTimeLine items={data.items} />
                        ))}
                </div>
            </OverlayScrollbar>
        </>
    );
}

function UpdatedTime({ isError, updatedTime }: { updatedTime: any; isError: boolean }) {
    const relativeTime = useRelativeTime(updatedTime ?? "");
    if (relativeTime) return `${relativeTime}更新`;
    if (isError) return "获取失败";
    return "加载中...";
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
function NewsListHot({ items }: { items: NewsItem[] }) {
    const { width } = useWindowSize();
    return (
        <ol className="flex flex-col gap-2">
            {items?.map((item, i) => (
                <a
                    href={width < 768 ? item.mobileUrl || item.url : item.url}
                    target="_blank"
                    key={item.id}
                    title={item.extra?.hover}
                    className={clsx(
                        "flex gap-2 items-center items-stretch relative cursor-pointer [&_*]:cursor-pointer transition-all",
                        "hover:bg-neutral-400/10 rounded-md pr-1 visited:(text-neutral-400)"
                    )}
                >
                    <span
                        className={clsx(
                            "bg-neutral-400/10 min-w-6 flex justify-center items-center rounded-md text-sm"
                        )}
                    >
                        {i + 1}
                    </span>
                    {!!item.extra?.diff && <DiffNumber diff={item.extra.diff} />}
                    <span className="self-start line-height-none">
                        <span className="mr-2 text-base">{item.title}</span>
                        <span className="text-xs text-neutral-400/80 truncate align-middle">
                            <ExtraInfo item={item} />
                        </span>
                    </span>
                </a>
            ))}
        </ol>
    );
}

function NewsListTimeLine({ items }: { items: NewsItem[] }) {
    const { width } = useWindowSize();
    return (
        <ol className="border-s border-neutral-400/50 flex flex-col ml-1">
            {items?.map((item) => (
                <li key={`${item.id}-${item.pubDate || item?.extra?.date || ""}`} className="flex flex-col">
                    <span className="flex items-center gap-1 text-neutral-400/50 ml--1px">
                        <span className="">-</span>
                        <span className="text-xs text-neutral-400/80">
                            {(item.pubDate || item?.extra?.date) && (
                                <NewsUpdatedTime date={(item.pubDate || item?.extra?.date)!} />
                            )}
                        </span>
                        <span className="text-xs text-neutral-400/80">
                            <ExtraInfo item={item} />
                        </span>
                    </span>
                    <a
                        className={clsx(
                            "ml-2 px-1 hover:bg-neutral-400/10 rounded-md visited:(text-neutral-400/80)",
                            "cursor-pointer [&_*]:cursor-pointer transition-all"
                        )}
                        href={width < 768 ? item.mobileUrl || item.url : item.url}
                        title={item.extra?.hover}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {item.title}
                    </a>
                </li>
            ))}
        </ol>
    );
}
