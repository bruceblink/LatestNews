import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { parse, stringify } from "yaml";
import { createHash } from "node:crypto";
import { rm, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { prepareUpdateAssets } from "../scripts/prepare-update-assets.mjs";

it("merges multi-architecture metadata, verifies assets and rejects corrupt downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "latestnews-update-assets-"));
    const input = join(root, "inputs");
    const output = join(root, "output");
    try {
        for (const [platform, architectures, extension, metadata] of [
            ["Windows", ["x64", "arm64"], "exe", "latest.yml"],
            ["macOS", ["x64", "arm64"], "zip", "latest-mac.yml"],
            ["Linux", ["x64", "arm64"], "AppImage", "latest-linux.yml"],
        ] as const) {
            for (const arch of architectures) {
                const directory = join(input, `${platform}-${arch}`);
                await mkdir(directory, { recursive: true });
                const file = `LatestNews-1.0.1-${platform}-${arch}.${extension}`;
                const content = Buffer.from(`${platform}-${arch}`);
                await writeFile(join(directory, file), content);
                if (extension !== "AppImage") await writeFile(join(directory, `${file}.blockmap`), "block map");
                await writeFile(
                    join(directory, platform === "Linux" && arch === "arm64" ? "latest-linux-arm64.yml" : metadata),
                    stringify({
                        version: "1.0.1",
                        files: [
                            {
                                url: file,
                                size: content.length,
                                sha512: createHash("sha512").update(content).digest("base64"),
                            },
                        ],
                    })
                );
            }
        }
        await prepareUpdateAssets(input, output, "1.0.1");
        for (const name of ["latest.yml", "latest-mac.yml"]) {
            const info = parse(await readFile(join(output, name), "utf8"));
            expect(info.files).toHaveLength(2);
            expect(info.path).toContain("-x64.");
            expect(info.files.some((file: { url: string }) => file.url.includes("-arm64."))).toBe(true);
        }
        expect(await readFile(join(output, "SHA256SUMS.txt"), "utf8")).toContain("latest-linux-arm64.yml");
        await writeFile(join(input, "Windows-x64", "LatestNews-1.0.1-Windows-x64.exe"), "bad");
        await expect(prepareUpdateAssets(input, output, "1.0.1")).rejects.toThrow("mismatch");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
