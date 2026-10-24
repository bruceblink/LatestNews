import { z } from "zod";

import { normalizeSourceQualitySampleOrigin } from "./source-quality-sampling";

import type { SourceQualitySampleRecord } from "./source-quality-sampling";

const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const duration = z.number().finite().nonnegative();
const samplingRunSchema = z.object({
    id: z.uuid(),
    startedAt: timestamp,
    commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64}|unknown)$/),
    workingTreeDirty: z.boolean(),
    nodeVersion: z.string().regex(/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
    intervalMs: z.number().int().nonnegative(),
    timeoutMs: z.number().int().positive(),
});
const sampleRecordSchema = z
    .object({
        sampledAt: timestamp,
        origin: z.string().refine(isNormalizedOrigin),
        sourceId: z.string().min(1),
        kind: z.enum(["rss", "json", "html"]),
        purpose: z.string(),
        durationMs: duration,
        httpStatus: z.number().int().min(100).max(599).optional(),
        status: z.enum([
            "success",
            "cache",
            "degraded-cache",
            "stale-cache",
            "empty",
            "http-error",
            "invalid-response",
            "error",
        ]),
        itemCount: z.number().int().nonnegative(),
        newestPublishedAt: timestamp.optional(),
        freshnessMs: duration.optional(),
        error: z.string().optional(),
        run: samplingRunSchema.optional(),
        round: z.number().int().positive().optional(),
    })
    .refine((record) => (record.run === undefined) === (record.round === undefined));

/** Validate every JSONL line, including legacy records, without echoing potentially sensitive payloads. */
export function parseSourceQualitySampleRecords(content: string): SourceQualitySampleRecord[] {
    const records: SourceQualitySampleRecord[] = [];
    const runs = new Map<string, string>();
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch {
            throw new Error(`Invalid JSON on line ${index + 1} of the sample file.`);
        }
        const parsed = sampleRecordSchema.safeParse(value);
        if (!parsed.success) throw new Error(`Invalid source quality sample on line ${index + 1}.`);
        const record = parsed.data;
        if (record.run) {
            const serialized = JSON.stringify(record.run);
            const previous = runs.get(record.run.id);
            if (previous && previous !== serialized) {
                throw new Error(`Conflicting sampling run on line ${index + 1}.`);
            }
            runs.set(record.run.id, serialized);
        }
        records.push(record);
    }
    return records;
}

function isNormalizedOrigin(value: string) {
    try {
        return normalizeSourceQualitySampleOrigin(value) === value;
    } catch {
        return false;
    }
}
