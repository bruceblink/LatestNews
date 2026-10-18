import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import {
    app,
    net,
    Menu,
    shell,
    ipcMain,
    session,
    protocol,
    safeStorage,
    BrowserWindow,
    type WebContents,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
} from "electron";

import { createElectronCrawlerPluginRuntime } from "./crawler-plugin-provider";
import { getSafeExternalUrl, resolveRendererFile, isTrustedRendererUrl } from "./security";
import { isValidSyncHubApiKey, parseStoredSyncHubConfig, serializeStoredSyncHubConfig } from "./synchub-storage";
import {
    normalizeServiceUrl,
    createUpstreamHeaders,
    resolveApiProxyTarget,
    rewriteApiRedirectLocation,
} from "./api-proxy";
import {
    isSyncHubVerificationSuccessful,
    resolveSyncHubRequestCredentials,
    resolveSyncHubVerificationCredentials,
} from "./synchub-policy";
import {
    syncHubHeaders,
    latestNewsSyncHubURL,
    defaultSyncHubEndpoint,
    normalizeSyncHubEndpoint,
    latestNewsSyncHubCollections,
    type LatestNewsSyncHubCollection,
} from "../shared/synchub-contract";

import type { SourceID } from "../shared/types";
import type { ElectronCrawlerPluginRuntime } from "./crawler-plugin-provider";

const APP_BASE_URL = "app://bundle/";
const MAX_API_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_API_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_SYNC_HUB_BODY_BYTES = 2 * 1024 * 1024;
const MAX_SYNC_HUB_RESPONSE_BYTES = 8 * 1024 * 1024;
const SYNC_HUB_CONFIG_FILE = "synchub-config.enc";
const LEGACY_SYNC_HUB_KEY_FILE = "synchub-api-key.enc";
const API_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SYNC_HUB_METHODS = new Set(["GET", "PUT"]);
const SYNC_HUB_COLLECTIONS = new Set<string>(latestNewsSyncHubCollections);

protocol.registerSchemesAsPrivileged([
    {
        scheme: "app",
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);

const newsApiUrl = normalizeServiceUrl(__LATESTNEWS_DESKTOP_API_URL__, { allowLocalHttp: true });
const authApiUrl = normalizeServiceUrl(__LATESTNEWS_DESKTOP_AUTH_API_URL__, { allowLocalHttp: true });
const authCallbackUrl = new URL(__LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL__);

if (authCallbackUrl.protocol !== "https:" || authCallbackUrl.username || authCallbackUrl.password) {
    throw new Error("The desktop authentication callback must use an HTTPS URL without credentials.");
}

const apiTargets = { news: newsApiUrl, auth: authApiUrl };
const securityHeaders = new Headers({
    "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' app:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https:",
        "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;
let rendererDevUrl: URL | null = null;
let trustedRendererUrl = APP_BASE_URL;

// Prevent Electron from creating its default File, Edit, View, and Window menu.
Menu.setApplicationMenu(null);

function getAppResourceRoot() {
    return app.isPackaged ? app.getAppPath() : resolve(app.getAppPath(), "out");
}

// Keep the native window icon outside app.asar so the operating system can load it as a file.
function getWindowIconPath() {
    const resourceRoot = app.isPackaged ? process.resourcesPath : getAppResourceRoot();
    return resolve(resourceRoot, process.platform === "win32" ? "icon.ico" : "icon.png");
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady()
        .then(async () => {
            app.setAppUserModelId("top.likanug.latestnews");
            rendererDevUrl = getDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL);
            trustedRendererUrl = rendererDevUrl?.origin ?? APP_BASE_URL;
            installProtocol();
            installPermissionPolicy();
            const crawlerRuntime = await createElectronCrawlerPluginRuntime();
            installDesktopIpc(crawlerRuntime);
            await createMainWindow();

            app.on("activate", () => {
                if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
            });
        })
        .catch((error: unknown) => {
            console.error("LatestNews Desktop could not start.", error);
            app.quit();
        });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}

function getDevelopmentRendererUrl(candidate?: string) {
    if (app.isPackaged || !candidate) return null;
    try {
        const url = new URL(candidate);
        if (
            url.protocol !== "http:" ||
            !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
            url.username !== "" ||
            url.password !== ""
        ) {
            return null;
        }
        return new URL(`${url.origin}/`);
    } catch {
        return null;
    }
}

function responseWithSecurityHeaders(body: BodyInit | null, status: number, headers = new Headers()) {
    for (const [name, value] of securityHeaders) headers.set(name, value);
    return new Response(body, { status, headers });
}

function getDevCorsHeaders(request: Request) {
    if (!rendererDevUrl) return new Headers();
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin !== rendererDevUrl.origin) return null;

    const allowedHeaders = new Set(["accept", "authorization", "content-type", "if-none-match", "if-modified-since"]);
    const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
    if (requestedHeaders.some((header) => !allowedHeaders.has(header))) return null;

    return new Headers({
        "Access-Control-Allow-Origin": rendererDevUrl.origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": [...allowedHeaders].join(", "),
        Vary: "Origin",
    });
}

async function readBoundedBody(request: Request, maximumBytes: number) {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw new Error("Request body is too large.");
    if (!request.body) return null;

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maximumBytes) {
                await reader.cancel();
                throw new Error("Request body is too large.");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function limitResponseBody(body: ReadableStream<Uint8Array> | null, maximumBytes: number) {
    if (!body) return null;
    let totalBytes = 0;
    return body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                totalBytes += chunk.byteLength;
                if (totalBytes > maximumBytes) {
                    controller.error(new Error("Response body is too large."));
                    return;
                }
                controller.enqueue(chunk);
            },
        })
    );
}

