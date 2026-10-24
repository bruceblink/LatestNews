import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { rm, mkdtemp, readFile } from "node:fs/promises";
import { it, expect, describe, afterAll, beforeAll } from "vitest";

import { parseSourceQualitySampleRecords } from "../shared/source-quality-records";

const execute = promisify(execFile);
const sampleScript = resolve("scripts/performance/source-quality-sample.ts");
const reportScript = resolve("scripts/performance/source-quality-report.ts");
const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: { status: "success", items: [{ pubDate: Date.now() - 1_000 }] } }));
});
let directory: string;
let origin: string;

// Exercise the real CLI processes against a deterministic loopback endpoint, without public traffic.
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "latestnews-quality-"));
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing loopback test server address.");
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise()))
    );
    if (directory && resolve(directory).startsWith(join(tmpdir(), "latestnews-quality-"))) {
        await rm(directory, { recursive: true, force: true });
    }
});

describe("source quality commands", () => {
    it("persists run metadata and reports an inclusive window through the CLI", async () => {
        const input = join(directory, "samples.jsonl");
        await run(sampleScript, [
            "--",
            "--origin",
            origin,
            "--source",
            "freebuf,freebuf",
            "--samples",
            "2",
            "--interval-ms",
            "0",
            "--output",
            input,
        ]);
        const records = parseSourceQualitySampleRecords(await readFile(input, "utf8"));

        expect(records).toHaveLength(2);
        expect(records.map((record) => record.round)).toEqual([1, 2]);
        expect(records[0]!.run).toMatchObject({ nodeVersion: process.version, intervalMs: 0, timeoutMs: 20_000 });
        expect(records[1]!.run).toEqual(records[0]!.run);

        const output = join(directory, "report.json");
        await run(reportScript, [
            "--input",
            input,
            "--output",
            output,
            "--origin",
            `${origin}/`,
            "--from",
            new Date(records[0]!.sampledAt).toISOString(),
            "--to",
            new Date(records[1]!.sampledAt).toISOString(),
        ]);
        const report = JSON.parse(await readFile(output, "utf8"));

        expect(report).toMatchObject({
            sampleCount: 2,
            origins: [origin],
            unattributedSampleCount: 0,
            samplingRuns: [records[0]!.run],
        });
        expect(report.sources).toHaveLength(10);
        expect(
            report.sources.every(
                (source: { assessment: { status: string } }) => source.assessment.status === "insufficient-data"
            )
        ).toBe(true);
    });

    it("rejects high-frequency HTTPS sampling before making a request", async () => {
        await expect(run(sampleScript, ["--origin", "https://news.example.com", "--interval-ms", "0"])).rejects.toThrow(
            "at least 900000 ms"
        );
    });

    it("requires explicit timezone information for report boundaries", async () => {
        await expect(run(reportScript, ["--from", "2026-10-24T12:00:00"])).rejects.toThrow("explicit timezone");
    });
});

function run(script: string, args: string[]) {
    return execute(process.execPath, ["--import", "tsx", script, ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
    });
}
