import { test, expect, type Page } from "@playwright/test";

type InsightsPayload = {
    sources: string[];
    trendWindow: "24h" | "7d";
};

type InsightsResponseOptions = {
    itemCount?: number;
    partial?: boolean;
    sourceActivity?: Array<{ sourceId: string; sourceName: string; itemCount: number }>;
    headlines?: string[];
};

type MockOptions = {
    holdFirstInsightsRequest?: boolean;
    respondToInsights?: (
        payload: InsightsPayload,
        requestIndex: number
    ) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown };
};

const firstHeadline = "固定测试响应中的首条热点";
const secondHeadline = "固定测试响应中的另一条热点";

test("keeps source choices available when a result has no source activity", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        respondToInsights: () => ({
            body: createInsightsEnvelope({ itemCount: 0, sourceActivity: [] }),
        }),
    });
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "阅读洞察", level: 1 })).toBeVisible();

    const sourceFilter = getInsightFilter(page, "来源");
    await expect(sourceFilter.locator('option[value="weibo"]')).toHaveCount(1);
    await expect(sourceFilter.locator('option[value="hackernews"]')).toHaveCount(1);
    await sourceFilter.selectOption("weibo");

    await expect.poll(() => mocks.insightsRequests.at(-1)?.sources).toEqual(["weibo"]);
    await expect(sourceFilter).toHaveValue("weibo");
});

test("resets the source filter when the content scope changes", async ({ page }) => {
    const mocks = await installInsightsMocks(page);
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "阅读洞察", level: 1 })).toBeVisible();

    await getInsightFilter(page, "来源").selectOption("hackernews");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.sources).toEqual(["hackernews"]);

    await getInsightFilter(page, "内容范围").selectOption("realtime");
    await expect(getInsightFilter(page, "来源")).toHaveValue("all");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.sources).toContain("zaobao");
    expect(mocks.insightsRequests.at(-1)?.sources).not.toContain("hackernews");
});

test("changes the trend window from chart buttons and sends uncached selections", async ({ page }) => {
    const mocks = await installInsightsMocks(page);
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "阅读洞察", level: 1 })).toBeVisible();
    await expect.poll(() => mocks.insightsRequests[0]?.trendWindow).toBe("24h");

    const controls = page.getByRole("group", { name: "趋势时间范围", exact: true });
    const sevenDays = controls.getByRole("button", { name: "7 天", exact: true });

    await sevenDays.click();
    await expect(sevenDays).toHaveAttribute("aria-pressed", "true");
    await expect(getInsightFilter(page, "时间范围")).toHaveValue("7d");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.trendWindow).toBe("7d");
    const day = controls.getByRole("button", { name: "24 小时", exact: true });
    await day.click();
    await expect(day).toHaveAttribute("aria-pressed", "true");
    await expect(getInsightFilter(page, "时间范围")).toHaveValue("24h");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect.poll(() => mocks.insightsRequests.at(-1)?.trendWindow).toBe("24h");
});

test("uses the returned headline and shows a neutral empty state", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        respondToInsights: (_payload, requestIndex) => ({
            body: createInsightsEnvelope(
                requestIndex === 0
                    ? { headlines: [firstHeadline, secondHeadline] }
                    : { itemCount: 0, headlines: [], sourceActivity: [] }
            ),
        }),
    });
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "阅读洞察", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: firstHeadline, exact: true })).toBeVisible();
    await expect(page.getByText("不表示内容增长率。")).toBeVisible();

    await getInsightFilter(page, "来源").selectOption("weibo");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.sources).toEqual(["weibo"]);
    await expect(page.getByText("暂无热点", { exact: true })).toBeVisible();
    await expect(page.locator(".insights-page-status").first()).toContainText("暂无内容");
});

test("does not report success while pending and reports partial results", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        holdFirstInsightsRequest: true,
        respondToInsights: (_payload, requestIndex) => ({
            body: createInsightsEnvelope({ partial: requestIndex === 0 }),
        }),
    });
    await page.goto("/insights");
    await mocks.firstInsightsRequestStarted;
    await expect(page.locator(".insights-page-status").first()).toContainText("更新中");
    await expect(page.locator(".insights-page-status").first()).not.toContainText("数据已更新");

    mocks.releaseFirstInsightsRequest();
    await expect(page.locator(".insights-page-status").first()).toContainText("部分数据");
    await expect(page.locator(".insights-page-status").first()).toContainText("更新于");

    await getInsightFilter(page, "时间范围").selectOption("7d");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.trendWindow).toBe("7d");
    await expect(page.locator(".insights-page-status").first()).toContainText("数据已更新");
});