function getAppRequestPath(url: URL) {
    if (url.pathname === "/" || url.pathname === "/index.html") return "/index.html";
    return url.pathname;
}

async function handleAppRequest(request: Request) {
    if (resolveApiProxyTarget(request.url, apiTargets)) {
        return proxyApiRequest(request);
    }
    if (request.method === "OPTIONS") return responseWithSecurityHeaders("Not found", 404);

    if (request.method !== "GET" && request.method !== "HEAD") {
        return responseWithSecurityHeaders("Method not allowed", 405, new Headers({ Allow: "GET, HEAD" }));
    }

    const requestUrl = new URL(request.url);
    if (
        requestUrl.protocol !== "app:" ||
        requestUrl.hostname !== "bundle" ||
        requestUrl.username ||
        requestUrl.password
    ) {
        return responseWithSecurityHeaders("Not found", 404);
    }

    if (rendererDevUrl) {
        const destination = new URL(`${requestUrl.pathname}${requestUrl.search}`, rendererDevUrl);
        return new Response(null, { status: 302, headers: { Location: destination.href } });
    }

    const rendererRoot = resolve(getAppResourceRoot(), "renderer");
    const filePath = await resolveRendererFile(rendererRoot, getAppRequestPath(requestUrl));
    if (!filePath) return responseWithSecurityHeaders("Not found", 404);

    try {
        const response = await net.fetch(pathToFileURL(filePath).toString());
        const headers = new Headers(response.headers);
        if (request.method === "HEAD") return responseWithSecurityHeaders(null, response.status, headers);
        return responseWithSecurityHeaders(response.body, response.status, headers);
    } catch {
        return responseWithSecurityHeaders("Not found", 404);
    }
}

