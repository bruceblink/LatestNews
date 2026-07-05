import { it, expect, describe } from "vitest";

import { isPublicApiPath } from "../shared/public-api-path";

describe("public API path policy", () => {
    it("allows read-only source endpoints when login is disabled", () => {
        expect(isPublicApiPath("/api/s")).toBe(true);
        expect(isPublicApiPath("/api/s/entire")).toBe(true);
        expect(isPublicApiPath("/api/v1/sources")).toBe(true);
    });

    it("keeps user sync endpoints private", () => {
        expect(isPublicApiPath("/api/me")).toBe(false);
        expect(isPublicApiPath("/api/sync/me")).toBe(false);
    });
});
