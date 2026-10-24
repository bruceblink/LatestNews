import process from "node:process";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stat, readdir, readFile } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerDirectory = join(projectRoot, "dist", "_worker.js");
const workerEntry = join(workerDirectory, "index.js");
const serviceWorker = join(projectRoot, "dist", "swx.js");

const entryStats = await stat(workerEntry).catch(() => undefined);
if (!entryStats?.isFile()) {
    throw new Error("Cloudflare Pages output has no dist/_worker.js/index.js entry.");
}

const files = await readdir(workerDirectory, { recursive: true, withFileTypes: true });
const chunks = files.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"));
if (chunks.length > 0) {
    throw new Error(
        "Cloudflare Pages output still contains split worker modules: " +
            chunks.map((entry) => entry.name).join(", ")
    );
}

const entrySource = await readFile(workerEntry, "utf8");
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
const request = new Request("https://pages-output.invalid/api/s?id=__pages_output_invalid__");
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
} finally {
    if (nodeVersion) Object.defineProperty(process.versions, "node", nodeVersion);
}

console.log(
    "Cloudflare Pages output is self-contained, excludes Node-only Cheerio dependencies and PWA precache, and initializes source routes without a Node version."
);
