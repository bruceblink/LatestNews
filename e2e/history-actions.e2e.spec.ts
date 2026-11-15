import { test, expect, type Page } from "@playwright/test";

type HistoryFixtureItem = {
    newsId: string;
    title: string;
    url: string;
    sourceId: string;
    sourceName: string;
    readAt: number;
};

type ReadingStateFixtureItem = {
    newsId: string;
    title: string;
    url: string;
    sourceId: string;
    sourceName: string;
    updatedAt: number;
};

const keyboardHistoryItem: HistoryFixtureItem = {
    newsId: "keyboard-history",
    title: "键盘可删除的已读条目",
    url: "https://example.test/history/keyboard",
    sourceId: "hackernews",
    sourceName: "Hacker News",
    readAt: Date.now(),
};

const otherHistoryItem: HistoryFixtureItem = {
    newsId: "other-history",
    title: "另一来源保留的已读条目",
    url: "https://example.test/history/other",
    sourceId: "v2ex-share",
    sourceName: "V2EX",
    readAt: Date.now() - 60_000,
};

const laterItem: ReadingStateFixtureItem = {
    newsId: "later-item",
    title: "触屏删除的稍后读条目",
    url: "https://example.test/reading/later",
    sourceId: "hackernews",
    sourceName: "Hacker News",
    updatedAt: Date.now(),
};

const favoriteItem: ReadingStateFixtureItem = {
    newsId: "favorite-item",
    title: "触屏删除的收藏条目",
    url: "https://example.test/reading/favorite",
    sourceId: "v2ex-share",
    sourceName: "V2EX",
    updatedAt: Date.now(),
};

const hiddenItem: ReadingStateFixtureItem = {
    newsId: "hidden-item",
    title: "触屏删除的隐藏条目",
    url: "https://example.test/reading/hidden",
    sourceId: "hackernews",
    sourceName: "Hacker News",
    updatedAt: Date.now(),
};

const initialReadingState = {
    later: [laterItem],
    favorites: [favoriteItem],
    hidden: [hiddenItem],
};

const sourceMetadata = [
    {
        id: "hackernews",
        name: "Hacker News",
        interval: 600_000,
        color: "orange",
        type: "hottest",
        disabled: false,
        column: "tech",
    },
    {
        id: "v2ex-share",
        name: "V2EX",
        interval: 600_000,
        color: "slate",
        type: "normal",
        disabled: false,
        column: "tech",
    },
];

