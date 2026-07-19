export const defaultSyncHubEndpoint = "https://sync.likanug.app";

export const latestNewsSyncHubCollections = ["reading-history", "favorites", "preferences"] as const;

export type LatestNewsSyncHubCollection = (typeof latestNewsSyncHubCollections)[number];

export function normalizeSyncHubEndpoint(value: string) {
    return value.trim().replace(/\/+$/, "") || defaultSyncHubEndpoint;
}

export function latestNewsSyncHubURL(endpoint: string, collection: LatestNewsSyncHubCollection) {
    return `${normalizeSyncHubEndpoint(endpoint)}/api/v1/metadata/latestnews/${collection}`;
}

export function syncHubHeaders(apiKey: string) {
    return {
        "Content-Type": "application/json",
        "X-API-Key": apiKey.trim(),
    };
}

export type SyncHubConnectionResult = { ok: true; message: string } | { ok: false; message: string };

export async function verifyLatestNewsSyncHubConnection(
    endpoint: string,
    apiKey: string,
    fetcher: typeof fetch = fetch
): Promise<SyncHubConnectionResult> {
    const normalizedKey = apiKey.trim();
    if (!normalizedKey.startsWith("shk_")) {
        return { ok: false, message: "请输入有效的 LatestNews API Key" };
    }

    try {
        const response = await fetcher(latestNewsSyncHubURL(endpoint, "favorites"), {
            headers: syncHubHeaders(normalizedKey),
        });
        const result = (await response.json()) as { code?: number | string; message?: string };
        if (response.ok || (response.status === 404 && result.code === "NOT_FOUND")) {
            return { ok: true, message: "连接成功，API Key 可用于 LatestNews 同步" };
        }
        return { ok: false, message: result.message || `连接失败（HTTP ${response.status}）` };
    } catch {
        return { ok: false, message: "无法连接 SyncHub，请检查服务地址和网络" };
    }
}
