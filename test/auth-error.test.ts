import { it, expect, describe } from "vitest";

import { isAuthenticationError, getHttpErrorStatusCode } from "../shared/auth-error";

describe("auth error classification", () => {
    it("reads direct HTTP status fields", () => {
        expect(getHttpErrorStatusCode({ statusCode: 401 })).toBe(401);
        expect(getHttpErrorStatusCode({ status: 403 })).toBe(403);
    });

    it("reads ofetch response status fields", () => {
        expect(getHttpErrorStatusCode({ response: { status: 500 } })).toBe(500);
        expect(getHttpErrorStatusCode({ response: { _data: { statusCode: 506 } } })).toBe(506);
    });

    it("only treats 401 and 403 as authentication errors", () => {
        expect(isAuthenticationError({ statusCode: 401 })).toBe(true);
        expect(isAuthenticationError({ response: { status: 403 } })).toBe(true);
        expect(isAuthenticationError({ statusCode: 500 })).toBe(false);
        expect(isAuthenticationError({ statusCode: 506 })).toBe(false);
        expect(isAuthenticationError(new Error("network failed"))).toBe(false);
    });
});
