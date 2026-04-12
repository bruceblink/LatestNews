import { it, vi, expect, describe, afterEach, beforeEach } from "vitest";

import { tranformToUTC, parseRelativeDate } from "./date";

describe("parseRelativeDate", () => {
    const second = 1000;
    const minute = 60 * second;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;
    const now = new Date("2026-03-29T00:00:00.000Z");
    const nowTs = now.getTime();

    const weekday = (d: number) =>
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + d - (now.getUTCDay() > d ? now.getUTCDay() : now.getUTCDay() + 7)
        );

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("s秒钟前", () => {
        expect(+new Date(parseRelativeDate("10秒前"))).toBe(nowTs - 10 * second);
    });

    it("m分钟前", () => {
        expect(+new Date(parseRelativeDate("10分钟前"))).toBe(nowTs - 10 * minute);
    });

    it("m分鐘前", () => {
        expect(+new Date(parseRelativeDate("10分鐘前"))).toBe(nowTs - 10 * minute);
    });

    it("m分钟后", () => {
        expect(+new Date(parseRelativeDate("10分钟后"))).toBe(nowTs + 10 * minute);
    });

    it("a minute ago", () => {
        expect(+new Date(parseRelativeDate("a minute ago"))).toBe(nowTs - minute);
    });

    it("s minutes ago", () => {
        expect(+new Date(parseRelativeDate("10 minutes ago"))).toBe(nowTs - 10 * minute);
    });

    it("s mins ago", () => {
        expect(+new Date(parseRelativeDate("10 mins ago"))).toBe(nowTs - 10 * minute);
    });

    it("in s minutes", () => {
        expect(+new Date(parseRelativeDate("in 10 minutes"))).toBe(nowTs + 10 * minute);
    });

    it("in an hour", () => {
        expect(+new Date(parseRelativeDate("in an hour"))).toBe(nowTs + hour);
    });

    it("h小时前", () => {
        expect(+new Date(parseRelativeDate("10小时前"))).toBe(nowTs - 10 * hour);
    });

    it("h个小时前", () => {
        expect(+new Date(parseRelativeDate("10个小时前"))).toBe(nowTs - 10 * hour);
    });

    it("d天前", () => {
        expect(+new Date(parseRelativeDate("10天前"))).toBe(nowTs - 10 * day);
    });

    it("w周前", () => {
        expect(+new Date(parseRelativeDate("10周前"))).toBe(nowTs - 10 * week);
    });

    it("w星期前", () => {
        expect(+new Date(parseRelativeDate("10星期前"))).toBe(nowTs - 10 * week);
    });

    it("w个星期前", () => {
        expect(+new Date(parseRelativeDate("10个星期前"))).toBe(nowTs - 10 * week);
    });

    it("m月前", () => {
        expect(+new Date(parseRelativeDate("1月前"))).toBe(nowTs - month);
    });

    it("m个月前", () => {
        expect(+new Date(parseRelativeDate("1个月前"))).toBe(nowTs - month);
    });

    it("y年前", () => {
        expect(+new Date(parseRelativeDate("1年前"))).toBe(nowTs - year);
    });

    it("y年M个月前", () => {
        expect(+new Date(parseRelativeDate("1年1个月前"))).toBe(nowTs - year - month);
    });

    it("d天H小时前", () => {
        expect(+new Date(parseRelativeDate("1天1小时前"))).toBe(nowTs - day - hour);
    });

    it("h小时m分钟s秒钟前", () => {
        expect(+new Date(parseRelativeDate("1小时1分钟1秒钟前"))).toBe(nowTs - hour - minute - second);
    });

    it("dd Hh mm ss ago", () => {
        expect(+new Date(parseRelativeDate("1d 1h 1m 1s ago"))).toBe(nowTs - day - hour - minute - second);
    });

    it("h小时m分钟s秒钟后", () => {
        expect(+new Date(parseRelativeDate("1小时1分钟1秒钟后"))).toBe(nowTs + hour + minute + second);
    });

    it("今天", () => {
        expect(+new Date(parseRelativeDate("今天"))).toBe(nowTs);
    });

    it("today H:m", () => {
        expect(+new Date(parseRelativeDate("Today 08:00"))).toBe(nowTs + 8 * hour);
    });

    it("today, h:m a", () => {
        expect(+new Date(parseRelativeDate("Today, 8:00 pm"))).toBe(nowTs + 20 * hour);
    });

    it("tDA H:m:s", () => {
        expect(+new Date(parseRelativeDate("TDA 08:00:00"))).toBe(nowTs + 8 * hour);
    });

    it("今天 H:m", () => {
        expect(+new Date(parseRelativeDate("今天 08:00"))).toBe(nowTs + 8 * hour);
    });

    it("今天H点m分", () => {
        expect(+new Date(parseRelativeDate("今天8点0分"))).toBe(nowTs + 8 * hour);
    });

    it("昨日H点m分s秒", () => {
        expect(+new Date(parseRelativeDate("昨日20时0分0秒"))).toBe(nowTs - 4 * hour);
    });

    it("前天 H:m", () => {
        expect(+new Date(parseRelativeDate("前天 20:00"))).toBe(nowTs - day - 4 * hour);
    });

    it("明天 H:m", () => {
        expect(+new Date(parseRelativeDate("明天 20:00"))).toBe(nowTs + day + 20 * hour);
    });

    it("星期几 h:m", () => {
        expect(+new Date(parseRelativeDate("星期一 8:00"))).toBe(weekday(1) + 8 * hour);
    });

    it("周几 h:m", () => {
        expect(+new Date(parseRelativeDate("周二 8:00"))).toBe(weekday(2) + 8 * hour);
    });

    it("星期天 h:m", () => {
        expect(+new Date(parseRelativeDate("星期天 8:00"))).toBe(weekday(7) + 8 * hour);
    });

    it("invalid", () => {
        expect(parseRelativeDate("RSSHub")).toBe("RSSHub");
    });
});

describe("transform Beijing time to UTC in different timezone", () => {
    const a = "2024/10/3 12:26:16";
    const b = 1727929576000;
    it("in UTC", () => {
        const date = tranformToUTC(a);
        expect(date).toBe(b);
    });

    it("in Beijing", () => {
        const date = tranformToUTC(a);
        expect(date).toBe(b);
    });

    it("in New York", () => {
        const date = tranformToUTC(a);
        expect(date).toBe(b);
    });
});
