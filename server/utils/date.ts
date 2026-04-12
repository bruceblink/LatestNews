import dayjs from "dayjs/esm";
import utcPlugin from "dayjs/esm/plugin/utc";
import weekday from "dayjs/esm/plugin/weekday";
import duration from "dayjs/esm/plugin/duration";
import timezonePlugin from "dayjs/esm/plugin/timezone";
import isSameOrBefore from "dayjs/esm/plugin/isSameOrBefore";
import customParseFormat from "dayjs/esm/plugin/customParseFormat";

import { toDurations, createRelativeWordRules, normalizeRelativeDateInput } from "./date-rules";

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);
dayjs.extend(customParseFormat);
dayjs.extend(duration);
dayjs.extend(isSameOrBefore);
dayjs.extend(weekday);

/**
 * 传入任意时区的时间（不携带时区），转换为 UTC 时间
 */
export function tranformToUTC(date: string, format?: string, timezone: string = "Asia/Shanghai"): number {
    if (!format) return dayjs.tz(date, timezone).valueOf();
    return dayjs.tz(date, format, timezone).valueOf();
}

export const parseDate = (date: string | number, ...options: any) => dayjs(date, ...options).toDate();

export function parseRelativeDate(date: string, timezone: string = "UTC") {
    if (date === "刚刚") return new Date();
    // 预处理日期字符串 date

    const theDate = normalizeRelativeDateInput(date);
    const now = dayjs().tz(timezone);

    // 将 `\d+年\d+月...\d+秒前` 分割成 `['\d+年', ..., '\d+秒前']`

    const matches = theDate.match(/\D*\d+(?![:\-/]|(a|p)m)\D+/g);

    if (matches) {
        // 获得最后的时间单元，如 `\d+秒前`

        const lastMatch = matches.pop();

        if (lastMatch) {
            // 若最后的时间单元含有 `前`、`以前`、`之前` 等标识字段，减去相应的时间长度
            // 如 `1分10秒前`

            const beforeMatches = /(.*)(?:前|ago)$/.exec(lastMatch);
            if (beforeMatches) {
                matches.push(beforeMatches[1]);
                // duration 这个插件有 bug，他会重新实现 subtract 这个方法，并且不会处理 weeks。用 ms 就可以调用默认的方法
                return now.subtract(dayjs.duration(toDurations(matches))).toDate();
            }

            // 若最后的时间单元含有 `后`、`以后`、`之后` 等标识字段，加上相应的时间长度
            // 如 `1分10秒后`

            const afterMatches = /(?:^in(.*)|(.*)[后後])$/.exec(lastMatch);
            if (afterMatches) {
                matches.push(afterMatches[1] ?? afterMatches[2]);
                return now.add(dayjs.duration(toDurations(matches))).toDate();
            }

            // 以下处理日期字符串 date 含有特殊词的情形
            // 如 `今天1点10分`

            matches.push(lastMatch);
        }
        const firstMatch = matches.shift();

        if (firstMatch) {
            for (const w of createRelativeWordRules(now)) {
                const wordMatches = w.regExp.exec(firstMatch);
                if (wordMatches) {
                    matches.unshift(wordMatches[1]);

                    // 取特殊词对应日零时为起点，加上相应的时间长度

                    return w.startAt
                        .set("hour", 0)
                        .set("minute", 0)
                        .set("second", 0)
                        .set("millisecond", 0)
                        .add(dayjs.duration(toDurations(matches)))
                        .toDate();
                }
            }
        }
    } else {
        // 若日期字符串 date 不匹配 patterns 中所有模式，则默认为 `特殊词 + 标准时间格式` 的情形，此时直接将特殊词替换为对应日期
        // 如今天为 `2022-03-22`，则 `今天 20:00` => `2022-03-22 20:00`

        for (const w of createRelativeWordRules(now)) {
            const wordMatches = w.regExp.exec(theDate);
            if (wordMatches) {
                // The default parser of dayjs() can parse '8:00 pm' but not '8:00pm'
                // so we need to insert a space in between
                const normalizedTime = /a|pm$/.test(wordMatches[1])
                    ? wordMatches[1].replace(/a|pm/, " $&")
                    : wordMatches[1];
                const dateTime = `${w.startAt.format("YYYY-MM-DD")} ${normalizedTime}`;

                // Use explicit format for am/pm inputs to keep behavior consistent across environments.
                if (/\b(?:am|pm)\b/.test(normalizedTime)) {
                    return dayjs.tz(dateTime, "YYYY-MM-DD h:mm a", timezone).toDate();
                }

                return dayjs.tz(dateTime, timezone).toDate();
            }
        }
    }

    return date;
}
