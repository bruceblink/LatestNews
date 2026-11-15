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
            adapterKind: "plugin",
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
        if (pathname.endsWith("/s/insights")) {
            const now = Date.now();
            await route.fulfill({
                json: {
                    data: {
                        generatedAt: now,
                        sourceCount: 1,
                        itemCount: 1,
                        hotRankings: [
                            {
                                id: "workspace-1",
                                rank: 1,
                                title: "开源工具更新与开发者社区动态",
                                url: "https://example.test/workspace-1",
                                sourceId: "hackernews",
                                score: 100,
                                sources: ["hackernews"],
                                sourceNames: ["Hacker News"],
                                keywords: ["开源"],
                            },
                        ],
                        topicEvents: [],
                        keywordTrends: [],
                        categoryShares: [],
                        sourceActivity: [{ sourceId: "hackernews", itemCount: 1 }],
                        updateFrequency: [{ startAt: now - 3_600_000, endAt: now, itemCount: 1, sourceCount: 1 }],
                    },
                    meta: {
                        generatedAt: now,
                        requestedSourceCount: 1,
                        resolvedSourceCount: 1,
                        partial: false,
                        omittedSourceIds: [],
                    },
                    errors: [],
                },
            });
            return;
        }
        if (pathname.endsWith("/s/health") || pathname.endsWith("/v1/health/sources")) {
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

test("renders the shared web shell and opens the settings page from the tools menu", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/feed");

    await expect(page).toHaveTitle(/LatestNews/i);
    await expect(page.locator(".app-modern-header")).toHaveCount(0);
    await expect(page.locator(".app-modern-sidebar")).toBeVisible();
    await expect(page.locator(".app-modern-sidebar .app-modern-sidebar-search")).toBeVisible();
    const sidebar = page.getByRole("complementary", { name: "主要导航" });
    await expect(sidebar.getByRole("link", { name: "设置" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "GitHub 仓库" })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: /切换到.*主题/ })).toHaveCount(0);
    const menu = page.getByRole("button", { name: "打开菜单", exact: true });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "打开 GitHub 仓库", exact: true })).toHaveCount(0);
    const settingsLink = page.getByRole("link", { name: "设置", exact: true });
    await expect(settingsLink).toBeVisible();
    await settingsLink.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
});

test("opens the reading insights workspace as the application home", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");

    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.getByRole("heading", { name: /阅读洞察 Reading Insights/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "阅读洞察", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "洞察", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "阅读历史", exact: true })).toBeVisible();
});

test("keeps navigation labels aligned with their destination pages", async ({ page }) => {
    await installApiMocks(page);

    const destinations = [
        { path: "/feed", label: "统一 Feed", heading: "统一 Feed" },
        { path: "/history", label: "阅读历史", heading: "阅读历史" },
        { path: "/health", label: "数据源健康", heading: "数据源健康" },
    ] as const;

    for (const destination of destinations) {
        await page.goto(destination.path);
        const navigation = page.getByRole("complementary", { name: "主要导航" });
        await expect(navigation.getByRole("link", { name: destination.label, exact: true })).toHaveAttribute(
            "aria-current",
            "page"
        );
        await expect(page.getByRole("heading", { name: destination.heading, level: 1 })).toBeVisible();
    }
});

test("keeps the source search dialog centered in the viewport", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/c/focus");
    await page.getByRole("button", { name: "发现来源", exact: true }).click();

    const dialog = page.locator("[cmdk-dialog]");
    await expect(dialog).toBeVisible();
    const layout = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            position: style.position,
            top: rect.top,
            bottom: rect.bottom,
            viewportHeight: innerHeight,
            centerOffset: Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2),
        };
    });

    expect(layout.position).toBe("fixed");
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.centerOffset).toBeLessThanOrEqual(2);
});

test("loads the settings route directly", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
    await expect(page.getByText("Web 和桌面端使用同一套配置面板")).toBeVisible();
});

