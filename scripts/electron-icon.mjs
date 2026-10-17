import { resolve } from "node:path";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const projectRoot = resolve(import.meta.dirname, "..");
const buildDirectory = resolve(projectRoot, "build");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const svg = await readFile(resolve(projectRoot, "public/icon.svg"), "utf8");
const images = new Map(
    sizes.map((size) => [
        size,
        Buffer.from(
            new Resvg(svg, {
                fitTo: { mode: "width", value: size },
            })
                .render()
                .asPng()
        ),
    ])
);
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);

const entries = Buffer.alloc(icoSizes.length * 16);
let imageOffset = header.length + entries.length;
for (const [index, size] of icoSizes.entries()) {
    const image = images.get(size);
    const entryOffset = index * 16;
    entries.writeUInt8(size === 256 ? 0 : size, entryOffset);
    entries.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2);
    entries.writeUInt8(0, entryOffset + 3);
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(image.length, entryOffset + 8);
    entries.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.length;
}

await mkdir(buildDirectory, { recursive: true });

const windowsIcon = resolve(buildDirectory, "icon.ico");
await writeFile(
    windowsIcon,
    Buffer.concat([header, entries, ...icoSizes.map((size) => images.get(size))])
);
console.info(`Generated Windows application icon: ${windowsIcon}`);

const linuxIcon = resolve(buildDirectory, "icon.png");
await writeFile(linuxIcon, images.get(512));
console.info(`Generated Linux application icon: ${linuxIcon}`);

const appResourcesDirectory = resolve(projectRoot, "out");
const windowIcon = resolve(appResourcesDirectory, "icon.png");
await mkdir(appResourcesDirectory, { recursive: true });
await writeFile(windowIcon, images.get(512));
console.info(`Generated Electron window icon: ${windowIcon}`);

if (process.platform === "darwin") {
    const iconsetDirectory = resolve(buildDirectory, "icon.iconset");
    const iconsetFiles = [
        ["icon_16x16.png", 16],
        ["icon_16x16@2x.png", 32],
        ["icon_32x32.png", 32],
        ["icon_32x32@2x.png", 64],
        ["icon_128x128.png", 128],
        ["icon_128x128@2x.png", 256],
        ["icon_256x256.png", 256],
        ["icon_256x256@2x.png", 512],
        ["icon_512x512.png", 512],
        ["icon_512x512@2x.png", 1024],
    ];

    await mkdir(iconsetDirectory, { recursive: true });
    await Promise.all(
        iconsetFiles.map(([file, size]) =>
            writeFile(resolve(iconsetDirectory, file), images.get(size))
        )
    );

    // macOS iconutil converts the standard iconset PNG names into the ICNS container.
    const macIcon = resolve(buildDirectory, "icon.icns");
    await promisify(execFile)("iconutil", ["-c", "icns", iconsetDirectory, "-o", macIcon]);
    console.info(`Generated macOS application icon: ${macIcon}`);
}
