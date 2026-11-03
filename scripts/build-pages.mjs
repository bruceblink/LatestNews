import process from "node:process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatedFiles = ["shared/pinyin.json", "shared/sources.json"].map((file) => join(projectRoot, file));
const snapshots = await Promise.all(
    generatedFiles.map(async (file) => ({
        file,
        content: await readFile(file),
    }))
);

let exitCode = 1;
try {
    const isWindows = process.platform === "win32";
    const command = isWindows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
    const args = isWindows ? ["/d", "/s", "/c", "pnpm.cmd build"] : ["build"];
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        env: { ...process.env, CF_PAGES: "1" },
        stdio: "inherit",
    });

    if (result.error) {
        console.error(result.error);
    } else {
        exitCode = result.status ?? 1;
    }
} finally {
    await Promise.all(snapshots.map(({ file, content }) => writeFile(file, content)));
}

process.exitCode = exitCode;
