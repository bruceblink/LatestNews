import { rankFailingSourcesByPriority } from "./source-ranking-policy";

import type { SourceHealthEvent, SourceHealthSummary, SourceHealthSnapshot } from "./source-health-types";

export interface SourceHealthDiagnosticOptions {
    formatTime?: (time: number) => string;
    maxFailingSources?: number;
    maxCacheDegradedSources?: number;
    maxIdleSources?: number;
    maxHealthySamples?: number;
    maxRecentEvents?: number;
}

const DEFAULT_MAX_FAILING_SOURCES = 10;
const DEFAULT_MAX_CACHE_DEGRADED_SOURCES = 10;
const DEFAULT_MAX_IDLE_SOURCES = 20;
const DEFAULT_MAX_HEALTHY_SAMPLES = 5;
const DEFAULT_MAX_RECENT_EVENTS = 5;

export function formatSourceHealthDiagnostics(
    summary: SourceHealthSummary,
    options: SourceHealthDiagnosticOptions = {}
) {
    const formatTime = options.formatTime ?? defaultFormatTime;
    const failingSources = rankFailingSourcesByPriority(summary.sources).slice(
        0,
        options.maxFailingSources ?? DEFAULT_MAX_FAILING_SOURCES
    );
    const cacheDegradedSources = summary.sources
        .filter((source) => source.cacheDegraded)
        .slice(0, options.maxCacheDegradedSources ?? DEFAULT_MAX_CACHE_DEGRADED_SOURCES);
    const idleSources = summary.sources
        .filter((source) => source.status === "idle")
        .slice(0, options.maxIdleSources ?? DEFAULT_MAX_IDLE_SOURCES);
    const healthySamples = summary.sources
        .filter((source) => source.status === "healthy")
        .slice(0, options.maxHealthySamples ?? DEFAULT_MAX_HEALTHY_SAMPLES);

    return [
        "LatestNews 数据源诊断报告",
        `生成时间：${formatTime(summary.updatedAt)}`,
        "",
        "## 概览",
        `总数据源：${summary.total}`,
        `正常：${summary.healthy}`,
        `异常：${summary.failing}`,
        `未采样：${summary.idle}`,
        `缓存降级：${summary.cacheDegraded}`,
        "",
        formatFailingSection(failingSources, formatTime, options.maxRecentEvents),
        "",
        formatCacheDegradedSection(cacheDegradedSources, formatTime),
        "",
        formatIdleSection(idleSources),
        "",
        formatHealthySection(healthySamples, formatTime),
    ]
        .filter((line) => line !== undefined)
        .join("\n")
        .trim();
}

export function createSourceHealthDiagnosticFilename(summary: SourceHealthSummary) {
    const timestamp = new Date(summary.updatedAt).toISOString().replace(/[:.]/g, "-");
    return `latestnews-source-health-${timestamp}.txt`;
}

function formatFailingSection(
    sources: SourceHealthSnapshot[],
    formatTime: (time: number) => string,
    maxRecentEvents = DEFAULT_MAX_RECENT_EVENTS
) {
    if (!sources.length) return "## 异常源\n无";

    return [
        "## 异常源",
        ...sources.map((source, index) =>
            [
                `${index + 1}. ${source.name} (${source.id})`,
                `状态：${source.status}`,
                `连续失败：${source.consecutiveFailures}`,
                `失败次数：${source.errorCount}`,
                `最近错误：${formatOptionalTime(source.lastErrorAt, formatTime)}`,
                `最近耗时：${formatDuration(source.lastDurationMs)}`,
                `错误信息：${source.lastErrorMessage ?? "无"}`,
                formatRecentEvents(source.recentEvents, formatTime, maxRecentEvents),
            ].join("\n")
        ),
    ].join("\n\n");
}

function formatCacheDegradedSection(sources: SourceHealthSnapshot[], formatTime: (time: number) => string) {
    if (!sources.length) return "## 缓存降级源\n无";

    return [
        "## 缓存降级源",
        ...sources.map(
            (source, index) =>
                `${index + 1}. ${source.name} (${source.id}) · 连续失败 ${source.consecutiveFailures} · 最近错误 ${formatOptionalTime(
                    source.lastErrorAt,
                    formatTime
                )}`
        ),
    ].join("\n");
}

function formatIdleSection(sources: SourceHealthSnapshot[]) {
    if (!sources.length) return "## 未采样源\n无";

    return ["## 未采样源", ...sources.map((source, index) => `${index + 1}. ${source.name} (${source.id})`)].join("\n");
}

function formatHealthySection(sources: SourceHealthSnapshot[], formatTime: (time: number) => string) {
    if (!sources.length) return "## 正常源样本\n无";

    return [
        "## 正常源样本",
        ...sources.map(
            (source, index) =>
                `${index + 1}. ${source.name} (${source.id}) · 成功 ${source.successCount} 次 · 最近成功 ${formatOptionalTime(
                    source.lastSuccessAt,
                    formatTime
                )} · 最近返回 ${source.lastItemCount ?? "-"} 条`
        ),
    ].join("\n");
}

function formatRecentEvents(
    events: SourceHealthEvent[],
    formatTime: (time: number) => string,
    maxRecentEvents: number
) {
    if (!events.length) return "最近事件：无";

    return [
        "最近事件：",
        ...events
            .slice(0, maxRecentEvents)
            .map((event) =>
                [
                    `- ${event.status === "healthy" ? "成功" : "失败"}`,
                    formatTime(event.occurredAt),
                    formatDuration(event.durationMs),
                    event.itemCount !== undefined ? `返回 ${event.itemCount} 条` : undefined,
                    event.errorMessage,
                ]
                    .filter(Boolean)
                    .join(" · ")
            ),
    ].join("\n");
}

function formatOptionalTime(time: number | undefined, formatTime: (time: number) => string) {
    return time ? formatTime(time) : "未知";
}

function formatDuration(durationMs: number | undefined) {
    return durationMs === undefined ? "-" : `${durationMs} ms`;
}

function defaultFormatTime(time: number) {
    return new Date(time).toISOString();
}
