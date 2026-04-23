const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function getTodayStart(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function getDateLabel(ts: number): string {
    const now = new Date();
    const todayStart = getTodayStart();
    const yesterdayStart = todayStart - ONE_DAY_MS;
    if (ts >= todayStart) return "今天";
    if (ts >= yesterdayStart) return "昨天";
    const d = new Date(ts);
    const yearPrefix = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}年` : "";
    return `${yearPrefix}${d.getMonth() + 1}月${d.getDate()}日`;
}