async function proxyApiRequest(request: Request) {
    if (!API_METHODS.has(request.method)) {
        return responseWithSecurityHeaders(
            "Method not allowed",
            405,
            new Headers({ Allow: [...API_METHODS].join(", ") })
        );
    }

    const corsHeaders = rendererDevUrl ? getDevCorsHeaders(request) : new Headers();
    if (!corsHeaders) return responseWithSecurityHeaders("Cross-origin request denied", 403);
    if (request.method === "OPTIONS") return responseWithSecurityHeaders(null, 204, corsHeaders);

    const target = resolveApiProxyTarget(request.url, apiTargets);
    if (!target) return responseWithSecurityHeaders("Not found", 404, corsHeaders);

    try {
        const body =
            request.method === "GET" || request.method === "HEAD"
                ? null
                : await readBoundedBody(request, MAX_API_REQUEST_BYTES);
        const upstreamHeaders = createUpstreamHeaders(request.headers, target.url.origin);
        const response = await net.fetch(target.url.href, {
            method: request.method,
            headers: upstreamHeaders,
            body,
            credentials: target.service === "auth" ? "include" : "omit",
            redirect: "manual",
            signal: request.signal,
        });
        const headers = new Headers(response.headers);
        headers.delete("set-cookie");

        const location = headers.get("location");
        if (location) {
            const rewrittenLocation = rewriteApiRedirectLocation(location, target.url.origin, target.service);
            if (!rewrittenLocation) {
                await response.body?.cancel();
                return responseWithSecurityHeaders("Cross-origin redirect blocked", 502, corsHeaders);
            }
            headers.set("location", rewrittenLocation);
        }

        for (const [name, value] of corsHeaders) headers.set(name, value);
        if (request.method === "HEAD" || [204, 205, 304].includes(response.status)) {
            return responseWithSecurityHeaders(null, response.status, headers);
        }
        const contentLength = Number(headers.get("content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_API_RESPONSE_BYTES) {
            await response.body?.cancel();
            return responseWithSecurityHeaders("Response body is too large", 502, corsHeaders);
        }
        return responseWithSecurityHeaders(
            limitResponseBody(response.body, MAX_API_RESPONSE_BYTES),
            response.status,
            headers
        );
    } catch (error) {
        const message =
            error instanceof Error && error.message === "Request body is too large."
                ? error.message
                : "Remote API request failed.";
        const status = message === "Request body is too large." ? 413 : 502;
        return responseWithSecurityHeaders(message, status, corsHeaders);
    }
}

function installProtocol() {
    protocol.handle("app", (request) => handleAppRequest(request));
}

function installPermissionPolicy() {
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function isTrustedMainFrame(event: IpcMainEvent | IpcMainInvokeEvent) {
    return (
        event.senderFrame === event.sender.mainFrame && isTrustedRendererUrl(event.senderFrame.url, trustedRendererUrl)
    );
}

function getSyncHubConfigPath() {
    return join(app.getPath("userData"), SYNC_HUB_CONFIG_FILE);
}

function getLegacySyncHubKeyPath() {
    return join(app.getPath("userData"), LEGACY_SYNC_HUB_KEY_FILE);
}

async function decryptStoredSyncHubConfig(path: string) {
    try {
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
            throw new Error("Windows secure storage is unavailable.");
        const encrypted = await fs.readFile(path);
        const { result: decrypted, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
        const config = parseStoredSyncHubConfig(decrypted, validateSyncHubEndpoint);

        if (shouldReEncrypt) await writeSyncHubConfig(config.endpoint, config.apiKey);
        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

async function readSyncHubConfig() {
    return (
        (await decryptStoredSyncHubConfig(getSyncHubConfigPath())) ??
        (await decryptStoredSyncHubConfig(getLegacySyncHubKeyPath())) ?? { endpoint: null, apiKey: null }
    );
}

async function writeSyncHubConfig(endpoint: string | null, apiKey: string | null) {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("Windows secure storage is unavailable.");
    const plaintext = serializeStoredSyncHubConfig(endpoint, apiKey, validateSyncHubEndpoint);
    const encrypted = await safeStorage.encryptStringAsync(plaintext);
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await fs.writeFile(getSyncHubConfigPath(), encrypted, { mode: 0o600 });
    await fs.rm(getLegacySyncHubKeyPath(), { force: true });
}

async function writeSyncHubApiKey(apiKey: string) {
    const config = await readSyncHubConfig();
    await writeSyncHubConfig(config?.endpoint ?? null, apiKey);
}

function validateSyncHubEndpoint(endpoint: string) {
    const normalized = normalizeSyncHubEndpoint(endpoint || defaultSyncHubEndpoint);
    const url = new URL(normalized);
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) throw new Error("Invalid SyncHub endpoint.");
    if (url.protocol !== "https:" && !(localHost && url.protocol === "http:" && !app.isPackaged)) {
        throw new Error("SyncHub must use HTTPS. HTTP is allowed only for a local development service.");
    }
    return normalized;
}

async function readResponseText(response: Response, maximumBytes: number) {
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maximumBytes)
        throw new Error("SyncHub response is too large.");
    if (!response.body) return "";

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maximumBytes) {
                await reader.cancel();
                throw new Error("SyncHub response is too large.");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(result);
}

async function requestSyncHub(
    endpoint: string,
    collection: string,
    method: string,
    body: string | undefined,
    apiKey: string
) {
    const checkedEndpoint = validateSyncHubEndpoint(endpoint);
    if (!SYNC_HUB_COLLECTIONS.has(collection)) throw new Error("Unsupported SyncHub collection.");
    if (!SYNC_HUB_METHODS.has(method)) throw new Error("Unsupported SyncHub method.");
    if (!isValidSyncHubApiKey(apiKey)) throw new Error("Invalid SyncHub API key.");
    if (body !== undefined && Buffer.byteLength(body, "utf8") > MAX_SYNC_HUB_BODY_BYTES) {
        throw new Error("SyncHub request body is too large.");
    }
    if (method === "GET" && body !== undefined) throw new Error("GET SyncHub requests cannot include a body.");

    const target = new URL(latestNewsSyncHubURL(checkedEndpoint, collection as LatestNewsSyncHubCollection));
    if (target.origin !== new URL(checkedEndpoint).origin) throw new Error("Invalid SyncHub request target.");
    const response = await net.fetch(target.href, {
        method,
        headers: syncHubHeaders(apiKey),
        body: method === "PUT" ? body : undefined,
        credentials: "omit",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
    });
    if (response.headers.has("location")) {
        const location = new URL(response.headers.get("location")!, target);
        if (location.origin !== target.origin) {
            await response.body?.cancel();
            throw new Error("Cross-origin SyncHub redirects are blocked.");
        }
    }

    return { status: response.status, bodyText: await readResponseText(response, MAX_SYNC_HUB_RESPONSE_BYTES) };
}

function installDesktopIpc(crawlerRuntime: ElectronCrawlerPluginRuntime) {
    ipcMain.handle("desktop:start-login", async (event) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted desktop login request.");
        await openAuthenticationWindow();
    });

    ipcMain.handle("desktop:synchub:set-api-key", async (event, apiKey: unknown) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted SyncHub key request.");
        if (typeof apiKey !== "string" || (apiKey && !isValidSyncHubApiKey(apiKey.trim()))) {
            throw new Error("Invalid SyncHub API key.");
        }
        if (apiKey.trim()) await writeSyncHubApiKey(apiKey.trim());
    });

    ipcMain.handle("desktop:synchub:clear-api-key", async (event) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted SyncHub key request.");
        await Promise.all([
            fs.rm(getSyncHubConfigPath(), { force: true }),
            fs.rm(getLegacySyncHubKeyPath(), { force: true }),
        ]);
    });

    ipcMain.handle("desktop:synchub:verify", async (event, endpoint: unknown, apiKey: unknown) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted SyncHub verification request.");
        if (typeof endpoint !== "string" || (apiKey !== undefined && typeof apiKey !== "string"))
            throw new Error("Invalid SyncHub verification data.");
        const enteredApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
        const checkedEndpoint = validateSyncHubEndpoint(endpoint);
        const savedConfig = await readSyncHubConfig();
        const credentials = resolveSyncHubVerificationCredentials(
            checkedEndpoint,
            savedConfig?.endpoint ?? null,
            enteredApiKey,
            savedConfig?.apiKey ?? null
        );
        const result = await requestSyncHub(credentials.endpoint, "favorites", "GET", undefined, credentials.apiKey);
        if (isSyncHubVerificationSuccessful(result.status, result.bodyText)) {
            await writeSyncHubConfig(credentials.endpoint, credentials.apiKey);
        }
        return result;
    });

    ipcMain.handle("desktop:synchub:request", async (event, collection: unknown, method: unknown, body: unknown) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted SyncHub request.");
        if (typeof collection !== "string" || typeof method !== "string") {
            throw new Error("Invalid SyncHub request data.");
        }
        if (body !== undefined && typeof body !== "string") throw new Error("Invalid SyncHub request body.");
        const savedConfig = await readSyncHubConfig();
        const credentials = resolveSyncHubRequestCredentials(
            savedConfig?.endpoint ?? null,
            savedConfig?.apiKey ?? null
        );
        return requestSyncHub(credentials.endpoint, collection, method, body, credentials.apiKey);
    });

    ipcMain.handle("desktop:crawler:list-sources", async (event) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted crawler source list request.");
        return crawlerRuntime.listSourceIds();
    });

    ipcMain.handle("desktop:crawler:list-source-metadata", async (event) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted crawler source metadata request.");
        return crawlerRuntime.listSourceMetadata();
    });

    ipcMain.handle("desktop:crawler:fetch-source", async (event, sourceId: unknown) => {
        if (!isTrustedMainFrame(event)) throw new Error("Untrusted crawler source request.");
        if (typeof sourceId !== "string") throw new Error("Invalid crawler source ID.");
        if (!crawlerRuntime.listSourceIds().includes(sourceId)) return null;
        return crawlerRuntime.fetchSource(sourceId as SourceID);
    });
}

