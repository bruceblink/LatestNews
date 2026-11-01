import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { sep, extname, resolve } from "node:path";

test("keeps the current page until a waiting Web update is accepted", async ({ page }) => {
    test.skip(!process.env.LATESTNEWS_PWA_TEST_ROOT, "Requires a prepared production build.");
    const root = process.env.LATESTNEWS_PWA_TEST_ROOT ?? fileURLToPath(new URL("../dist/", import.meta.url));
    const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
    };
    let deployed = false;
    const server = createServer(async (request, response) => {
        const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        let file = resolve(root, `.${path}`);
        if (!file.startsWith(`${root.replace(/[\\/]$/, "")}${sep}`) || path.endsWith("/")) {
            file = resolve(root, "index.html");
        }
        try {
            let content = await readFile(file);
            if (path === "/swx.js" && deployed) {
                content = Buffer.concat([content, Buffer.from("\n// New deployment for update acceptance.\n")]);
            }
            response.writeHead(200, {
                "Content-Type": mime[extname(file)] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            });
            response.end(content);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise<void>((resolveReady, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveReady);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port.");

    try {
        await page.goto(`http://127.0.0.1:${address.port}/`);
        await page.evaluate(async () => navigator.serviceWorker.ready);
        if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
            await page.reload();
        }
        await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
        await page.getByRole("button", { name: "打开搜索" }).click();
        const input = page.getByPlaceholder("搜索你想要的");
        await input.fill("unsaved input");
        deployed = true;
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
        const notice = page.getByTestId("web-update-notice");
        await expect(notice).toContainText("新版本已准备就绪");
        await expect(input).toHaveValue("unsaved input");
        await page.waitForTimeout(6000);
        await expect(input).toHaveValue("unsaved input");
        await page.keyboard.press("Escape");
        await Promise.all([page.waitForNavigation(), notice.getByRole("button", { name: "立即更新" }).click()]);
        await expect(page.getByTestId("web-update-notice")).toHaveCount(0);
        await page.context().setOffline(true);
        await page.reload();
        await expect(page.getByRole("button", { name: "打开搜索" })).toBeVisible();
    } finally {
        await new Promise<void>((resolveClosed) => {
            server.close(() => resolveClosed());
            server.closeAllConnections();
        });
    }
});
