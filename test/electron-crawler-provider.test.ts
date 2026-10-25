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
        collect.mockResolvedValueOnce([item]).mockResolvedValueOnce([]).mockRejectedValue(new Error("offline"));
        const runtime = await createElectronCrawlerPluginRuntime({
            userDataPath,
            cachePath: join(root, "crawler-cache.json"),
            workerPath: join(root, "worker-entry.mjs"),
        });

        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({ status: "success", items: [item] });

        vi.setSystemTime(2_000);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({ status: "empty", items: [] });

        vi.setSystemTime(30_000);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({
            status: "degraded-cache",
            updatedTime: 1_000,
            items: [item],
        });

        vi.setSystemTime(121_001);
        await expect(runtime.fetchSource("juejin")).resolves.toMatchObject({
            status: "stale-cache",
            updatedTime: 1_000,
            items: [item],
        });
        runtime.dispose?.();
    });
});
