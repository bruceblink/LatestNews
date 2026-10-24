import type { SourceResponseStatus } from "@shared/source-response-status";

import type { SourceQualityWatchlistEntry } from "./source-quality-watchlist";

export const SOURCE_QUALITY_SAMPLE_TIMEOUT_MS = 20_000;
export const SOURCE_QUALITY_SAMPLE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type SourceQualitySampleStatus = SourceResponseStatus | "http-error" | "invalid-response" | "error";

export interface SourceQualitySampleRecord {
    sampledAt: number;
    origin: string;
    sourceId: string;
    kind: SourceQualityWatchlistEntry["kind"];
    purpose: string;
    durationMs: number;
    httpStatus?: number;
    status: SourceQualitySampleStatus;
    itemCount: number;
    newestPublishedAt?: number;
    freshnessMs?: number;
    error?: string;
}

export interface SourceQualitySampleOptions {
    origin: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
}

/** Validate a sampling origin before any request is made. */
export function normalizeSourceQualitySampleOrigin(origin: string): string {
    const url = new URL(origin);
    if (url.username || url.password || url.search || url.hash) {
        throw new Error("Sampling origin must not contain credentials, a query, or a fragment.");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
        throw new Error("Sampling origin must use HTTPS; HTTP is allowed only for localhost.");
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}

/** Sample one watchlist source without exposing authentication headers or unbounded response reads. */
export async function sampleSourceQuality(
    source: SourceQualityWatchlistEntry,
    options: SourceQualitySampleOptions
): Promise<SourceQualitySampleRecord> {
    const now = options.now ?? Date.now;
    const startedAt = now();
    const timeoutMs = options.timeoutMs ?? SOURCE_QUALITY_SAMPLE_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? SOURCE_QUALITY_SAMPLE_MAX_RESPONSE_BYTES;
    const fetchImpl = options.fetchImpl ?? fetch;
    const origin = normalizeSourceQualitySampleOrigin(options.origin);
    const url = `${origin}/api/v1/sources/${encodeURIComponent(source.id)}/items?latest=true&limit=30`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(url, {
            headers: { accept: "application/json" },
            signal: controller.signal,
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            return createRecord(source, origin, startedAt, now(), {
                httpStatus: response.status,
                status: "http-error",
                itemCount: 0,
                error: `HTTP ${response.status}`,
            });
        }

        const body = await readJson(response, maxResponseBytes);
        const parsed = parseSourceItemsResponse(body);
        const newestPublishedAt = getNewestPublishedAt(parsed.items);
        const sampledAt = now();
        return createRecord(source, origin, startedAt, sampledAt, {
            httpStatus: response.status,
            status: parsed.status,
            itemCount: parsed.items.length,
            ...(newestPublishedAt !== undefined
                ? { newestPublishedAt, freshnessMs: Math.max(0, sampledAt - newestPublishedAt) }
                : {}),
        });
    } catch (error) {
        const message = controller.signal.aborted ? `timeout after ${timeoutMs} ms` : getErrorMessage(error);
        return createRecord(source, origin, startedAt, now(), {
            status: "error",
            itemCount: 0,
            error: message,
        });
    } finally {
        clearTimeout(timeout);
    }
}

interface ParsedSourceItemsResponse {
    status: SourceResponseStatus;
    items: readonly unknown[];
}

function createRecord(
    source: SourceQualityWatchlistEntry,
    origin: string,
    startedAt: number,
    sampledAt: number,
    result: Omit<SourceQualitySampleRecord, "sampledAt" | "origin" | "sourceId" | "kind" | "purpose" | "durationMs">
): SourceQualitySampleRecord {
    return {
        sampledAt,
        origin,
        sourceId: source.id,
        kind: source.kind,
        purpose: source.purpose,
        durationMs: Math.max(0, sampledAt - startedAt),
        ...result,
    };
}

async function readJson(response: Response, maxResponseBytes: number): Promise<unknown> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        throw new Error(`response exceeds ${maxResponseBytes} bytes`);
    }

    if (!response.body) {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
            throw new Error(`response exceeds ${maxResponseBytes} bytes`);
        }
        return JSON.parse(text);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxResponseBytes) {
                await reader.cancel();
                throw new Error(`response exceeds ${maxResponseBytes} bytes`);
            }
            chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        return JSON.parse(chunks.join(""));
    } finally {
        reader.releaseLock();
    }
}

function parseSourceItemsResponse(value: unknown): ParsedSourceItemsResponse {
    if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.items)) {
        throw new Error("invalid source items response");
    }
    const status = value.data.status;
    if (!isSourceResponseStatus(status)) {
        throw new Error("invalid source response status");
    }
    return { status, items: value.data.items };
}

function getNewestPublishedAt(items: readonly unknown[]): number | undefined {
    const timestamps = items
        .filter(isRecord)
        .map((item) => parsePublishedAt(item.pubDate))
        .filter((value): value is number => value !== undefined);
    return timestamps.length ? Math.max(...timestamps) : undefined;
}

function parsePublishedAt(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function isSourceResponseStatus(value: unknown): value is SourceResponseStatus {
    return (
        value === "success" ||
        value === "cache" ||
        value === "degraded-cache" ||
        value === "stale-cache" ||
        value === "empty"
    );
}

function isLocalhost(hostname: string) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : "unknown sampling error";
}
