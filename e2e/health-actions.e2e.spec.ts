import { test, expect, type Page } from "@playwright/test";

import { createSourceHealthSourcesResponse } from "../shared/source-health-api";

import type { SourceHealthSummary } from "../shared/source-health-types";

const sourceHealth: SourceHealthSummary = {
    updatedAt: Date.parse("2026-11-15T00:00:00.000Z"),
    total: 2,
    healthy: 1,
    failing: 1,
    idle: 0,
    cacheDegraded: 0,
    sources: [
        {
            id: "hackernews",
            name: "Hacker News",
            status: "failing",
            adapterKind: "plugin",
            successCount: 1,
            errorCount: 1,
            consecutiveFailures: 1,
            cacheDegraded: false,
            lastDurationMs: 12,
            lastErrorAt: Date.parse("2026-11-15T00:00:00.000Z"),
            lastErrorMessage: "Temporary upstream failure",
            recentEvents: [],
        },
        {
            id: "weibo",
            name: "微博",
            status: "healthy",
            adapterKind: "legacy",
            successCount: 4,
            errorCount: 0,
            consecutiveFailures: 0,
            cacheDegraded: false,
            lastDurationMs: 18,
            lastSuccessAt: Date.parse("2026-11-15T00:00:00.000Z"),
            lastItemCount: 2,
            recentEvents: [],
        },
    ],
};

test("prevents duplicate source probes and keeps failures retryable", async ({ page }) => {
    const mocks = await installHealthMocks(page, { deferFirstProbe: true });
    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "数据源健康", level: 1 })).toBeVisible();

    const card = page.locator(".health-source-card").filter({ hasText: "Hacker News" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "清缓存探测", exact: true }).click();
    await mocks.firstProbeStarted;

    const pendingButton = card.getByRole("button", { name: "清理中", exact: true });
    await expect(pendingButton).toBeDisabled();
    await expect(pendingButton).toHaveAttribute("aria-busy", "true");
    await pendingButton.dispatchEvent("click");
    expect(mocks.probeRequests).toHaveLength(1);

    mocks.releaseFirstProbe();
    await expect(card.getByRole("alert")).toContainText("清缓存探测失败：");
    await expect(card.getByRole("button", { name: "清缓存探测", exact: true })).toBeEnabled();

    await card.getByRole("button", { name: "清缓存探测", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("已清理缓存并探测成功，返回 1 条数据");
    expect(mocks.probeRequests).toHaveLength(2);
    expect(
        mocks.probeRequests.every((request) => request.get("latest") === "true" && request.get("clearCache") === "true")
    ).toBe(true);
});

