import { z } from "zod";
import { isIP } from "node:net";
import { resolve4 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import { parseRssXml } from "./utils/rss2json";
import { createFetchScheduler } from "./utils/fetch-scheduler";
import { createDynamicSourceId } from "../shared/dynamic-source-id";
import { isPublicInternetAddress } from "../shared/upstream-node-federation";

import type { NewsItem, SourceID } from "../shared/types";
import type { RuntimeSourceDefinition } from "../shared/runtime-source-catalog";

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_SOURCES = 32;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_TITLE_LENGTH = 1_000;
const MAX_URL_LENGTH = 2_048;
const MAX_ITEM_ID_LENGTH = 256;
const MAX_DATE_LENGTH = 128;
const MANIFEST_SOURCE_KEY = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

const jsonPathSchema = z
    .string()
    .trim()
    .min(1)
    .max(256)
    .superRefine((path, context) => {
        const segments = path.split(".");
        if (segments.length > 8 || segments.some((segment) => !/^[a-zA-Z0-9_-]{1,64}$/.test(segment))) {
            context.addIssue({ code: "custom", message: "JSON paths must contain up to eight plain field names." });
            return;
        }
        if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
            context.addIssue({ code: "custom", message: "JSON paths cannot access prototype properties." });
        }
    });

const mappingSchema = z
    .object({
        itemsPath: jsonPathSchema,
        titlePath: jsonPathSchema,
        urlPath: jsonPathSchema,
        idPath: jsonPathSchema.optional(),
        publishedAtPath: jsonPathSchema.optional(),
        mobileUrlPath: jsonPathSchema.optional(),
    })
    .strict();

const sourceMetadataSchema = z
    .object({
        key: z.string().regex(MANIFEST_SOURCE_KEY),
        name: z.string().trim().min(1).max(80),
        enabled: z.boolean().default(true),
        intervalMs: z.number().int().min(30_000).max(86_400_000),
        endpoint: z.string().trim().min(1).max(2_048),
        column: z.enum(["china", "world", "tech", "finance"]).optional(),
        title: z.string().trim().min(1).max(40).optional(),
        description: z.string().trim().max(240).optional(),
        home: z.string().trim().min(1).max(2_048).optional(),
    })
    .strict();

const sourceSchema = z.discriminatedUnion("type", [
    sourceMetadataSchema.extend({ type: z.literal("rss") }),
    sourceMetadataSchema.extend({ type: z.literal("json"), mapping: mappingSchema }),
]);

const manifestSchema = z
    .object({
        version: z.literal(1),
        sources: z.array(sourceSchema).max(MAX_SOURCES),
    })
    .strict()
    .superRefine((manifest, context) => {
        const keys = new Set<string>();
        for (const [index, source] of manifest.sources.entries()) {
            if (keys.has(source.key)) {
                context.addIssue({
                    code: "custom",
                    path: ["sources", index, "key"],
                    message: "Configured source keys must be unique.",
                });
            }
            keys.add(source.key);
        }
    });

type ConfiguredSource = z.infer<typeof sourceSchema>;

export interface ConfiguredSourceHttpResponse {
    status: number;
    headers: Readonly<Record<string, string | undefined>>;
    body: string;
}

export interface ConfiguredSourceRuntimeDependencies {
    /** Resolve only A records. Requests are pinned to the returned address. */
    resolveIpv4?: (hostname: string) => Promise<string>;
    /** Injection point for local fixtures; production uses the pinned HTTPS transport below. */
    request?: (url: URL, pinnedAddress: string, signal: AbortSignal) => Promise<ConfiguredSourceHttpResponse>;
}

interface ConfiguredSourceRecord {
    id: string;
    config: ConfiguredSource;
    endpoint: URL;
    metadata: RuntimeSourceDefinition;
}

/**
 * Load a bounded, operator-owned source manifest. Each endpoint and redirect is
 * HTTPS-only, host-allowlisted, resolved to a public IPv4 address, then pinned.
 */
