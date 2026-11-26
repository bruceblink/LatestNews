import { it, expect, describe } from "vitest";

import { createFetchAdmission } from "./fetch";

describe("Pages fetch admission", () => {
    it("bounds concurrent operations by total and origin and releases only its own slot", () => {
        const admit = createFetchAdmission(3, 2);
        const releaseA = admit("a");
        const releaseB = admit("a");
        expect(() => admit("a")).toThrow(expect.objectContaining({ code: "QUEUE_FULL" }));
        const releaseC = admit("b");
        expect(() => admit("c")).toThrow(expect.objectContaining({ code: "QUEUE_FULL" }));
        releaseA();
        const releaseD = admit("a");
        releaseA();
        expect(() => admit("a")).toThrow(expect.objectContaining({ code: "QUEUE_FULL" }));
        releaseB();
        releaseC();
        releaseD();
        expect(() => admit("a")).not.toThrow();
    });

    it("recovers an abandoned slot without a cross-request timer or releasing a replacement", () => {
        let now = 0;
        const admit = createFetchAdmission(1, 1, 30_000, () => now);
        const old = admit("a");
        now = 29_999;
        expect(() => admit("b")).toThrow();
        now = 30_000;
        const replacement = admit("b");
        old();
        expect(() => admit("c")).toThrow();
        replacement();
        expect(() => admit("c")).not.toThrow();
    });
});
