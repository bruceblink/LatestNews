import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./electron-e2e",
    testMatch: /\.e2e\.spec\.ts$/,
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: "line",
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "./test-results/electron",
    timeout: 60_000,
    use: {
        testIdAttribute: "data-test-id",
        trace: "on-first-retry",
    },
    expect: {
        timeout: 15_000,
    },
});
