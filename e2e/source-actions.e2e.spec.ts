import type { Page } from "@playwright/test";

import { test, expect } from "@playwright/test";

const fixtureItem = {
    id: "fixture-source-1",
    title: "Source action keeps previous data",
    url: "https://example.test/source/fixture-source-1",
};

test("keeps prior source items and exposes a retry after clear-cache refresh fails", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    let clearCacheAttempts = 0;
    await installSourceMocks(page, {
        onItems: (url) => {
            if (url.searchParams.get("clearCache") !== "true") return { items: [fixtureItem] };
            clearCacheAttempts += 1;
            if (clearCacheAttempts === 1) return { status: 503, message: "upstream unavailable" };
            return { items: [{ ...fixtureItem, title: "Source action retry succeeded" }] };
        },
    });
    await page.goto("/source/hackernews");
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "清缓存刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("清缓存刷新失败");
    await expect(page.getByRole("alert")).toContainText("当前显示的内容已保留");
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "重试清缓存刷新", exact: true }).click();
    await expect(page.getByText("Source action retry succeeded", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(clearCacheAttempts).toBe(2);
    expect(pageErrors).toEqual([]);
});

test("renders a source without a home URL without a fake external link", async ({ page }) => {
    await installSourceMocks(page, { home: undefined });
    await page.goto("/source/hackernews");

    await expect(page.getByRole("heading", { name: "Hacker News", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开Hacker News源站" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "源站", exact: true })).toHaveCount(0);
});

test("shows metadata service errors separately from a missing source and allows retry", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    let metadataAttempts = 0;
    await installSourceMocks(page, {
        onMetadata: () => {
            metadataAttempts += 1;
            if (metadataAttempts === 1) return { status: 503, message: "metadata service unavailable" };
            return { data: sourceMetadata };
        },
    });
    await page.goto("/source/hackernews");

    await expect(page.getByRole("alert")).toContainText("无法加载来源详情");
    await expect(page.getByText("未找到或无效的数据源。", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Hacker News", level: 1 })).toBeVisible();
    expect(metadataAttempts).toBe(2);
    expect(pageErrors).toEqual([]);
});

test("restores the source detail without an items request and persists manual refresh", async ({ page }) => {
    let itemCalls = 0;
    let metadataCalls = 0;
    await installSourceMocks(page, {
        onMetadata: () => {
            metadataCalls++;
            return { data: sourceMetadata };
        },
        onItems: () => ({
            items: [{ ...fixtureItem, title: ++itemCalls === 1 ? fixtureItem.title : "Refreshed source item" }],
        }),
    });
    await page.goto("/source/hackernews");
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    expect(itemCalls).toBe(1);
    expect(metadataCalls).toBe(1);
    await page.getByRole("button", { name: "清缓存刷新", exact: true }).click();
    await expect(page.getByText("Refreshed source item", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Refreshed source item", { exact: true })).toBeVisible();
    expect(itemCalls).toBe(2);
});

async function installSourceMocks(
    page: Page,
    options: {
        home?: string;
        onItems?: (
            url: URL
        ) => { items: Array<{ id: string; title: string; url: string }> } | { status: number; message: string };
        onMetadata?: () => { data: typeof sourceMetadata } | { status: number; message: string };
    } = {}
) {
    await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const { pathname } = url;
        if (pathname.endsWith("/v1/health/sources")) {
            await route.fulfill({
                json: {
                    data: [],
                    meta: {
                        generatedAt: Date.now(),
                        totalSourceCount: 1,
                        healthyCount: 1,
                        failingCount: 0,
                        idleCount: 0,
                        cacheDegradedCount: 0,
                    },
                    errors: [],
                },
            });
            return;
        }

        if (pathname.endsWith("/v1/sources")) {
            await route.fulfill({ json: { data: { sources: [sourceMetadata], columns: [] }, meta: {} } });
            return;
        }

        if (pathname.endsWith("/v1/sources/hackernews")) {
            const result = options.onMetadata?.() ?? { data: { ...sourceMetadata, home: options.home } };
            if ("status" in result) {
                await route.fulfill({ status: result.status, json: { message: result.message } });
                return;
            }
            await route.fulfill({
                json: {
                    data: result.data,
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
            const result = options.onItems?.(url) ?? { items: [fixtureItem] };
            if ("status" in result) {
                await route.fulfill({ status: result.status, json: { message: result.message } });
                return;
            }
            await route.fulfill({
                json: {
                    data: {
                        status: "success",
                        id: "hackernews",
                        name: "Hacker News",
                        updatedTime: Date.now(),
                        items: result.items,
                    },
                    meta: {
                        generatedAt: Date.now(),
                        sourceId: "hackernews",
                        status: "success",
                        itemCount: result.items.length,
                        unfilteredItemCount: result.items.length,
                    },
                    errors: [],
                },
            });
            return;
        }

        if (pathname.endsWith("/v1/sources/batch")) {
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

        await route.fulfill({ json: { data: [], errors: [] } });
    });
}

const sourceMetadata = {
    id: "hackernews" as const,
    name: "Hacker News",
    interval: 600_000,
    color: "slate" as const,
    type: "normal" as const,
    disabled: false,
    column: "tech" as const,
    home: "https://news.ycombinator.com/",
};
