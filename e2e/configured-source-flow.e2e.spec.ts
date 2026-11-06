import type { Page } from "@playwright/test";

import { test, expect } from "@playwright/test";

const sourceId = "ext.config.rss-feed";
const fixtureItem = {
    id: "configured-rss-1",
    title: "Configured RSS fixture headline",
    url: "https://publisher.example.test/configured/1",
    pubDate: "2026-11-06T08:00:00.000Z",
};

test("reads a configured source through detail, saved state, and history", async ({ page }) => {
    await installConfiguredSourceMocks(page);
    await page.goto(`/source/${sourceId}`);

    await expect(page.getByRole("heading", { name: "Configured RSS", level: 1 })).toBeVisible();
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
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    await page
        .locator(".history-tabs")
        .getByRole("button", { name: /稍后读/ })
        .click();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    await page.locator(".history-tabs").getByRole("button", { name: /收藏/ }).click();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
});

async function installConfiguredSourceMocks(page: Page) {
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
                            id: sourceId,
                            name: "Configured RSS",
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
                                id: sourceId,
                                name: "Configured RSS",
                                interval: 300_000,
                                color: "primary",
                                type: "normal",
                                disabled: false,
                                column: "tech",
                            },
                        ],
                        columns: [{ id: "tech", name: "科技", sourceIds: [sourceId] }],
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceCount: 1,
                        redirectCount: 0,
                        disabledCount: 0,
                        columnCount: 1,
                    },
                },
            });
            return;
        }

        if (pathname.endsWith(`/v1/sources/${sourceId}`)) {
            await route.fulfill({
                json: {
                    data: {
                        id: sourceId,
                        name: "Configured RSS",
                        interval: 300_000,
                        color: "primary",
                        type: "normal",
                        disabled: false,
                        column: "tech",
                        home: "https://feeds.example.test",
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId,
                        canonicalSourceId: sourceId,
                        redirected: false,
                    },
                    errors: [],
                },
            });
            return;
        }

        if (pathname.endsWith(`/v1/sources/${sourceId}/items`)) {
            await route.fulfill({
                json: {
                    data: {
                        status: "success",
                        id: sourceId,
                        name: "Configured RSS",
                        updatedTime: Date.now(),
                        items: [fixtureItem],
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId,
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
