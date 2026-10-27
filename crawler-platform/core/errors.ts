export type CrawlerErrorCode =
    | "CANCELLED"
    | "DUPLICATE_PLUGIN"
    | "HOST_NOT_READY"
    | "HTTP_FAILED"
    | "INVALID_ARTIFACT"
    | "INVALID_MANIFEST"
    | "INVALID_OUTPUT"
    | "INVALID_PLUGIN"
    | "NETWORK_PERMISSION_DENIED"
    | "QUEUE_FULL"
    | "RESOURCE_LIMIT"
    | "SOURCE_NOT_FOUND"
    | "TARGET_UNSUPPORTED"
    | "TIMEOUT"
    | "WORKER_EXIT";

const crawlerErrorCodes: ReadonlySet<string> = new Set([
    "CANCELLED",
    "DUPLICATE_PLUGIN",
    "HOST_NOT_READY",
    "HTTP_FAILED",
    "INVALID_ARTIFACT",
    "INVALID_MANIFEST",
    "INVALID_OUTPUT",
    "INVALID_PLUGIN",
    "NETWORK_PERMISSION_DENIED",
    "QUEUE_FULL",
    "RESOURCE_LIMIT",
    "SOURCE_NOT_FOUND",
    "TARGET_UNSUPPORTED",
    "TIMEOUT",
    "WORKER_EXIT",
]);

export function isCrawlerErrorCode(value: unknown): value is CrawlerErrorCode {
    return typeof value === "string" && crawlerErrorCodes.has(value);
}

export class CrawlerPlatformError extends Error {
    constructor(
        readonly code: CrawlerErrorCode,
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = "CrawlerPlatformError";
    }
}
