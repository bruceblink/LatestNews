import type { NodeManifestResponse } from "./node-manifest";
import type { SourceHealthSummary } from "./source-health-types";

export const upstreamNodeManifestPath = "/api/v1/node";

export const federationErrorCodes = [
    "federation_endpoint_rejected",
    "federation_manifest_invalid",
    "federation_protocol_unsupported",
    "federation_upstream_timeout",
    "federation_upstream_unavailable",
    "federation_circuit_open",
] as const;

export type FederationErrorCode = (typeof federationErrorCodes)[number];

export interface ValidatedUpstreamNodeEndpoint {
    hostname: string;
    manifestUrl: string;
    origin: string;
}

export interface FederationCapabilityManifest {
    protocolVersion?: string;
    capabilities?: string[];
}

export interface ParsedUpstreamNodeManifest {
    federation?: FederationCapabilityManifest;
    manifest: NodeManifestResponse;
}

export interface FederationApiError {
    code: FederationErrorCode;
    message: string;
    retriable: boolean;
}

export type UpstreamCircuitState = "closed" | "open" | "half_open";

export interface UpstreamCircuitSnapshot {
    state: UpstreamCircuitState;
    consecutiveFailures: number;
    lastFailureAt?: number;
    lastSuccessAt?: number;
    openedAt?: number;
    nextProbeAt?: number;
}

export type LocalSourceHealthSummary = Pick<
    SourceHealthSummary,
    "updatedAt" | "total" | "healthy" | "failing" | "idle" | "cacheDegraded"
>;

export interface UpstreamFederationHealth {
    status: "not_configured" | "healthy" | "degraded";
    circuit: UpstreamCircuitSnapshot;
}

export interface UpstreamNodeManifestApiResponse {
    data: NodeManifestResponse["data"] | null;
    errors: FederationApiError[];
    meta: {
        attempts: number;
        configured: boolean;
        generatedAt: number;
        localHealth: LocalSourceHealthSummary;
        upstream: UpstreamFederationHealth;
        upstreamNodeId?: string;
    };
}

/** Creates a fresh, serializable circuit snapshot when no upstream request has run yet. */
export function createClosedUpstreamCircuitSnapshot(): UpstreamCircuitSnapshot {
    return { state: "closed", consecutiveFailures: 0 };
}

export interface UpstreamNodeEndpointPolicy {
    allowHttp?: boolean;
}

/**
 * Validates an operator-configured upstream origin before the server creates any network request.
 * Only a public HTTP(S) origin is accepted, so request paths cannot be smuggled through configuration.
 */
export function validateUpstreamNodeEndpoint(
    value: string | undefined,
    policy: UpstreamNodeEndpointPolicy = {}
): ValidatedUpstreamNodeEndpoint | undefined {
    const endpoint = value?.trim();
    if (!endpoint) return undefined;

    let parsed: URL;
    try {
        parsed = new URL(endpoint);
    } catch {
        return undefined;
    }

    const isAllowedProtocol = parsed.protocol === "https:" || (policy.allowHttp && parsed.protocol === "http:");
    if (!isAllowedProtocol || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash)
        return undefined;
    if (parsed.pathname !== "/") return undefined;

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isIpLiteral(hostname))
        return undefined;

    return {
        hostname,
        origin: parsed.origin,
        manifestUrl: new URL(upstreamNodeManifestPath, parsed.origin).toString(),
    };
}

/**
 * Rejects private, loopback, documentation, and multicast addresses returned by DNS.
 * The caller must apply this check to every address before opening the upstream connection.
 */
export function isPublicInternetAddress(value: string) {
    const address = value.trim().toLowerCase();
    if (isIpv4Address(address)) return isPublicIpv4Address(address);
    if (isIpv6Address(address)) return isPublicIpv6Address(address);
    return false;
}

/**
 * Parses only the stable parts of a remote node manifest that R4-B can safely consume.
 * Unknown optional fields remain forward compatible, while malformed discovery data is rejected.
 */
