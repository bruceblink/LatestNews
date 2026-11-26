import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { slowSpans, captureSpan, parsePressure } from "../scripts/performance/article-online-diagnostics";
import { sqliteErrorCode, instrumentSqlite, type NativeSqlite } from "../scripts/performance/article-online-metrics";

describe("online benchmark diagnostics", () => {
    it("parses cumulative PSI totals without inventing missing metrics", () => {
        expect(
            parsePressure(
                "some avg10=1.23 avg60=2.34 avg300=3.45 total=456\nfull avg10=0.01 avg60=0.02 avg300=0.03 total=12\n"
            )
        ).toEqual({ some: 456, full: 12 });
        expect(parsePressure("some avg10=1.00 total=42\n")).toEqual({ some: 42 });
        expect(parsePressure("invalid\nfull total=not-a-number\n")).toEqual({});
    });

    it("keeps the longest bounded slow spans and counts all slow operations", () => {
        const spans = slowSpans();
        spans.record({ startedAt: 0, wallMs: 249, cpuMs: 1, operation: "fast" });
        for (let i = 0; i < 200; i++) spans.record({ startedAt: i, wallMs: 250 + i, cpuMs: i, operation: "fixture" });
        const result = spans.finish();
        expect(result.count).toBe(200);
        expect(result.longest).toHaveLength(128);
        expect(result.longest[0].wallMs).toBe(449);
        expect(result.longest.at(-1)?.wallMs).toBe(322);
    });

    it("records elapsed and CPU time without retaining input data", () => {
        const finish = captureSpan("fixture");
        const span = finish();
        expect(span.operation).toBe("fixture");
        expect(span.startedAt).toBeGreaterThan(0);
        expect(span.wallMs).toBeGreaterThanOrEqual(0);
        expect(span.cpuMs).toBeGreaterThanOrEqual(0);
    });
    it("records fast failures without copying arbitrary exception text", () => {
        const spans = slowSpans();
        spans.record({ startedAt: 1, wallMs: 1, cpuMs: 1, operation: "fixture", errorCode: "SQLITE_BUSY" });
        expect(spans.finish()).toMatchObject({ count: 1, longest: [{ errorCode: "SQLITE_BUSY" }] });
        expect(sqliteErrorCode({ code: "SQLITE_BUSY_TIMEOUT", message: "private fixture" })).toBe(
            "SQLITE_BUSY_TIMEOUT"
        );
        expect(sqliteErrorCode({ code: "private fixture" })).toBe("UNKNOWN");
    });
    it("retains actual SQLite error codes and transaction phase timing without SQL text", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            await db.prepare("CREATE TABLE sample(id INTEGER PRIMARY KEY)").run();
            const native = (await db.getInstance()) as NativeSqlite;
            const metrics = instrumentSqlite(native);
            native.prepare("INSERT INTO sample VALUES(1)").run();
            expect(() =>
                native.transaction(() => native.prepare("INSERT INTO sample VALUES(1)").run()).immediate()
            ).toThrow();
            const result = metrics();
            expect(result.errorCodes.SQLITE_CONSTRAINT_PRIMARYKEY).toBe(2);
            expect(result.slow.longest).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        operation: "transaction:other",
                        errorCode: "SQLITE_CONSTRAINT_PRIMARYKEY",
                        acquireMs: expect.any(Number),
                        callbackMs: expect.any(Number),
                        tailMs: expect.any(Number),
                    }),
                ])
            );
            expect(JSON.stringify(result)).not.toContain("INSERT INTO");
            expect(await db.prepare("SELECT COUNT(*) AS count FROM sample").get()).toEqual({ count: 1 });
        } finally {
            await db.dispose();
        }
    });
});
