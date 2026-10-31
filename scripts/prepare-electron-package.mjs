import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, access, copyFile, readFile, writeFile } from "node:fs/promises";

import { verifyElectronDependencies } from "./verify-electron-dependencies.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(projectRoot, "out");
const rootPackage = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));

for (const file of ["main/main.cjs", "preload/preload.cjs", "renderer/index.html"]) {
    await access(resolve(outputRoot, file));
}
await verifyElectronDependencies(outputRoot);

const appManifest = {
    name: "latestnews-desktop",
    productName: "LatestNews",
    version: rootPackage.version,
    // The packaged Electron app contains the GPLv3 client/desktop components only.
    license: "GPL-3.0-only",
    description: rootPackage.description,
    homepage: rootPackage.homepage,
    private: true,
    dependencies: {},
    main: "main/main.cjs",
    author: rootPackage.author,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, "package.json"), `${JSON.stringify(appManifest, null, 2)}\n`, "utf8");
await copyFile(resolve(projectRoot, "LICENSE"), resolve(outputRoot, "LICENSE"));
await copyFile(resolve(projectRoot, "LICENSE.md"), resolve(outputRoot, "LICENSE.md"));
await mkdir(resolve(outputRoot, "LICENSES"), { recursive: true });
for (const licenseFile of ["GPL-3.0-only.txt", "AGPL-3.0-only.txt"]) {
    await copyFile(resolve(projectRoot, "LICENSES", licenseFile), resolve(outputRoot, "LICENSES", licenseFile));
}
console.info("Prepared a minimal Electron app manifest without server dependencies.");
