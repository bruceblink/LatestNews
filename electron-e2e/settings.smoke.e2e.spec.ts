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
    const sourceIds = await page.evaluate(() => window.latestNewsDesktop?.listCrawlerSources?.());
    expect(sourceIds?.sort()).toEqual(["freebuf", "hackernews", "juejin", "pcbeta-windows11"]);
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

    const settings = await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.());
    expect(settings?.url).toMatch(/^https?:\/\//);
    expect(settings?.defaultUrl).toMatch(/^https?:\/\//);
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

test("saves an empty desktop API URL as local-only mode", async () => {
    await page.goto("app://bundle/settings");

    const input = page.getByLabel("数据源 API URL");
    await input.fill("");
    await page.getByRole("button", { name: "保存并刷新" }).click();

    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toBe("");
    await expect(input).toHaveValue("");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "恢复默认" }).click();

    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toMatch(/^https?:\/\//);
});