test("filters source health by adapter kind", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/health");

    await expect(page.getByRole("heading", { name: "数据源健康", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "插件来源", exact: true }).click();
    await expect(page.getByText("显示 1 / 1 个", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hacker News", exact: true })).toBeVisible();
});

test("shows an actionable empty state for a new reading history", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/history");

    await expect(page.getByRole("heading", { name: "还没有阅读记录" })).toBeVisible();
    await expect(page.getByRole("link", { name: "浏览热门资讯" })).toHaveAttribute("href", "/c/hottest");
});

test("keeps mobile feed filters compact without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installApiMocks(page);
    await page.goto("/feed");

    const layout = await page.locator(".feed-filters").evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
    }));

    expect(layout.columns).toBe(2);
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
});

test("scrolls a selected mobile navigation link into view", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installApiMocks(page);
    await page.goto("/");
    await page
        .getByRole("complementary", { name: "主要导航" })
        .getByRole("link", { name: "阅读历史", exact: true })
        .click();

    await expect(page).toHaveURL(/\/history$/);
    await expect(
        page.getByRole("complementary", { name: "主要导航" }).getByRole("link", { name: "阅读历史", exact: true })
    ).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

const workspaceRoutes = [
    { path: "/insights", heading: /阅读洞察 Reading Insights/, navigation: "首页" },
    { path: "/feed", heading: "统一 Feed", navigation: "统一 Feed" },
    { path: "/history", heading: "阅读历史", navigation: "阅读历史" },
    { path: "/health", heading: "数据源健康", navigation: "数据源健康" },
    { path: "/source/hackernews", heading: "Hacker News", navigation: "数据源健康" },
    { path: "/c/focus", heading: "我的关注", navigation: "统一 Feed" },
    { path: "/settings", heading: "设置" },
] as const;

for (const scenario of [
    {
        label: "saved light",
        storageValue: JSON.stringify("light"),
        system: "dark",
        expectedDark: false,
        expectedScheme: "light",
    },
    {
        label: "saved dark",
        storageValue: JSON.stringify("dark"),
        system: "light",
        expectedDark: true,
        expectedScheme: "dark",
    },
    {
        label: "auto with dark system",
        storageValue: JSON.stringify("auto"),
        system: "dark",
        expectedDark: true,
        expectedScheme: "auto",
    },
    {
        label: "auto with light system",
        storageValue: JSON.stringify("auto"),
        system: "light",
        expectedDark: false,
        expectedScheme: "auto",
    },
    {
        label: "malformed stored value",
        storageValue: "{",
        system: "dark",
        expectedDark: false,
        expectedScheme: "light",
    },
    {
        label: "unknown stored value",
        storageValue: JSON.stringify("sepia"),
        system: "dark",
        expectedDark: false,
        expectedScheme: "light",
    },
    {
        label: "null stored value",
        storageValue: JSON.stringify(null),
        system: "dark",
        expectedDark: false,
        expectedScheme: "light",
    },
] as const) {
    test(`applies ${scenario.label} theme before the app mounts`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scenario.system });
        await page.addInitScript((storageValue) => {
            localStorage.setItem("color-scheme", storageValue);
            const themeToggles: boolean[] = [];
            Object.defineProperty(window, "__latestNewsThemeToggles", { value: themeToggles });

            const originalToggle = DOMTokenList.prototype.toggle;
            DOMTokenList.prototype.toggle = function toggle(token, force) {
                const result =
                    force === undefined ? originalToggle.call(this, token) : originalToggle.call(this, token, force);
                if (this === document.documentElement.classList && token === "dark") {
                    themeToggles.push(result);
                }
                return result;
            };
        }, scenario.storageValue);
        await installApiMocks(page);

        let releaseCatalog!: () => void;
        let markCatalogStarted!: () => void;
        const catalogGate = new Promise<void>((resolve) => {
            releaseCatalog = resolve;
        });
        const catalogStarted = new Promise<void>((resolve) => {
            markCatalogStarted = resolve;
        });
        await page.route("**/api/v1/sources", async (route) => {
            markCatalogStarted();
            await catalogGate;
            await route.fallback();
        });

        await page.goto("/settings", { waitUntil: "commit" });
        await catalogStarted;

        try {
            expect(await page.locator("#app").locator("> *").count()).toBe(0);
            expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(
                scenario.expectedDark
            );
            const initialBackground = await page.locator("body").evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    background: style.backgroundColor,
                    pageBackground: style.getPropertyValue("--page-bg").trim(),
                };
            });
            expect(initialBackground.background).not.toBe("rgba(0, 0, 0, 0)");
            expect(initialBackground.background).not.toBe("transparent");
            expect(initialBackground.background).toBe(scenario.expectedDark ? "rgb(16, 23, 34)" : "rgb(247, 249, 251)");
            expect(initialBackground.pageBackground).toBe(scenario.expectedDark ? "#101722" : "#f7f9fb");
            expect(
                await page.evaluate(
                    () =>
                        (
                            window as Window & {
                                __latestNewsThemeToggles: boolean[];
                            }
                        ).__latestNewsThemeToggles
                )
            ).toEqual([scenario.expectedDark]);
        } finally {
            releaseCatalog();
        }

        await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
        const schemeLabel = {
            light: "浅色",
            dark: "深色",
            auto: "跟随系统",
        }[scenario.expectedScheme];
        await expect(page.getByRole("button", { name: schemeLabel, exact: true })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
        expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(
            scenario.expectedDark
        );
        expect(
            await page.evaluate(
                () => (window as Window & { __latestNewsThemeToggles: boolean[] }).__latestNewsThemeToggles
            )
        ).toEqual([scenario.expectedDark, scenario.expectedDark]);
    });
}

