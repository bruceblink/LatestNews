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
    await expect(page.getByRole("heading", { name: /阅读洞察 Reading Insights/ })).toBeVisible();

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
    await expect(page.getByRole("heading", { name: /阅读洞察 Reading Insights/ })).toBeVisible();

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
    await expect(page.getByRole("heading", { name: /阅读洞察 Reading Insights/ })).toBeVisible();
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

test("uses the first returned headline and neutral copy for empty results", async ({ page }) => {
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
    await expect(page.locator("#insights-brief-title")).toContainText(firstHeadline);
    await expect(page.locator("#insights-brief-title")).not.toContainText("科技政策与产业进展受广泛关注");

    await getInsightFilter(page, "来源").selectOption("weibo");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.sources).toEqual(["weibo"]);
    await expect(page.locator("#insights-brief-title")).toHaveText("当前范围暂无内容");
    await expect(page.getByRole("status")).toHaveText("暂无内容");
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
    await expect(page.getByRole("status")).toHaveText("更新中");
    await expect(page.getByRole("status")).not.toHaveText("数据已更新");

    mocks.releaseFirstInsightsRequest();
    await expect(page.getByRole("status")).toHaveText("部分数据");

    await getInsightFilter(page, "时间范围").selectOption("7d");
    await expect.poll(() => mocks.insightsRequests.at(-1)?.trendWindow).toBe("7d");
    await expect(page.getByRole("status")).toHaveText("数据已更新");
});

test("shows a retry after an insights request fails", async ({ page }) => {
    const mocks = await installInsightsMocks(page, {
        respondToInsights: (_payload, requestIndex) =>
            requestIndex === 0
                ? { status: 503, body: { message: "Fixture unavailable" } }
                : { body: createInsightsEnvelope() },
    });
    await page.goto("/insights");
    await expect(page.getByRole("alert")).toContainText("洞察加载失败");
    await expect(page.getByRole("status")).toHaveText("更新失败");

    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect.poll(() => mocks.insightsRequests.length).toBeGreaterThan(1);
    await expect(page.getByRole("status")).toHaveText("数据已更新");
});

test("keeps later-read and favorite actions usable and persisted at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installInsightsMocks(page);
    await page.goto("/insights");

    const hotRow = page.locator(".insights-hot-row").filter({ hasText: firstHeadline });
    await expect(hotRow).toBeVisible();
    const laterButton = hotRow.getByRole("button", { name: "稍后读", exact: true });
    const favoriteButton = hotRow.getByRole("button", { name: "收藏", exact: true });
    await expect(laterButton).toBeVisible();
    await expect(favoriteButton).toBeVisible();

    await laterButton.click();
    await expect(hotRow.getByRole("button", { name: "移出稍后读", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );
    await favoriteButton.click();
    await expect(hotRow.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    const reloadedRow = page.locator(".insights-hot-row").filter({ hasText: firstHeadline });
    await expect(reloadedRow.getByRole("button", { name: "移出稍后读", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );
    await expect(reloadedRow.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );
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
