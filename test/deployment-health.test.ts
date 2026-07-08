import type { SourceHealthSummary } from "@shared/source-health-types";

import { it, expect, describe } from "vitest";

import {
    getDeploymentCacheStatus,
    getDeploymentSourceStatus,
    createDeploymentHealthResponse,
} from "../shared/deployment-health";

const NOW = Date.parse("2026-07-08T12:00:00.000Z");

function createSummary(input: Partial<SourceHealthSummary>): SourceHealthSummary {
    return {
        updatedAt: NOW,
        total: 3,
        healthy: 3,
        failing: 0,
        idle: 0,
        cacheDegraded: 0,
        sources: [],
        ...input,
    };
}

describe("deployment health", () => {
    it("reports an ok deployment when app, cache and sources are available", () => {
        const response = createDeploymentHealthResponse({
            appName: "latestnews",
            appVersion: "0.5.2",
            cacheStatus: "ok",
            generatedAt: NOW,
            sourceSummary: createSummary({}),
        });

        expect(response).toEqual({
            data: {
                status: "ok",
                generatedAt: NOW,
                checks: {
                    app: {
                        status: "ok",
                        name: "latestnews",
                        version: "0.5.2",
                    },
                    cache: {
                        status: "ok",
                    },
                    sources: {
                        status: "ok",
                        total: 3,
                        healthy: 3,
                        failing: 0,
                        idle: 0,
                        cacheDegraded: 0,
                        updatedAt: NOW,
                    },
                },
            },
            meta: {
                generatedAt: NOW,
            },
            errors: [],
        });
    });

    it("degrades deployment health when cache or source checks are not fully available", () => {
        expect(
            createDeploymentHealthResponse({
                appName: "latestnews",
                appVersion: "0.5.2",
                cacheStatus: "unavailable",
                generatedAt: NOW,
                sourceSummary: createSummary({}),
            }).data.status
        ).toBe("degraded");

        expect(
            createDeploymentHealthResponse({
                appName: "latestnews",
                appVersion: "0.5.2",
                cacheStatus: "ok",
                generatedAt: NOW,
                sourceSummary: createSummary({ healthy: 1, failing: 1, cacheDegraded: 1 }),
            }).data.status
        ).toBe("degraded");
    });

    it("distinguishes disabled cache from unavailable cache", () => {
        expect(getDeploymentCacheStatus({ cacheAvailable: true })).toBe("ok");
        expect(getDeploymentCacheStatus({ cacheAvailable: false, cacheDisabled: true })).toBe("disabled");
        expect(getDeploymentCacheStatus({ cacheAvailable: false })).toBe("unavailable");
    });

    it("derives source availability from source health counters", () => {
        expect(getDeploymentSourceStatus(createSummary({}))).toBe("ok");
        expect(getDeploymentSourceStatus(createSummary({ healthy: 1, failing: 1 }))).toBe("degraded");
        expect(getDeploymentSourceStatus(createSummary({ total: 3, healthy: 0, failing: 0, idle: 3 }))).toBe("unknown");
        expect(getDeploymentSourceStatus(createSummary({ total: 0, healthy: 0, failing: 0, idle: 0 }))).toBe(
            "unavailable"
        );
    });
});
