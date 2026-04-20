import type { SourceID } from "@shared/types";

import clsx from "clsx";
import { useMemo } from "react";
import { useAtom } from "jotai";
import { focusSourcesAtom } from "~/atoms";
import { metadata } from "@shared/metadata";
import { useToast } from "~/hooks/useToast";
import { useFocus } from "~/hooks/useFocus";
import { Column } from "~/components/column";
import dataSources from "@shared/data-sources";
import { createFileRoute } from "@tanstack/react-router";
import { useSourceHealthSummary } from "~/hooks/useSourceHealth";

export const Route = createFileRoute("/")({
    component: IndexComponent,
});

function uniqueSources(sources: SourceID[]) {
    return Array.from(new Set(sources));
}

function IndexComponent() {
    const [focusSources, setFocusSources] = useAtom(focusSourcesAtom);
    const { toggleFocus, isFocused } = useFocus();
    const toaster = useToast();
    const id = useMemo(() => (focusSources.length ? "focus" : "hottest"), [focusSources.length]);
    const { data } = useSourceHealthSummary();

    const activeSources = useMemo(() => {
        if (!data?.sources) return [];

        return data.sources
            .filter((source) => source.status !== "failing")
            .sort((left, right) => {
                if ((right.lastItemCount ?? 0) !== (left.lastItemCount ?? 0)) {
                    return (right.lastItemCount ?? 0) - (left.lastItemCount ?? 0);
                }

                if (right.successCount !== left.successCount) {
                    return right.successCount - left.successCount;
                }

                return left.consecutiveFailures - right.consecutiveFailures;
            })
            .slice(0, 6);
    }, [data?.sources]);

    const focusPresets = useMemo(
        () => [
            {
                id: "tech-brief",
                name: "科技速览",
                description: "覆盖科技、产品和开发社区的高频信息源。",
                sources: uniqueSources([
                    ...metadata.tech.sources.slice(0, 4),
                    ...metadata.realtime.sources.slice(0, 2),
                ]),
            },
            {
                id: "market-watch",
                name: "财经追踪",
                description: "聚焦财经快讯、市场波动和投资讨论。",
                sources: uniqueSources([
                    ...metadata.finance.sources.slice(0, 4),
                    ...metadata.hottest.sources.slice(0, 2),
                ]),
            },
            {
                id: "global-digest",
                name: "综合精选",
                description: "适合日常快速浏览，兼顾国内、国际和科技。",
                sources: uniqueSources([
                    ...metadata.china.sources.slice(0, 2),
                    ...metadata.world.sources.slice(0, 2),
                    ...metadata.tech.sources.slice(0, 2),
                ]),
            },
        ],
        []
    );

    const applyFocusPreset = (presetName: string, sources: SourceID[]) => {
        if (
            focusSources.length > 0 &&
            !window.confirm(`应用"${presetName}"将替换当前 ${focusSources.length} 个关注源，是否继续？`)
        ) {
            return;
        }
        setFocusSources(sources);
        toaster(`${presetName} 已应用到关注栏`, { type: "success" });
    };

    return (
        <>
            {activeSources.length > 0 && (
                <section className="mx-auto mb-5 max-w-6xl rounded-2xl bg-primary/6 p-4 shadow shadow-primary/10">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h2 className="m-0 text-lg font-semibold">活跃源推荐</h2>
                            <p className="m-0 mt-1 text-sm op-70">
                                优先展示最近更新稳定、内容量较高的数据源，可一键加入关注。
                            </p>
                        </div>
                        <div className="text-xs op-55">推荐结果每分钟更新一次</div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {activeSources.map((source) => {
                            const sourceMeta = dataSources[source.id];

                            return (
                                <article key={source.id} className="rounded-xl bg-base/80 p-3 shadow shadow-primary/5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex gap-3">
                                            <a
                                                className="mt-0.5 h-10 w-10 rounded-full bg-cover bg-center"
                                                href={sourceMeta.home}
                                                target="_blank"
                                                title={sourceMeta.desc}
                                                style={{
                                                    backgroundImage: `url(/icons/${source.id.split("-")[0]}.png)`,
                                                }}
                                            />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold">{source.name}</span>
                                                    {sourceMeta.title && (
                                                        <span
                                                            className={clsx(
                                                                "rounded px-1.5 py-0.5 text-xs",
                                                                `color-${sourceMeta.color} bg-base op-80 bg-op-50!`
                                                            )}
                                                        >
                                                            {sourceMeta.title}
                                                        </span>
                                                    )}
                                                </div>
                                                {sourceMeta.desc && (
                                                    <div className="mt-1 text-xs op-60 line-clamp-1">
                                                        {sourceMeta.desc}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className={clsx(
                                                "rounded-full px-3 py-1 text-xs transition-all",
                                                isFocused(source.id)
                                                    ? "bg-primary text-white"
                                                    : "bg-primary/10 text-primary-700 dark:text-primary-300"
                                            )}
                                            onClick={() => toggleFocus(source.id)}
                                        >
                                            {isFocused(source.id) ? "已关注" : "加入关注"}
                                        </button>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2 text-xs op-70">
                                        <span className="rounded-full bg-neutral-500/8 px-2 py-1">
                                            近期返回 {source.lastItemCount ?? 0} 条
                                        </span>
                                        <span className="rounded-full bg-neutral-500/8 px-2 py-1">
                                            成功 {source.successCount} 次
                                        </span>
                                        <span className="rounded-full bg-neutral-500/8 px-2 py-1">
                                            状态 {source.status === "healthy" ? "稳定" : "待观察"}
                                        </span>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            )}
            <section className="mx-auto mb-5 max-w-6xl rounded-2xl bg-base/80 p-4 shadow shadow-primary/5">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h2 className="m-0 text-lg font-semibold">快速关注预设</h2>
                        <p className="m-0 mt-1 text-sm op-70">先用一组预设快速建立首页关注，再按自己的习惯继续微调。</p>
                    </div>
                    <div className="text-xs op-55">应用后会直接替换当前关注栏内容</div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {focusPresets.map((preset) => (
                        <article key={preset.id} className="rounded-xl bg-primary/6 p-4 shadow shadow-primary/5">
                            <div className="font-semibold">{preset.name}</div>
                            <div className="mt-2 text-sm op-75">{preset.description}</div>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs op-70">
                                {preset.sources.slice(0, 4).map((sourceId) => (
                                    <span key={sourceId} className="rounded-full bg-base/80 px-2 py-1">
                                        {dataSources[sourceId].name}
                                    </span>
                                ))}
                            </div>
                            <button
                                type="button"
                                className="mt-4 rounded-full bg-primary px-4 py-2 text-sm text-white transition-all hover:opacity-90"
                                onClick={() => applyFocusPreset(preset.name, preset.sources)}
                            >
                                立即使用
                            </button>
                        </article>
                    ))}
                </div>
            </section>
            <Column id={id} />
        </>
    );
}
