import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { stat, readFile } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const licenseFiles = ["LICENSE", "LICENSE.md", "LICENSES/GPL-3.0-only.txt", "LICENSES/AGPL-3.0-only.txt"];

async function digest(path) {
    return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** Verify that a distributable directory carries the repository's complete license bundle. */
export async function verifyLicenseBundle(root, expectedManifestLicense) {
    for (const relativePath of licenseFiles) {
        const source = join(projectRoot, relativePath);
        const bundled = join(root, relativePath);
        const bundledInfo = await stat(bundled).catch(() => undefined);
        if (!bundledInfo?.isFile() || bundledInfo.size === 0) {
            throw new Error(`Missing license file in distributable: ${relativePath}`);
        }
        if ((await digest(source)) !== (await digest(bundled))) {
            throw new Error(`License file differs from repository: ${relativePath}`);
        }
    }

    if (expectedManifestLicense) {
        const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        if (manifest.license !== expectedManifestLicense) {
            throw new Error(`Unexpected distributable license: ${manifest.license ?? "missing"}`);
        }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = resolve(process.argv[2] ?? "out");
    const kind = process.argv[3] ?? "generic";
    await verifyLicenseBundle(root, kind === "electron" ? "GPL-3.0-only" : undefined);
    console.info(`Verified license bundle in ${root}.`);
}
