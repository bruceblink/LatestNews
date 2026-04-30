import type { SourceResponse } from "@shared/types";

import clsx from "clsx";
import { myFetch } from "~/utils";
import { useTitle } from "react-use";
import { useToast } from "~/hooks/useToast";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { useRef, useMemo, useState, useEffect } from "react";
import { rankFailingSourcesByPriority } from "@shared/source-ranking-policy";

type SourceHealthStatus = "idle" | "healthy" | "failing";

interface SourceHealthEvent {
    status: Exclude<SourceHealthStatus, "idle">;
    occurredAt: number;
    durationMs: number;
    itemCount?: number;
    errorMessage?: string;
}

interface SourceHealthSnapshot {
    id: string;
    name: string;
    status: SourceHealthStatus;
    successCount: number;
    errorCount: number;
    consecutiveFailures: number;
    lastDurationMs?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    lastItemCount?: number;
    recentEvents: SourceHealthEvent[];
}

interface SourceHealthSummary {
    updatedAt: number;
    total: number;
    healthy: number;
    failing: number;
    idle: number;
    sources: SourceHealthSnapshot[];
}

const statusLabelMap: Record<SourceHealthStatus, string> = {
    healthy: "正常",
    failing: "异常",
    idle: "未采样",
};

const statusClassMap: Record<SourceHealthStatus, string> = {
    healthy: "text-green-600 bg-green-500/12 dark:text-green-300",
    failing: "text-red-600 bg-red-500/12 dark:text-red-300",
    idle: "text-neutral-500 bg-neutral-500/10 dark:text-neutral-300",
};

export const Route = createFileRoute("/health")({
    component: HealthPage,
});

