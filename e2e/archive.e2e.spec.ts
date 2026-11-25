import { test, expect, type Page } from "@playwright/test";

const article = (id: string, title: string, eventId = "event-v2-reviewed") => ({
    articleKey: "article-v2-" + id,
    canonicalUrl: "https://example.test/archive/" + id,
    title,
    publishedAt: Date.parse("2026-11-23T00:00:00Z"),
    eventId,
    sourceIds: ["hackernews"],
    item: { id, title, url: "https://example.test/archive/" + id },
});

async function installMocks(page: Page) {
    let nextPageFailed = false;
    await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/v1/articles/search")) {
            const q = url.searchParams.get("q");
            if (q === "unavailable") return route.fulfill({ status: 503, json: { message: "Index unavailable" } });
            if (q === "denied") return route.fulfill({ status: 403, json: { message: "Forbidden" } });
            if (q === "limited") return route.fulfill({ status: 429, json: { message: "Rate limit" } });
            const items =
                q === "empty"
                    ? []
                    : [
                          article("first", "历史报道一"),
                          {
                              ...article("unsafe", "不安全链接"),
                              item: { id: "unsafe", title: "不安全链接", url: "javascript:alert(1)" },
                          },
                      ];
            return route.fulfill({
                json: {
                    data: { status: "ok", searchMode: "fts", query: q, items },
                    meta: { generatedAt: Date.now(), itemCount: items.length, limit: 50 },
                    errors: [],
                },
            });
        }
        if (url.pathname.endsWith("/v1/events/event-v2-reviewed")) {
            const after = url.searchParams.get("after");
            if (after && !nextPageFailed) {
                nextPageFailed = true;
                return route.fulfill({ status: 503, json: { message: "Temporary failure" } });
            }
            const items = after
                ? [article("first", "历史报道一"), article("second", "历史报道二")]
                : [article("first", "历史报道一")];
            return route.fulfill({
                json: {
                    data: {
                        eventId: "event-v2-reviewed",
                        canonicalEventId: "event-v2-canonical",
                        registeredAt: Date.now(),
                        items,
                    },
                    meta: {
                        generatedAt: Date.now(),
                        itemCount: items.length,
                        limit: 30,
                        ...(!after ? { nextCursor: "article-v2-first" } : {}),
                    },
                    errors: [],
                },
            });
        }
        if (url.pathname.includes("/v1/events/"))
            return route.fulfill({ status: 404, json: { message: "Event missing" } });
        if (url.pathname.endsWith("/api/me")) return route.fulfill({ json: { status: "unauthenticated" } });
        if (url.pathname.endsWith("/v1/sources"))
            return route.fulfill({
                json: {
                    data: { sources: [], columns: [] },
                    meta: {
                        generatedAt: Date.now(),
                        sourceCount: 0,
                        redirectCount: 0,
                        disabledCount: 0,
                        columnCount: 0,
                    },
                    errors: [],
                },
            });
        if (url.pathname.endsWith("/v1/health/sources"))
            return route.fulfill({
                json: {
                    meta: {
                        generatedAt: Date.now(),
                        totalSourceCount: 0,
                        healthyCount: 0,
                        failingCount: 0,
                        idleCount: 0,
                        cacheDegradedCount: 0,
                    },
                    data: [],
                    errors: [],
                },
            });
        return route.fulfill({ json: { data: [], errors: [] } });
    });
}

test("searches historical articles with source/date, reading actions and reviewed event pagination", async ({
    page,
}) => {
    await installMocks(page);
    await page.goto("/history");
    await page.getByRole("link", { name: "检索新闻档案" }).click();
    await expect(page.getByRole("heading", { name: "新闻档案" })).toBeVisible();
    await page.getByLabel("关键词").fill("历史");
    await page.getByRole("combobox", { name: "来源", exact: true }).selectOption("hackernews");
    await page.getByLabel("发布时间起点（UTC）").fill("2026-11-01");
    const request = page.waitForRequest((r) => r.url().includes("/v1/articles/search"));
    await page.getByRole("button", { name: "检索历史文章" }).click();
    const url = new URL((await request).url());
    expect(url.searchParams.get("q")).toBe("历史");
    expect(url.searchParams.get("source")).toBe("hackernews");
    expect(url.searchParams.get("since")).toBe("2026-11-01");
    await expect(page.getByRole("link", { name: "历史报道一" })).toBeVisible();
    await expect(page.getByText("不安全链接")).toHaveCount(0);
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "查看事件历史" }).click();
    await expect(page.getByRole("heading", { name: "事件历史" })).toBeVisible();
    await expect(page.getByText("规范事件：event-v2-canonical")).toBeVisible();
    await page.getByRole("button", { name: "加载更多事件文章" }).click();
    await expect(page.getByRole("alert")).toContainText("已加载的结果保留");
    await expect(page.getByRole("link", { name: "历史报道一" })).toBeVisible();
    await page.getByRole("button", { name: "加载更多事件文章" }).click();
    await expect(page.getByRole("link", { name: "历史报道二" })).toBeVisible();
    await expect(page.getByRole("link", { name: "历史报道一" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "加载更多事件文章" })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "新闻档案" })).toBeVisible();
    await expect(page.getByLabel("关键词")).toHaveValue("历史");
});

test("distinguishes empty, authorization and unavailable responses", async ({ page }) => {
    await installMocks(page);
    for (const [query, label] of [
        ["empty", "没有可展示的文章。"],
        ["denied", "当前新闻 API 拒绝访问历史索引"],
        ["limited", "历史查询请求过于频繁"],
        ["unavailable", "历史索引暂不可用"],
    ]) {
        await page.goto("/archive?q=" + query);
        await expect(page.getByText(label, { exact: false })).toBeVisible();
    }
    await page.goto("/archive?event=event-missing");
    await expect(page.getByText("事件不存在，或当前服务尚未提供事件详情。")).toBeVisible();
});

test("keeps historical search separate from offline content and fits mobile widths", async ({ page, context }) => {
    await installMocks(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/archive?q=history");
        await expect(page.getByRole("link", { name: "历史报道一" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await context.setOffline(true);
    await expect(page.getByText("当前离线。历史索引需要远端服务", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "历史报道一" })).toHaveCount(0);
    await context.setOffline(false);
    await expect(page.getByRole("link", { name: "历史报道一" })).toBeVisible();
});
