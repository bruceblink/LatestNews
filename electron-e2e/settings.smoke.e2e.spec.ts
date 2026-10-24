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