test("preserves the prior result after a filtered request fails and supports retry", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        respondToInsights: (_payload, requestIndex) =>
            requestIndex === 1
                ? { status: 503, body: { message: "Fixture unavailable" } }
                : {
                      body: createInsightsEnvelope({
                          headlines: [requestIndex === 0 ? firstHeadline : secondHeadline],
                      }),
                  },
    });
    await page.goto("/insights");
    const oldHotItem = page.getByRole("link", { name: firstHeadline, exact: true });
    await expect(oldHotItem).toBeVisible();
    const requestsBeforeFilter = mocks.insightsRequests.length;
    await getInsightFilter(page, "来源").selectOption("weibo");
    await expect.poll(() => mocks.insightsRequests.length).toBeGreaterThan(requestsBeforeFilter);
    await expect(page.getByRole("alert")).toContainText("洞察加载失败");
    await expect(page.getByRole("alert")).toContainText(
        "当前筛选失败，以下保留全部内容 · 全部来源 · 最近 24 小时的上次结果"
    );
    await expect(page.getByRole("status").first()).toContainText("更新失败 · 显示上次范围");
    await expect(oldHotItem).toBeVisible();

    await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => mocks.insightsRequests.length).toBeGreaterThan(1);
    await expect(page.getByRole("link", { name: secondHeadline, exact: true })).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("数据已更新");
});

test("preserves the 24-hour result and labels its range when a 7-day request fails", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        respondToInsights: (_payload, requestIndex) =>
            requestIndex === 1
                ? { status: 503, body: { message: "Fixture unavailable" } }
                : {
                      body: createInsightsEnvelope({
                          headlines: [requestIndex === 0 ? firstHeadline : secondHeadline],
                      }),
                  },
    });
    await page.goto("/insights");
    const oldHotItem = page.getByRole("link", { name: firstHeadline, exact: true });
    await expect(oldHotItem).toBeVisible();
    await expect.poll(() => mocks.insightsRequests[0]?.trendWindow).toBe("24h");

    await getInsightFilter(page, "时间范围").selectOption("7d");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.trendWindow).toBe("7d");
    await expect(page.getByRole("alert")).toContainText("洞察加载失败");
    await expect(page.getByRole("alert")).toContainText(
        "当前筛选失败，以下保留全部内容 · 全部来源 · 最近 24 小时的上次结果"
    );
    await expect(page.getByRole("status").first()).toContainText("更新失败 · 显示上次范围");
    await expect(oldHotItem).toBeVisible();
    await expect(page.locator(".insights-chart-snapshot-range")).toHaveText("当前图表：最近 24 小时的上次结果");
    await expect(page.locator(".insights-sr-only")).toContainText("最近 24 小时");
    await expect(getInsightFilter(page, "时间范围")).toHaveValue("7d");
    await expect(page.locator(".insights-bar-column").first()).toHaveAccessibleName(/ \d{2}:00：/);

    await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => mocks.insightsRequests.length).toBeGreaterThan(2);
    await expect(mocks.insightsRequests.at(-1)?.trendWindow).toBe("7d");
    await expect(page.getByRole("link", { name: secondHeadline, exact: true })).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("数据已更新");
    await expect(page.locator(".insights-chart-snapshot-range")).toHaveCount(0);
});

test("preserves the same-range result after a manual refresh fails and supports retry", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        respondToInsights: (_payload, requestIndex) =>
            requestIndex === 1
                ? { status: 503, body: { message: "Fixture unavailable" } }
                : {
                      body: createInsightsEnvelope({
                          headlines: [requestIndex === 0 ? firstHeadline : secondHeadline],
                      }),
                  },
    });
    await page.goto("/insights");
    const oldHotItem = page.getByRole("link", { name: firstHeadline, exact: true });
    await expect(oldHotItem).toBeVisible();
    await expect.poll(() => mocks.insightsRequests[0]?.trendWindow).toBe("24h");

    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect.poll(() => mocks.insightsRequests.length).toBeGreaterThan(1);
    await expect(page.getByRole("alert")).toContainText("洞察加载失败");
    await expect(page.getByRole("alert")).toContainText("当前保留上次结果");
    await expect(page.getByRole("status").first()).toContainText("更新失败 · 显示上次结果");
    await expect(oldHotItem).toBeVisible();

    await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => mocks.insightsRequests.length).toBeGreaterThan(2);
    await expect(mocks.insightsRequests.at(-1)?.trendWindow).toBe("24h");
    await expect(page.getByRole("link", { name: secondHeadline, exact: true })).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("数据已更新");
});

