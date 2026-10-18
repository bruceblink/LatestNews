import type { SourceResponse } from "@shared/types";
import type { SourceMetadataItem } from "@shared/source-metadata";

declare global {
    interface Window {
        latestNewsDesktop?: {
            startLogin: () => Promise<void>;
            setSyncHubApiKey: (apiKey: string) => Promise<void>;
            clearSyncHubApiKey: () => Promise<void>;
            verifySyncHub: (endpoint: string, apiKey?: string) => Promise<{ status: number; bodyText: string }>;
            requestSyncHub: (
                collection: string,
                method: string,
                body?: string
            ) => Promise<{ status: number; bodyText: string }>;
            listCrawlerSources: () => Promise<string[]>;
            listCrawlerSourceMetadata?: () => Promise<SourceMetadataItem[]>;
            fetchCrawlerSource: (sourceId: string) => Promise<SourceResponse | null>;
        };
    }
}
