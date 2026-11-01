import { parse, stringify } from "yaml";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve, basename } from "node:path";
import { mkdir, readdir, readFile, copyFile, writeFile } from "node:fs/promises";

import { verifyUpdateAssets } from "./verify-update-assets.mjs";

/** Combine independently built architecture lists without losing an installer or overwriting a checksum. */
export async function prepareUpdateAssets(inputRoot, outputRoot, version) {
    await mkdir(outputRoot, { recursive: true });
    const documents = new Map();
    const copied = new Map();
    for (const directory of (await readdir(inputRoot)).sort()) {
        const root = join(inputRoot, directory);
        for (const name of (await readdir(root)).sort()) {
            if (!/\.(exe|dmg|zip|AppImage|deb|blockmap|yml)$/.test(name)) continue;
            const path = join(root, name);
            if (name.endsWith(".yml")) {
                const info = parse(await readFile(path, "utf8"));
                if (info.version !== version || !Array.isArray(info.files)) {
                    throw new Error(`Invalid update metadata: ${name}`);
                }
                const existing = documents.get(name);
                if (existing) existing.files.push(...info.files);
                else documents.set(name, info);
            } else {
                const digest = createHash("sha512").update(await readFile(path)).digest("hex");
                if (copied.has(name) && copied.get(name) !== digest) throw new Error(`Conflicting asset: ${name}`);
                copied.set(name, digest);
                await copyFile(path, join(outputRoot, name));
            }
        }
    }
    for (const [name, info] of documents) {
        const files = new Map();
        for (const file of info.files) {
            const previous = files.get(file.url);
            if (previous && JSON.stringify(previous) !== JSON.stringify(file)) {
                throw new Error(`Conflicting update file: ${file.url}`);
            }
            files.set(file.url, file);
        }
        // x64 remains the legacy path/sha512 fallback; current updaters select the matching file from files.
        info.files = [...files.values()].sort((a, b) =>
            Number(b.url.includes("-x64.")) - Number(a.url.includes("-x64.")) || a.url.localeCompare(b.url)
        );
        info.path = info.files[0]?.url;
        info.sha512 = info.files[0]?.sha512;
        await writeFile(join(outputRoot, basename(name)), stringify(info), "utf8");
    }
    return verifyUpdateAssets(outputRoot, {
        version,
        expectedMetadata: ["latest.yml", "latest-mac.yml", "latest-linux.yml", "latest-linux-arm64.yml"],
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    await prepareUpdateAssets(resolve(process.argv[2] ?? "desktop-inputs"), resolve(process.argv[3] ?? "release-assets"), version);
}
