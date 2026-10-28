import type { SourceID, SourceResponse } from "@shared/types.ts";
import type { SourceHealthStatus } from "@shared/source-health-types";

import clsx from "clsx";
import { Link } from "@tanstack/react-router";
import { useRefetch } from "~/hooks/useRefetch";
import { useLoginState } from "~/hooks/useLogin";
import dataSources from "@shared/data-sources.ts";
import { useFocusWith } from "~/hooks/useFocus.ts";
import { useRelativeTime } from "~/hooks/useRelativeTime";

interface CardHeaderProps {
    id: SourceID;
    data?: SourceResponse;
    healthStatus?: SourceHealthStatus;
    isFetching: boolean;
    isError: boolean;
    setHandleRef?: (el: HTMLDivElement | null) => void;
}

export function CardHeader({ id, data, healthStatus, isFetching, isError, setHandleRef }: CardHeaderProps) {
    const { refresh } = useRefetch();
    const { enableLogin } = useLoginState();
    const { isFocused, toggleFocus } = useFocusWith(id);
    const ds = dataSources[id];
    const healthStatusLabel = healthStatus === "failing" ? "异常" : healthStatus === "idle" ? "未采样" : undefined;
    const sourceStatusLabel = getSourceStatusLabel(data?.status);

    return (
        <div className="news-card-header">
            <div className="source-heading">
                <a
                    className="source-icon"
                    aria-label={`${ds.name}网站`}
                    target="_blank"
                    rel="noopener noreferrer"
                    href={ds.home}
                    title={ds.desc}
                    style={{
                        backgroundImage: `url(/icons/${id.split("-")[0]}.png)`,
                    }}
                />
                <span className="source-heading-text">
                    <span className="source-name-line">
                        <Link to="/source/$sourceId" params={{ sourceId: id }} className="source-name" title={ds.desc}>
                            {ds.name}
                        </Link>
                        {healthStatusLabel && (
                            <span
                                className={clsx(
                                    "rounded px-1.5 py-0.5 text-xs",
                                    healthStatus === "failing"
                                        ? "bg-red-500/8 text-red-400/85"
                                        : "bg-zinc-200/75 dark:bg-zinc-700/35 text-zinc-700 dark:text-zinc-500"
                                )}
                            >
                                {healthStatusLabel}
                            </span>
                        )}
                        {sourceStatusLabel && (
                            <span
                                className={clsx(
                                    "rounded px-1.5 py-0.5 text-xs",
                                    getSourceStatusClassName(data?.status)
                                )}
                            >
                                {sourceStatusLabel}
                            </span>
                        )}
                        {ds?.title && (
                            <span
                                className={clsx(
                                    "text-xs rounded px-1 py-0.5",
                                    `color-${ds.color} bg-zinc-100/90 dark:bg-zinc-800/70 op-75`
                                )}
                            >
                                {ds.title}
                            </span>
                        )}
                    </span>
                    <span className="source-updated">
                        <UpdatedTime isError={isError} updatedTime={data?.updatedTime} />
                    </span>
                </span>
            </div>
            <div className="source-actions">
                {enableLogin.enable && (
                    <button
                        title={isFetching ? "正在刷新" : "刷新数据"}
                        aria-label={isFetching ? "正在刷新" : "刷新数据"}
                        aria-busy={isFetching}
                        disabled={isFetching}
                        type="button"
                        className={clsx(
                            "source-action i-ph:arrow-counter-clockwise-duotone disabled:cursor-wait disabled:opacity-60",
                            isFetching && "animate-spin i-ph:spinner-duotone"
                        )}
                        onClick={() => refresh(id)}
                    />
                )}
                <button
                    title={isFocused ? "取消关注" : "加入关注"}
                    aria-label={isFocused ? "取消关注" : "加入关注"}
                    aria-pressed={isFocused}
                    type="button"
                    className={clsx(
                        "source-action",
                        isFocused ? "i-ph:star-fill text-zinc-700 dark:text-cyan-400" : "i-ph:star-duotone"
                    )}
                    onClick={toggleFocus}
                />
                {/* firefox cannot drag a button */}
                {setHandleRef && (
                    <div
                        ref={setHandleRef}
                        className="source-action drag-handle i-ph:dots-six-vertical-duotone"
                        title="拖动排序"
                        aria-label="拖动排序"
                        role="button"
                    />
                )}
            </div>
        </div>
    );
}

function UpdatedTime({ isError, updatedTime }: { updatedTime: any; isError: boolean }) {
    const relativeTime = useRelativeTime(updatedTime ?? "");
    if (relativeTime) return `${relativeTime}更新`;
    if (isError) return "获取失败";
    return "加载中...";
}

function getSourceStatusLabel(status?: SourceResponse["status"]) {
    if (status === "cache") return "缓存";
    if (status === "degraded-cache") return "降级缓存";
    if (status === "stale-cache") return "旧缓存";
    if (status === "empty") return "空数据";
    return undefined;
}

function getSourceStatusClassName(status?: SourceResponse["status"]) {
    if (status === "degraded-cache" || status === "stale-cache") {
        return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    }
    if (status === "empty") {
        return "bg-zinc-200/75 text-zinc-700 dark:bg-zinc-700/35 dark:text-zinc-500";
    }
    return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
}
