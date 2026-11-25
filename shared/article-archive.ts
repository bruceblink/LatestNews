export interface ArchiveSearch {
    q?: string;
    source?: string;
    since?: string;
    event?: string;
}

export function validArchiveKey(value: unknown): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function normalizeArchiveSearch(input: Record<string, unknown>): ArchiveSearch {
    if (validArchiveKey(input.event) && !input.event.startsWith("candidate-")) return { event: input.event };
    const q = typeof input.q === "string" ? input.q.trim().slice(0, 256) : "";
    const source = typeof input.source === "string" ? input.source.trim().slice(0, 128) : "";
    const date = typeof input.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.since) ? input.since : undefined;
    const parsed = date ? new Date(date + "T00:00:00Z") : undefined;
    const since =
        parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
    return { ...(q ? { q } : {}), ...(source ? { source } : {}), ...(since ? { since } : {}) };
}

export function archiveErrorLabel(error: unknown, isEvent: boolean) {
    const candidate =
        error && typeof error === "object"
            ? (error as { status?: number; statusCode?: number; response?: { status?: number }; code?: string })
            : undefined;
    const status = candidate?.statusCode ?? candidate?.status ?? candidate?.response?.status;
    if (candidate?.code === "ARCHIVE_REMOTE_REQUIRED")
        return "历史索引仅支持已配置的远端新闻 API。桌面本地采集模式没有完整历史索引。";
    if (status === 401 || status === 403) return "当前新闻 API 拒绝访问历史索引，请检查授权。";
    if (status === 429) return "历史查询请求过于频繁，请稍后重试。";
    if (status === 404) return isEvent ? "事件不存在，或当前服务尚未提供事件详情。" : "当前服务未提供历史检索接口。";
    if (status === 503) return "历史索引暂不可用，请检查服务端缓存、索引与恢复状态。";
    if (status === 400) return "查询条件无效，请检查关键词、日期或事件标识。";
    return "无法读取远端历史索引。请检查网络与服务配置后重试。";
}