export function createConfiguredSourceRuntime(
    manifestText: string,
    allowedHostsText: string,
    dependencies: ConfiguredSourceRuntimeDependencies = {}
) {
    if (Buffer.byteLength(manifestText, "utf8") > MAX_MANIFEST_BYTES) {
        throw new Error("Configured source manifest exceeds 128 KiB.");
    }

    const allowedHosts = parseAllowedHosts(allowedHostsText);
    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(manifestText) as unknown;
    } catch {
        throw new Error("Configured source manifest is not valid JSON.");
    }

    const parsedManifest = manifestSchema.safeParse(parsedJson);
    if (!parsedManifest.success) {
        throw new Error("Configured source manifest has an invalid shape or value.");
    }

    const sources = new Map<string, ConfiguredSourceRecord>();
    for (const config of parsedManifest.data.sources) {
        const endpoint = parseEndpoint(config.endpoint, allowedHosts);
        if (!config.enabled) continue;

        const id = createDynamicSourceId("config", config.key);
        const home = config.home ? parsePublicHttpsUrl(config.home) : endpoint.origin;
        const metadata: RuntimeSourceDefinition = {
            id,
            name: config.name,
            interval: config.intervalMs,
            ...(config.column ? { column: config.column } : {}),
            ...(config.title ? { title: config.title } : {}),
            ...(config.description ? { desc: config.description } : {}),
            home,
        };
        sources.set(id, { id, config, endpoint, metadata });
    }

    const scheduler = createFetchScheduler({
        maxConcurrent: 8,
        maxPerKey: 2,
        maxQueued: 100,
        queueTimeoutMs: 8_000,
        taskTimeoutMs: 12_000,
    });
    const resolveIpv4 = dependencies.resolveIpv4 ?? resolvePublicIpv4;
    const request = dependencies.request ?? requestPinnedHttps;

    return {
        listSources(): RuntimeSourceDefinition[] {
            return [...sources.values()].map(({ metadata }) => metadata);
        },
        hasSource(id: string) {
            return sources.has(id);
        },
        async fetchSource(id: SourceID): Promise<NewsItem[] | undefined> {
            const source = sources.get(id);
            if (!source) return undefined;

            return scheduler.run(source.endpoint.origin, async (signal) => {
                const body = await fetchConfiguredSourceText(
                    source.endpoint,
                    allowedHosts,
                    resolveIpv4,
                    request,
                    signal
                );
                if (source.config.type === "rss") return parseRssItems(body, source.endpoint);
                return parseJsonItems(body, source.config.mapping, source.endpoint);
            });
        },
    };
}