test("does not style an unsampled source as healthy", async ({ page }) => {
    await installInsightsMocks(page);
    await page.route("**/api/s/health", (route) =>
        route.fulfill({
            json: {
                updatedAt: Date.now(),
                total: 2,
                healthy: 1,
                failing: 0,
                idle: 1,
                cacheDegraded: 0,
                sources: [
                    { id: "hackernews", name: "Hacker News", status: "healthy", cacheDegraded: false },
                    { id: "weibo", name: "微博", status: "idle", cacheDegraded: false },
                ],
            },
        })
    );
    await page.goto("/insights");

    const idleSource = page.locator(".insights-health-source.is-idle");
    await expect(idleSource).toContainText("未采样");
    const idleColor = await idleSource
        .locator(".insights-health-indicator")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(idleColor).toBe(
        await page
            .locator(".insights-health-legend i.is-idle")
            .evaluate((element) => getComputedStyle(element).backgroundColor)
    );
    expect(idleColor).not.toBe(
        await page
            .locator(".insights-health-source.is-healthy .insights-health-indicator")
            .evaluate((element) => getComputedStyle(element).backgroundColor)
    );
});

test("keeps later-read and favorite actions usable and persisted at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installInsightsMocks(page);
    await page.goto("/insights");

    const hotRow = page.locator(".insights-hot-row").filter({ hasText: firstHeadline });
    await expect(hotRow).toBeVisible();
    const favoriteButton = hotRow.getByRole("button", { name: "收藏", exact: true });
    const moreActions = hotRow.locator(".insights-hot-more");
    await moreActions.locator("summary").click();
    const laterButton = moreActions.getByRole("button", { name: "稍后读", exact: true });
    await expect(laterButton).toBeVisible();
    await expect(favoriteButton).toBeVisible();

    await laterButton.click();
    await expect(moreActions.getByRole("button", { name: "移出稍后读", exact: true })).toBeVisible();
    await favoriteButton.click();
    await expect(hotRow.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    const reloadedRow = page.locator(".insights-hot-row").filter({ hasText: firstHeadline });
    const reloadedMoreActions = reloadedRow.locator(".insights-hot-more");
    await reloadedMoreActions.locator("summary").click();
    await expect(reloadedMoreActions.getByRole("button", { name: "移出稍后读", exact: true })).toBeVisible();
    await expect(reloadedRow.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );
});

test.describe("mobile insights controls", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("exposes actual bucket counts and supports mobile filter apply", async ({ page }) => {
        const mocks = await installInsightsMocks(page);
        await page.goto("/insights");

        const firstBucket = page.getByRole("button", { name: /：1 条内容，1 个来源$/ }).first();
        await expect(firstBucket).toBeVisible();
        const touchTargets = page.locator(
            ".insights-header-theme-toggle, .insights-window-toggle button, .insights-favorite-button, .insights-hot-more > summary"
        );
        const targetSizes = await touchTargets.evaluateAll((elements) =>
            elements.map((element) => {
                const { width, height } = element.getBoundingClientRect();
                return { width, height };
            })
        );
        expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
        await firstBucket.tap();
        await expect(page.locator(".insights-chart-detail")).toContainText("1 条 · 1 个来源");

        const filterSummary = page.locator(".insights-filter-summary");
        await filterSummary.tap();
        await expect(filterSummary).toHaveAttribute("aria-expanded", "true");
        await getInsightFilter(page, "内容范围").selectOption("realtime");
        await getInsightFilter(page, "来源").selectOption("zaobao");
        await page.getByRole("button", { name: "应用筛选", exact: true }).tap();

        await expect(filterSummary).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator(".insights-filter-active")).toContainText("实时内容");
        await expect(page.locator(".insights-filter-active")).toContainText("联合早报");
        await expect.poll(() => mocks.insightsRequests.at(-1)?.sources).toEqual(["zaobao"]);
        await expect(page.getByRole("region", { name: "主要洞察" })).toBeFocused();

        await filterSummary.tap();
        await getInsightFilter(page, "内容范围").selectOption("focus");
        await page.keyboard.press("Escape");
        await expect(filterSummary).toHaveAttribute("aria-expanded", "false");
        await expect(filterSummary).toBeFocused();
        await expect(page.locator(".insights-filter-active")).toContainText("实时内容");

        await filterSummary.tap();
        await expect(getInsightFilter(page, "内容范围")).toHaveValue("realtime");
        await page.getByRole("heading", { name: "阅读洞察", exact: true }).tap();
        await expect(filterSummary).toHaveAttribute("aria-expanded", "false");

        await filterSummary.tap();
        await page.getByRole("button", { name: "重置", exact: true }).tap();
        await expect(getInsightFilter(page, "内容范围")).toHaveValue("broad");
        await expect(getInsightFilter(page, "来源")).toHaveValue("all");
        await page.keyboard.press("Escape");
        await expect(page.locator(".insights-filter-active")).toContainText("实时内容");
        await expect(page.locator(".insights-filter-active")).toContainText("联合早报");

        await filterSummary.tap();
        await expect(getInsightFilter(page, "内容范围")).toHaveValue("realtime");
        await page.getByRole("button", { name: "重置", exact: true }).tap();
        await page.getByRole("button", { name: "应用筛选", exact: true }).tap();
        await expect(page.locator(".insights-filter-active")).toContainText("全部内容");
        await expect(page.locator(".insights-filter-active")).toContainText("全部来源");
    });
});

