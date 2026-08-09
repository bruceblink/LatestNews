import type {
    FederationErrorCode,
    ParsedUpstreamNodeManifest,
    ValidatedUpstreamNodeEndpoint,
} from "@shared/upstream-node-federation";

import process from "node:process";
import {
    isPublicInternetAddress,
    parseUpstreamNodeManifest,
    getFederationProtocolMajor,
    validateUpstreamNodeEndpoint,
} from "@shared/upstream-node-federation";

const MANIFEST_TIMEOUT_MS = 3_000;
const RETRY_DELAY_MS = 250;
const SUPPORTED_FEDERATION_PROTOCOL_MAJOR = 1;

type UpstreamFetch = (input: string, init: RequestInit) => Promise<Response>;
type HostnameResolver = (hostname: string) => Promise<string[]>;
type Wait = (milliseconds: number) => Promise<void>;

interface NodeHttpResponse {
    headers: Record<string, string | string[] | number | undefined>;
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    statusCode?: number;
}

interface NodeHttpRequest {
    destroy(error?: Error): void;
    end(): void;
    on(event: "error", listener: (error: Error) => void): void;
}

interface NodeHttpRequestModule {
    request(
        url: string,
        options: {
            headers?: Record<string, string>;
            lookup: (
                hostname: string,
                options: unknown,
                callback: (error: Error | null, address: string, family: number) => void
            ) => void;
            method?: string;
        },
        callback: (response: NodeHttpResponse) => void
    ): NodeHttpRequest;
}

export interface FetchUpstreamNodeManifestOptions {
    allowHttp?: boolean;
    endpoint: string;
    fetcher?: UpstreamFetch;
    resolveHostname?: HostnameResolver;
    retryDelay?: Wait;
    timeoutMs?: number;
    token?: string;
}

export type UpstreamNodeManifestResult =
    | {
          ok: true;
          attempts: number;
          endpoint: ValidatedUpstreamNodeEndpoint;
          manifest: ParsedUpstreamNodeManifest;
      }
    | {
          ok: false;
          attempts: number;
          code: FederationErrorCode;
          message: string;
          retriable: boolean;
      };

/**
 * Reads the configured upstream node manifest with fixed headers, a short deadline, and no redirects.
 * It resolves and checks DNS addresses before fetch so a browser cannot turn this server request into SSRF.
 */
export async function fetchUpstreamNodeManifest(
    options: FetchUpstreamNodeManifestOptions
): Promise<UpstreamNodeManifestResult> {
    const endpoint = validateUpstreamNodeEndpoint(options.endpoint, { allowHttp: options.allowHttp });
    if (!endpoint) return endpointFailure("Configured upstream endpoint is not an allowed public origin.");

    const resolveHostname = options.resolveHostname ?? resolvePublicHostname;
    let resolvedAddresses: string[];
    try {
        resolvedAddresses = await resolveHostname(endpoint.hostname);
    } catch {
        return unavailableFailure(0, "Configured upstream hostname could not be resolved.");
    }

    if (!resolvedAddresses.length || resolvedAddresses.some((address) => !isPublicInternetAddress(address))) {
        return endpointFailure("Configured upstream hostname resolved to a non-public address.");
    }

    const fetcher = options.fetcher ?? createPinnedNodeFetch(resolvedAddresses[0]);
    const retryDelay = options.retryDelay ?? wait;
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? MANIFEST_TIMEOUT_MS, 1), MANIFEST_TIMEOUT_MS);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await requestManifest(fetcher, endpoint, options.token, timeoutMs);
        if (response.ok) {
            const manifest = parseUpstreamNodeManifest(response.value);
            if (!manifest) return manifestFailure(attempt, "Upstream node returned an invalid manifest.");

            const protocolMajor = getFederationProtocolMajor(manifest.federation);
            if (protocolMajor !== undefined && protocolMajor !== SUPPORTED_FEDERATION_PROTOCOL_MAJOR) {
                return {
                    ok: false,
                    attempts: attempt,
                    code: "federation_protocol_unsupported",
                    message: "Upstream node uses an unsupported federation protocol version.",
                    retriable: false,
                };
            }

            return { ok: true, attempts: attempt, endpoint, manifest };
        }

        if (!response.shouldRetry || attempt === 2) return response.failure(attempt);
        await retryDelay(RETRY_DELAY_MS);
    }

    return unavailableFailure(2, "Upstream node request could not be completed.");
}

/**
 * Reads only the deployment-owned environment variables needed by the upstream client.
 * No request parameter or browser value can replace this endpoint or federation credential.
 */
export function fetchConfiguredUpstreamNodeManifest(
    options: Omit<FetchUpstreamNodeManifestOptions, "endpoint" | "token"> = {}
) {
    const endpoint = process.env.LATESTNEWS_UPSTREAM_ENDPOINT;
    if (!endpoint?.trim()) return undefined;

    return fetchUpstreamNodeManifest({
        ...options,
        endpoint,
        allowHttp: process.env.LATESTNEWS_FEDERATION_ALLOW_HTTP === "true",
        token: process.env.LATESTNEWS_FEDERATION_UPSTREAM_TOKEN,
    });
}

