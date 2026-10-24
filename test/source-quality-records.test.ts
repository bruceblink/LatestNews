import { it, expect, describe } from "vitest";

import { parseSourceQualitySampleRecords } from "../shared/source-quality-records";

import type { SourceQualitySampleRecord } from "../shared/source-quality-sampling";

const legacyRecord: SourceQualitySampleRecord = {
    sampledAt: 1_000,
    origin: "https://news.example.com",
    sourceId: "freebuf",
    kind: "rss",
    purpose: "RSS adapter",
    durationMs: 20,
    status: "success",
    itemCount: 2,
};
const run = {
    id: "2c16d6a6-4fc1-47cc-a95c-30b09173a516",
    startedAt: 500,
    commit: "a".repeat(40),
    workingTreeDirty: false,
    nodeVersion: "v24.15.0",
    intervalMs: 900_000,
    timeoutMs: 20_000,
};

describe("source quality JSONL records", () => {
    it("reads legacy and attributed records with blank lines and CRLF", () => {
        const attributed = { ...legacyRecord, run, round: 1 };
        const records = parseSourceQualitySampleRecords(
            `\r\n${JSON.stringify(legacyRecord)}\r\n${JSON.stringify(attributed)}\r\n`
        );

        expect(records).toEqual([legacyRecord, attributed]);
    });

    it.each([
        { status: "unknown" },
        { kind: "unknown" },
        { sampledAt: -1 },
        { durationMs: -1 },
        { itemCount: 0.5 },
        { freshnessMs: "100" },
        { newestPublishedAt: -1 },
        { httpStatus: 99 },
        { origin: "https://user:secret@news.example.com" },
        { run, round: 0 },
        { run },
        { round: 1 },
        { run: { ...run, commit: "invalid" }, round: 1 },
    ])("rejects invalid metrics or metadata with a line number: %j", (overrides) => {
        const content = `${JSON.stringify(legacyRecord)}\n${JSON.stringify({ ...legacyRecord, ...overrides })}`;

        expect(() => parseSourceQualitySampleRecords(content)).toThrow("Invalid source quality sample on line 2.");
    });

    it("rejects malformed JSON without echoing the payload", () => {
        expect(() => parseSourceQualitySampleRecords('\n{"secret":')).toThrow(
            "Invalid JSON on line 2 of the sample file."
        );
    });

    it("rejects conflicting metadata for a reused run ID", () => {
        const records = [
            { ...legacyRecord, run, round: 1 },
            { ...legacyRecord, run: { ...run, commit: "b".repeat(40) }, round: 2 },
        ];

        expect(() =>
            parseSourceQualitySampleRecords(records.map((record) => JSON.stringify(record)).join("\n"))
        ).toThrow("Conflicting sampling run on line 2.");
    });
});
