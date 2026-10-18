import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { rm, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { bundleCrawlerPlugin } from "../../crawler-platform/testing/bundle-plugin";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const pluginId = "org.latestnews.server-smoke";
const fixtureDirectory = join(projectRoot, "test", "fixtures", "crawler-server-smoke");
const temporaryRoot = await mkdtemp(join(tmpdir(), "latestnews-crawler-docker-smoke-"));
const packageDirectory = join(temporaryRoot, pluginId);
const uniqueId = Date.now().toString(36);
const imageTag = `latestnews-crawler-smoke:${uniqueId}`;
const containerName = `latestnews-crawler-smoke-${uniqueId}`;
let imageBuilt = false;
let containerStarted = false;

try {
    const manifest = JSON.parse(await readFile(join(fixtureDirectory, "manifest.json"), "utf8")) as Record<
        string,
        unknown
    >;
    await bundleCrawlerPlugin(join(fixtureDirectory, "plugin.ts"), packageDirectory);
    await writeFile(
        join(packageDirectory, "manifest.json"),
        `${JSON.stringify({ ...manifest, entry: "plugin.mjs" }, null, 2)}\n`,
        "utf8"
    );

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
            `LATESTNEWS_CRAWLER_PLUGIN_IDS=${pluginId}`,
            "--env",
            "LATESTNEWS_CRAWLER_PLUGIN_DIR=/usr/app/.data/crawler-plugins",
            "--env",
            "ENABLE_CACHE=false",
            "--volume",
            `${temporaryRoot}:/usr/app/.data/crawler-plugins:ro`,
            imageTag,
        ],
        { inheritOutput: true }
    );
    containerStarted = true;

    const response = await waitForPluginResponse(`http://127.0.0.1:${port}/api/s?id=hackernews&latest=true`);
    assert.equal(response.status, 200, "The Node API should return HTTP 200 for the fixture source.");
    const body = await response.text();
    assert.ok(body.includes("server-smoke-1"), "The API response should contain the fixture item ID.");
    assert.ok(body.includes("Server plugin API smoke"), "The API response should contain the fixture title.");
    process.stdout.write(`Docker Node plugin API smoke passed (127.0.0.1:${port} -> container :4444).\n`);
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
