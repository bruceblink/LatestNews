import type { NodeManifestResponse } from "./node-manifest";
import type { FederationApiError } from "./upstream-node-federation";

export const downstreamNodeManifestPath = "/api/v1/federation/downstream/node";

export const federationDownstreamScopes = [
    "node:read",
    "source-metadata:read",
    "source-items:read",
    "source-health:read",
] as const;

export type FederationDownstreamScope = (typeof federationDownstreamScopes)[number];

export interface FederationDownstreamKeyConfig {
    expiresAt?: number;
    id: string;
    nodeIds: string[];
    revokedAt?: number;
    scopes: FederationDownstreamScope[];
    verifier: string;
}

export interface ParsedFederationDownstreamConfig {
    configured: boolean;
    keys: FederationDownstreamKeyConfig[];
    valid: boolean;
}

export interface FederationRateLimitMeta {
    limit: number;
    remaining: number;
    resetAt: number;
}

export interface DownstreamNodeManifestResponse {
    data: NodeManifestResponse["data"] | null;
    errors: FederationApiError[];
    meta: {
        authenticatedNodeId?: string;
        grantedScopes?: FederationDownstreamScope[];
        generatedAt: number;
        keyId?: string;
        rateLimit: FederationRateLimitMeta;
        requestId: string;
    };
}

/**
 * Parses deployment-owned downstream credentials and rejects the whole set if one record is malformed.
 * A fail-closed configuration prevents an operator typo from silently weakening the allow-list.
 */
export function parseFederationDownstreamConfig(value: string | undefined): ParsedFederationDownstreamConfig {
    const raw = value?.trim();
    if (!raw) return { configured: false, keys: [], valid: true };

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { configured: true, keys: [], valid: false };
    }

    if (!Array.isArray(parsed) || !parsed.length) return { configured: true, keys: [], valid: false };

    const keys: FederationDownstreamKeyConfig[] = [];
    const keyIds = new Set<string>();
    for (const candidate of parsed) {
        const key = parseKeyConfig(candidate);
        if (!key || keyIds.has(key.id)) return { configured: true, keys: [], valid: false };
        keyIds.add(key.id);
        keys.push(key);
    }

    return { configured: true, keys, valid: true };
}

/** Accepts only stable operator/node identifiers so audit and rate-limit keys cannot carry secrets or control chars. */
export function normalizeFederationNodeId(value: string | undefined) {
    const nodeId = value?.trim();
    return nodeId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(nodeId) ? nodeId : undefined;
}

export function isFederationDownstreamScope(value: unknown): value is FederationDownstreamScope {
    return typeof value === "string" && (federationDownstreamScopes as readonly string[]).includes(value);
}

function parseKeyConfig(value: unknown): FederationDownstreamKeyConfig | undefined {
    if (!isRecord(value)) return undefined;

    const id = typeof value.id === "string" ? value.id.trim() : "";
    const verifier = typeof value.verifier === "string" ? value.verifier.trim() : "";
    const nodeIds = Array.isArray(value.nodeIds)
        ? value.nodeIds.map((nodeId) => (typeof nodeId === "string" ? normalizeFederationNodeId(nodeId) : undefined))
        : [];
    const rawScopes = Array.isArray(value.scopes) ? value.scopes : [];
    const scopes = rawScopes.filter(isFederationDownstreamScope);
    const expiresAt = value.expiresAt;
    const revokedAt = value.revokedAt;
    const normalizedExpiresAt = typeof expiresAt === "number" ? expiresAt : undefined;
    const normalizedRevokedAt = typeof revokedAt === "number" ? revokedAt : undefined;

    if (
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(id) ||
        !/^sha256:[0-9a-f]{64}$/.test(verifier) ||
        !nodeIds.length ||
        nodeIds.some((nodeId) => !nodeId) ||
        new Set(nodeIds).size !== nodeIds.length ||
        !scopes.length ||
        scopes.length !== rawScopes.length ||
        new Set(scopes).size !== scopes.length
    )
        return undefined;

    if (
        expiresAt !== undefined &&
        (!isFinitePositiveNumber(expiresAt) || (revokedAt !== undefined && !isFinitePositiveNumber(revokedAt)))
    )
        return undefined;
    if (expiresAt === undefined && revokedAt !== undefined && !isFinitePositiveNumber(revokedAt)) return undefined;

    return {
        id,
        verifier,
        nodeIds: nodeIds as string[],
        scopes,
        ...(normalizedExpiresAt !== undefined && { expiresAt: normalizedExpiresAt }),
        ...(normalizedRevokedAt !== undefined && { revokedAt: normalizedRevokedAt }),
    };
}

function isFinitePositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