function createInsightsEnvelope(options: InsightsResponseOptions = {}) {
    const now = Date.now();
    const headlines = options.headlines ?? [firstHeadline];
    return {
        data: {
            generatedAt: now,
            sourceCount: 2,
            itemCount: options.itemCount ?? (headlines.length ? headlines.length : 0),
            hotRankings: headlines.map((title, index) => ({
                id: `fixture-${index + 1}`,
                rank: index + 1,
                title,
                url: `https://example.test/insights/${index + 1}`,
                sourceId: index % 2 === 0 ? "hackernews" : "weibo",
                sourceName: index % 2 === 0 ? "Hacker News" : "微博",
                score: 90 - index,
                sources: [index % 2 === 0 ? "hackernews" : "weibo"],
                sourceNames: [index % 2 === 0 ? "Hacker News" : "微博"],
                itemCount: 1,
                keywords: ["fixture"],
                signals: {
                    sourceCoverage: 1,
                    duplicateCount: 0,
                    recencyScore: 1,
                    sourceWeight: 1,
                    categoryWeight: 1,
                    readPenalty: 0,
                    categoryDistribution: [],
                    rankingReason: "Static test fixture.",
                },
            })),
            topicEvents: [],
            wordCloud: [],
            sourceActivity: options.sourceActivity ?? [
                { sourceId: "hackernews", sourceName: "Hacker News", itemCount: 1 },
            ],
            categoryShares: [],
            updateFrequency: [{ startAt: now - 3_600_000, endAt: now, itemCount: 1, sourceCount: 1 }],
            keywordTrends: [],
        },
        meta: {
            generatedAt: now,
            requestedSourceCount: 2,
            resolvedSourceCount: 2,
            partial: options.partial ?? false,
            omittedSourceIds: [],
        },
        errors: [],
    };
}

function getInsightFilter(page: Page, label: string) {
    return page.locator(".insights-filter-bar label").filter({ hasText: label }).locator("select");
}

async function installInsightsMocks(page: Page, options: MockOptions = {}) {
    const insightsRequests: InsightsPayload[] = [];
    let markFirstRequestStarted!: () => void;
    let releaseFirstRequest!: () => void;
    let heldFirstRequest = false;
    const firstInsightsRequestStarted = new Promise<void>((resolve) => {
        markFirstRequestStarted = resolve;
    });
    const firstResponseGate = new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
    });

    await page.route("**/api/**", async (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname.endsWith("/api/me")) {
            await route.fulfill({ json: { status: "unauthenticated" } });
            return;
        }
        if (pathname.endsWith("/s/insights")) {
            const payload = route.request().postDataJSON() as InsightsPayload;
            const requestIndex = insightsRequests.push(payload) - 1;
            if (options.holdFirstInsightsRequest && requestIndex === 0) {
                heldFirstRequest = true;
                markFirstRequestStarted();
                await firstResponseGate;
            }
            const result =
                (await options.respondToInsights?.(payload, requestIndex)) ??
                ({ body: createInsightsEnvelope() } satisfies { body: unknown });
            await route.fulfill({
                status: result.status ?? 200,
                contentType: "application/json",
                body: JSON.stringify(result.body),
            });
            return;
        }
        if (pathname.endsWith("/s/health")) {
            await route.fulfill({
                json: {
                    updatedAt: Date.now(),
                    total: 0,
                    healthy: 0,
                    failing: 0,
                    idle: 0,
                    cacheDegraded: 0,
                    sources: [],
                },
            });
            return;
        }
        if (pathname.endsWith("/v1/sources")) {
            const sources = [
                { id: "weibo", name: "微博", type: "hottest", column: "china" },
                { id: "hackernews", name: "Hacker News", type: "hottest", column: "tech" },
                { id: "zaobao", name: "联合早报", type: "realtime", column: "world" },
                { id: "v2ex-share", name: "V2EX", type: "normal", column: "tech" },
            ].map((source) => ({
                ...source,
                interval: 600_000,
                color: "slate",
                disabled: false,
            }));
            await route.fulfill({
                json: {
                    data: { sources, columns: [] },
                    meta: {
                        generatedAt: Date.now(),
                        sourceCount: sources.length,
                        redirectCount: 0,
                        disabledCount: 0,
                        columnCount: 0,
                    },
                },
            });
            return;
        }

        // Keep auth and every unrelated API request local to this fixture.
        await route.fulfill({ json: { data: [], errors: [] } });
    });

    return {
        insightsRequests,
        firstInsightsRequestStarted,
        releaseFirstInsightsRequest: () => {
            if (heldFirstRequest) releaseFirstRequest();
        },
    };
}