function getAuthLoginUrl() {
    const url = new URL("/auth/oauth/github/login", authApiUrl);
    url.searchParams.set("redirect_uri", authCallbackUrl.href);
    return url;
}

function isAuthenticationCallback(candidate: string) {
    try {
        const url = new URL(candidate);
        return url.origin === authCallbackUrl.origin && url.pathname === authCallbackUrl.pathname;
    } catch {
        return false;
    }
}

function isAllowedAuthWindowUrl(candidate: string) {
    try {
        const url = new URL(candidate);
        if (url.protocol === "app:" && url.hostname === "bundle" && url.pathname === "/auth/callback") return true;
        if (
            url.protocol !== "https:" &&
            !(url.protocol === "http:" && url.origin === authApiUrl.origin && !app.isPackaged)
        ) {
            return false;
        }
        return (
            url.origin === authApiUrl.origin ||
            url.origin === authCallbackUrl.origin ||
            url.hostname === "github.com" ||
            url.hostname.endsWith(".github.com")
        );
    } catch {
        return false;
    }
}

async function openAuthenticationWindow() {
    if (authWindow && !authWindow.isDestroyed()) {
        authWindow.focus();
        return;
    }

    const window = new BrowserWindow({
        width: 760,
        height: 760,
        minWidth: 560,
        minHeight: 600,
        parent: mainWindow ?? undefined,
        modal: mainWindow !== null,
        show: false,
        title: "登录 LatestNews",
        icon: getWindowIconPath(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
        },
    });

    authWindow = window;
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
        if (authWindow === window) authWindow = null;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    let callbackHandled = false;
    const redirectToLocalCallback = (event: Electron.Event, candidate: string) => {
        if (isAuthenticationCallback(candidate)) {
            event.preventDefault();
            if (callbackHandled) return;
            callbackHandled = true;
            const localCallback = rendererDevUrl
                ? new URL("/auth/callback", rendererDevUrl).href
                : new URL("auth/callback", APP_BASE_URL).href;
            window.close();
            void mainWindow?.loadURL(localCallback);
            return;
        }
        if (!isAllowedAuthWindowUrl(candidate)) event.preventDefault();
    };

    window.webContents.on("will-navigate", redirectToLocalCallback);
    window.webContents.on("will-redirect", redirectToLocalCallback);

    try {
        await window.loadURL(getAuthLoginUrl().href);
    } catch (error) {
        if (!window.isDestroyed()) window.close();
        throw error;
    }
}