function HealthPage() {
    useTitle(`${import.meta.env.VITE_APP_TITLE} | 数据源健康`);
    const [keyword, setKeyword] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | SourceHealthStatus>("all");
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
    const toaster = useToast();
    const hasLoadedRef = useRef(false);
    const previousFailingIdsRef = useRef<Set<string>>(new Set());

    const { data, isFetching, isError, refetch, error } = useQuery<SourceHealthSummary>({
        queryKey: ["source-health"],
        queryFn: () => myFetch("/s/health"),
        staleTime: 1000 * 30,
        refetchInterval: autoRefreshEnabled ? 1000 * 60 : false,
        retry: false,
    });

    useEffect(() => {
        if (!data?.sources) return;

        const currentFailingIds = new Set(
            data.sources.filter((source) => source.status === "failing").map((source) => source.id)
        );

        if (!hasLoadedRef.current) {
            previousFailingIdsRef.current = currentFailingIds;
            hasLoadedRef.current = true;
            return;
        }

        const previousFailingIds = previousFailingIdsRef.current;
        const recoveredSources = data.sources.filter(
            (source) => source.status !== "failing" && previousFailingIds.has(source.id)
        );
        const newlyFailingSources = data.sources.filter(
            (source) => source.status === "failing" && !previousFailingIds.has(source.id)
        );

        if (recoveredSources.length > 0) {
            const label = recoveredSources
                .slice(0, 2)
                .map((source) => source.name)
                .join("、");
            toaster(
                recoveredSources.length > 2
                    ? `${label} 等 ${recoveredSources.length} 个数据源已恢复`
                    : `${label} 已恢复正常`,
                { type: "success" }
            );
        }

        if (newlyFailingSources.length > 0) {
            const label = newlyFailingSources
                .slice(0, 2)
                .map((source) => source.name)
                .join("、");
            toaster(
                newlyFailingSources.length > 2
                    ? `${label} 等 ${newlyFailingSources.length} 个数据源出现异常`
                    : `${label} 出现新的异常`,
                { type: "warning" }
            );
        }

        previousFailingIdsRef.current = currentFailingIds;
    }, [data?.sources, toaster]);

    const prioritizedFailingSources = useMemo(() => {
        if (!data?.sources) return [];
        return rankFailingSourcesByPriority(data.sources);
    }, [data?.sources]);

    const filteredSources = useMemo(() => {
        if (!data?.sources) return [];

        return data.sources.filter((source) => {
            const matchStatus = statusFilter === "all" || source.status === statusFilter;
            const normalizedKeyword = keyword.trim().toLowerCase();
            const matchKeyword =
                normalizedKeyword.length === 0 ||
                source.name.toLowerCase().includes(normalizedKeyword) ||
                source.id.toLowerCase().includes(normalizedKeyword);

            return matchStatus && matchKeyword;
        });
    }, [data?.sources, keyword, statusFilter]);

    return (
        <section className="mx-auto flex max-w-6xl flex-col gap-4 px-1 md:px-4">
            <div className="flex flex-col gap-3 rounded-2xl bg-primary/6 p-4 shadow shadow-primary/10 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="m-0 text-2xl font-bold">数据源健康</h1>
                    <p className="m-0 mt-2 text-sm op-75">
                        查看各数据源最近一次抓取状态、连续失败次数和响应耗时，便于后续治理抓取质量。
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <button
                        type="button"
                        className={clsx(
                            "rounded-full px-3 py-1 transition-all",
                            autoRefreshEnabled
                                ? "bg-green-500/10 text-green-700 dark:text-green-300"
                                : "bg-neutral-500/8 op-75"
                        )}
                        onClick={() => setAutoRefreshEnabled((prev) => !prev)}
                    >
                        {autoRefreshEnabled ? "自动刷新中" : "自动刷新已关闭"}
                    </button>
                    <span className="rounded-full bg-base/70 px-3 py-1">
                        {data
                            ? `最近更新 ${new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                            : "等待数据"}
                    </span>
                    <button
                        type="button"
                        className={clsx(
                            "flex items-center gap-2 rounded-full px-3 py-1.5 transition-all",
                            "bg-base/80 hover:bg-base shadow shadow-primary/10",
                            isFetching && "animate-pulse"
                        )}
                        onClick={() => void refetch()}
                    >
                        <span className={clsx("i-ph:arrow-clockwise-duotone", isFetching && "animate-spin")} />
                        <span>{isFetching ? "刷新中" : "刷新统计"}</span>
                    </button>
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <SummaryCard label="总数据源" value={data?.total ?? 0} tone="neutral" />
                <SummaryCard label="正常" value={data?.healthy ?? 0} tone="green" />
                <SummaryCard label="异常" value={data?.failing ?? 0} tone="red" />
                <SummaryCard label="未采样" value={data?.idle ?? 0} tone="slate" />
            </div>

            <div className="flex flex-col gap-3 rounded-2xl bg-base/60 p-4 shadow shadow-primary/5 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap gap-2">
                    {(
                        [
                            ["all", "全部"],
                            ["failing", "仅异常"],
                            ["healthy", "仅正常"],
                            ["idle", "仅未采样"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={clsx(
                                "rounded-full px-3 py-1.5 text-sm transition-all",
                                statusFilter === value
                                    ? "bg-primary/15 text-primary-700 shadow shadow-primary/10 dark:text-primary-300"
                                    : "bg-neutral-500/8 op-80 hover:bg-neutral-500/12"
                            )}
                            onClick={() => setStatusFilter(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 rounded-full bg-neutral-500/8 px-3 py-1.5 text-sm md:w-72">
                    <span className="i-ph:magnifying-glass-duotone text-base" />
                    <input
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="搜索数据源名称或 ID"
                        className="w-full bg-transparent outline-none placeholder:text-neutral-400"
                    />
                </label>
            </div>

            {isError && (
                <div className="rounded-2xl bg-red-500/10 p-4 text-red-600 dark:text-red-300">
                    加载健康统计失败{error instanceof Error ? `：${error.message}` : ""}
                </div>
            )}

            {!!data?.failing && (
                <div className="rounded-2xl bg-red-500/8 p-4 shadow shadow-red/5">
                    <div className="mb-3 flex items-center gap-2 text-red-600 dark:text-red-300">
                        <span className="i-ph:warning-circle-duotone text-lg" />
                        <span className="font-semibold">需要优先处理的异常源</span>
                    </div>
                    <div className="mb-3 rounded-xl bg-red-500/6 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        优先级根据连续失败次数、最近错误时间和最近耗时综合排序。
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {prioritizedFailingSources.slice(0, 6).map((source, index) => (
                            <div
                                key={source.id}
                                className="rounded-xl bg-base/70 px-3 py-3 text-sm shadow shadow-red/5"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">
                                        #{index + 1} {source.name}
                                    </span>
                                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600 dark:text-red-300">
                                        连续失败 {source.consecutiveFailures}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">
                                    最近错误{" "}
                                    {source.lastErrorAt
                                        ? new Date(source.lastErrorAt).toLocaleTimeString("zh-CN")
                                        : "未知"}
                                </div>
                                <div className="mt-2 text-xs op-70">
                                    {source.lastErrorMessage ?? "最近抓取失败，建议优先探测"}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredSources.map((source) => (
                    <SourceHealthCard
                        key={source.id}
                        source={source}
                        onProbeSuccess={async (result) => {
                            toaster(`${source.name} 探测成功，拉取 ${result.items.length} 条数据`, { type: "success" });
                            await refetch();
                        }}
                        onProbeError={(message) => {
                            toaster(`${source.name} 探测失败：${message}`, { type: "error" });
                        }}
                    />
                ))}
            </div>
            {data && filteredSources.length === 0 && (
                <div className="rounded-2xl bg-neutral-500/8 p-6 text-center text-sm op-70">
                    当前筛选条件下没有匹配的数据源
                </div>
            )}
        </section>
    );
}

function SummaryCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: "neutral" | "green" | "red" | "slate";
}) {
    const toneClass = {
        neutral: "bg-primary/6 text-primary-700 dark:text-primary-300",
        green: "bg-green-500/10 text-green-700 dark:text-green-300",
        red: "bg-red-500/10 text-red-700 dark:text-red-300",
        slate: "bg-neutral-500/10 text-neutral-700 dark:text-neutral-300",
    } satisfies Record<typeof tone, string>;

    return (
        <div className={clsx("rounded-2xl p-4 shadow shadow-primary/5", toneClass[tone])}>
            <div className="text-sm op-75">{label}</div>
            <div className="mt-2 text-3xl font-bold">{value}</div>
        </div>
    );
}

function SourceHealthCard({
    source,
    onProbeSuccess,
    onProbeError,
}: {
    source: SourceHealthSnapshot;
    onProbeSuccess: (result: SourceResponse) => Promise<void>;
    onProbeError: (message: string) => void;
}) {
    const lastSuccess = useRelativeTime(source.lastSuccessAt ?? "");
    const lastError = useRelativeTime(source.lastErrorAt ?? "");
    const [detailsOpen, setDetailsOpen] = useState(source.status === "failing");
    const [probing, setProbing] = useState(false);
    const [probeResult, setProbeResult] = useState<string>();

    const severityLabel =
        source.status === "failing"
            ? source.consecutiveFailures >= 5
                ? "高优先级"
                : "待处理"
            : source.status === "idle"
              ? "待采样"
              : "稳定";

    const handleProbe = async () => {
        setProbing(true);
        try {
            const result = await myFetch<SourceResponse>("/s", {
                query: {
                    id: source.id,
                    latest: true,
                },
            });

            setProbeResult(`最近探测成功，返回 ${result.items.length} 条数据`);
            await onProbeSuccess(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : "探测失败，请稍后重试";
            setProbeResult(message);
            onProbeError(message);
        } finally {
            setProbing(false);
        }
    };

    return (
        <article className="rounded-2xl bg-base/70 p-4 shadow shadow-primary/8 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="m-0 text-lg font-semibold">{source.name}</h2>
                    <div className="mt-1 text-xs op-55">{source.id}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span
                        className={clsx(
                            "rounded-full px-2.5 py-1 text-xs font-semibold",
                            statusClassMap[source.status]
                        )}
                    >
                        {statusLabelMap[source.status]}
                    </span>
                    <span className="rounded-full bg-neutral-500/8 px-2.5 py-1 text-xs op-70">{severityLabel}</span>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <MetricItem label="成功次数" value={String(source.successCount)} />
                <MetricItem label="失败次数" value={String(source.errorCount)} />
                <MetricItem label="连续失败" value={String(source.consecutiveFailures)} />
                <MetricItem label="耗时" value={source.lastDurationMs ? `${source.lastDurationMs} ms` : "-"} />
                <MetricItem label="最近成功" value={lastSuccess ?? "-"} />
                <MetricItem label="最近错误" value={lastError ?? "-"} />
                <MetricItem
                    label="最近条数"
                    value={source.lastItemCount !== undefined ? String(source.lastItemCount) : "-"}
                />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    className="rounded-full bg-primary/10 px-3 py-1.5 text-sm text-primary-700 transition-all hover:bg-primary/14 dark:text-primary-300"
                    onClick={() => void handleProbe()}
                >
                    <span
                        className={clsx(
                            "mr-1 inline-block align-middle",
                            probing ? "i-ph:spinner-gap-duotone animate-spin" : "i-ph:radar-duotone"
                        )}
                    />
                    <span>{probing ? "探测中" : "探测最新"}</span>
                </button>
                <button
                    type="button"
                    className="rounded-full bg-neutral-500/8 px-3 py-1.5 text-sm transition-all hover:bg-neutral-500/12"
                    onClick={() => setDetailsOpen((prev) => !prev)}
                >
                    <span className="mr-1 inline-block align-middle i-ph:list-magnifying-glass-duotone" />
                    <span>{detailsOpen ? "收起详情" : "查看详情"}</span>
                </button>
            </div>

            {probeResult && (
                <div className="mt-3 rounded-xl bg-primary/6 px-3 py-2 text-sm text-primary-700 dark:text-primary-300">
                    {probeResult}
                </div>
            )}

            {detailsOpen && (
                <div className="mt-3 rounded-xl bg-neutral-500/6 px-3 py-3 text-sm leading-6">
                    <div>
                        <span className="op-60">最近成功时间：</span>
                        <span>{lastSuccess ?? "-"}</span>
                    </div>
                    <div>
                        <span className="op-60">最近错误时间：</span>
                        <span>{lastError ?? "-"}</span>
                    </div>
                    <div>
                        <span className="op-60">最近耗时：</span>
                        <span>{source.lastDurationMs ? `${source.lastDurationMs} ms` : "-"}</span>
                    </div>
                    <div>
                        <span className="op-60">最近返回条数：</span>
                        <span>{source.lastItemCount !== undefined ? source.lastItemCount : "-"}</span>
                    </div>
                    {source.lastErrorMessage && (
                        <div className="mt-2 rounded-lg bg-red-500/6 px-3 py-2 text-red-600 dark:text-red-300">
                            {source.lastErrorMessage}
                        </div>
                    )}
                    <div className="mt-3 border-t border-neutral-500/10 pt-3">
                        <div className="mb-2 font-medium op-75">最近 5 次事件</div>
                        {source.recentEvents.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                {source.recentEvents.map((event, index) => {
                                    const occurredTime = new Date(event.occurredAt).toLocaleString("zh-CN", {
                                        month: "2-digit",
                                        day: "2-digit",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        second: "2-digit",
                                    });

                                    return (
                                        <div
                                            key={`${source.id}-${event.occurredAt}-${index}`}
                                            className="rounded-lg bg-base/70 px-3 py-2"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span
                                                    className={clsx(
                                                        "rounded-full px-2 py-0.5 text-xs font-medium",
                                                        event.status === "healthy"
                                                            ? "bg-green-500/10 text-green-700 dark:text-green-300"
                                                            : "bg-red-500/10 text-red-700 dark:text-red-300"
                                                    )}
                                                >
                                                    {event.status === "healthy" ? "成功" : "失败"}
                                                </span>
                                                <span className="text-xs op-55">{occurredTime}</span>
                                            </div>
                                            <div className="mt-1 text-xs op-70">
                                                耗时 {event.durationMs} ms
                                                {event.itemCount !== undefined ? ` · 返回 ${event.itemCount} 条` : ""}
                                            </div>
                                            {event.errorMessage && (
                                                <div className="mt-1 text-xs text-red-600 dark:text-red-300">
                                                    {event.errorMessage}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-xs op-55">暂无事件记录</div>
                        )}
                    </div>
                </div>
            )}
        </article>
    );
}

function MetricItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl bg-neutral-500/6 px-3 py-2">
            <div className="text-xs op-60">{label}</div>
            <div className="mt-1 font-medium">{value}</div>
        </div>
    );
}
