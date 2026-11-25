import type { Primitive, Statement, PreparedStatement } from "db0";

import { createDatabase } from "db0";

/** Capture the actual binding from the current request, never a mutable global. */
interface BoundD1Statement {
    bind(...params: Primitive[]): BoundD1Statement;
    all(): Promise<{ results: unknown[] }>;
    first(): Promise<unknown>;
    run(): Promise<{ success: boolean }>;
}

interface D1Binding {
    prepare(sql: string): BoundD1Statement;
    exec(sql: string): Promise<unknown>;
    batch(statements: BoundD1Statement[]): Promise<Array<{ success: boolean; results?: unknown[] }>>;
}

function wrapBound(statement: BoundD1Statement): PreparedStatement {
    return {
        bind: (...params) => wrapBound(statement.bind(...params)),
        all: async () => (await statement.all()).results,
        get: () => statement.first(),
        run: () => statement.run(),
    };
}

export function createRequestD1Database(value: unknown) {
    if (
        !value ||
        typeof value !== "object" ||
        !("prepare" in value) ||
        typeof value.prepare !== "function" ||
        !("batch" in value) ||
        typeof value.batch !== "function" ||
        !("exec" in value) ||
        typeof value.exec !== "function"
    ) {
        throw new Error("LATESTNEWS_DB binding is unavailable.");
    }
    const binding = value as D1Binding;
    return createDatabase({
        name: "cloudflare-d1",
        dialect: "sqlite",
        capabilityOverrides: { transactions: false },
        getInstance: () => binding,
        exec: (sql) => binding.exec(sql),
        prepare(sql): Statement {
            const bind = (...params: Primitive[]) => wrapBound(binding.prepare(sql).bind(...params));
            return {
                bind,
                all: (...params) => bind(...params).all(),
                get: (...params) => bind(...params).get(),
                run: (...params) => bind(...params).run(),
            };
        },
    });
}
