export interface StoredSyncHubConfig {
    endpoint: string | null;
    apiKey: string | null;
}

export function isValidSyncHubApiKey(value: string) {
    return /^shk_[A-Za-z0-9_-]{1,512}$/.test(value);
}

/** Read the encrypted payload format and support the earlier key-only payload during migration. */
export function parseStoredSyncHubConfig(plaintext: string, validateEndpoint: (endpoint: string) => string) {
    let value: unknown;
    try {
        value = JSON.parse(plaintext);
    } catch (error) {
        if (error instanceof SyntaxError && isValidSyncHubApiKey(plaintext)) {
            return { endpoint: null, apiKey: plaintext } satisfies StoredSyncHubConfig;
        }
        throw error;
    }

    if (typeof value !== "object" || value === null) throw new Error("Saved SyncHub configuration is invalid.");
    const config = value as { version?: unknown; endpoint?: unknown; apiKey?: unknown };
    if (
        config.version !== 1 ||
        (config.endpoint !== null && typeof config.endpoint !== "string") ||
        (config.apiKey !== null && typeof config.apiKey !== "string")
    ) {
        throw new Error("Saved SyncHub configuration is invalid.");
    }

    const endpoint = typeof config.endpoint === "string" ? validateEndpoint(config.endpoint) : null;
    const apiKey = typeof config.apiKey === "string" ? config.apiKey : null;
    if (apiKey && !isValidSyncHubApiKey(apiKey)) throw new Error("Saved SyncHub configuration is invalid.");
    return { endpoint, apiKey } satisfies StoredSyncHubConfig;
}

export function serializeStoredSyncHubConfig(
    endpoint: string | null,
    apiKey: string | null,
    validateEndpoint: (endpoint: string) => string
) {
    const config = {
        version: 1,
        endpoint: endpoint ? validateEndpoint(endpoint) : null,
        apiKey,
    };
    if (apiKey && !isValidSyncHubApiKey(apiKey)) throw new Error("Invalid SyncHub API key.");
    return JSON.stringify(config);
}
