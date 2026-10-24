import type { Page, ElectronApplication } from "@playwright/test";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, mkdtemp } from "node:fs/promises";
import { test, expect, _electron } from "@playwright/test";

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), "latestnews-playwright-electron-"));
    electronApp = await _electron.launch({
        args: ["--no-sandbox", `--user-data-dir=${userDataDirectory}`, "."],
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
        executablePath: process.env.LATESTNEWS_ELECTRON_EXECUTABLE,
        timeout: 60_000,
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState("load");
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
