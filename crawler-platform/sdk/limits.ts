/**
 * Resource limits shared by every crawler host.
 *
 * These defaults preserve the boundaries that the first process host already
 * enforced while making them part of the plugin contract. A host may apply a
 * stricter deployment limit, but it must never widen a plugin's declaration.
 */
export const defaultCrawlerPluginLimits = {
    maxExecutionMs: 15_000,
    maxRequestsPerRun: 16,
    maxRequestBodyBytes: 16 * 1024,
    maxResponseBytes: 2 * 1024 * 1024,
    maxResponseBytesPerRun: 8 * 1024 * 1024,
    maxItems: 30,
    maxOutputBytes: 256 * 1024,
} as const;

export function utf8ByteLength(value: string) {
    return new TextEncoder().encode(value).byteLength;
}
