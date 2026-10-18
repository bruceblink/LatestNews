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
    | "SOURCE_NOT_FOUND"
    | "TARGET_UNSUPPORTED"
    | "TIMEOUT"
    | "WORKER_EXIT";

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
