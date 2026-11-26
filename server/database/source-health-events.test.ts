import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, describe, afterEach } from "vitest";

const { getRuntimeDatabase } = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("nitro/database", () => ({ useDatabase: getRuntimeDatabase }));

afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    getRuntimeDatabase.mockReset();
});

describe("source health event persistence", () => {
    it("writes and bounds event history through the imported database provider", async () => {
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        getRuntimeDatabase.mockReturnValue(database);
        try {
            const { getSourceHealthEventsTable } = await import("./source-health-events");
            const table = await getSourceHealthEventsTable();
            expect(table).toBeDefined();
            for (let index = 1; index <= 3; index += 1) {
                await table!.append(
                    "juejin",
                    { status: "healthy", occurredAt: index * 1_000, durationMs: 20, itemCount: index },
                    2
                );
            }
            const events = await table!.listRecent("juejin");
            expect(events.map((event) => event.occurredAt)).toEqual([3_000, 2_000]);
            expect(events[0]).toMatchObject({ sourceId: "juejin", status: "healthy", itemCount: 3 });
            expect(getRuntimeDatabase).toHaveBeenCalledOnce();
        } finally {
            await database.dispose();
        }
    });

    it("writes only safe failure text and safely projects legacy rows without changing them", async () => {
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            const { SourceHealthEvents } = await import("./source-health-events");
            const table = new SourceHealthEvents(database);
            await table.init();
            const marker = "AUDIT_SYNTHETIC_NOT_A_SECRET";
            await table.append("weibo", { status: "failing", occurredAt: 2, durationMs: 1, errorMessage: marker });
            expect(await database.prepare("SELECT error_message FROM source_health_events").get()).toEqual({
                error_message: "Source collection failed.",
            });
            await database
                .prepare("INSERT INTO source_health_events VALUES(?,?,?,?,?,?,?)")
                .run("legacy", "weibo", "failing", 1, 1, null, marker);
            const events = await table.listRecent("weibo");
            expect(events.map((x) => x.errorMessage)).toEqual([
                "Source collection failed.",
                "Source collection failed.",
            ]);
            expect(
                await database.prepare("SELECT error_message FROM source_health_events WHERE id='legacy'").get()
            ).toEqual({ error_message: marker });
        } finally {
            await database.dispose();
        }
    });

    it("does not open the database when cache persistence is disabled", async () => {
        vi.stubEnv("ENABLE_CACHE", "false");
        const { getSourceHealthEventsTable } = await import("./source-health-events");

        expect(await getSourceHealthEventsTable()).toBeUndefined();
        expect(getRuntimeDatabase).not.toHaveBeenCalled();
    });
});
