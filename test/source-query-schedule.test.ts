import { it, expect, describe } from "vitest";

import { getSourceQuerySchedule } from "../shared/source-query-schedule";

describe("getSourceQuerySchedule", () => {
    it("uses degraded cadence when source is failing", () => {
        const schedule = getSourceQuerySchedule("v2ex", true);

        expect(schedule).toEqual({
            staleTime: 1000 * 60 * 5,
            refetchInterval: 1000 * 60 * 8,
        });
    });

    it("uses fast cadence for realtime sources", () => {
        const schedule = getSourceQuerySchedule("jin10", false);

        expect(schedule).toEqual({
            staleTime: 1000 * 60,
            refetchInterval: 1000 * 60 * 2,
        });
    });

    it("uses medium cadence for hottest sources", () => {
        const schedule = getSourceQuerySchedule("weibo", false);

        expect(schedule).toEqual({
            staleTime: 1000 * 60 * 2,
            refetchInterval: 1000 * 60 * 4,
        });
    });

    it("uses relaxed cadence for non-realtime and non-hottest sources", () => {
        const schedule = getSourceQuerySchedule("v2ex", false);

        expect(schedule).toEqual({
            staleTime: 1000 * 60 * 4,
            refetchInterval: 1000 * 60 * 6,
        });
    });
});
