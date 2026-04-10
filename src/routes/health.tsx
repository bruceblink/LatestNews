import clsx from "clsx";
import { myFetch } from "~/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTitle } from "react-use";

import { useRelativeTime } from "~/hooks/useRelativeTime";

type SourceHealthStatus = "idle" | "healthy" | "failing";

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

    const { data, isFetching, isError, refetch, error } = useQuery<SourceHealthSummary>({
        queryKey: ["source-health"],
        queryFn: () => myFetch("/s/health"),
        staleTime: 1000 * 30,
        retry: false,
    });

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
                    <span className="rounded-full bg-base/70 px-3 py-1">
                        {data ? `最近更新 ${new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "等待数据"}
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
                    <div className="flex flex-wrap gap-2">
                        {data.sources
                            .filter((source) => source.status === "failing")
                            .slice(0, 8)
                            .map((source) => (
                                <span key={source.id} className="rounded-full bg-base/70 px-3 py-1 text-sm">
                                    {source.name}
                                    {source.consecutiveFailures > 0 ? ` · 连续失败 ${source.consecutiveFailures}` : ""}
                                </span>
                            ))}
                    </div>
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data?.sources.map((source) => (
                    <SourceHealthCard key={source.id} source={source} />
                ))}
            </div>
        </section>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "neutral" | "green" | "red" | "slate" }) {
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

function SourceHealthCard({ source }: { source: SourceHealthSnapshot }) {
    const lastSuccess = useRelativeTime(source.lastSuccessAt ?? "");
    const lastError = useRelativeTime(source.lastErrorAt ?? "");

    return (
        <article className="rounded-2xl bg-base/70 p-4 shadow shadow-primary/8 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="m-0 text-lg font-semibold">{source.name}</h2>
                    <div className="mt-1 text-xs op-55">{source.id}</div>
                </div>
                <span className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold", statusClassMap[source.status])}>
                    {statusLabelMap[source.status]}
                </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <MetricItem label="成功次数" value={String(source.successCount)} />
                <MetricItem label="失败次数" value={String(source.errorCount)} />
                <MetricItem label="连续失败" value={String(source.consecutiveFailures)} />
                <MetricItem label="耗时" value={source.lastDurationMs ? `${source.lastDurationMs} ms` : "-"} />
                <MetricItem label="最近成功" value={lastSuccess ?? "-"} />
                <MetricItem label="最近错误" value={lastError ?? "-"} />
                <MetricItem label="最近条数" value={source.lastItemCount !== undefined ? String(source.lastItemCount) : "-"} />
            </div>

            {source.lastErrorMessage && (
                <p className="mt-4 rounded-xl bg-red-500/6 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                    {source.lastErrorMessage}
                </p>
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