test("keeps health filters and reset behavior available", async ({ page }) => {
    await installHealthMocks(page);
    await page.goto("/health");
    await expect(page.getByText("显示 2 / 2 个", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hacker News", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "微博", exact: true })).toBeVisible();

    const [headerColors, priorityColors] = await Promise.all([
        page
            .locator(".health-page > .surface-panel")
            .first()
            .evaluate((element) => {
                const style = getComputedStyle(element);
                return { background: style.backgroundColor, border: style.borderTopColor };
            }),
        page.locator(".health-priority-panel").evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, border: style.borderTopColor };
        }),
    ]);
    expect(priorityColors.background).not.toBe(headerColors.background);
    expect(priorityColors.border).not.toBe(headerColors.border);

    await page.getByRole("button", { name: "仅异常", exact: true }).click();
    await expect(page.getByText("显示 1 / 2 个", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hacker News", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "微博", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "重置筛选", exact: true }).click();
    await expect(page.getByText("显示 2 / 2 个", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hacker News", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "微博", exact: true })).toBeVisible();
});

test("prevents duplicate manual health refreshes and restores the refresh button", async ({ page }) => {
    const mocks = await installHealthMocks(page, { deferManualRefresh: true });
    await page.goto("/health");

    const refreshButton = page.getByRole("button", { name: "刷新统计", exact: true });
    await expect(refreshButton).toBeEnabled();
    await refreshButton.click();
    await mocks.manualRefreshStarted;

    const pendingButton = page.getByRole("button", { name: "刷新中", exact: true });
    await expect(pendingButton).toBeDisabled();
    await expect(pendingButton).toHaveAttribute("aria-busy", "true");
    await pendingButton.dispatchEvent("click");
    expect(mocks.healthRequests).toBe(2);

    mocks.releaseManualRefresh();
    const restoredButton = page.getByRole("button", { name: "刷新统计", exact: true });
    await expect(restoredButton).toBeEnabled();
    await expect(restoredButton).toHaveAttribute("aria-busy", "false");
    expect(mocks.healthRequests).toBe(2);
});

function installHealthMocks(page: Page, options: { deferFirstProbe?: boolean; deferManualRefresh?: boolean } = {}) {
    const probeRequests: URLSearchParams[] = [];
    let healthRequests = 0;
    let markFirstProbeStarted!: () => void;
    let releaseFirstProbe!: () => void;
    let markManualRefreshStarted!: () => void;
    let releaseManualRefresh!: () => void;
    let shouldDeferFirstProbe = Boolean(options.deferFirstProbe);
    let shouldDeferManualRefresh = Boolean(options.deferManualRefresh);
    const firstProbeStarted = new Promise<void>((resolve) => {
        markFirstProbeStarted = resolve;
    });
    const firstProbeGate = new Promise<void>((resolve) => {
        releaseFirstProbe = resolve;
    });
    const manualRefreshStarted = new Promise<void>((resolve) => {
        markManualRefreshStarted = resolve;
    });
    const manualRefreshGate = new Promise<void>((resolve) => {
        releaseManualRefresh = resolve;
    });

    const routeReady = page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/v1/health/sources")) {
            healthRequests += 1;
            if (shouldDeferManualRefresh && healthRequests > 1) {
                shouldDeferManualRefresh = false;
                markManualRefreshStarted();
                await manualRefreshGate;
            }
            await route.fulfill({ json: createSourceHealthSourcesResponse(sourceHealth) });
            return;
        }
        if (url.pathname.endsWith("/api/me")) {
            await route.fulfill({ json: { status: "unauthenticated" } });
            return;
        }
        if (url.pathname.endsWith("/v1/auth/capability")) {
            await route.fulfill({ json: { enable: false } });
            return;
        }
        if (url.pathname.endsWith("/v1/sources")) {
            await route.fulfill({
                json: {
                    data: {
                        sources: [],
                        columns: [],
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceCount: 0,
                        redirectCount: 0,
                        disabledCount: 0,
                        columnCount: 0,
                    },
                },
            });
            return;
        }
        if (url.pathname.endsWith("/v1/sources/hackernews/items") && url.searchParams.get("clearCache") === "true") {
            probeRequests.push(url.searchParams);
            if (shouldDeferFirstProbe) {
                shouldDeferFirstProbe = false;
                markFirstProbeStarted();
                await firstProbeGate;
                await route.fulfill({
                    status: 503,
                    contentType: "application/json",
                    body: JSON.stringify({ message: "Temporary upstream failure" }),
                });
                return;
            }
            await route.fulfill({
                json: {
                    data: {
                        status: "success",
                        id: "hackernews",
                        name: "Hacker News",
                        updatedTime: Date.now(),
                        items: [
                            { id: "probe-result", title: "Probe result", url: "https://example.test/probe-result" },
                        ],
                    },
                    errors: [],
                },
            });
            return;
        }
        await route.fulfill({ json: { data: [], errors: [] } });
    });

    return routeReady.then(() => ({
        firstProbeStarted,
        manualRefreshStarted,
        probeRequests,
        get healthRequests() {
            return healthRequests;
        },
        releaseFirstProbe,
        releaseManualRefresh,
    }));
}