function attachMainWindowSecurity(contents: WebContents) {
    if (contents.hostWebContents && contents.hostWebContents !== mainWindow?.webContents) return;

    contents.setWindowOpenHandler(({ url, referrer }) => {
        if (!isTrustedRendererUrl(referrer.url || contents.getURL(), trustedRendererUrl)) return { action: "deny" };
        void openExternalLink(url);
        return { action: "deny" };
    });

    contents.on("will-navigate", (event, url) => {
        if (isTrustedRendererUrl(url, trustedRendererUrl)) return;
        event.preventDefault();
        void openExternalLink(url);
    });

    contents.on("will-redirect", (event, url) => {
        if (!isTrustedRendererUrl(url, trustedRendererUrl)) event.preventDefault();
    });

    contents.on("will-attach-webview", (event) => event.preventDefault());
}

async function openExternalLink(candidate: string) {
    const safeUrl = getSafeExternalUrl(candidate);
    if (!safeUrl) return;
    try {
        await shell.openExternal(safeUrl);
    } catch (error) {
        console.warn("Could not open the external link.", error);
    }
}

async function createMainWindow() {
    const window = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 820,
        minHeight: 620,
        show: false,
        backgroundColor: "#18181b",
        icon: getWindowIconPath(),
        webPreferences: {
            preload: resolve(getAppResourceRoot(), "preload/preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
        },
    });

    mainWindow = window;
    attachMainWindowSecurity(window.webContents);
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
        if (mainWindow === window) mainWindow = null;
    });

    await window.loadURL(rendererDevUrl?.href ?? APP_BASE_URL);
}