test("applies the saved theme immediately and keeps it across all workspace routes", async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await installApiMocks(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    for (const route of workspaceRoutes) {
        await page.goto(route.path);
        await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.locator("html")).toHaveClass(/dark/);
        await expect(page.locator("vite-error-overlay")).toHaveCount(0);
        const sidebar = page.getByRole("complementary", { name: "主要导航" });
        await expect(sidebar).toBeVisible();
        if ("navigation" in route) {
            await expect(sidebar.getByRole("link", { name: route.navigation, exact: true })).toHaveAttribute(
                "aria-current",
                "page"
            );
        }
        const colors = await page.locator(".app-modern-column").evaluate((element) => ({
            background: getComputedStyle(element).backgroundColor,
            expected: getComputedStyle(document.documentElement).getPropertyValue("--page-bg").trim(),
        }));
        expect(colors.background).toBe("rgb(16, 23, 34)");
        expect(colors.expected).toBe("#101722");
    }

    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: "跟随系统", exact: true }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(errors).toEqual([]);
});

test("opens settings and returns home by keyboard using the same workspace menu", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/insights");
    const sidebar = page.getByRole("complementary", { name: "主要导航" });
    for (const name of ["首页", "统一 Feed", "阅读历史", "数据源健康"]) {
        const icon = sidebar.getByRole("link", { name, exact: true }).locator("span").first();
        expect(await icon.evaluate((element) => getComputedStyle(element).maskImage)).not.toBe("none");
    }
    await sidebar.getByRole("button", { name: "打开菜单", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "设置", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings$/);
    await sidebar.getByRole("link", { name: "首页", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.getByRole("heading", { name: /阅读洞察 Reading Insights/ })).toBeVisible();
});

test("keeps the workspace sidebar in natural keyboard tab order", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: /阅读洞察 Reading Insights/ })).toBeVisible();

    const expectedFocusOrder = [
        page.locator(".skip-link"),
        page.getByRole("link", { name: "LatestNews 首页" }),
        page.getByRole("button", { name: "打开搜索" }),
        page.getByRole("link", { name: "首页", exact: true }),
        page.getByRole("link", { name: "统一 Feed", exact: true }),
        page.getByRole("link", { name: "阅读历史", exact: true }),
        page.getByRole("link", { name: "数据源健康", exact: true }),
        page.getByRole("button", { name: "打开菜单", exact: true }),
    ];

    for (const locator of expectedFocusOrder) {
        await page.keyboard.press("Tab");
        await expect(locator).toBeFocused();
    }
});

for (const width of [320, 390, 768, 1024, 1440]) {
    test(`keeps all workspace pages within the ${width}px viewport`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await installApiMocks(page);
        for (const route of workspaceRoutes) {
            await page.goto(route.path);
            await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();
            const layout = await page.locator("main").evaluate((main) => {
                const rect = main.getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    contentWidth: main.scrollWidth,
                    availableWidth: main.clientWidth,
                    viewport: innerWidth,
                };
            });
            expect(layout.left, route.path).toBeGreaterThanOrEqual(0);
            expect(layout.right, route.path).toBeLessThanOrEqual(layout.viewport);
            expect(layout.contentWidth, route.path).toBeLessThanOrEqual(layout.availableWidth + 1);
        }
    });
}

