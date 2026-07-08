import type { SourceApiError } from "./source-api";
import type { SourceHealthSummary } from "./source-health-types";

export type DeploymentHealthOverallStatus = "ok" | "degraded" | "unavailable";
export type DeploymentHealthCheckStatus = "ok" | "degraded" | "unavailable" | "disabled" | "unknown";
export type DeploymentCacheStatus = "ok" | "disabled" | "unavailable";

export interface DeploymentHealthAppCheck {
    status: "ok";
    name: string;
    version: string;
}

export interface DeploymentHealthCacheCheck {
    status: DeploymentCacheStatus;
}

export interface DeploymentHealthSourcesCheck {
    status: DeploymentHealthCheckStatus;
    total: number;
    healthy: number;
    failing: number;
    idle: number;
    cacheDegraded: number;
    updatedAt: number;
}

export interface DeploymentHealthData {
    status: DeploymentHealthOverallStatus;
    generatedAt: number;
    checks: {
        app: DeploymentHealthAppCheck;
        cache: DeploymentHealthCacheCheck;
        sources: DeploymentHealthSourcesCheck;
    };
}

export interface DeploymentHealthResponse {
    data: DeploymentHealthData;
    meta: {
        generatedAt: number;
    };
    errors: SourceApiError[];
}

export interface DeploymentHealthInput {
    appName: string;
    appVersion: string;
    cacheStatus: DeploymentCacheStatus;
    generatedAt: number;
    sourceSummary: SourceHealthSummary;
}

export function createDeploymentHealthResponse(input: DeploymentHealthInput): DeploymentHealthResponse {
    const sources = createSourcesCheck(input.sourceSummary);
    const data: DeploymentHealthData = {
        status: getOverallStatus(input.cacheStatus, sources.status),
        generatedAt: input.generatedAt,
        checks: {
            app: {
                status: "ok",
                name: input.appName,
                version: input.appVersion,
            },
            cache: {
                status: input.cacheStatus,
            },
            sources,
        },
    };

    return {
        data,
        meta: {
            generatedAt: input.generatedAt,
        },
        errors: [],
    };
}

export function getDeploymentCacheStatus(input: { cacheAvailable: boolean; cacheDisabled?: boolean }) {
    if (input.cacheDisabled) return "disabled";
    return input.cacheAvailable ? "ok" : "unavailable";
}

export function getDeploymentSourceStatus(summary: SourceHealthSummary): DeploymentHealthCheckStatus {
    if (summary.total <= 0) return "unavailable";
    if (summary.healthy > 0 && summary.failing === 0 && summary.cacheDegraded === 0) return "ok";
    if (summary.healthy > 0 || summary.failing > 0 || summary.cacheDegraded > 0) return "degraded";
    return "unknown";
}

function createSourcesCheck(summary: SourceHealthSummary): DeploymentHealthSourcesCheck {
    return {
        status: getDeploymentSourceStatus(summary),
        total: summary.total,
        healthy: summary.healthy,
        failing: summary.failing,
        idle: summary.idle,
        cacheDegraded: summary.cacheDegraded,
        updatedAt: summary.updatedAt,
    };
}

function getOverallStatus(
    cacheStatus: DeploymentCacheStatus,
    sourceStatus: DeploymentHealthCheckStatus
): DeploymentHealthOverallStatus {
    if (sourceStatus === "unavailable") return "unavailable";
    if (cacheStatus === "unavailable" || sourceStatus === "degraded" || sourceStatus === "unknown") return "degraded";
    return "ok";
}
