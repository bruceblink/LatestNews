import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join, extname, resolve, relative } from "node:path";

interface AssetRecord {
    path: string;
    bytes: number;
    gzipBytes: number;
}

const publicRoot = resolve(process.cwd(), "dist/output/public");
const htmlPath = join(publicRoot, "index.html");
const assets = await collectAssets(publicRoot);
const html = await readFile(htmlPath, "utf8");
const initialScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((match) => match[1]);
const javascript = assets.filter((asset) => extname(asset.path) === ".js");
const stylesheets = assets.filter((asset) => extname(asset.path) === ".css");

const report = {
    generatedAt: new Date().toISOString(),
    publicRoot,
    html: measure(Buffer.from(html)),
    initialScripts,
    javascript: summarize(javascript),
    stylesheets: summarize(stylesheets),
    largestAssets: [...assets].sort((left, right) => right.bytes - left.bytes).slice(0, 10),
};

console.log(JSON.stringify(report, null, 2));

async function collectAssets(root: string): Promise<AssetRecord[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const path = join(root, entry.name);
            if (entry.isDirectory()) return collectAssets(path);
            if (!entry.isFile()) return [];
            const content = await readFile(path);
            return [
                {
                    path: relative(root, path).replaceAll("\\", "/"),
                    ...measure(content),
                },
            ];
        })
    );
    return files.flat();
}

function measure(content: Buffer) {
    return { bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength };
}

function summarize(records: AssetRecord[]) {
    return {
        count: records.length,
        bytes: records.reduce((total, asset) => total + asset.bytes, 0),
        gzipBytes: records.reduce((total, asset) => total + asset.gzipBytes, 0),
        files: records.sort((left, right) => right.bytes - left.bytes),
    };
}