async function openInstallationGuide(page: Page) {
    const menu = page.getByRole("button", { name: "打开菜单", exact: true });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "数据源健康", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "安装与下载", exact: true }).click();
    return page.getByRole("dialog", { name: "安装与下载" });
}

test("opens installation instructions by keyboard and restores focus when closed", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/feed");
    const guide = await openInstallationGuide(page);
    await expect(guide).toBeVisible();
    await expect(guide.getByRole("link", { name: "查看已发布版本" })).toHaveAttribute(
        "href",
        "https://github.com/bruceblink/latestnews/releases/latest"
    );
    await guide.getByLabel("操作系统").selectOption("macos");
    await expect(guide).toContainText("macOS-arm64.dmg / macOS-x64.dmg");
    await guide.getByLabel("操作系统").selectOption("linux");
    await expect(guide).toContainText("Linux-x86_64.AppImage");
    await guide.getByRole("tab", { name: "桌面客户端", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(guide.getByRole("tab", { name: "浏览器应用", exact: true })).toBeFocused();
    await expect(guide.getByRole("tabpanel", { name: "浏览器应用" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guide).not.toBeVisible();
    await expect(page.getByRole("button", { name: "打开菜单", exact: true })).toBeFocused();
});

test.describe("mobile installation", () => {
    test.use({ hasTouch: true });

    test("keeps installation steps readable in a narrow touch viewport", async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await installApiMocks(page);
        await page.goto("/feed");
        await page.getByRole("button", { name: "打开菜单", exact: true }).tap();
        await page.getByRole("button", { name: "安装与下载", exact: true }).tap();
        const guide = page.getByRole("dialog", { name: "安装与下载" });
        await guide.getByRole("tab", { name: "浏览器应用", exact: true }).tap();
        await guide.getByLabel("浏览器环境").selectOption("ios");
        await expect(guide).toContainText("添加到主屏幕");
        expect(await guide.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await guide.getByRole("button", { name: "关闭安装与下载" }).tap();
        await expect(guide).not.toBeVisible();
    });
});

for (const outcome of ["accepted", "dismissed", "error"] as const) {
    test(`handles the one-use browser installation request: ${outcome}`, async ({ page }) => {
        const errors: Error[] = [];
        page.on("pageerror", (error) => errors.push(error));
        await installApiMocks(page);
        await page.goto("/feed");
        const guide = await openInstallationGuide(page);
        await guide.getByRole("tab", { name: "浏览器应用", exact: true }).click();
        await page.evaluate((result) => {
            const event = new Event("beforeinstallprompt", { cancelable: true });
            Object.assign(event, {
                prompt: async () => {
                    if (result === "error") throw new Error("Installation prompt unavailable");
                },
                userChoice: Promise.resolve({ outcome: result, platform: "web" }),
            });
            window.dispatchEvent(event);
        }, outcome);
        await guide.getByRole("button", { name: "安装浏览器应用", exact: true }).click();
        const messages = {
            accepted: "已确认安装请求",
            dismissed: "已取消安装",
            error: "未能打开安装窗口",
        };
        await expect(guide).toContainText(messages[outcome]);
        await expect(guide.getByRole("button", { name: "安装浏览器应用", exact: true })).toHaveCount(0);
        expect(errors).toEqual([]);
        if (outcome === "accepted") {
            await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
            await expect(guide).toContainText("当前已在浏览器应用中运行，或已完成安装。");
            await expect(guide.getByLabel("浏览器环境")).toHaveCount(0);
        }
    });
}

test("recognizes an already running standalone browser app", async ({ page }) => {
    await page.addInitScript(() => {
        const matchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
            const result = matchMedia(query);
            if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", { value: true });
            return result;
        };
    });
    await installApiMocks(page);
    await page.goto("/feed");
    const guide = await openInstallationGuide(page);
    await guide.getByRole("tab", { name: "浏览器应用", exact: true }).click();
    await expect(guide).toContainText("当前已在浏览器应用中运行，或已完成安装。");
    await expect(guide.getByRole("button", { name: "安装浏览器应用", exact: true })).toHaveCount(0);
});
