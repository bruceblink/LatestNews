import type { SourceResponse } from "@shared/types";
import type { SourceMetadataItem } from "@shared/source-metadata";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type { DesktopCollectionMode } from "@shared/desktop-collection-mode";

declare global {
    interface Window {
        latestNewsDesktop?: {
            getLifecycleDiagnostics: () => Promise<unknown>;
            getNewsApiUrl?: () => Promise<{ url: string; defaultUrl: string; mode: DesktopCollectionMode }>;
            setNewsApiUrl?: (url: string) => Promise<string>;
            setNewsApiSettings?: (settings: { url: string; mode: DesktopCollectionMode }) => Promise<string>;
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
            listCrawlerSources: () => Promise<string[]>;
            listCrawlerSourceMetadata?: () => Promise<SourceMetadataItem[]>;
            getCrawlerSourceHealthSummary?: () => Promise<SourceHealthSummary>;
            fetchCrawlerSource: (sourceId: string) => Promise<SourceResponse | null>;
        };
    }
}
