import type { ColumnID, SourceID } from "@shared/types";

import dataSources from "@shared/data-sources";

export type HealthRankStatus = "idle" | "healthy" | "failing";
export type InsightCategoryID = ColumnID | "uncategorized";

export interface SourceHealthRankInput {
    id: SourceID;
    status: HealthRankStatus;
    successCount: number;
    consecutiveFailures: number;
    lastItemCount?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastDurationMs?: number;
}

function healthWeight(status: HealthRankStatus) {
    if (status === "healthy") return 3;
    if (status === "idle") return 1;
    return 0;
}

export function getHomeSourceScore(source: SourceHealthRankInput) {
    return (
        healthWeight(source.status) * 1000 +
        (source.lastItemCount ?? 0) * 100 +
        source.successCount * 10 -
        source.consecutiveFailures * 20
    );
}

export function rankActiveSourcesForHome<T extends SourceHealthRankInput>(sources: T[]) {
    return sources
        .filter((source) => source.status !== "failing")
        .sort((left, right) => {
            const rightScore = getHomeSourceScore(right);
            const leftScore = getHomeSourceScore(left);

            if (rightScore !== leftScore) return rightScore - leftScore;
            return (right.lastSuccessAt ?? 0) - (left.lastSuccessAt ?? 0);
        });
}

export function getFailingSourcePriorityScore(source: SourceHealthRankInput) {
    if (source.status !== "failing") return -1;

    const failureWeight = source.consecutiveFailures * 100;
    const errorRecencyWeight = Math.floor((source.lastErrorAt ?? 0) / 1000);
    const durationWeight = source.lastDurationMs ?? 0;

    return failureWeight + errorRecencyWeight + durationWeight;
}

export function rankFailingSourcesByPriority<T extends SourceHealthRankInput>(sources: T[]) {
    return sources
        .filter((source) => source.status === "failing")
        .sort((left, right) => getFailingSourcePriorityScore(right) - getFailingSourcePriorityScore(left));
}

function healthReviewStatusPriority(status: HealthRankStatus) {
    if (status === "failing") return 3;
    if (status === "idle") return 2;
    return 1;
}

export function rankSourcesForHealthReview<T extends SourceHealthRankInput>(sources: T[]) {
    return [...sources].sort((left, right) => {
        const rightStatusPriority = healthReviewStatusPriority(right.status);
        const leftStatusPriority = healthReviewStatusPriority(left.status);

        if (rightStatusPriority !== leftStatusPriority) return rightStatusPriority - leftStatusPriority;

        if (left.status === "failing" && right.status === "failing") {
            return getFailingSourcePriorityScore(right) - getFailingSourcePriorityScore(left);
        }

        const rightScore = getHomeSourceScore(right);
        const leftScore = getHomeSourceScore(left);

        if (rightScore !== leftScore) return rightScore - leftScore;
        return (right.lastSuccessAt ?? right.lastErrorAt ?? 0) - (left.lastSuccessAt ?? left.lastErrorAt ?? 0);
    });
}

const INSIGHT_SOURCE_TYPE_WEIGHTS = {
    hottest: 1.1,
    realtime: 1.05,
} as const;

/**
 * Derives a stable insight weight from source metadata, without consulting fetch or health state.
 * The caller may still override this value for deterministic tests or a future user preference.
 */
export function getInsightSourceWeight(sourceId: SourceID) {
    const source = dataSources[sourceId];
    if (!source?.type) return 1;
    return INSIGHT_SOURCE_TYPE_WEIGHTS[source.type];
}

const INSIGHT_CATEGORY_WEIGHTS: Record<InsightCategoryID, number> = {
    china: 1,
    world: 1,
    tech: 1,
    finance: 1.05,
    focus: 1.05,
    realtime: 1.05,
    hottest: 1.1,
    uncategorized: 0.95,
};

/** Returns the deterministic default weight for a source category. */
export function getInsightCategoryWeight(categoryId: InsightCategoryID) {
    return INSIGHT_CATEGORY_WEIGHTS[categoryId] ?? 1;
}

export interface InsightRankingReasonInput {
    sourceCoverage: number;
    recencyScore: number;
    sourceWeight: number;
    categoryWeight: number;
    readPenalty: number;
}

/**
 * Converts numeric ranking signals into a compact explanation that can be rendered by any client.
 * Keeping this formatter pure makes the explanation deterministic and easy to test.
 */
export function formatInsightRankingReason({
    sourceCoverage,
    recencyScore,
    sourceWeight,
    categoryWeight,
    readPenalty,
}: InsightRankingReasonInput) {
    const freshness = recencyScore >= 0.75 ? "近期更新" : recencyScore >= 0.35 ? "今日更新" : "更新较早";
    const readState = readPenalty > 0 ? "已读降权" : "未读优先";

    return [
        `${sourceCoverage} 个来源覆盖`,
        freshness,
        `来源权重 ${sourceWeight.toFixed(2)}`,
        `分类权重 ${categoryWeight.toFixed(2)}`,
        readState,
    ].join(" · ");
}
