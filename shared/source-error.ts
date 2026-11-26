/** Public collection/health errors: only locally authored text, never exception details. */
const messages = {
    UNKNOWN: "Source collection failed.",
    TIMEOUT: "Source collection timed out.",
    CANCELLED: "Source collection cancelled.",
    QUEUE_FULL: "Source collection queue is full.",
    HTTP_FAILED: "Upstream HTTP request failed.",
    INVALID_OUTPUT: "Source returned invalid data.",
    NETWORK_PERMISSION_DENIED: "Source network request was denied.",
    RESOURCE_LIMIT: "Source resource limit exceeded.",
    HOST_NOT_READY: "Source host is unavailable.",
    SOURCE_NOT_FOUND: "Source is unavailable.",
    INVALID_PLUGIN: "Source plugin is invalid.",
    WORKER_EXIT: "Source worker exited unexpectedly.",
} as const;

export type PublicSourceErrorCode = keyof typeof messages;
export interface PublicSourceError {
    code: PublicSourceErrorCode;
    message: string;
}

function getField(value: unknown, key: string): unknown {
    // Exceptions can be arbitrary objects, including throwing getters or proxies.
    try {
        return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
    } catch {
        return undefined;
    }
}

function isKnownCode(value: unknown): value is PublicSourceErrorCode {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(messages, value);
}

function httpStatus(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

function fixedError(code: PublicSourceErrorCode): PublicSourceError {
    return { code, message: messages[code] };
}

/** Does not stringify errors, causes, URLs, headers, response bodies, or stacks.
 * A legacy stored message is recognized only if it exactly matches a known
 * constant or a bounded HTTP status. Unknown values are deliberately discarded. */
export function describeSourceError(error: unknown): PublicSourceError {
    const code = getField(error, "code");
    const status = httpStatus(getField(error, "statusCode")) ?? httpStatus(getField(error, "status"));
    if (status !== undefined) return { code: "HTTP_FAILED", message: "HTTP " + status };
    if (code === "BATCH_TIMEOUT" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT")
        return fixedError("TIMEOUT");
    if (code === "RESPONSE_TOO_LARGE") return fixedError("RESOURCE_LIMIT");
    const name = getField(error, "name");
    if (name === "AbortError") return fixedError("CANCELLED");
    if (name === "TimeoutError") return fixedError("TIMEOUT");

    const text = typeof error === "string" ? error : getField(error, "message");
    // Numeric-only HTTP status is safe; the entire string must match.
    if (typeof text === "string" && text.length <= 64) {
        const match = /^HTTP ([45][0-9]{2})$/.exec(text);
        if (match) return { code: "HTTP_FAILED", message: "HTTP " + Number(match[1]) };
    }
    if (isKnownCode(code)) return fixedError(code);
    if (typeof text === "string" && text.length <= 64) {
        for (const key of Object.keys(messages) as PublicSourceErrorCode[]) {
            if (text === messages[key]) return fixedError(key);
        }
        if (text === "timeout") return fixedError("TIMEOUT");
    }
    return fixedError("UNKNOWN");
}

/** Re-project old persisted or remote health error fields at the public boundary. */
export function safeSourceErrorMessage(message: unknown): string {
    return describeSourceError(message).message;
}
