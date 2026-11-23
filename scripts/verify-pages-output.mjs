import process from "node:process";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stat, readdir, readFile } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerDirectory = join(projectRoot, "dist", "_worker.js");
const workerEntry = join(workerDirectory, "index.js");
const serviceWorker = join(projectRoot, "dist", "swx.js");
const wranglerSource = join(projectRoot, "wrangler.json");
const wranglerOutput = join(workerDirectory, "wrangler.json");

const entryStats = await stat(workerEntry).catch(() => undefined);
if (!entryStats?.isFile()) {
    throw new Error("Cloudflare Pages output has no dist/_worker.js/index.js entry.");
}

const files = await readdir(workerDirectory, { recursive: true, withFileTypes: true });
const chunks = files.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"));
if (chunks.length > 0) {
    throw new Error(
        "Cloudflare Pages output still contains split worker modules: " + chunks.map((entry) => entry.name).join(", ")
    );
}

const entrySource = await readFile(workerEntry, "utf8");
const sourceConfig = JSON.parse(await readFile(wranglerSource, "utf8"));
const outputConfig = JSON.parse(await readFile(wranglerOutput, "utf8"));
if (JSON.stringify(sourceConfig.d1_databases) !== JSON.stringify(outputConfig.d1_databases)) {
    throw new Error("Cloudflare Pages output does not carry the repository D1 bindings.");
}
if (/(?:from\s*|import\s*)["'][^"']*index\.js["']/.test(entrySource)) {
    throw new Error("Cloudflare Pages worker entry imports itself or another index.js module.");
}
if (/node_modules\/undici\/|versions\.node\.split\(/.test(entrySource)) {
    throw new Error("Cloudflare Pages worker includes Undici or a Node version check; use Cheerio's browser entry.");
}

const serviceWorkerSource = await readFile(serviceWorker, "utf8").catch(() => "");
if (serviceWorkerSource.includes("_worker.js")) {
    throw new Error("The PWA precache manifest must not include the Cloudflare worker bundle.");
}

// Reproduce the missing Node version reported by production. The invalid source
// exercises source-module initialization without fetching news or requiring D1.
const request = new Request("https://pages-output.invalid/api/v1/sources/__pages_output_invalid__/items");
const nodeVersion = Object.getOwnPropertyDescriptor(process.versions, "node");
try {
    delete process.versions.node;
    const { default: worker } = await import(pathToFileURL(workerEntry).href);
    const response = await worker.fetch(request, {}, { waitUntil() {} });
    if (response.status !== 400) {
        throw new Error(
            `Cloudflare Pages source initialization failed without process.versions.node: HTTP ${response.status}.`
        );
    }
    for (const path of ["/api/s/ids", "/api/v1/media/image"]) {
        const retired = await worker.fetch(new Request(`https://pages-output.invalid${path}`), {}, { waitUntil() {} });
        if (retired.status !== 404) {
            throw new Error(`Cloudflare Pages served retired endpoint ${path}: HTTP ${retired.status}.`);
        }
    }
    const refreshUrl = "https://pages-output.invalid/api/v1/sources/refresh";
    const refreshToken = randomBytes(32).toString("hex");
    const env = { LATESTNEWS_REFRESH_TOKEN: refreshToken };
    const context = { waitUntil() {} };
    const unauthorized = await worker.fetch(new Request(refreshUrl, { method: "POST" }), env, context);
    if (unauthorized.status !== 401) {
        throw new Error(`Cloudflare Pages refresh authentication returned HTTP ${unauthorized.status}.`);
    }
    const noCache = await worker.fetch(
        new Request(refreshUrl, { method: "POST", headers: { Authorization: `Bearer ${refreshToken}` } }),
        env,
        context
    );
    if (noCache.status !== 503) {
        throw new Error(`Cloudflare Pages refresh without a cache returned HTTP ${noCache.status}.`);
    }
} finally {
    if (nodeVersion) Object.defineProperty(process.versions, "node", nodeVersion);
}

console.log(
    "Cloudflare Pages output is self-contained and passes source initialization and refresh authentication checks."
);
