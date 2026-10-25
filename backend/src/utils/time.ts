import { env } from "../config/env";

const hourFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: env.timezone });
const dateFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: env.timezone });

/** Hour of day (0-23) in the bank's timezone, independent of the server's local timezone. */
export const localHour = (date: Date): number => Number(hourFormatter.format(date)) % 24;

/** YYYY-MM-DD in the bank's timezone. */
export const localDateKey = (date: Date): string => dateFormatter.format(date);

export const localMonthKey = (date: Date): string => localDateKey(date).slice(0, 7);

/** Weekday 0 (Sunday) .. 6 in the bank's timezone. */
export const localWeekday = (date: Date): number => {
    const [y, m, d] = localDateKey(date).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Start (as a UTC instant) of the current local day. */
export const startOfLocalDay = (date: Date = new Date()): Date => {
    const key = localDateKey(date);
    // find the instant where local date key changes: start from UTC midnight of that date and adjust by the offset
    const guess = new Date(`${key}T00:00:00.000Z`);
    const localAtGuess = localDateKey(guess);
    const offsetMs = tzOffsetMs(guess);
    const start = new Date(guess.getTime() - offsetMs);
    return localDateKey(start) === key || localAtGuess === key ? start : guess;
};

const tzOffsetMs = (date: Date): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: env.timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

export const daysAgo = (days: number, from: Date = new Date()): Date => new Date(from.getTime() - days * 86400000);
