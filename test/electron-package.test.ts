import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, describe, afterEach } from "vitest";
import { rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { verifyElectronDependencies } from "../scripts/verify-electron-dependencies.mjs";

const temporaryDirectories: string[] = [];
afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Electron standalone dependency verification", () => {
    it("accepts Electron, Node builtins and local bundled modules", async () => {
        const root = await createOutput(
            'require("electron"); require("node:fs"); require("path"); require("./chunk.cjs");'
        );
        await expect(verifyElectronDependencies(root)).resolves.toBeUndefined();
    });

    it("rejects a runtime zod import before preparing the app package", async () => {
        const root = await createOutput('require("zod");');
        await expect(verifyElectronDependencies(root)).rejects.toThrow("unpackaged modules: zod");
    });

    it("also checks nested chunks and preload ESM imports", async () => {
        const root = await createOutput('require("electron");');
        await mkdir(join(root, "preload", "chunks"));
        await writeFile(join(root, "preload", "chunks", "dependency.mjs"), 'import { z } from "zod/v4";');
        await expect(verifyElectronDependencies(root)).rejects.toThrow("unpackaged modules: zod/v4");
    });
});

async function createOutput(source: string) {
    const root = await mkdtemp(join(tmpdir(), "latestnews-electron-package-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "main"));
    await mkdir(join(root, "preload"));
    await writeFile(join(root, "main", "main.cjs"), source);
    return root;
}
