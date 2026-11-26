import type { H3Event } from "h3";
import type { SourceID } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

vi.mock("nitro/database", () => ({
    useDatabase: vi.fn(() => {
        throw new Error("must not use Node DB");
    }),
}));

import { createSourceEngine } from "../utils/source-engine";
import { getRequestSourceHealthPersistence } from "./source-health-events";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function request(
    blockInsert?: Promise<void>,
    options: { enabled?: boolean; initialize?: boolean; fail?: boolean } = {}
) {
    const writes: { sql: string; params: unknown[] }[] = [];
    const retained: Promise<unknown>[] = [];
    const binding = {
        exec: vi.fn(),
        batch: vi.fn(),
        prepare(sql: string) {
            return {
                bind(...params: unknown[]) {
                    return {
                        async run() {
                            if (sql.includes("INSERT") && blockInsert) await blockInsert;
                            if (options.fail) throw new Error("private-database-error");
                            writes.push({ sql, params });
                            return { success: true };
                        },
                    };
                },
            };
        },
    };
    const env = {
        LATESTNEWS_DB: binding,
        ENABLE_CACHE: String(options.enabled !== false),
        INIT_TABLE: String(options.initialize !== false),
    };
    const event = {
        req: { runtime: { cloudflare: { env } } },
        waitUntil: (p: Promise<unknown>) => {
            retained.push(p);
        },
    } as unknown as H3Event;
    return { event, env, binding, writes, retained, sink: getRequestSourceHealthPersistence(event)! };
}

const sample = { status: "healthy" as const, occurredAt: 123, durationMs: 5, itemCount: 1 };
const source = "weibo" as SourceID;

describe("request-owned source health", () => {
    it("keeps insert and trim on captured binding even when another request starts", async () => {
        const gate = deferred();
        const a = request(gate.promise);
        const b = request();
        const first = a.sink.append(source, sample);
        a.env.LATESTNEWS_DB = b.binding;
        expect(getRequestSourceHealthPersistence(a.event)).toBe(a.sink);
        await b.sink.append("ithome" as SourceID, sample);
        gate.resolve();
        await first;
        expect(a.writes.filter((x) => x.sql.includes("INSERT"))[0].params[1]).toBe(source);
        expect(a.writes.filter((x) => x.sql.includes("DELETE"))[0].params[0]).toBe(source);
        expect(b.writes.filter((x) => x.sql.includes("INSERT"))[0].params[1]).toBe("ithome");
        expect(b.writes.filter((x) => x.sql.includes("DELETE"))[0].params[0]).toBe("ithome");
    });

    it("does not make disabled or managed-schema persistence use the Node provider", async () => {
        const disabled = request(undefined, { enabled: false });
        await disabled.sink.append(source, sample);
        expect(disabled.writes).toEqual([]);
        const managed = request(undefined, { initialize: false });
        await managed.sink.append(source, sample);
        expect(managed.writes).toHaveLength(2);
        expect(managed.writes.every((x) => !x.sql.includes("CREATE"))).toBe(true);
    });

    it("retains one collection and one sample under the original owner even if its caller cancels", async () => {
        const collecting = deferred();
        const writing = deferred();
        const a = request(writing.promise);
        const b = request();
        const controller = new AbortController();
        const collect = vi.fn(async () => {
            await collecting.promise;
            return [{ id: 1, title: "test", url: "https://example.test/test" }];
        });
        const engine = createSourceEngine({
            resolveAdapter: (id) => ({ descriptor: { id, kind: "legacy" }, collect }),
            onSuccess: (id, _duration, _count, persistence) => persistence?.append(id, sample),
            onFailure: vi.fn(),
        });
        const first = engine.collect(source, { signal: controller.signal, healthPersistence: a.sink });
        const firstRejected = expect(first).rejects.toMatchObject({ code: "CANCELLED" });
        const second = engine.collect(source, { healthPersistence: b.sink });
        expect(a.retained).toHaveLength(1);
        expect(b.retained).toHaveLength(0);
        controller.abort();
        await firstRejected;
        collecting.resolve();
        expect(await second).toHaveLength(1);
        let settled = false;
        void Promise.all(a.retained).then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        writing.resolve();
        await Promise.all(a.retained);
        expect(collect).toHaveBeenCalledOnce();
        expect(a.writes.filter((x) => x.sql.includes("INSERT"))).toHaveLength(1);
        expect(b.writes).toEqual([]);
    });

    it("does not record cancelled collections, and persistence failure cannot fail a collection", async () => {
        const a = request();
        const b = request(undefined, { fail: true });
        const gate = deferred();
        const onFailure = vi.fn();
        const engine = createSourceEngine({
            resolveAdapter: (id) => ({
                descriptor: { id, kind: "legacy" },
                collect: async () => {
                    await gate.promise;
                    return [];
                },
            }),
            onSuccess: (id, _duration, _count, persistence) => persistence?.append(id, sample),
            onFailure,
        });
        const controller = new AbortController();
        const first = engine.collect(source, { signal: controller.signal, healthPersistence: a.sink });
        const rejected = expect(first).rejects.toMatchObject({ code: "CANCELLED" });
        controller.abort();
        gate.resolve();
        await rejected;
        await Promise.all(a.retained);
        expect(a.writes).toEqual([]);
        expect(onFailure).not.toHaveBeenCalled();
        expect(await engine.collect(source, { healthPersistence: b.sink })).toEqual([]);
        await Promise.all(b.retained);
        expect(onFailure).not.toHaveBeenCalled();
    });
});
