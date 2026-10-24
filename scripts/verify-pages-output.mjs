import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
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

const serviceWorkerSource = await readFile(serviceWorker, "utf8").catch(() => "");
if (serviceWorkerSource.includes("_worker.js")) {
    throw new Error("The PWA precache manifest must not include the Cloudflare worker bundle.");
}

console.log("Cloudflare Pages output is self-contained and excluded from PWA precache.");
