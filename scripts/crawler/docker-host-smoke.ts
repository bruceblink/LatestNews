import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { rm, mkdtemp } from "node:fs/promises";

import { bundlePluginPackage } from "../../crawler-platform/cli";
import { installCrawlerPluginPackage } from "../../crawler-platform/host/plugin-store";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const pluginId = "org.latestnews.server-smoke";
const sourceId = `ext.${pluginId}.latest`;
const fixtureDirectory = join(projectRoot, "test", "fixtures", "crawler-server-smoke");
const temporaryRoot = await mkdtemp(join(tmpdir(), "latestnews-crawler-docker-smoke-"));
const packageDirectory = join(temporaryRoot, "bundle");
const pluginStore = join(temporaryRoot, "plugin-store");
const uniqueId = Date.now().toString(36);
const imageTag = `latestnews-crawler-smoke:${uniqueId}`;
const containerName = `latestnews-crawler-smoke-${uniqueId}`;
let imageBuilt = false;
let containerStarted = false;

try {
    await bundlePluginPackage(fixtureDirectory, packageDirectory);
    await installCrawlerPluginPackage(packageDirectory, pluginStore, { action: "install", enable: true });

    runDocker(["build", "--tag", imageTag, "."], { inheritOutput: true });
    imageBuilt = true;

    const port = await getAvailableLocalPort();
    runDocker(
        [
            "run",
            "--detach",
            "--rm",
            "--name",
            containerName,
            "--publish",
            `127.0.0.1:${port}:4444`,
            "--env",
            "LATESTNEWS_CRAWLER_PLUGIN_DIR=/usr/app/.data/crawler-plugins",
            "--env",
            "LATESTNEWS_WEB_ORIGINS=https://news.example.test",
            "--env",
            "ENABLE_CACHE=false",
            "--volume",
            `${pluginStore}:/usr/app/.data/crawler-plugins:ro`,
            imageTag,
        ],
        { inheritOutput: true }
    );
    containerStarted = true;

    const origin = `http://127.0.0.1:${port}`;
    const response = await waitForPluginResponse(`${origin}/api/s?id=${encodeURIComponent(sourceId)}&latest=true`);
    assert.equal(response.status, 200, "The Node API should return HTTP 200 for a dynamic fixture source.");
    const body = await response.text();
    assert.ok(body.includes("server-smoke-1"), "The API response should contain the fixture item ID.");
    assert.ok(body.includes("Server plugin API smoke"), "The API response should contain the fixture title.");
    const unknownSourceResponse = await fetch(
        `${origin}/api/s?id=${encodeURIComponent("ext.org.latestnews.unknown.latest")}`
    );
    assert.equal(unknownSourceResponse.status, 400, "Unknown dynamic source namespaces must be rejected.");

    const corsPreflight = await fetch(`${origin}/api/v1/sources`, {
        method: "OPTIONS",
        headers: {
            Origin: "https://news.example.test",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    });
    assert.equal(corsPreflight.status, 204, "The configured Pages origin should pass the API CORS preflight.");
    assert.equal(corsPreflight.headers.get("access-control-allow-origin"), "https://news.example.test");
    const deniedOriginResponse = await fetch(`${origin}/api/v1/sources`, {
        headers: { Origin: "https://attacker.example.test" },
    });
    assert.equal(
        deniedOriginResponse.headers.get("access-control-allow-origin"),
        null,
        "Unlisted origins must not receive CORS permission."
    );

    const catalogResponse = await fetch(`${origin}/api/v1/sources`);
    assert.equal(catalogResponse.status, 200, "The source catalog API should return HTTP 200.");
    const catalog = (await catalogResponse.json()) as { data: { sources: Array<{ id: string; name: string }> } };
    assert.ok(
        catalog.data.sources.some((source) => source.id === sourceId && source.name === "Server Smoke"),
        "The source catalog should expose the dynamic fixture metadata."
    );

    const idsResponse = await fetch(`${origin}/api/s/ids`);
    assert.equal(idsResponse.status, 200, "The legacy source ID endpoint should include dynamic sources.");
    assert.ok(((await idsResponse.json()) as string[]).includes(sourceId));

    const detailResponse = await fetch(`${origin}/api/v1/sources/${encodeURIComponent(sourceId)}`);
    assert.equal(detailResponse.status, 200, "The source metadata API should resolve dynamic source IDs.");
    const detail = (await detailResponse.json()) as { data: { id: string; column: string } };
    assert.equal(detail.data.id, sourceId);
    assert.equal(detail.data.column, "tech");

    const batchResponse = await fetch(`${origin}/api/v1/sources/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: [sourceId] }),
    });
    assert.equal(batchResponse.status, 200, "The batch API should accept dynamic source IDs.");
    assert.ok((await batchResponse.text()).includes("server-smoke-1"));

    const feedResponse = await fetch(`${origin}/api/v1/feeds/json?source=${encodeURIComponent(sourceId)}`);
    assert.equal(feedResponse.status, 200, "The JSON Feed endpoint should accept dynamic source IDs.");
    assert.ok((await feedResponse.text()).includes("Server plugin API smoke"));
    process.stdout.write(`Docker dynamic source API smoke passed (127.0.0.1:${port} -> container :4444).\n`);
} catch (error) {
    if (containerStarted) runDocker(["logs", containerName], { allowFailure: true, inheritOutput: true });
    throw error;
} finally {
    if (containerStarted) {
        runDocker(["stop", containerName], { allowFailure: true });
        runDocker(["rm", "--force", containerName], { allowFailure: true });
    }
    if (imageBuilt) runDocker(["image", "rm", "--force", imageTag], { allowFailure: true });
    await rm(temporaryRoot, { recursive: true, force: true });
}

async function waitForPluginResponse(url: string) {
    const deadline = Date.now() + 30000;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            return await fetch(url, { signal: AbortSignal.timeout(3000) });
        } catch (error) {
            lastError = error;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        }
    }
    throw new Error(`Node API did not become ready within 30 seconds: ${String(lastError)}`);
}

async function getAvailableLocalPort() {
    const net = await import("node:net");
    const server = net.createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Could not reserve an ephemeral localhost port.");
    }
    await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
    return address.port;
}

function runDocker(args: string[], options: { allowFailure?: boolean; inheritOutput?: boolean } = {}) {
    const result = spawnSync("docker", args, {
        cwd: projectRoot,
        encoding: "utf8",
        windowsHide: true,
        ...(options.inheritOutput ? { stdio: "inherit" as const } : {}),
    });
    if (result.error) throw result.error;
    if (!options.allowFailure && result.status !== 0) {
        throw new Error(`docker ${args[0]} failed with exit code ${String(result.status)}.`);
    }
    return result.stdout?.trim() ?? "";
}
