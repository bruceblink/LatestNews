import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, access, copyFile, readFile, writeFile } from "node:fs/promises";

import { verifyLicenseBundle } from "./verify-license-bundle.mjs";
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
    repository: `${rootPackage.repository}/tree/v${rootPackage.version}`,
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
await writeFile(
    resolve(outputRoot, "README.txt"),
    [
        `LatestNews ${rootPackage.version} desktop package`,
        "",
        `Source code: ${rootPackage.repository}/tree/v${rootPackage.version}`,
        `Build and update notes: ${rootPackage.repository}/blob/v${rootPackage.version}/docs/04-desktop-updates.md`,
        "",
        "License: LICENSE.md and LICENSES/",
        "",
    ].join("\n"),
    "utf8"
);
await verifyLicenseBundle(outputRoot, "GPL-3.0-only");
console.info("Prepared a minimal Electron app manifest without server dependencies.");
