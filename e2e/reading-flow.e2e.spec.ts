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

test("blocks unsafe remote and legacy reading links and falls back from invalid mobile URLs", async ({ page }) => {
    const valid = { ...fixtureItem, mobileUrl: "file:///legacy-mobile" };
    const invalid = {
        ...fixtureItem,
        id: "legacy-unsafe",
        title: "Legacy unsafe article",
        url: "file:///legacy-article",
    };
    await installReadingFlowMocks(page, [valid, invalid]);
    await page.addInitScript((item) => {
        if (localStorage.getItem("reading-history")) return;
        localStorage.setItem(
            "reading-history",
            JSON.stringify([
                {
                    newsId: item.id,
                    title: item.title,
                    url: item.url,
                    sourceId: "hackernews",
                    sourceName: "Hacker News",
                    readAt: Date.now(),
                },
            ])
        );
    }, invalid);
    await page.goto("/source/hackernews");
    const safe = page.getByRole("link", { name: new RegExp(valid.title) });
    await expect(safe).toHaveAttribute("href", valid.url);
    const blocked = page.locator("a[aria-disabled=true]").filter({ hasText: invalid.title });
    await expect(blocked).toBeVisible();
    await expect(blocked).not.toHaveAttribute("href", /.+/);
    await blocked.click({ force: true });
    await page.goto("/history");
    const legacy = page.locator("a[aria-disabled=true]").filter({ hasText: invalid.title });
    await expect(legacy).toBeVisible();
    await expect(legacy).not.toHaveAttribute("href", /.+/);
    await expect(page.getByRole("button", { name: "移除阅读记录：" + invalid.title })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("reading-history") ?? "[]").length)).toBe(1);
});

async function installReadingFlowMocks(
    page: Page,
    items: Array<typeof fixtureItem & { mobileUrl?: string }> = [fixtureItem]
) {
    await page.route("**/api/**", async (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname.endsWith("/v1/health/sources")) {
            await route.fulfill({
                json: {
                    meta: {
                        generatedAt: Date.now(),
                        totalSourceCount: 1,
                        healthyCount: 1,
                        failingCount: 0,
                        idleCount: 0,
                        cacheDegradedCount: 0,
                    },
                    data: [
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
                    errors: [],
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
                        items,
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId: "hackernews",
                        status: "success",
                        itemCount: items.length,
                        unfilteredItemCount: items.length,
                    },
                    errors: [],
                },
            });
            return;
        }

        await route.fulfill({ json: { data: [], errors: [] } });
    });
}
