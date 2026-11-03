import type { Page } from "@playwright/test";

import { test, expect } from "@playwright/test";

const fixtureItem = {
    id: "fixture-1",
    title: "Stable fixture headline",
    url: "https://example.test/articles/fixture-1",
    pubDate: "2026-11-04T00:00:00.000Z",
};

test("keeps reading history and saved states across source and history routes", async ({ page }) => {
    await installReadingFlowMocks(page);
    await page.goto("/source/hackernews");

    await expect(page.getByRole("heading", { name: "Hacker News", level: 1 })).toBeVisible();
    const itemLink = page.getByRole("link", { name: new RegExp(fixtureItem.title) });
    await expect(itemLink).toBeVisible();

    await page.getByRole("button", { name: "稍后读", exact: true }).click();
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(page.getByRole("button", { name: "移出稍后读", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await itemLink.click();
    await (await popupPromise).close();
    await expect(itemLink).toContainText("已读");

    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "阅读历史", level: 1 })).toBeVisible();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();

    const historyTabs = page.locator(".history-tabs");
    await historyTabs.getByRole("button", { name: /稍后读/ }).click();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    await historyTabs.getByRole("button", { name: /收藏/ }).click();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
});

async function installReadingFlowMocks(page: Page) {
    await page.route("**/api/**", async (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname.endsWith("/v1/health/sources")) {
            await route.fulfill({
                json: {
                    updatedAt: Date.now(),
                    total: 1,
                    healthy: 1,
                    failing: 0,
                    idle: 0,
                    cacheDegraded: 0,
                    sources: [
                        {
                            id: "hackernews",
                            name: "Hacker News",
                            status: "healthy",
                            successCount: 1,
                            errorCount: 0,
                            consecutiveFailures: 0,
                            cacheDegraded: false,
                            lastDurationMs: 12,
                            lastSuccessAt: Date.now(),
                            lastItemCount: 1,
                            recentEvents: [],
                        },
                    ],
                },
            });
            return;
        }

        if (pathname.endsWith("/v1/sources")) {
            await route.fulfill({
                json: {
                    data: {
                        sources: [
                            {
                                id: "hackernews",
                                name: "Hacker News",
                                interval: 600_000,
                                color: "slate",
                                type: "normal",
                                disabled: false,
                            },
                        ],
                        columns: [],
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceCount: 1,
                        redirectCount: 0,
                        disabledCount: 0,
                        columnCount: 0,
                    },
                },
            });
            return;
        }

        if (pathname.endsWith("/v1/sources/hackernews")) {
            await route.fulfill({
                json: {
                    data: {
                        id: "hackernews",
                        name: "Hacker News",
                        interval: 600_000,
                        color: "slate",
                        type: "normal",
                        disabled: false,
                        home: "https://news.ycombinator.com/",
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId: "hackernews",
                        canonicalSourceId: "hackernews",
                        redirected: false,
                    },
                    errors: [],
                },
            });
            return;
        }

        if (pathname.endsWith("/v1/sources/hackernews/items")) {
            await route.fulfill({
                json: {
                    data: {
                        status: "success",
                        id: "hackernews",
                        name: "Hacker News",
                        updatedTime: Date.now(),
                        items: [fixtureItem],
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId: "hackernews",
                        status: "success",
                        itemCount: 1,
                        unfilteredItemCount: 1,
                    },
                    errors: [],
                },
            });
            return;
        }

        await route.fulfill({ json: { data: [], errors: [] } });
    });
}
