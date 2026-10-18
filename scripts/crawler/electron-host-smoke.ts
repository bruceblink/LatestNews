import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { rm, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { pcbetaPlugin } from "../../crawler-platform/plugins/pcbeta/plugin";
import { createLegacyUrlHashId } from "../../crawler-platform/sdk/legacy-id";
import { bundleCrawlerPlugin } from "../../crawler-platform/testing/bundle-plugin";
import { createRestrictedWorkerEnvironment } from "../../crawler-platform/host/environment";
import { createServerCrawlerPluginRuntime } from "../../server/crawler-plugin-runtime.node.ts";

import type { CrawlerHttpRequest, CrawlerHttpResponse } from "../../crawler-platform/sdk/types";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(import.meta.url);
const electronExecutable = process.env.LATESTNEWS_ELECTRON_EXECUTABLE ?? require("electron");
const fixturePath = join(projectRoot, "crawler-platform", "plugins", "pcbeta", "fixture.xml");
const workerPath = join(projectRoot, "crawler-platform", "runtime", "worker-entry.mjs");
const feedUrl = "https://bbs.pcbeta.com/forum.php?mod=rss&fid=563&auth=0";
const itemUrl = "https://bbs.pcbeta.com/topic/1";

if (typeof electronExecutable !== "string") throw new Error("Could not resolve the Electron executable.");

const temporaryRoot = await mkdtemp(join(tmpdir(), "latestnews-electron-crawler-smoke-"));
const appDirectory = join(temporaryRoot, "app");
const userDataPath = join(temporaryRoot, "user-data");
const pluginRoot = join(userDataPath, "crawler-plugins");
const packagesDirectory = join(pluginRoot, "packages");
const pluginDirectory = join(packagesDirectory, pcbetaPlugin.manifest.id);
const resultPath = join(temporaryRoot, "result.json");
const responsePath = join(temporaryRoot, "response.json");
const mainPath = join(appDirectory, "main.cjs");

try {
    await Promise.all([
        mkdir(appDirectory, { recursive: true }),
        mkdir(pluginDirectory, { recursive: true }),
        mkdir(pluginRoot, { recursive: true }),
    ]);
    await bundleCrawlerPlugin(join(projectRoot, "crawler-platform", "plugins", "pcbeta", "plugin.ts"), pluginDirectory);
    const pluginPath = join(pluginDirectory, "plugin.mjs");
    const pluginHash = createHash("sha256")
        .update(await readFile(pluginPath))
        .digest("hex");
    await writeFile(join(appDirectory, "package.json"), JSON.stringify({ name: "crawler-smoke", main: "main.cjs" }));
    await writeFile(
        mainPath,
        `require(require.resolve("tsx/cjs", { paths: [${JSON.stringify(projectRoot)}] }));\nrequire(${JSON.stringify(
            join(projectRoot, "scripts", "crawler", "electron-host-smoke-main.ts")
        )});\n`,
        "utf8"
    );
    await writeFile(responsePath, await readFile(fixturePath, "utf8"), "utf8");
    await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify(pcbetaPlugin.manifest), "utf8");
    await writeFile(join(pluginRoot, "enabled.json"), JSON.stringify({ enabledPluginIds: [pcbetaPlugin.manifest.id] }));

    const fixtureBody = await readFile(responsePath, "utf8");
    const nodeStartedAt = performance.now();
    const nodeRuntime = createServerCrawlerPluginRuntime({
        pluginDirectory: packagesDirectory,
        enabledPluginIds: [pcbetaPlugin.manifest.id],
        acceptedSourceIds: new Set(["pcbeta-windows11"]),
        workerPath,
        requestHandler: async (request) => createFixtureResponse(request, fixtureBody),
    });
    const nodeItems = await nodeRuntime.fetchSource("pcbeta-windows11");
    assert.ok(nodeItems, "The Node server adapter should return the enabled plugin source.");
    const nodeElapsedMs = Math.round(performance.now() - nodeStartedAt);

    const exitCode = await runElectronApp(electronExecutable, appDirectory, {
        LATESTNEWS_CRAWLER_SMOKE_USER_DATA: userDataPath,
        LATESTNEWS_CRAWLER_PLUGIN_DIR: pluginRoot,
        LATESTNEWS_CRAWLER_SMOKE_FIXTURE: responsePath,
        LATESTNEWS_CRAWLER_SMOKE_RESULT: resultPath,
        LATESTNEWS_CRAWLER_SMOKE_WORKER: workerPath,
        LATESTNEWS_CRAWLER_SMOKE_PLUGIN_HASH: pluginHash,
    });
    assert.equal(exitCode, 0, "Electron host smoke process should exit successfully.");

    const electronResult = JSON.parse(await readFile(resultPath, "utf8")) as {
        items: unknown;
        pluginHash: string;
        elapsedMs: number;
        processMetrics: Array<{ type: string; serviceName?: string; workingSetSize: number }>;
    };
    assert.equal(electronResult.pluginHash, pluginHash, "Both hosts must execute the same bundled artifact.");
    const expectedItem = {
        id: await createLegacyUrlHashId(itemUrl),
        title: "Windows fixture headline",
        url: itemUrl,
        pubDate: "Sun, 18 Oct 2026 07:00:00 GMT",
    };
    assert.deepEqual(nodeItems, [expectedItem]);
    assert.deepEqual(electronResult.items, nodeItems, "Node and Electron hosts must return identical items.");
    assert.ok(
        electronResult.processMetrics.some((metric) => metric.type === "Utility"),
        "Electron must report a utility process during plugin execution."
    );
    process.stdout.write(
        `${JSON.stringify({
            result: "passed",
            pluginSha256: pluginHash,
            nodeElapsedMs,
            electronElapsedMs: electronResult.elapsedMs,
            electronProcesses: electronResult.processMetrics,
        })}\n`
    );
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

function createFixtureResponse(request: CrawlerHttpRequest, fixtureBody: string): CrawlerHttpResponse {
    if (request.url !== feedUrl || (request.method ?? "GET") !== "GET") {
        throw new Error(`Unexpected smoke request ${request.method ?? "GET"} ${request.url}.`);
    }
    return {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
        body: fixtureBody,
    };
}

function runElectronApp(executable: string, appPath: string, smokeEnvironment: NodeJS.ProcessEnv) {
    return new Promise<number>((resolveExit, reject) => {
        const child = spawn(executable, [appPath, "--no-sandbox"], {
            cwd: projectRoot,
            env: { ...createRestrictedWorkerEnvironment(), ...smokeEnvironment },
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
        });
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Electron crawler smoke exceeded 20 seconds."));
        }, 20000);

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once("exit", (code) => {
            clearTimeout(timer);
            if (code !== 0 && stderr) process.stderr.write(stderr);
            resolveExit(code ?? 1);
        });
    });
}
