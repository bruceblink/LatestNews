import { devices, defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
    testDir: "./e2e",
    testMatch: /\.e2e\.spec\.ts$/,
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    workers: isCI ? 1 : undefined,
    reporter: isCI ? "line" : "list",
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "./test-results/web",
    use: {
        baseURL,
        trace: "on-first-retry",
        testIdAttribute: "data-test-id",
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "pnpm exec cross-env LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm dev --host 127.0.0.1 --port 5173",
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
    },
});
