import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export const SLOW_MS = 250;
const MAX_EVENTS = 128;
export interface DiagnosticSpan {
    startedAt: number;
    wallMs: number;
    cpuMs: number;
    operation: string;
    acquireMs?: number;
    callbackMs?: number;
    tailMs?: number;
    errorCode?: string;
}
export function captureSpan(operation: string) {
    const startedAt = Date.now();
    const start = performance.now();
    const cpu = process.cpuUsage();
    return (): DiagnosticSpan => {
        const usage = process.cpuUsage(cpu);
        return { startedAt, wallMs: performance.now() - start, cpuMs: (usage.user + usage.system) / 1000, operation };
    };
}
export function slowSpans() {
    let count = 0;
    const longest: DiagnosticSpan[] = [];
    return {
        record(span: DiagnosticSpan) {
            if (span.wallMs < SLOW_MS && !span.errorCode) return;
            count++;
            longest.push(span);
            longest.sort((a, b) => b.wallMs - a.wallMs);
            if (longest.length > MAX_EVENTS) longest.pop();
        },
        finish() {
            return { count, longest };
        },
    };
}

/** Linux-specific pressure totals. Missing permissions or platforms are unknown,
 * not zero. These are cumulative system counters, not a per-process cause. */
export function parsePressure(text: string) {
    const result: Record<string, number> = {};
    for (const line of text.split("\n")) {
        const match = /^(some|full) .*\btotal=(\d+)$/.exec(line.trim());
        if (match) result[match[1]] = Number(match[2]);
    }
    return result;
}
function readOptional(path: string) {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return undefined;
    }
}
export function hostPressure() {
    const values: Record<string, number> = {};
    for (const scope of ["/proc/pressure", "/sys/fs/cgroup"]) {
        for (const kind of ["cpu", "io", "memory"]) {
            const path = scope === "/proc/pressure" ? scope + "/" + kind : scope + "/" + kind + ".pressure";
            const raw = readOptional(path);
            if (raw)
                for (const [state, total] of Object.entries(parsePressure(raw)))
                    values[(scope === "/proc/pressure" ? "host" : "cgroup") + "." + kind + "." + state] = total;
        }
    }
    const stat = readOptional("/proc/stat")?.split("\n")[0]?.trim().split(/\s+/);
    if (stat?.[0] === "cpu" && stat.length >= 9) {
        values["host.cpu.iowaitTicks"] = Number(stat[5]);
        values["host.cpu.stealTicks"] = Number(stat[8]);
    }
    return values;
}
export interface PressureSample {
    startedAt: number;
    wallMs: number;
    cpuMs: number;
    lateMs: number;
    pressure: Record<string, number>;
}
/** No DB access. An independent process samples wall/CPU timing and kernel
 * pressure; aggregate PSI can corroborate a stall but cannot prove causality. */
export async function runHostProbe(startAt: number, endAt: number) {
    const samples: PressureSample[] = [];
    if (startAt > Date.now()) await delay(startAt - Date.now());
    let previous = hostPressure();
    let next = Date.now() + 250;
    while (Date.now() < endAt) {
        const finish = captureSpan("host-heartbeat");
        await delay(Math.max(0, next - Date.now()));
        const span = finish();
        const lateMs = Math.max(0, Date.now() - next);
        const current = hostPressure();
        const pressure = Object.fromEntries(
            Object.entries(current).flatMap(([key, value]) =>
                previous[key] !== undefined && value >= previous[key] ? [[key, value - previous[key]]] : []
            )
        );
        samples.push({ startedAt: span.startedAt, wallMs: span.wallMs, cpuMs: span.cpuMs, lateMs, pressure });
        previous = current;
        next = Date.now() + 250;
    }
    return samples;
}
