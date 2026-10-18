import { app } from "electron";
import { readFile, writeFile } from "node:fs/promises";

import { createDynamicSourceId } from "../../shared/dynamic-source-id";
import { createElectronCrawlerPluginRuntime } from "../../electron/crawler-plugin-provider";

import type { CrawlerHttpRequest, CrawlerHttpResponse } from "../../crawler-platform/sdk/types";

const startedAt = performance.now();
const fixturePath = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_FIXTURE");
const jsonFixturePath = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_JSON_FIXTURE");
const resultPath = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_RESULT");
const workerPath = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_WORKER");
const pluginHash = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_PLUGIN_HASH");
const jsonPluginHash = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_JSON_PLUGIN_HASH");
const userDataPath = requiredEnvironment("LATESTNEWS_CRAWLER_SMOKE_USER_DATA");

app.setPath("userData", userDataPath);

void app
    .whenReady()
    .then(runSmoke)
    .then(() => app.quit())
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        app.exit(1);
    });

async function runSmoke() {
    const fixtureBody = await readFile(fixturePath, "utf8");
    const jsonFixtureBody = await readFile(jsonFixturePath, "utf8");
    let processMetrics: Array<{
        type: string;
        pid: number;
        serviceName?: string;
        workingSetSize: number;
        privateBytes?: number;
    }> = [];
    const runtime = await createElectronCrawlerPluginRuntime({
        workerPath,
        userDataPath,
        requestHandler: async (request: CrawlerHttpRequest): Promise<CrawlerHttpResponse> => {
            processMetrics = app.getAppMetrics().map((metric) => ({
                type: metric.type,
                pid: metric.pid,
                ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
                workingSetSize: metric.memory.workingSetSize,
                ...(metric.memory.privateBytes !== undefined ? { privateBytes: metric.memory.privateBytes } : {}),
            }));
            if ((request.method ?? "GET") !== "GET") {
                throw new Error(`Unexpected smoke request ${request.method ?? "GET"} ${request.url}.`);
            }
            if (request.url === "https://json.example.test/news.json") {
                return {
                    status: 200,
                    headers: { "content-type": "application/json" },
                    body: jsonFixtureBody,
                };
            }
            if (request.url !== "https://bbs.pcbeta.com/forum.php?mod=rss&fid=563&auth=0") {
                throw new Error(`Unexpected smoke request ${request.method ?? "GET"} ${request.url}.`);
            }
            return {
                status: 200,
                headers: { "content-type": "application/rss+xml" },
                body: fixtureBody,
            };
        },
    });
    const dynamicSourceId = createDynamicSourceId("org.latestnews.example-json", "latest");
    if (!runtime.listSourceIds().includes("pcbeta-windows11") || !runtime.listSourceIds().includes(dynamicSourceId)) {
        throw new Error("Electron did not load both the static and dynamic plugin sources.");
    }
    const sourceResponse = await runtime.fetchSource("pcbeta-windows11");
    if (!sourceResponse) throw new Error("Electron could not collect the enabled Pcbeta source.");
    const dynamicSourceResponse = await runtime.fetchSource(dynamicSourceId);
    if (!dynamicSourceResponse) throw new Error("Electron could not collect the dynamic JSON plugin source.");
    const dynamicSourceMetadata = runtime.listSourceMetadata().find((source) => source.id === dynamicSourceId);
    if (!dynamicSourceMetadata || dynamicSourceMetadata.column !== "tech") {
        throw new Error("Electron did not expose dynamic source metadata.");
    }
    await writeFile(
        resultPath,
        JSON.stringify({
            items: sourceResponse.items,
            dynamicItems: dynamicSourceResponse.items,
            dynamicSourceMetadata: { id: dynamicSourceMetadata.id, column: dynamicSourceMetadata.column },
            pluginHash,
            dynamicPluginHash: jsonPluginHash,
            elapsedMs: Math.round(performance.now() - startedAt),
            processMetrics,
        }),
        "utf8"
    );
}

function requiredEnvironment(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing smoke setting ${name}.`);
    return value;
}
