import { normalizeSyncHubEndpoint } from "../shared/synchub-contract";

export interface SyncHubCredentials {
    endpoint: string;
    apiKey: string;
}

function getEndpointOrigin(endpoint: string) {
    return new URL(normalizeSyncHubEndpoint(endpoint)).origin;
}

/** Reuse a stored key only for the SyncHub endpoint that was previously verified and saved. */
export function resolveSyncHubVerificationCredentials(
    endpoint: string,
    savedEndpoint: string | null,
    enteredApiKey: string,
    savedApiKey: string | null
): SyncHubCredentials {
    const verifiedEndpoint = getEndpointOrigin(endpoint);
    const suppliedApiKey = enteredApiKey.trim();

    if (suppliedApiKey) return { endpoint: verifiedEndpoint, apiKey: suppliedApiKey };
    if (!savedEndpoint || getEndpointOrigin(savedEndpoint) !== verifiedEndpoint) {
        throw new Error("SyncHub 地址已更改。请重新输入 API Key 并验证新地址。");
    }
    if (!savedApiKey) throw new Error("没有已保存的 SyncHub API Key。请重新输入 API Key。");

    return { endpoint: verifiedEndpoint, apiKey: savedApiKey };
}

/** Build a request target only from the main-process configuration, never renderer input. */
export function resolveSyncHubRequestCredentials(
    savedEndpoint: string | null,
    savedApiKey: string | null
): SyncHubCredentials {
    if (!savedEndpoint || !savedApiKey) {
        throw new Error("请先验证并保存 SyncHub 配置，再开始同步。");
    }
    return { endpoint: getEndpointOrigin(savedEndpoint), apiKey: savedApiKey };
}

export function isSyncHubVerificationSuccessful(status: number, bodyText: string) {
    if (status >= 200 && status < 300) return true;
    if (status !== 404) return false;

    try {
        const payload = JSON.parse(bodyText) as { code?: string | number };
        return payload.code === "NOT_FOUND";
    } catch {
        return false;
    }
}
