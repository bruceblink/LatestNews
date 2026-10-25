import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi, expect, describe, afterEach } from "vitest";
import { rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { createElectronCrawlerPluginRuntime } from "../electron/crawler-plugin-provider";

const { collect, seed } = vi.hoisted(() => ({ collect: vi.fn(), seed: vi.fn() }));
const temporaryDirectories: string[] = [];
const originalPluginDirectory = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR;

vi.mock("electron", () => ({ app: { getPath: () => "", isPackaged: false } }));
vi.mock("../electron/crawler-host", () => ({ createElectronCrawlerHost: vi.fn() }));
vi.mock("../electron/crawler-plugin-seeder", () => ({ seedBuiltinCrawlerPlugins: seed }));
vi.mock("../crawler-platform/host/plugin-provider", () => ({
    createCrawlerPluginProvider: () => ({
        listSourceIds: () => ["juejin"],
        listSources: () => [{ id: "juejin", name: "稀土掘金", interval: 60_000 }],
        collect,
        dispose: vi.fn(),
    }),
}));

afterEach(async () => {
    vi.useRealTimers();
    collect.mockReset();
    seed.mockReset();
    if (originalPluginDirectory === undefined) delete process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR;
    else process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR = originalPluginDirectory;
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

describe("desktop crawler provider cache fallback", () => {
    it("seeds default stores and keeps explicit external stores operator-managed", async () => {
        delete process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR;
        seed.mockResolvedValue({ available: true });
        const runtime = await createElectronCrawlerPluginRuntime({
            userDataPath: "profile",
            bundledPluginRoot: "bundles",
        });
        expect(seed).toHaveBeenCalledWith(join("profile", "crawler-plugins"), "bundles");
        runtime.dispose?.();

        seed.mockClear();
        process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR = "external-store";
        const external = await createElectronCrawlerPluginRuntime({ userDataPath: "profile" });
        expect(seed).not.toHaveBeenCalled();
        external.dispose?.();
    });

    it("keeps the runtime available after a bundled installation failure", async () => {
        delete process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR;
        seed.mockRejectedValue(new Error("Damaged shipped package"));
        const runtime = await createElectronCrawlerPluginRuntime({ userDataPath: "profile" });
        expect(runtime.listSourceIds()).toEqual(["juejin"]);
        runtime.dispose?.();
    });

    it("returns persisted items with degraded and stale statuses after collector failures", async () => {
        const root = await mkdtemp(join(tmpdir(), "latestnews-provider-"));
        temporaryDirectories.push(root);
        const userDataPath = join(root, "user-data");
        const pluginRoot = join(userDataPath, "crawler-plugins");
        await mkdir(pluginRoot, { recursive: true });
        await writeFile(join(pluginRoot, "enabled.json"), JSON.stringify({ enabledPluginIds: [] }), "utf8");
        delete process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR;

        const item = { id: "one", title: "Item one", url: "https://example.test/one" };
        collect
            .mockResolvedValueOnce([item])
            .mockResolvedValueOnce([])
            .mockRejectedValue(
                new Error("offline https://secret.example/path?token=do-not-leak authorization=Bearer secret-token")
            );
        const runtime = await createElectronCrawlerPluginRuntime({
            userDataPath,
            cachePath: join(root, "crawler-cache.json"),
            workerPath: join(root, "worker-entry.mjs"),
        });

        await expect(runtime.getHealthSummary()).resolves.toMatchObject({
            total: 1,
            idle: 1,
            sources: [expect.objectContaining({ id: "juejin", status: "idle", successCount: 0 })],
        });

        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({ status: "success", items: [item] });
        await expect(runtime.getHealthSummary()).resolves.toMatchObject({
            healthy: 1,
            sources: [expect.objectContaining({ id: "juejin", successCount: 1, lastItemCount: 1 })],
        });

        vi.setSystemTime(2_000);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({ status: "empty", items: [] });

        vi.setSystemTime(30_000);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({
            status: "degraded-cache",
            updatedTime: 1_000,
            items: [item],
        });
        const health = await runtime.getHealthSummary();
        expect(health).toMatchObject({ failing: 1, cacheDegraded: 1 });
        expect(health.sources[0]).toMatchObject({
            status: "failing",
            successCount: 2,
            errorCount: 1,
            consecutiveFailures: 1,
            cacheDegraded: true,
            lastSuccessAt: 2_000,
            lastItemCount: 0,
        });
        expect(health.sources[0].lastErrorMessage).not.toContain("https://");
        expect(health.sources[0].lastErrorMessage).not.toContain("do-not-leak");
        expect(health.sources[0].lastErrorMessage).not.toContain("secret-token");
        expect(health.sources[0].recentEvents).toHaveLength(3);

        vi.setSystemTime(121_001);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({
            status: "stale-cache",
            updatedTime: 1_000,
            items: [item],
        });
        runtime.dispose?.();
    });

    it("keeps only the most recent local health events", async () => {
        const root = await mkdtemp(join(tmpdir(), "latestnews-health-events-"));
        temporaryDirectories.push(root);
        const item = { id: "one", title: "Item one", url: "https://example.test/one" };
        collect.mockResolvedValue([item]);
        const runtime = await createElectronCrawlerPluginRuntime({
            userDataPath: join(root, "user-data"),
            cachePath: join(root, "crawler-cache.json"),
            workerPath: join(root, "worker-entry.mjs"),
        });

        for (let count = 0; count < 15; count += 1) await runtime.fetchSource("juejin");

        const summary = await runtime.getHealthSummary();
        expect(summary.sources[0].successCount).toBe(15);
        expect(summary.sources[0].recentEvents).toHaveLength(12);
        runtime.dispose?.();
    });
});