export function parseUpstreamNodeManifest(value: unknown): ParsedUpstreamNodeManifest | undefined {
    if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.meta) || !Array.isArray(value.errors))
        return undefined;

    const { data, meta } = value;
    if (
        !isNodeIdentity(data.node) ||
        !isNodeEndpointMap(data.endpoints) ||
        !Array.isArray(data.sources) ||
        !Array.isArray(data.columns)
    ) {
        return undefined;
    }
    if (!isNodeSummary(data.summary) || !isNodeHealth(data.health) || !isFiniteNumber(meta.generatedAt))
        return undefined;

    const federation = parseFederationCapability(data.federation);
    if (data.federation !== undefined && !federation) return undefined;

    return {
        manifest: value as unknown as NodeManifestResponse,
        ...(federation && { federation }),
    };
}

/** Returns the remote federation major version when present so callers can reject incompatible protocols. */
export function getFederationProtocolMajor(federation: FederationCapabilityManifest | undefined) {
    const version = federation?.protocolVersion;
    if (!version) return undefined;

    const match = /^(\d+)\.\d+$/.exec(version);
    return match ? Number(match[1]) : undefined;
}

function isIpLiteral(hostname: string) {
    const unwrapped = hostname.replace(/^\[/, "").replace(/\]$/, "");
    return isIpv4Address(unwrapped) || isIpv6Address(unwrapped);
}

function isIpv4Address(value: string) {
    const parts = value.split(".");
    return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIpv6Address(value: string) {
    return value.includes(":") && /^[0-9a-f:.]+$/i.test(value);
}

function isPublicIpv4Address(address: string) {
    const [first, second, third] = address.split(".").map(Number);

    if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
    if (first === 100 && second >= 64 && second <= 127) return false;
    if (first === 169 && second === 254) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && (second === 0 || second === 88 || second === 168)) return false;
    if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
    if (first === 203 && second === 0 && third === 113) return false;
    return true;
}

function isPublicIpv6Address(address: string) {
    const normalized = address.replace(/^\[/, "").replace(/\]$/, "");
    const embeddedIpv4 = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (embeddedIpv4 && !isPublicIpv4Address(embeddedIpv4)) return false;

    if (normalized === "::" || normalized === "::1") return false;
    if (/^(?:fc|fd)/.test(normalized) || /^fe[89ab]/.test(normalized) || /^ff/.test(normalized)) return false;
    if (/^2001:db8:/.test(normalized)) return false;
    return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value);
}

function isNodeIdentity(value: unknown) {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        Boolean(value.id.trim()) &&
        typeof value.name === "string" &&
        Boolean(value.name.trim()) &&
        typeof value.version === "string" &&
        Boolean(value.version.trim())
    );
}

function isNodeEndpointMap(value: unknown) {
    return (
        isRecord(value) &&
        value.node === upstreamNodeManifestPath &&
        isSameOriginApiPath(value.sources) &&
        isSameOriginApiPath(value.sourceHealth)
    );
}

function isSameOriginApiPath(value: unknown) {
    return typeof value === "string" && /^\/api\/v1\/[a-z0-9_/{}/-]+$/i.test(value);
}

function isNodeSummary(value: unknown) {
    return (
        isRecord(value) &&
        isFiniteNumber(value.sourceCount) &&
        isFiniteNumber(value.redirectCount) &&
        isFiniteNumber(value.disabledCount) &&
        isFiniteNumber(value.columnCount)
    );
}

function isNodeHealth(value: unknown) {
    return (
        isRecord(value) &&
        isFiniteNumber(value.updatedAt) &&
        isFiniteNumber(value.total) &&
        isFiniteNumber(value.healthy) &&
        isFiniteNumber(value.failing) &&
        isFiniteNumber(value.idle) &&
        isFiniteNumber(value.cacheDegraded)
    );
}

function parseFederationCapability(value: unknown): FederationCapabilityManifest | undefined {
    if (!isRecord(value)) return undefined;
    if (
        value.protocolVersion !== undefined &&
        (typeof value.protocolVersion !== "string" || !/^\d+\.\d+$/.test(value.protocolVersion))
    ) {
        return undefined;
    }
    if (
        value.capabilities !== undefined &&
        (!Array.isArray(value.capabilities) || !value.capabilities.every((item) => typeof item === "string"))
    ) {
        return undefined;
    }

    return {
        ...(typeof value.protocolVersion === "string" && { protocolVersion: value.protocolVersion }),
        ...(Array.isArray(value.capabilities) && { capabilities: [...value.capabilities] }),
    };
}
