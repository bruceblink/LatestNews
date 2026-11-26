import { performance, monitorEventLoopDelay } from "node:perf_hooks";

import { slowSpans, captureSpan } from "./article-online-diagnostics";

export interface NativeStatement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
}
export interface NativeSqlite {
    prepare(sql: string): NativeStatement;
    transaction<T>(fn: () => T): { immediate(): T };
    pragma(sql: string): unknown;
}

export function distribution(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (q: number) => sorted[Math.ceil(q * sorted.length) - 1] ?? null;
    return {
        samples: sorted.length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        maxMs: sorted.at(-1) ?? null,
        meanMs: sorted.length ? sorted.reduce((sum, x) => sum + x, 0) / sorted.length : null,
    };
}

export function sqliteErrorCode(error: unknown) {
    const value = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return typeof value === "string" && /^SQLITE_[A-Z0-9_]{1,48}$/.test(value) ? value : "UNKNOWN";
}

export function isBusy(error: unknown) {
    return /^SQLITE_(?:BUSY|LOCKED)(?:_|$)/.test(sqliteErrorCode(error));
}

function phase(sql: string) {
    if (sql.includes("INSERT INTO article_fts_audit") && sql.includes("NOT (")) return "verify";
    if (sql.includes("DELETE FROM article_search WHERE rowid")) return "clear";
    if (sql.includes("INSERT INTO article_search") && sql.includes("cursor=?")) return "build";
    if (sql.includes("article_fts_pending ORDER BY")) return "pending";
    if (sql.includes("INSERT INTO cache")) return "journal";
    if (sql.includes("INSERT INTO articles")) return "article";
    if (sql.includes("DELETE FROM article_search")) return "incrementalFts";
    return "other";
}

type TransactionSample = {
    acquireMs: number;
    heldMs: number;
    wallMs: number;
    entered: boolean;
    callbackMs: number;
    tailMs: number;
    failed: boolean;
};
/** Measures actual BEGIN IMMEDIATE callback-entry delay, not inferred waits from SQL wall time.
 * Nontransactional statement execution can also wait; its busy failures are counted separately. */
export function instrumentSqlite(native: NativeSqlite) {
    const prepare = native.prepare.bind(native);
    const transaction = native.transaction.bind(native);
    const samples: Record<string, TransactionSample[]> = {};
    const slow = slowSpans();
    let current: string | undefined;
    let failedBegins = 0;
    let busyBegins = 0;
    let busyStatements = 0;
    let busyTransactionsAfterBegin = 0;
    const errorCodes: Record<string, number> = {};
    const recordError = (error: unknown) => {
        const code = sqliteErrorCode(error);
        errorCodes[code] = (errorCodes[code] ?? 0) + 1;
        return code;
    };
    native.prepare = (sql: string) => {
        if (current !== undefined) {
            const kind = phase(sql);
            if (kind !== "other") current = kind;
        }
        let statement: NativeStatement;
        const prepareDone = captureSpan("prepare:" + phase(sql));
        let prepareError: string | undefined;
        try {
            statement = prepare(sql);
        } catch (error) {
            prepareError = recordError(error);
            if (isBusy(error)) busyStatements++;
            throw error;
        } finally {
            slow.record({ ...prepareDone(), errorCode: prepareError });
        }
        return new Proxy(statement, {
            get(target, prop) {
                const value = Reflect.get(target, prop, target);
                if (typeof value !== "function") return value;
                if (!["get", "run", "all"].includes(String(prop))) return value.bind(target);
                return (...params: unknown[]) => {
                    const done = captureSpan(String(prop) + ":" + phase(sql));
                    let statementError: string | undefined;
                    try {
                        return value.apply(target, params);
                    } catch (error) {
                        statementError = recordError(error);
                        if (isBusy(error)) busyStatements++;
                        throw error;
                    } finally {
                        slow.record({ ...done(), errorCode: statementError });
                    }
                };
            },
        });
    };
    native.transaction = <T>(fn: () => T) => {
        let enteredAt: number | undefined;
        let callbackEnded: number | undefined;
        const wrapped = transaction(() => {
            enteredAt = performance.now();
            try {
                return fn();
            } finally {
                callbackEnded = performance.now();
            }
        });
        return {
            immediate() {
                const start = performance.now();
                const done = captureSpan("transaction");
                enteredAt = undefined;
                callbackEnded = undefined;
                let failed = false;
                let transactionError: string | undefined;
                current = "other";
                try {
                    return wrapped.immediate();
                } catch (error) {
                    failed = true;
                    transactionError = recordError(error);
                    if (enteredAt === undefined) {
                        failedBegins++;
                        if (isBusy(error)) busyBegins++;
                    } else if (isBusy(error)) busyTransactionsAfterBegin++;
                    throw error;
                } finally {
                    const end = performance.now();
                    const sample = {
                        acquireMs: (enteredAt ?? end) - start,
                        heldMs: enteredAt === undefined ? 0 : end - enteredAt,
                        wallMs: end - start,
                        entered: enteredAt !== undefined,
                        callbackMs: enteredAt === undefined ? 0 : (callbackEnded ?? end) - enteredAt,
                        tailMs: callbackEnded === undefined ? 0 : end - callbackEnded,
                        failed,
                    };
                    (samples[current ?? "other"] ??= []).push(sample);
                    slow.record({
                        ...done(),
                        operation: "transaction:" + (current ?? "other"),
                        acquireMs: sample.acquireMs,
                        callbackMs: sample.callbackMs,
                        tailMs: sample.tailMs,
                        errorCode: transactionError,
                    });
                    current = undefined;
                }
            },
        };
    };
    return () => ({
        slow: slow.finish(),
        errorCodes,
        failedBegins,
        busyBegins,
        busyStatements,
        busyTransactionsAfterBegin,
        phases: Object.fromEntries(
            Object.entries(samples).map(([kind, rows]) => [
                kind,
                {
                    acquire: distribution(rows.map((x) => x.acquireMs)),
                    held: distribution(rows.filter((x) => x.entered).map((x) => x.heldMs)),
                    callback: distribution(rows.filter((x) => x.entered).map((x) => x.callbackMs)),
                    commitOrRollbackTail: distribution(rows.filter((x) => x.entered).map((x) => x.tailMs)),
                    failed: rows.filter((x) => x.failed).length,
                    wall: distribution(rows.map((x) => x.wallMs)),
                },
            ])
        ),
        allAcquire: distribution(Object.values(samples).flatMap((rows) => rows.map((x) => x.acquireMs))),
    });
}

export function runtimeMetrics() {
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    let maxRssBytes = process.memoryUsage().rss;
    return {
        sample() {
            maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
        },
        finish() {
            histogram.disable();
            return {
                maxRssBytes,
                eventLoopSamples: histogram.count,
                eventLoopP95Ms: histogram.count ? histogram.percentile(95) / 1e6 : null,
                eventLoopP99Ms: histogram.count ? histogram.percentile(99) / 1e6 : null,
                eventLoopMaxMs: histogram.count ? histogram.max / 1e6 : null,
            };
        },
    };
}
