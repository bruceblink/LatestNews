import { test, expect, type Page } from "@playwright/test";

const sourceHealth = {
    updatedAt: Date.parse("2026-10-24T00:00:00.000Z"),
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
            lastSuccessAt: Date.parse("2026-10-24T00:00:00.000Z"),
            lastItemCount: 1,
            recentEvents: [],
        },
    ],
};

async function installApiMocks(page: Page) {
    await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;
        if (pathname.endsWith("/s/health")) {
            await route.fulfill({ json: sourceHealth });
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
                                column: "tech",
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
        if (pathname.endsWith("/s/entire") || pathname.endsWith("/v1/sources/batch")) {
            await route.fulfill({
                json: {
                    data: [],
                    meta: {
                        generatedAt: Date.now(),
                        requestedSourceCount: 0,
                        resolvedSourceCount: 0,
                        partial: false,
                        omittedSourceIds: [],
                    },
                    errors: [],
                },
            });
            return;
        }
        if (pathname.includes("/v1/sources/") && pathname.endsWith("/items")) {
            await route.fulfill({
                json: {
                    data: {
                        status: "empty",
                        id: "hackernews",
                        name: "Hacker News",
                        items: [],
                        updatedTime: Date.now(),
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId: "hackernews",
                        status: "empty",
                        itemCount: 0,
                        unfilteredItemCount: 0,
                    },
                    errors: [],
                },
            });
            return;
        }
        await route.fulfill({ json: { data: [], errors: [] } });
    });
}

test("renders the web shell and opens the shared settings panel", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");

    await expect(page).toHaveTitle(/LatestNews/i);
    await expect(page.getByRole("button", { name: "打开设置" })).toBeVisible();
    await page.getByRole("button", { name: "打开设置" }).click();

    await expect(page.getByRole("dialog")).toContainText("设置");
    await expect(page.getByText("当前运行在 Web 版本。数据源地址由构建变量")).toBeVisible();
});

test("loads the settings route directly", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
    await expect(page.getByText("Web 和桌面端使用同一套配置面板")).toBeVisible();
});
