export interface SourceHealthPolicyInput {
    status: "idle" | "healthy" | "failing";
    consecutiveFailures: number;
}

export function shouldDegradeSourceToCache(health: SourceHealthPolicyInput) {
    if (health.status !== "failing") return false;
    return health.consecutiveFailures >= 2;
}
