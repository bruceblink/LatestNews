import { ipcRenderer, contextBridge } from "electron";

contextBridge.exposeInMainWorld(
    "latestNewsDesktop",
    Object.freeze({
        startLogin: () => ipcRenderer.invoke("desktop:start-login"),
        setSyncHubApiKey: (apiKey: string) => ipcRenderer.invoke("desktop:synchub:set-api-key", apiKey),
        clearSyncHubApiKey: () => ipcRenderer.invoke("desktop:synchub:clear-api-key"),
        verifySyncHub: (endpoint: string, apiKey?: string) =>
            ipcRenderer.invoke("desktop:synchub:verify", endpoint, apiKey),
        requestSyncHub: (collection: string, method: string, body?: string) =>
            ipcRenderer.invoke("desktop:synchub:request", collection, method, body),
        listCrawlerSources: () => ipcRenderer.invoke("desktop:crawler:list-sources"),
        listCrawlerSourceMetadata: () => ipcRenderer.invoke("desktop:crawler:list-source-metadata"),
        fetchCrawlerSource: (sourceId: string) => ipcRenderer.invoke("desktop:crawler:fetch-source", sourceId),
    })
);
