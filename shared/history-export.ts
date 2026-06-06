export interface ReadingHistoryExportItem {
    title: string;
    url: string;
    sourceName: string;
    readAt: number;
}

export interface FormatReadingHistoryExportOptions {
    formatReadAt?: (readAt: number) => string;
}

function defaultFormatReadAt(readAt: number) {
    return new Date(readAt).toLocaleString("zh-CN", {
        hour12: false,
    });
}

export function formatReadingHistoryExport(
    items: ReadingHistoryExportItem[],
    options: FormatReadingHistoryExportOptions = {}
) {
    const formatReadAt = options.formatReadAt ?? defaultFormatReadAt;

    return items
        .map((item, index) =>
            [
                `${index + 1}. ${item.title}`,
                `来源：${item.sourceName}`,
                `阅读时间：${formatReadAt(item.readAt)}`,
                `链接：${item.url}`,
            ].join("\n")
        )
        .join("\n\n");
}
