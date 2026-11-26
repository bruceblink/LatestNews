import { HTTPError, createError } from "h3";
import { describeSourceError } from "@shared/source-error";

import { logger } from "./logger";

// Only errors authored by these routes may retain their validation messages.
// Never forward the original HTTPError (its cause, body, data and headers may
// contain remote content).
const routeMessages = new Map([
    ["Invalid source id", 400],
    ["Invalid source items query", 400],
    ["Invalid source batch payload", 400],
    ["Invalid insights payload", 400],
    ["At least one source selector is required", 400],
    ["Too many sources selected", 400],
    ["Invalid JSON feed query", 400],
    ["Invalid RSS feed query", 400],
    ["Invalid source health query", 400],
    ["Invalid source health diagnostics query", 400],
    ["Source collection timed out.", 504],
]);

export function publicSourceHttpError(error: unknown) {
    let statusCode = 500;
    try {
        // Preserve explicit HTTP statuses without rethrowing an untrusted object.
        if (error && typeof error === "object" && "statusCode" in error) {
            const status = error.statusCode;
            if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599)
                statusCode = status;
        }
        if (error instanceof HTTPError) {
            const message = error.message;
            if (routeMessages.get(message) === statusCode) return createError({ statusCode, message });
        }
    } catch {
        // A malformed exception must not bypass the safe response.
        statusCode = 500;
    }
    const safe = describeSourceError(error);
    logger.error("News API operation failed.", safe);
    return createError({ statusCode, message: statusCode === 500 ? "Internal Server Error" : "Request failed." });
}
