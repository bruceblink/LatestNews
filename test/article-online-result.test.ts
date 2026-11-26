import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it, expect, describe } from "vitest";
import { spawnSync } from "node:child_process";
import { rm, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { readOnlineResult, publishOnlineResult } from "../scripts/performance/article-online-result";

describe("benchmark result handoff", () => {
    it("receives a long-run sized result after child exit without an IPC payload", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ln-online-result-test-"));
        try {
            const path = join(directory, "host.json");
            const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/performance/article-online-result.ts")).href;
            const code = `import {publishOnlineResult} from ${JSON.stringify(moduleUrl)};
                const samples=Array.from({length:7200},(_,i)=>({sequence:i,payload:"x".repeat(512)}));
                await publishOnlineResult(process.argv[1],{samples});`;
            const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, path], {
                encoding: "utf8",
                timeout: 20000,
            });
            expect(child.status, child.stderr).toBe(0);
            const bytes = await readFile(path);
            expect(bytes.byteLength).toBeGreaterThan(3_000_000);
            const result = await readOnlineResult<{ samples: { sequence: number; payload: string }[] }>(path);
            expect(result.samples).toHaveLength(7200);
            expect(result.samples.at(-1)).toEqual({ sequence: 7199, payload: "x".repeat(512) });
            await expect(readFile(path + ".partial")).rejects.toThrow();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("never reads an unfinished or missing result as a successful child result", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ln-online-result-test-"));
        try {
            const path = join(directory, "write.json");
            await writeFile(path + ".partial", '{"samples":');
            await expect(readOnlineResult(path)).rejects.toThrow();
            await expect(publishOnlineResult(path, { samples: [] })).rejects.toThrow();
            await rm(path + ".partial");
            await publishOnlineResult(path, { samples: [1] });
            expect(await readOnlineResult(path)).toEqual({ samples: [1] });
            await writeFile(path, "not json");
            await expect(readOnlineResult(path)).rejects.toThrow();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
