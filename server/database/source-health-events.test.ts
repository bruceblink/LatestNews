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

    it("does not open the database when cache persistence is disabled", async () => {
        vi.stubEnv("ENABLE_CACHE", "false");
        const { getSourceHealthEventsTable } = await import("./source-health-events");

        expect(await getSourceHealthEventsTable()).toBeUndefined();
        expect(getRuntimeDatabase).not.toHaveBeenCalled();
    });
});
