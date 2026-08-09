import type { FederationDownstreamScope, ParsedFederationDownstreamConfig } from "@shared/federation-downstream";

import { normalizeFederationNodeId, parseFederationDownstreamConfig } from "@shared/federation-downstream";

const FEDERATION_TOKEN_PREFIX = "lnf_";
const FEDERATION_TOKEN_PATTERN = /^lnf_([A-Za-z0-9-]{1,64})_([A-Za-z0-9_-]{32,256})$/;

export interface DownstreamFederationPrincipal {
    keyId: string;
    nodeId: string;
    scopes: FederationDownstreamScope[];
}

export type DownstreamFederationAuthorization =
    | {
          ok: true;
          principal: DownstreamFederationPrincipal;
      }
    | {
          auditReason: string;
          code: "federation_access_denied" | "federation_auth_required";
          ok: false;
      };

export interface AuthorizeDownstreamFederationOptions {
    authorizationHeader?: string;
    config: ParsedFederationDownstreamConfig;
    nodeIdHeader?: string;
    now?: number;
    requiredScope: FederationDownstreamScope;
}

export interface CreatedFederationCredential {
    token: string;
    verifier: string;
}

/**
 * Authenticates one downstream request using a dedicated `lnf_` token and an operator-owned SHA-256 verifier.
 * The returned principal contains only safe audit identifiers; the bearer secret never leaves this function.
 */
export async function authorizeDownstreamFederationRequest(
    options: AuthorizeDownstreamFederationOptions
): Promise<DownstreamFederationAuthorization> {
    const token = parseBearerToken(options.authorizationHeader);
    if (!token) return { ok: false, code: "federation_auth_required", auditReason: "missing_or_malformed_bearer" };

    const nodeId = normalizeFederationNodeId(options.nodeIdHeader);
    if (!nodeId) return { ok: false, code: "federation_access_denied", auditReason: "invalid_node_id" };

    const parsedToken = parseFederationToken(token);
    if (!parsedToken) return { ok: false, code: "federation_access_denied", auditReason: "wrong_credential_namespace" };

    const key = options.config.keys.find((candidate) => candidate.id === parsedToken.keyId);
    if (!options.config.valid || !key)
        return { ok: false, code: "federation_access_denied", auditReason: "unknown_key_id" };
    if (key.revokedAt !== undefined || (key.expiresAt !== undefined && key.expiresAt <= (options.now ?? Date.now())))
        return { ok: false, code: "federation_access_denied", auditReason: "revoked_or_expired_key" };
    if (!(await verifyFederationToken(token, key.verifier)))
        return { ok: false, code: "federation_access_denied", auditReason: "verifier_mismatch" };
    if (!key.nodeIds.includes(nodeId))
        return { ok: false, code: "federation_access_denied", auditReason: "node_not_allow_listed" };
    if (!key.scopes.includes(options.requiredScope))
        return { ok: false, code: "federation_access_denied", auditReason: "scope_denied" };

    return {
        ok: true,
        principal: {
            keyId: key.id,
            nodeId,
            scopes: [...key.scopes],
        },
    };
}

/** Generates a verifier-only config pair for one rotating downstream credential. The raw token is shown once to the operator. */
export async function createFederationCredential(
    keyId: string,
    randomValues: (bytes: Uint8Array) => Uint8Array = defaultRandomValues
): Promise<CreatedFederationCredential> {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(keyId))
        throw new Error("Federation key id must contain only letters, numbers, and hyphens.");

    const secretBytes = randomValues(new Uint8Array(32));
    const secret = toBase64Url(secretBytes);
    const token = `${FEDERATION_TOKEN_PREFIX}${keyId}_${secret}`;
    return { token, verifier: await hashFederationToken(token) };
}

/** Hashes the complete bearer token so the deployment configuration never needs to store the raw secret. */
export async function hashFederationToken(token: string) {
    const digest = await getSubtle().digest("SHA-256", new TextEncoder().encode(token));
    return `sha256:${toHex(new Uint8Array(digest))}`;
}

async function verifyFederationToken(token: string, verifier: string) {
    if (!/^sha256:[0-9a-f]{64}$/.test(verifier)) return false;
    const actual = new Uint8Array(await getSubtle().digest("SHA-256", new TextEncoder().encode(token)));
    const expected = fromHex(verifier.slice("sha256:".length));
    return constantTimeEqual(actual, expected);
}

function parseBearerToken(value: string | undefined) {
    const token = /^Bearer\s+(\S+)$/i.exec(value?.trim() ?? "")?.[1];
    return token && token.length <= 512 ? token : undefined;
}

function parseFederationToken(token: string) {
    const match = FEDERATION_TOKEN_PATTERN.exec(token);
    return match ? { keyId: match[1] } : undefined;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference += Math.abs(left[index] - right[index]);
    return difference === 0;
}

function getSubtle() {
    if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for federation credential verification.");
    return globalThis.crypto.subtle;
}

function defaultRandomValues(bytes: Uint8Array) {
    if (!globalThis.crypto?.getRandomValues)
        throw new Error("Web Crypto is required to generate federation credentials.");
    return globalThis.crypto.getRandomValues(bytes);
}

function toBase64Url(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toHex(bytes: Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < bytes.length; index += 1)
        bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    return bytes;
}

export function loadFederationDownstreamConfig(value: string | undefined) {
    return parseFederationDownstreamConfig(value);
}
