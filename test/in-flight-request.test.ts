import { it, vi, expect, describe } from "vitest";

import { getOrCreateInFlightRequest } from "../shared/in-flight-request";

describe("in-flight request helper", () => {
    it("reuses the same promise until the request settles", async () => {
        const requests = new Map<string, Promise<string>>();
        const createRequest = vi.fn(async () => "ok");

        const first = getOrCreateInFlightRequest(requests, "same-key", createRequest);
        const second = getOrCreateInFlightRequest(requests, "same-key", createRequest);

        expect(second).toBe(first);
        await expect(first).resolves.toBe("ok");
        expect(createRequest).toHaveBeenCalledTimes(1);
        expect(requests.has("same-key")).toBe(false);
    });
});
