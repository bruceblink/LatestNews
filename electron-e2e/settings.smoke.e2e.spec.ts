import type { Page, ElectronApplication } from "@playwright/test";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, mkdtemp, readFile } from "node:fs/promises";
import { test, expect, _electron } from "@playwright/test";

import { builtinCrawlerPlugins } from "../crawler-platform/builtin-plugins";

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), "latestnews-playwright-electron-"));
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
    delete env.LATESTNEWS_CRAWLER_PLUGIN_DIR;
    electronApp = await _electron.launch({
        args: [
            "--no-sandbox",
            `--user-data-dir=${userDataDirectory}`,
            ...(process.env.LATESTNEWS_ELECTRON_PACKAGED_TEST === "1" ? [] : ["."]),
        ],
        env,
        executablePath: process.env.LATESTNEWS_ELECTRON_EXECUTABLE,
        timeout: 60_000,
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState("load");
});

test("keeps the native menu bar removed after pressing Alt", async () => {
    const before = await electronApp.evaluate(({ Menu, BrowserWindow }) => ({
        hasApplicationMenu: Menu.getApplicationMenu() !== null,
        windows: BrowserWindow.getAllWindows().map((window) => ({
            menuVisible: window.isMenuBarVisible(),
            autoHide: window.isMenuBarAutoHide(),
        })),
    }));
    expect(before.hasApplicationMenu).toBe(false);
    expect(before.windows.length).toBeGreaterThan(0);
    expect(before.windows.every((window) => !window.menuVisible && window.autoHide)).toBe(true);
    await page.keyboard.press("Alt");
    const after = await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.isMenuBarVisible())
    );
    expect(after.every((visible) => !visible)).toBe(true);
});

test("installs and discovers all bundled sources in a fresh desktop profile", async () => {
    const [sourceIds, metadata, health] = await page.evaluate(async () =>
        Promise.all([
            window.latestNewsDesktop?.listCrawlerSources?.(),
            window.latestNewsDesktop?.listCrawlerSourceMetadata?.(),
            window.latestNewsDesktop?.getCrawlerSourceHealthSummary?.(),
        ])
    );
    expect(sourceIds?.sort()).toEqual(["freebuf", "hackernews", "juejin", "pcbeta-windows11"]);
    expect(metadata).toBeInstanceOf(Array);
    expect(health).toMatchObject({ total: 4, healthy: 0, failing: 0, idle: 4 });
    expect(health?.sources.every((source) => source.status === "idle")).toBe(true);
    const pluginRoot = join(userDataDirectory, "crawler-plugins");
    const settings = JSON.parse(await readFile(join(pluginRoot, "enabled.json"), "utf8"));
    expect(settings.enabledPluginIds.sort()).toEqual(builtinCrawlerPlugins.map((plugin) => plugin.id).sort());
    for (const plugin of builtinCrawlerPlugins) {
        const active = JSON.parse(await readFile(join(pluginRoot, "packages", plugin.id, "active.json"), "utf8"));
        expect(active.activeVersion).toBeTruthy();
    }
});

test.afterAll(async () => {
    try {
        await electronApp?.close();
    } finally {
        if (userDataDirectory) {
            await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
        }
    }
});

test("opens the shared settings route in the Electron renderer", async () => {
    await page.goto("app://bundle/settings");

    await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
    await expect(page.getByLabel("数据源 API URL")).toHaveValue(/^https?:\/\//);
    await expect(page.getByLabel("采集模式")).toHaveValue("auto");
    await expect(page.getByLabel("关闭窗口后保留托盘并刷新本地来源")).not.toBeChecked();

    const settings = await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.());
    expect(settings?.url).toMatch(/^https?:\/\//);
    expect(settings?.defaultUrl).toMatch(/^https?:\/\//);
});

test("shows desktop update instructions without a PWA install action", async () => {
    const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    await page.goto("app://bundle/settings");
    await page.getByRole("button", { name: "打开菜单", exact: true }).click();
    await page.getByRole("button", { name: "安装与下载", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "安装与下载" });
    await expect(guide).toContainText(`当前为桌面版 v${version}。`);
    await expect(guide.getByRole("heading", { name: "更新桌面客户端" })).toBeVisible();
    await expect(guide.getByRole("link", { name: "查看已发布版本" })).toHaveAttribute(
        "href",
        "https://github.com/bruceblink/latestnews/releases/latest"
    );
    await expect(guide.getByRole("button", { name: "安装浏览器应用", exact: true })).toHaveCount(0);
    await guide.getByRole("tab", { name: "浏览器应用", exact: true }).click();
    await expect(guide.getByRole("link", { name: "https://news.likanug.top" })).toBeVisible();
    await expect(guide.getByLabel("浏览器环境")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(guide).not.toBeVisible();
});

test("saves and resets the desktop API URL through the settings panel", async () => {
    await page.goto("app://bundle/settings");

    const input = page.getByLabel("数据源 API URL");
    const defaultUrl = (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.defaultUrl;
    expect(defaultUrl).toMatch(/^https?:\/\//);
    await input.fill("https://news.example.test");
    await page.getByRole("button", { name: "保存并刷新" }).click();

    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toBe("https://news.example.test");
    await expect(input).toHaveValue("https://news.example.test");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "恢复默认" }).click();

    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toBe(defaultUrl);
});

test("switches remote and local modes and restores auto mode", async () => {
    await page.goto("app://bundle/settings");

    const mode = page.getByLabel("采集模式");
    const defaultUrl = (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.defaultUrl;
    expect(defaultUrl).toMatch(/^https?:\/\//);
    await mode.selectOption("remote");
    await page.getByRole("button", { name: "保存并刷新" }).click();
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.mode)
        .toBe("remote");
    await expect
        .poll(async () => JSON.parse(await readFile(join(userDataDirectory, "news-api-config.json"), "utf8")))
        .toMatchObject({ url: defaultUrl, mode: "remote" });

    await mode.selectOption("local");
    await page.getByRole("button", { name: "保存并刷新" }).click();
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.mode)
        .toBe("local");
    await expect
        .poll(async () => JSON.parse(await readFile(join(userDataDirectory, "news-api-config.json"), "utf8")))
        .toMatchObject({ url: defaultUrl, mode: "local" });

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "恢复默认" }).click();
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.mode)
        .toBe("auto");

    await page.getByLabel("数据源 API URL").fill("");
    await mode.selectOption("remote");
    await page.getByRole("button", { name: "保存并刷新" }).click();
    await expect(page.getByText("远端模式需要配置数据源 API 地址。", { exact: true })).toBeVisible();
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.mode)
        .toBe("auto");
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toBe(defaultUrl);
});

test("saves an empty desktop API URL as local-only mode", async () => {
    await page.goto("app://bundle/settings");

    const input = page.getByLabel("数据源 API URL");
    await input.fill("");
    await page.getByLabel("采集模式").selectOption("local");
    await page.getByRole("button", { name: "保存并刷新" }).click();

    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toBe("");
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.mode)
        .toBe("local");
    await expect(input).toHaveValue("");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "恢复默认" }).click();

    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toMatch(/^https?:\/\//);
});