test("removes the final history item for a selected source with keyboard and clears the stale filter", async ({
    page,
}) => {
    await seedReadingState(page, [keyboardHistoryItem, otherHistoryItem], initialReadingState);
    await installHistoryMocks(page);
    await page.goto("/history");

    await expect(page.getByRole("heading", { name: "阅读历史", level: 1 })).toBeVisible();
    const sourceFilter = page.getByRole("combobox", { name: "按来源筛选阅读历史" });
    await sourceFilter.selectOption("hackernews");
    await expect(sourceFilter).toHaveValue("hackernews");

    const row = page.locator(".history-item").filter({ hasText: keyboardHistoryItem.title });
    const removeButton = row.getByRole("button", {
        name: `移除阅读记录：${keyboardHistoryItem.title}`,
        exact: true,
    });
    await expect(removeButton).toBeVisible();
    await expect(removeButton).toHaveAccessibleName(`移除阅读记录：${keyboardHistoryItem.title}`);
    await expectAlwaysVisibleWithoutHover(removeButton);

    await row.getByRole("link", { name: keyboardHistoryItem.title, exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(removeButton).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(row).toHaveCount(0);
    await expect(sourceFilter).toHaveValue("");
    await expect(page.getByText(otherHistoryItem.title, { exact: true })).toBeVisible();
    await expect(sourceFilter.locator('option[value="hackernews"]')).toHaveCount(0);

    await expect
        .poll(() => readPersistedState(page))
        .toEqual({ history: [otherHistoryItem], readingState: initialReadingState });
});

test("confirms clearing one source without changing other history or saved reading lists", async ({ page }) => {
    await seedReadingState(page, [keyboardHistoryItem, otherHistoryItem], initialReadingState);
    await installHistoryMocks(page);
    await page.goto("/history");

    const sourceFilter = page.getByRole("combobox", { name: "按来源筛选阅读历史" });
    await sourceFilter.selectOption("hackernews");
    const clearSource = page.getByRole("button", { name: "清空来源", exact: true });
    page.once("dialog", (dialog) => dialog.dismiss());
    await clearSource.click();
    await expect(sourceFilter).toHaveValue("hackernews");
    await expect
        .poll(() => readPersistedState(page))
        .toEqual({ history: [keyboardHistoryItem, otherHistoryItem], readingState: initialReadingState });

    page.once("dialog", (dialog) => dialog.accept());
    await clearSource.click();
    await expect(sourceFilter).toHaveValue("");
    await expect(page.getByText(keyboardHistoryItem.title, { exact: true })).toHaveCount(0);
    await expect(page.getByText(otherHistoryItem.title, { exact: true })).toBeVisible();
    await expect
        .poll(() => readPersistedState(page))
        .toEqual({ history: [otherHistoryItem], readingState: initialReadingState });

    await page.reload();
    await expect(page.getByText(otherHistoryItem.title, { exact: true })).toBeVisible();
    await expect(page.getByText(keyboardHistoryItem.title, { exact: true })).toHaveCount(0);
    await expect
        .poll(() => readPersistedState(page))
        .toEqual({ history: [otherHistoryItem], readingState: initialReadingState });
});

test.describe("touch history actions", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("keeps all four remove actions visible, tappable, and scoped to their own storage lists", async ({ page }) => {
        await seedReadingState(page, [keyboardHistoryItem], initialReadingState);
        await installHistoryMocks(page);
        await page.goto("/history");

        await expect(page.getByRole("heading", { name: "阅读历史", level: 1 })).toBeVisible();
        const historyRow = page.locator(".history-item").filter({ hasText: keyboardHistoryItem.title });
        const historyRemove = historyRow.getByRole("button", {
            name: `移除阅读记录：${keyboardHistoryItem.title}`,
            exact: true,
        });
        await expectAlwaysVisibleWithoutHover(historyRemove);
        await historyRemove.tap();
        await expect(historyRow).toHaveCount(0);
        await expect.poll(() => readPersistedState(page)).toEqual({ history: [], readingState: initialReadingState });

        await page.reload();
        await expect(page.getByRole("heading", { name: "阅读历史", level: 1 })).toBeVisible();
        const tabs = page.getByRole("group", { name: "阅读状态" });

        await tabs.getByRole("button", { name: "稍后读 1", exact: true }).tap();
        const laterRow = page.locator(".history-item").filter({ hasText: laterItem.title });
        const laterRemove = laterRow.getByRole("button", {
            name: `移除此条记录：${laterItem.title}`,
            exact: true,
        });
        await expectAlwaysVisibleWithoutHover(laterRemove);
        await laterRemove.tap();
        await expect(laterRow).toHaveCount(0);
        await expect
            .poll(() => readPersistedState(page))
            .toEqual({ history: [], readingState: { ...initialReadingState, later: [] } });

        await tabs.getByRole("button", { name: "收藏 1", exact: true }).tap();
        const favoriteRow = page.locator(".history-item").filter({ hasText: favoriteItem.title });
        const favoriteRemove = favoriteRow.getByRole("button", {
            name: `移除此条记录：${favoriteItem.title}`,
            exact: true,
        });
        await expectAlwaysVisibleWithoutHover(favoriteRemove);
        await favoriteRemove.tap();
        await expect(favoriteRow).toHaveCount(0);
        await expect
            .poll(() => readPersistedState(page))
            .toEqual({ history: [], readingState: { ...initialReadingState, later: [], favorites: [] } });

        await tabs.getByRole("button", { name: "隐藏 1", exact: true }).tap();
        const hiddenRow = page.locator(".history-item").filter({ hasText: hiddenItem.title });
        const hiddenRemove = hiddenRow.getByRole("button", {
            name: `取消隐藏：${hiddenItem.title}`,
            exact: true,
        });
        await expectAlwaysVisibleWithoutHover(hiddenRemove);
        await hiddenRemove.tap();
        await expect(hiddenRow).toHaveCount(0);
        await expect
            .poll(() => readPersistedState(page))
            .toEqual({ history: [], readingState: { later: [], favorites: [], hidden: [] } });

        await page.reload();
        await expect(page.getByRole("heading", { name: "阅读历史", level: 1 })).toBeVisible();
        await expect(page.locator(".history-item")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "还没有阅读记录" })).toBeVisible();

        await tabs.getByRole("button", { name: "稍后读 0", exact: true }).tap();
        await expect(page.locator(".history-item")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "还没有稍后读内容" })).toBeVisible();

        await tabs.getByRole("button", { name: "收藏 0", exact: true }).tap();
        await expect(page.locator(".history-item")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "还没有收藏内容" })).toBeVisible();

        await tabs.getByRole("button", { name: "隐藏 0", exact: true }).tap();
        await expect(page.locator(".history-item")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "没有隐藏内容" })).toBeVisible();

        await expect
            .poll(() => readPersistedState(page))
            .toEqual({ history: [], readingState: { later: [], favorites: [], hidden: [] } });
    });
});

async function expectAlwaysVisibleWithoutHover(button: ReturnType<Page["getByRole"]>) {
    await expect(button).toBeVisible();
    await expect.poll(() => button.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
}

async function seedReadingState(
    page: Page,
    history: HistoryFixtureItem[],
    readingState: {
        later: ReadingStateFixtureItem[];
        favorites: ReadingStateFixtureItem[];
        hidden: ReadingStateFixtureItem[];
    }
) {
    await page.addInitScript(
        ({ initialHistory, initialState }) => {
            if (localStorage.getItem("latestnews-history-test-seeded")) return;
            localStorage.setItem("reading-history", JSON.stringify(initialHistory));
            localStorage.setItem("reading-state", JSON.stringify(initialState));
            localStorage.setItem("latestnews-history-test-seeded", "true");
        },
        { initialHistory: history, initialState: readingState }
    );
}

async function readPersistedState(page: Page) {
    return page.evaluate(() => ({
        history: JSON.parse(localStorage.getItem("reading-history") ?? "[]"),
        readingState: JSON.parse(localStorage.getItem("reading-state") ?? '{"later":[],"favorites":[],"hidden":[]}'),
    }));
}

async function installHistoryMocks(page: Page) {
    await page.route("**/api/**", async (route) => {
        const { pathname } = new URL(route.request().url());

        if (pathname.endsWith("/api/me")) {
            await route.fulfill({ json: { status: "unauthenticated" } });
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
            await route.fulfill({
                json: {
                    data: { sources: sourceMetadata, columns: [] },
                    meta: {
                        generatedAt: Date.now(),
                        sourceCount: sourceMetadata.length,
                        redirectCount: 0,
                        disabledCount: 0,
                        columnCount: 0,
                    },
                },
            });
            return;
        }

        if (pathname.includes("/auth/") && pathname.endsWith("/login")) {
            await route.fulfill({ status: 404, json: { message: "Authentication is disabled in this test." } });
            return;
        }

        await route.fulfill({ json: { data: [], errors: [] } });
    });
}
