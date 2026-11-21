import { test, expect } from "@playwright/test";

test("keeps history visible during a slow feed refresh and restores omitted source items", async ({ page }) => {
    const blockedRefresh = Promise.withResolvers<void>();
    const requested = Promise.withResolvers<void>();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const title = "Previously loaded headline";
    const newTitle = "New headline from another source";
    let batchCalls = 0;
    await page.route("**/api/v1/sources/batch", async (route) => {
        const call = ++batchCalls;
        if (call === 2) {
            requested.resolve();
            await blockedRefresh.promise;
        }

        const now = Date.now();
        const partial = call > 1;
        await route.fulfill({
            json: {
                data: [
                    {
                        status: "success",
                        id: partial ? "weibo" : "zhihu",
                        updatedTime: now,
                        items: [
                            {
                                id: String(call),
                                title: partial ? newTitle : title,
                                url: `https://example.test/feed/${call}`,
                            },
                        ],
                    },
                ],
                meta: {
                    generatedAt: now,
                    requestedSourceCount: 2,
                    resolvedSourceCount: 1,
                    partial,
                    omittedSourceIds: partial ? ["zhihu"] : [],
                },
                errors: partial ? [{ sourceId: "zhihu", message: "Collector timed out" }] : [],
            },
        });
    });
    await page.route("**/api/v1/sources", (route) => route.fulfill({ json: { data: { sources: [] } } }));
    await page.goto("/feed?scope=hottest&since=all");

    const oldArticle = page.getByRole("link", { name: title });
    await expect(oldArticle).toBeVisible();
    try {
        await page.getByRole("button", { name: "刷新", exact: true }).click();
        await requested.promise;
        await expect(page.getByRole("button", { name: "刷新中" })).toBeDisabled();
        await expect(oldArticle).toBeVisible();
    } finally {
        blockedRefresh.resolve();
    }

    await expect(page.getByRole("link", { name: newTitle })).toBeVisible();
    await expect(oldArticle).toBeVisible();
    await expect(page.getByRole("status").getByText("部分来源正在显示历史数据。")).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    expect(pageErrors).toEqual([]);
});
