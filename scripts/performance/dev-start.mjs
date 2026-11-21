import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("../../", import.meta.url);
const pnpm = process.env.npm_execpath;
const runs = Number(process.argv[2] ?? 5);
const timeoutMs = 30_000;
const isWindows = process.platform === "win32";

if (!pnpm || !Number.isSafeInteger(runs) || runs < 1 || process.argv.length > 3) {
    throw new Error("Usage: pnpm performance:dev-start [positive sample count]");
}

// Use the installed dependency cache, and warm it once before collecting samples.
await measure();
const samples = [];
for (let i = 0; i < runs; i++) {
    const sample = await measure();
    samples.push(sample);
    console.log(`Run ${i + 1}: ${JSON.stringify(sample)}`);
}

const medianMs = Object.fromEntries(
    Object.keys(samples[0]).map((key) => {
        const values = samples.map((sample) => sample[key]).sort((a, b) => a - b);
        return [key, Math.round((values[Math.floor((runs - 1) / 2)] + values[Math.floor(runs / 2)]) / 2)];
    })
);
console.log(JSON.stringify({ node: process.version, platform: process.platform, runs, medianMs, samples }, null, 2));

async function measure() {
    const port = await getLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const start = performance.now();
    const args = ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
    const nodeLauncher = /\.[cm]?js$/i.test(pnpm);
    const child = spawn(nodeLauncher ? process.execPath : pnpm, nodeLauncher ? [pnpm, ...args] : args, {
        cwd: root,
        env: {
            ...process.env,
            LATESTNEWS_SKIP_FAVICON_FETCH: "true",
            LATESTNEWS_CRAWLER_PLUGIN_DIR: ".data/performance/dev-start-no-plugins",
            LATESTNEWS_CRAWLER_PLUGIN_IDS: "",
            LATESTNEWS_CONFIGURED_SOURCES: "",
        },
        detached: !isWindows,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    let exited = false;
    let spawnError;
    const trackOutput = (data) => (logs = (logs + data).slice(-8000));
    child.stdout.on("data", trackOutput);
    child.stderr.on("data", trackOutput);
    const exit = new Promise((resolve) => {
        child.once("error", (error) => {
            spawnError = error;
            exited = true;
            resolve();
        });
        child.once("exit", () => {
            exited = true;
            resolve();
        });
    });

    try {
        const shellMs = await probe("/", async (response) => (await response.text()).includes('id="app"'));
        const [entryMs, apiMs] = await Promise.all([
            probe("/src/main.tsx", (response) => response.headers.get("content-type")?.includes("javascript")),
            probe("/api/v1/sources", async (response) => (await response.json()).data?.sources?.length > 0),
        ]);
        return { shellMs, entryMs, apiMs, readyMs: Math.max(entryMs, apiMs) };
    } catch (error) {
        throw new Error(`${error.message}\n${logs}`, { cause: error });
    } finally {
        if (child.pid) {
            if (isWindows && !exited) {
                execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
            } else if (!isWindows) {
                signalGroup(child.pid, "SIGTERM");
                if (!(await Promise.race([exit.then(() => true), delay(1000, false, { ref: false })]))) {
                    signalGroup(child.pid, "SIGKILL");
                }
            }
        }
        await exit;
    }

    async function probe(path, check) {
        let lastResult = "no connection";
        while (!exited && performance.now() - start < timeoutMs) {
            try {
                const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(1000) });
                lastResult = `HTTP ${response.status}`;
                if (response.ok && (await check(response))) {
                    return Math.round(performance.now() - start);
                }
                await response.body?.cancel().catch(() => {});
            } catch (error) {
                lastResult = error.cause?.code ?? error.message;
            }
            await delay(25);
        }
        throw spawnError ?? new Error(`${path} was not ready (${exited ? "dev command exited" : lastResult}).`);
    }
}

function signalGroup(pid, signal) {
    try {
        process.kill(-pid, signal);
    } catch (error) {
        if (error.code !== "ESRCH") throw error;
    }
}

async function getLoopbackPort() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return port;
}
