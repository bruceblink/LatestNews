import type { SourceHealthStatus } from "@shared/source-health-types";

import { it, expect, describe } from "vitest";

import { filterSourceHealthSnapshots } from "../shared/source-health-filter";

const sources = [
    createSource({ id: "weibo", name: "微博", status: "failing", cacheDegraded: true }),
    createSource({ id: "jin10", name: "金十数据", status: "healthy", cacheDegraded: false }),
    createSource({ id: "seebug", name: "Seebug Paper", status: "idle", cacheDegraded: false }),
];

function createSource(input: { id: string; name: string; status: SourceHealthStatus; cacheDegraded: boolean }) {
    return input;
}

describe("filterSourceHealthSnapshots", () => {
    it("filters source health snapshots by source status", () => {
        expect(filterSourceHealthSnapshots(sources, { status: "failing" }).map((source) => source.id)).toEqual([
            "weibo",
        ]);
        expect(filterSourceHealthSnapshots(sources, { status: "idle" }).map((source) => source.id)).toEqual(["seebug"]);
    });

    it("filters cache degraded sources independently from health status", () => {
        expect(filterSourceHealthSnapshots(sources, { status: "cache-degraded" }).map((source) => source.id)).toEqual([
            "weibo",
        ]);
    });

    it("filters source health snapshots by keyword", () => {
        expect(filterSourceHealthSnapshots(sources, { keyword: "paper" }).map((source) => source.id)).toEqual([
            "seebug",
        ]);
        expect(filterSourceHealthSnapshots(sources, { keyword: "jin" }).map((source) => source.id)).toEqual(["jin10"]);
    });

    it("combines keyword and status filters", () => {
        expect(
            filterSourceHealthSnapshots(sources, { keyword: "微博", status: "cache-degraded" }).map(
                (source) => source.id
            )
        ).toEqual(["weibo"]);
        expect(filterSourceHealthSnapshots(sources, { keyword: "金十", status: "cache-degraded" })).toEqual([]);
    });
});
