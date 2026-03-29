import type { Dayjs } from "dayjs/esm";

const patterns = [
    {
        unit: "years",
        regExp: /(\d+)(?:年|y(?:ea)?rs?)/,
    },
    {
        unit: "months",
        regExp: /(\d+)(?:[个個]?月|months?)/,
    },
    {
        unit: "weeks",
        regExp: /(\d+)(?:周|[个個]?星期|weeks?)/,
    },
    {
        unit: "days",
        regExp: /(\d+)(?:天|日|d(?:ay)?s?)/,
    },
    {
        unit: "hours",
        regExp: /(\d+)(?:[个個]?(?:小?时|[時点點])|h(?:(?:ou)?r)?s?)/,
    },
    {
        unit: "minutes",
        regExp: /(\d+)(?:分[鐘钟]?|m(?:in(?:ute)?)?s?)/,
    },
    {
        unit: "seconds",
        regExp: /(\d+)(?:秒[鐘钟]?|s(?:ec(?:ond)?)?s?)/,
    },
] as const;

const patternSize = patterns.length;

export function createRelativeWordRules(now: Dayjs) {
    return [
        {
            startAt: now,
            regExp: /^(?:今[天日]|to?day?)(.*)/,
        },
        {
            startAt: now.subtract(1, "days"),
            regExp: /^(?:昨[天日]|y(?:ester)?day?)(.*)/,
        },
        {
            startAt: now.subtract(2, "days"),
            regExp: /^(?:前天|(?:the)?d(?:ay)?b(?:eforeyesterda)?y)(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(1)) ? now.weekday(1).subtract(1, "week") : now.weekday(1),
            regExp: /^(?:周|星期)一(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(2)) ? now.weekday(2).subtract(1, "week") : now.weekday(2),
            regExp: /^(?:周|星期)二(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(3)) ? now.weekday(3).subtract(1, "week") : now.weekday(3),
            regExp: /^(?:周|星期)三(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(4)) ? now.weekday(4).subtract(1, "week") : now.weekday(4),
            regExp: /^(?:周|星期)四(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(5)) ? now.weekday(5).subtract(1, "week") : now.weekday(5),
            regExp: /^(?:周|星期)五(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(6)) ? now.weekday(6).subtract(1, "week") : now.weekday(6),
            regExp: /^(?:周|星期)六(.*)/,
        },
        {
            startAt: now.isSameOrBefore(now.weekday(7)) ? now.weekday(7).subtract(1, "week") : now.weekday(7),
            regExp: /^(?:周|星期)[天日](.*)/,
        },
        {
            startAt: now.add(1, "days"),
            regExp: /^(?:明[天日]|y(?:ester)?day?)(.*)/,
        },
        {
            startAt: now.add(2, "days"),
            regExp: /^(?:[后後][天日]|(?:the)?d(?:ay)?a(?:fter)?t(?:omrrow)?)(.*)/,
        },
    ];
}

export function normalizeRelativeDateInput(date: string) {
    return date
        .toLowerCase()
        .replace(/(^an?\s)|(\san?\s)/g, "1")
        .replace(/几|幾/g, "3")
        .replace(/[\s,]/g, "");
}

export function toDurations(matches: string[]) {
    const durations: Record<string, string> = {};

    let p = 0;
    for (const matchValue of matches) {
        for (; p < patternSize; p++) {
            const match = patterns[p].regExp.exec(matchValue);
            if (match) {
                durations[patterns[p].unit] = match[1];
                break;
            }
        }
    }

    return durations;
}
