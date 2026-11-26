import { createError } from "h3";
import { it, expect, describe } from "vitest";

import { CrawlerPlatformError } from "../crawler-platform/core/errors";
import { publicSourceHttpError } from "../server/utils/public-source-error";
import { describeSourceError, safeSourceErrorMessage } from "../shared/source-error";

const secret = "AUDIT_SYNTHETIC_NOT_A_SECRET";
const raw = `https://example.test/?token=${secret} Authorization: Bearer ${secret} /private/path\r\n`;

describe("N3-G1 public source errors", () => {
    it.each([
        new Error(raw, { cause: new Error(secret) }),
        raw,
        { message: raw, stack: raw, cause: { token: secret }, code: secret },
        {
            toString() {
                throw new Error(secret);
            },
        },
        new Proxy(
            {},
            {
                get() {
                    throw new Error(secret);
                },
            }
        ),
        secret.repeat(10000),
        undefined,
    ])("does not stringify arbitrary errors or expose secrets", (error) => {
        const safe = describeSourceError(error);
        expect(safe).toEqual({ code: "UNKNOWN", message: "Source collection failed." });
        expect(JSON.stringify(safe)).not.toContain(secret);
        expect(safe.message.length).toBeLessThanOrEqual(64);
    });

    it("keeps known categories and reconstructs numeric HTTP status", () => {
        expect(describeSourceError(new CrawlerPlatformError("TIMEOUT", raw))).toEqual({
            code: "TIMEOUT",
            message: "Source collection timed out.",
        });
        expect(describeSourceError({ code: "BATCH_TIMEOUT", message: raw }).code).toBe("TIMEOUT");
        expect(describeSourceError({ code: "RESPONSE_TOO_LARGE", message: raw }).code).toBe("RESOURCE_LIMIT");
        expect(describeSourceError({ statusCode: 503, message: raw })).toEqual({
            code: "HTTP_FAILED",
            message: "HTTP 503",
        });
        expect(describeSourceError({ statusCode: "503" + secret, message: raw }).code).toBe("UNKNOWN");
        expect(safeSourceErrorMessage("HTTP 500")).toBe("HTTP 500");
        expect(safeSourceErrorMessage("HTTP 500 " + secret)).toBe("Source collection failed.");
        for (const code of ["QUEUE_FULL", "NETWORK_PERMISSION_DENIED", "INVALID_OUTPUT", "CANCELLED"] as const) {
            const failure = describeSourceError(new CrawlerPlatformError(code, raw));
            expect(failure.code).toBe(code);
            expect(safeSourceErrorMessage(failure.message)).toBe(failure.message);
        }
    });

    it("creates fresh HTTP errors preserving authored validation and status without forwarding fields", () => {
        const err = createError({
            statusCode: 400,
            message: "Invalid source id",
            data: { secret },
            headers: { "x-test": secret },
        });
        const sanitized = publicSourceHttpError(err);
        expect(sanitized).not.toBe(err);
        expect(sanitized.statusCode).toBe(400);
        expect(sanitized.message).toBe("Invalid source id");
        expect(sanitized.data).toBeUndefined();
        expect(JSON.stringify(sanitized)).not.toContain(secret);
        const upstream = publicSourceHttpError(createError({ statusCode: 503, message: raw, data: { secret } }));
        expect(upstream.statusCode).toBe(503);
        expect(upstream.message).toBe("Request failed.");
        expect(JSON.stringify(upstream)).not.toContain(secret);
        expect(publicSourceHttpError(new Error(raw)).statusCode).toBe(500);
    });
});
