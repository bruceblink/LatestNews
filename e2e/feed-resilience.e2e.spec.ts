import { test, expect } from "@playwright/test";

test("keeps history visible during a slow feed refresh and restores omitted source items", async ({ page }) => {
    const blockedRefresh = Promise.withResolvers<void>();
    const requested = Promise.withResolvers<void>();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const title = "Previously loaded headline";
    const newTitle = "New headline from another source";
    const recoveredTitle = "Recovered source headline";
    let batchCalls = 0;
    await page.route("**/api/v1/sources/batch", async (route) => {
        const call = ++batchCalls;
        if (call === 2) {
            requested.resolve();
            await blockedRefresh.promise;
        }

        const now = Date.now();
        const partial = call === 2;
        await route.fulfill({
            json: {
                data: [
                    {
                        status: call === 3 ? "empty" : "success",
                        id: partial ? "weibo" : "zhihu",
                        updatedTime: now,
                        items:
                            call === 3
                                ? []
                                : [
                                      {
                                          id: String(call),
                                          title: partial ? newTitle : call === 4 ? recoveredTitle : title,
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
    const refreshButton = page.getByRole("button", { name: "刷新", exact: true });
    await expect(refreshButton).toBeEnabled();
    await refreshButton.click();
    await expect(refreshButton).toBeEnabled();
    await expect(oldArticle).toBeVisible();
    await expect(page.getByRole("status").getByText("部分来源正在显示历史数据。")).toBeVisible();
    await refreshButton.click();
    await expect(page.getByRole("link", { name: recoveredTitle })).toBeVisible();
    await expect(oldArticle).toHaveCount(0);
    await expect(page.getByText("部分来源正在显示历史数据。")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
});

test("uses a scoped recent Feed snapshot on reload and recalculates the rolling query on explicit refresh", async ({
    page,
}) => {
    let batchCalls = 0;
    const cutoffs: number[] = [];
    const title = "Recent rolling Feed snapshot";
    await page.route("**/api/v1/sources", (route) => route.fulfill({ json: { data: { sources: [] } } }));
    await page.route("**/api/v1/sources/batch", async (route) => {
        batchCalls++;
        const payload = route.request().postDataJSON() as { since: number; sources: string[] };
        cutoffs.push(payload.since);
        const now = Date.now();
        await route.fulfill({
            json: {
                data: [
                    {
                        id: "zhihu",
                        status: "success",
                        updatedTime: now,
                        items: [{ id: "rolling", title, url: "https://example.test/rolling", pubDate: now }],
                    },
                ],
                meta: {
                    generatedAt: now,
                    requestedSourceCount: 1,
                    resolvedSourceCount: 1,
                    partial: false,
                    omittedSourceIds: [],
                    itemCount: 1,
                    unfilteredItemCount: 1,
                    filters: { sourceIds: payload.sources, columns: [], types: [], since: payload.since },
                },
                errors: [],
            },
        });
    });
    await page.goto("/feed?scope=hottest&since=24h");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    expect(batchCalls).toBe(1);
    await page.reload();
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByText("本地缓存", { exact: true })).toBeVisible();
    expect(batchCalls).toBe(1);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect.poll(() => batchCalls).toBe(2);
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    expect(cutoffs[1]).toBeGreaterThan(cutoffs[0]);
    await page.reload();
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    expect(batchCalls).toBe(2);
});
