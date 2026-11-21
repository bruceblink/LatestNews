import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
import { rmSync, statSync, utimesSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";

import { generateSourceFiles } from "../tools/generate-sources";

let outputDir: string;

beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "latestnews-source-files-"));
    vi.stubEnv("CF_PAGES", undefined);
});

afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(outputDir, { recursive: true, force: true });
});

it("generates missing catalogs and preserves unchanged files", () => {
    const sourcesPath = join(outputDir, "sources.json");
    const pinyinPath = join(outputDir, "pinyin.json");
    generateSourceFiles(outputDir);

    const sources = readFileSync(sourcesPath, "utf8");
    expect(JSON.parse(sources)).toHaveProperty("v2ex.redirect", "v2ex-share");
    expect(JSON.parse(sources)).toHaveProperty("bilibili-hot-video");
    expect(JSON.parse(readFileSync(pinyinPath, "utf8"))).toHaveProperty("v2ex-share", "V2EX-zuixinfenxiang");

    const oldTime = new Date("2020-01-01T00:00:00Z");
    utimesSync(pinyinPath, oldTime, oldTime);
    writeFileSync(sourcesPath, "{}");
    generateSourceFiles(outputDir);

    expect(readFileSync(sourcesPath, "utf8")).toBe(sources);
    expect(statSync(pinyinPath).mtimeMs).toBe(oldTime.getTime());
});

it("keeps Cloudflare source filtering consistent across both files", () => {
    vi.stubEnv("CF_PAGES", "1");
    generateSourceFiles(outputDir);

    for (const file of ["sources.json", "pinyin.json"]) {
        const catalog = JSON.parse(readFileSync(join(outputDir, file), "utf8"));
        expect(catalog).not.toHaveProperty("bilibili-hot-video");
        expect(catalog).toHaveProperty("v2ex-share");
    }
});