async function requestManifest(
    fetcher: UpstreamFetch,
    endpoint: ValidatedUpstreamNodeEndpoint,
    token: string | undefined,
    timeoutMs: number
) {
    const controller = new AbortController();
    const timeoutError = new Error("Upstream manifest request timed out");
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
            controller.abort();
            reject(timeoutError);
        }, timeoutMs);
    });

    try {
        const response = await Promise.race([
            fetcher(endpoint.manifestUrl, {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    "User-Agent": "LatestNews-Node-Federation/1.0",
                    ...(token?.trim() && { Authorization: `Bearer ${token.trim()}` }),
                },
            }),
            timeout,
        ]);

        if (response.status >= 300 && response.status < 400) {
            return {
                ok: false as const,
                shouldRetry: false,
                failure: manifestFailureFactory("Upstream node returned a redirect."),
            };
        }
        if (!response.ok) {
            return {
                ok: false as const,
                shouldRetry: false,
                failure: unavailableFailureFactory(`Upstream node returned HTTP ${response.status}.`),
            };
        }

        try {
            return { ok: true as const, value: await response.json() };
        } catch {
            return {
                ok: false as const,
                shouldRetry: false,
                failure: manifestFailureFactory("Upstream node did not return JSON."),
            };
        }
    } catch (error) {
        const failure =
            error === timeoutError || controller.signal.aborted
                ? timeoutFailureFactory("Upstream node did not respond before the request deadline.")
                : unavailableFailureFactory("Upstream node connection failed before a response was received.");
        return { ok: false as const, shouldRetry: true, failure };
    } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
    }
}

function endpointFailure(message: string): UpstreamNodeManifestResult {
    return { ok: false, attempts: 0, code: "federation_endpoint_rejected", message, retriable: false };
}

function manifestFailure(attempts: number, message: string): UpstreamNodeManifestResult {
    return { ok: false, attempts, code: "federation_manifest_invalid", message, retriable: false };
}

function unavailableFailure(attempts: number, message: string): UpstreamNodeManifestResult {
    return { ok: false, attempts, code: "federation_upstream_unavailable", message, retriable: true };
}

function manifestFailureFactory(message: string) {
    return (attempts: number) => manifestFailure(attempts, message);
}

function timeoutFailureFactory(message: string) {
    return (attempts: number): UpstreamNodeManifestResult => ({
        ok: false,
        attempts,
        code: "federation_upstream_timeout",
        message,
        retriable: true,
    });
}

function unavailableFailureFactory(message: string) {
    return (attempts: number) => unavailableFailure(attempts, message);
}

/** Uses the Node resolver when this optional server-only federation feature runs on a Node deployment. */
async function resolvePublicHostname(hostname: string) {
    const moduleName = "node:dns/promises";
    const dns = await import(moduleName);
    const addresses = (await dns.lookup(hostname, { all: true, verbatim: true })) as Array<{ address: string }>;
    return addresses.map((entry: { address: string }) => entry.address);
}

/**
 * Connects Node's HTTP client to a DNS address that has already passed the public-network policy.
 * The custom lookup prevents a second, attacker-controlled DNS answer between validation and connection.
 */
function createPinnedNodeFetch(address: string): UpstreamFetch {
    return async (url, init) => {
        const transportModuleName = url.startsWith("https:") ? "node:https" : "node:http";
        const transport = (await import(transportModuleName)) as unknown as NodeHttpRequestModule;

        return new Promise<Response>((resolve, reject) => {
            const request = transport.request(
                url,
                {
                    method: init.method,
                    headers: init.headers as Record<string, string> | undefined,
                    lookup: (_hostname, _options, callback) => {
                        callback(null, address, address.includes(":") ? 6 : 4);
                    },
                },
                (response) => {
                    const chunks: Uint8Array[] = [];
                    response.on("data", (chunk) => chunks.push(chunk));
                    response.on("error", reject);
                    response.on("end", () => {
                        const body = combineChunks(chunks);
                        resolve(
                            new Response(body, {
                                status: response.statusCode ?? 502,
                                headers: normalizeResponseHeaders(response.headers),
                            })
                        );
                    });
                }
            );

            const abortRequest = () => request.destroy(new Error("Upstream manifest request was aborted"));
            request.on("error", reject);
            if (init.signal?.aborted) {
                abortRequest();
                return;
            }
            init.signal?.addEventListener("abort", abortRequest, { once: true });
            request.end();
        });
    };
}

function combineChunks(chunks: Uint8Array[]) {
    const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

function normalizeResponseHeaders(headers: NodeHttpResponse["headers"]) {
    return Object.entries(headers).flatMap(([name, value]) => {
        if (Array.isArray(value)) return value.map((item) => [name, item] as [string, string]);
        return value === undefined ? [] : [[name, String(value)] as [string, string]];
    });
}

function wait(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
