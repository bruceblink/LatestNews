import type { SourceID } from "@shared/types";

export type HealthRankStatus = "idle" | "healthy" | "failing";

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