async function fetchConfiguredSourceText(
    initialUrl: URL,
    allowedHosts: ReadonlySet<string>,
    resolveIpv4: (hostname: string) => Promise<string>,
    request: (url: URL, pinnedAddress: string, signal: AbortSignal) => Promise<ConfiguredSourceHttpResponse>,
    signal: AbortSignal
) {
    let url = new URL(initialUrl);
    const visitedUrls = new Set<string>();

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        assertAllowedEndpoint(url, allowedHosts);
        url.hostname = normalizeHostname(url.hostname);
        if (visitedUrls.has(url.href)) throw new Error("Configured source redirect loop detected.");
        visitedUrls.add(url.href);

        const hostname = normalizeHostname(url.hostname);
        const pinnedAddress = await resolveIpv4(hostname);
        if (!isPublicIpv4(pinnedAddress)) {
            throw new Error("Configured source DNS did not resolve to a public IPv4 address.");
        }

        const response = await request(url, pinnedAddress, signal);
        assertResponseBodySize(response.body);

        if (isRedirectStatus(response.status)) {
            const location = getHeader(response.headers, "location");
            if (!location || redirects === MAX_REDIRECTS) {
                throw new Error("Configured source redirect limit exceeded or Location is missing.");
            }
            let target: URL;
            try {
                target = new URL(location, url);
            } catch {
                throw new Error("Configured source returned an invalid redirect.");
            }
            assertAllowedEndpoint(target, allowedHosts);
            target.hostname = normalizeHostname(target.hostname);
            url = target;
            continue;
        }

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Configured source returned HTTP ${response.status}.`);
        }
        const contentEncoding = getHeader(response.headers, "content-encoding");
        if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
            throw new Error("Configured source returned an unsupported content encoding.");
        }
        return response.body;
    }

    throw new Error("Configured source redirect limit exceeded.");
}

function parseRssItems(body: string, endpoint: URL): NewsItem[] {
    const feed = parseRssXml(body);
    if (!feed) throw new Error("Configured RSS source did not contain a valid feed.");
    const items: NewsItem[] = [];
    for (const item of feed.items.slice(0, 30)) {
        const title = item.title.trim();
        const url = resolveArticleUrl(item.link, endpoint);
        if (!title || title.length > MAX_TITLE_LENGTH || !url) continue;

        const id = item.id?.trim();
        const publishedAt = item.created?.trim();
        items.push({
            id: id && id.length <= MAX_ITEM_ID_LENGTH ? id : url,
            title,
            url,
            ...(publishedAt && publishedAt.length <= MAX_DATE_LENGTH ? { pubDate: publishedAt } : {}),
        });
    }
    return items;
}

function parseJsonItems(
    body: string,
    mapping: Extract<ConfiguredSource, { type: "json" }>["mapping"],
    endpoint: URL
): NewsItem[] {
    let document: unknown;
    try {
        document = JSON.parse(body) as unknown;
    } catch {
        throw new Error("Configured JSON source returned invalid JSON.");
    }

    const entries = readPath(document, mapping.itemsPath);
    if (!Array.isArray(entries)) throw new Error("Configured JSON source itemsPath did not resolve to an array.");

    const items: NewsItem[] = [];
    for (const [index, entry] of entries.slice(0, 30).entries()) {
        const title = readPath(entry, mapping.titlePath);
        const url = readPath(entry, mapping.urlPath);
        if (typeof title !== "string" || typeof url !== "string") continue;
        const articleUrl = resolveArticleUrl(url, endpoint);
        if (!title.trim() || title.length > MAX_TITLE_LENGTH || !articleUrl) continue;

        const rawId = mapping.idPath ? readPath(entry, mapping.idPath) : undefined;
        const rawPublishedAt = mapping.publishedAtPath ? readPath(entry, mapping.publishedAtPath) : undefined;
        const rawMobileUrl = mapping.mobileUrlPath ? readPath(entry, mapping.mobileUrlPath) : undefined;
        const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : index;
        const mobileUrl = typeof rawMobileUrl === "string" ? resolveArticleUrl(rawMobileUrl, endpoint) : undefined;
        items.push({
            id: typeof id === "string" && id.length > MAX_ITEM_ID_LENGTH ? index : id,
            title: title.trim(),
            url: articleUrl,
            ...(typeof rawPublishedAt === "string" || typeof rawPublishedAt === "number"
                ? typeof rawPublishedAt === "string" && rawPublishedAt.length > MAX_DATE_LENGTH
                    ? {}
                    : { pubDate: rawPublishedAt }
                : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
        });
    }
    return items;
}

function readPath(value: unknown, path: string): unknown {
    let current = value;
    for (const segment of path.split(".")) {
        if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
        current = current[segment];
    }
    return current;
}

async function resolvePublicIpv4(hostname: string) {
    let addresses: string[];
    try {
        addresses = await resolve4(hostname);
    } catch {
        throw new Error("Configured source DNS lookup failed.");
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicIpv4(address))) {
        throw new Error("Configured source DNS did not return only public IPv4 addresses.");
    }
    return addresses[0]!;
}

function requestPinnedHttps(url: URL, pinnedAddress: string, signal: AbortSignal) {
    return new Promise<ConfiguredSourceHttpResponse>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            callback();
        };
        const onAbort = () => request.destroy(new Error("Configured source request was cancelled."));
        const request = httpsRequest(
            {
                hostname: pinnedAddress,
                family: 4,
                port: 443,
                method: "GET",
                path: `${url.pathname}${url.search}`,
                servername: url.hostname,
                agent: false,
                headers: {
                    Accept: "application/rss+xml, application/atom+xml, application/xml, application/json;q=0.9",
                    "Accept-Encoding": "identity",
                    "User-Agent": "LatestNews configured-source adapter",
                    Host: url.host,
                },
            },
            (response) => {
                const status = response.statusCode ?? 0;
                const headers = normalizeResponseHeaders(response.headers);
                if (isRedirectStatus(status) || status < 200 || status >= 300) {
                    response.destroy();
                    finish(() => resolve({ status, headers, body: "" }));
                    return;
                }

                const contentLength = Number(headers["content-length"]);
                if (Number.isSafeInteger(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
                    response.destroy(new Error("Configured source response exceeds 2 MiB."));
                    finish(() => reject(new Error("Configured source response exceeds 2 MiB.")));
                    return;
                }

                const chunks: Buffer[] = [];
                let totalBytes = 0;
                response.on("data", (chunk: Buffer | string) => {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    totalBytes += bytes.byteLength;
                    if (totalBytes > MAX_RESPONSE_BYTES) {
                        response.destroy(new Error("Configured source response exceeds 2 MiB."));
                        finish(() => reject(new Error("Configured source response exceeds 2 MiB.")));
                        return;
                    }
                    chunks.push(bytes);
                });
                response.on("end", () => {
                    finish(() =>
                        resolve({
                            status,
                            headers,
                            body: Buffer.concat(chunks, totalBytes).toString("utf8"),
                        })
                    );
                });
                response.on("error", (error) => finish(() => reject(error)));
            }
        );

        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        request.setTimeout(REQUEST_TIMEOUT_MS, () =>
            request.destroy(new Error("Configured source request timed out."))
        );
        request.on("error", (error) => finish(() => reject(error)));
        request.end();
    });
}

function parseAllowedHosts(value: string): ReadonlySet<string> {
    const entries = value
        .split(",")
        .map((host) => normalizeHostname(host.trim()))
        .filter(Boolean);
    if (entries.length === 0 || entries.length > 64) {
        throw new Error("LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS must contain 1 to 64 exact hostnames.");
    }

    const hosts = new Set<string>();
    for (const host of entries) {
        if (!isAllowedHostname(host)) {
            throw new Error("Configured source host allowlist contains an invalid hostname.");
        }
        hosts.add(host);
    }
    if (hosts.size !== entries.length) throw new Error("Configured source host allowlist contains duplicates.");
    return hosts;
}

function parseEndpoint(value: string, allowedHosts: ReadonlySet<string>) {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Configured source endpoint must be a valid HTTPS URL.");
    }
    assertAllowedEndpoint(url, allowedHosts);
    url.hostname = normalizeHostname(url.hostname);
    return url;
}

function parsePublicHttpsUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Configured source home must be a valid HTTPS URL.");
    }
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !isAllowedHostname(normalizeHostname(url.hostname))
    ) {
        throw new Error("Configured source home must be an HTTPS URL without credentials or an IP address.");
    }
    return url.origin;
}

function assertAllowedEndpoint(url: URL, allowedHosts: ReadonlySet<string>) {
    const hostname = normalizeHostname(url.hostname);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        url.port ||
        !isAllowedHostname(hostname) ||
        !allowedHosts.has(hostname)
    ) {
        throw new Error("Configured source endpoint or redirect is outside the HTTPS host allowlist.");
    }
}

function normalizeHostname(hostname: string) {
    return hostname.toLowerCase().replace(/\.$/, "");
}

function isAllowedHostname(hostname: string) {
    if (hostname.length > 253 || !hostname.includes(".") || isIP(hostname) !== 0) return false;
    return hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function isPublicIpv4(address: string) {
    return isIP(address) === 4 && isPublicInternetAddress(address);
}

function resolveArticleUrl(value: string, base: URL) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH) return undefined;

    try {
        const url = new URL(trimmed, base);
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
        const resolved = url.toString();
        return resolved.length <= MAX_URL_LENGTH ? resolved : undefined;
    } catch {
        return undefined;
    }
}

function isRedirectStatus(status: number) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function getHeader(headers: Readonly<Record<string, string | undefined>>, name: string) {
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) return value;
    }
    return undefined;
}

function normalizeResponseHeaders(headers: NodeJS.Dict<string | string[]>) {
    const normalized: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (typeof value === "string") normalized[name.toLowerCase()] = value;
        else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(", ");
    }
    return normalized;
}

function assertResponseBodySize(body: string) {
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("Configured source response exceeds 2 MiB.");
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
