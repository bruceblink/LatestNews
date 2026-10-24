declare const __LATESTNEWS_DESKTOP_API_URL__: string;
declare const __LATESTNEWS_DESKTOP_AUTH_API_URL__: string;
declare const __LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL__: string;

interface ImportMetaEnv {
    readonly LATESTNEWS_DESKTOP: boolean;
}

interface Window {
    latestNewsDesktop?: {
        getLifecycleDiagnostics: () => Promise<unknown>;
        getNewsApiUrl?: () => Promise<{ url: string; defaultUrl: string }>;
        setNewsApiUrl?: (url: string) => Promise<string>;
        resetNewsApiUrl?: () => Promise<string>;
        startLogin: () => Promise<void>;
        setSyncHubApiKey: (apiKey: string) => Promise<void>;
        clearSyncHubApiKey: () => Promise<void>;
        verifySyncHub: (endpoint: string, apiKey?: string) => Promise<{ status: number; bodyText: string }>;
        requestSyncHub: (
            collection: string,
            method: string,
            body?: string
        ) => Promise<{ status: number; bodyText: string }>;
    };
}
