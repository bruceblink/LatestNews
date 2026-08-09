import type { DownstreamNodeManifestResponse } from "@shared/federation-downstream";

import process from "node:process";
import { randomUUID } from "@shared/utils";
import { emitFederationAuditEvent } from "#/utils/federation-audit";
import { getFederationRateLimiter } from "#/utils/federation-rate-limit";
import { createLocalNodeManifestResponse } from "#/utils/local-node-manifest";
import { getHeader, setHeader, setResponseStatus, defineEventHandler } from "h3";
import { normalizeFederationNodeId, downstreamNodeManifestPath } from "@shared/federation-downstream";
import { loadFederationDownstreamConfig, authorizeDownstreamFederationRequest } from "#/utils/federation-credentials";

const REQUIRED_SCOPE = "node:read" as const;

/**
 * Serves the local node manifest to an explicitly allow-listed downstream node.
 * Federation authentication is independent from JWT and SyncHub, and every branch emits redacted audit fields.
 */
export default defineEventHandler(async (event): Promise<DownstreamNodeManifestResponse> => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const generatedAt = startedAt;
    const nodeId = normalizeFederationNodeId(getHeader(event, "x-latestnews-node-id"));
    const authorization = await authorizeDownstreamFederationRequest({
        authorizationHeader: getHeader(event, "authorization"),
        config: loadFederationDownstreamConfig(process.env.LATESTNEWS_FEDERATION_DOWNSTREAM_KEYS),
        nodeIdHeader: getHeader(event, "x-latestnews-node-id"),
        requiredScope: REQUIRED_SCOPE,
    });
    const rateSubject = authorization.ok
        ? `key:${authorization.principal.keyId}:node:${authorization.principal.nodeId}`
        : "anonymous";
    const rateDecision = getFederationRateLimiter().check(rateSubject);
    const rateLimit = {
        limit: rateDecision.limit,
        remaining: rateDecision.remaining,
        resetAt: rateDecision.resetAt,
    };
    setRateLimitHeaders(event, requestId, rateLimit);

    if (!rateDecision.allowed) {
        setResponseStatus(event, 429);
        emitAudit({
            durationMs: Date.now() - startedAt,
            ...(authorization.ok && { keyId: authorization.principal.keyId }),
            nodeId: authorization.ok ? authorization.principal.nodeId : nodeId,
            outcome: "rate_limited",
            reason: "federation_rate_limited",
            requestId,
        });
        return createErrorResponse(requestId, generatedAt, rateLimit, "federation_rate_limited");
    }

    if (!authorization.ok) {
        setResponseStatus(event, authorization.code === "federation_auth_required" ? 401 : 403);
        emitAudit({
            durationMs: Date.now() - startedAt,
            nodeId,
            outcome: "rejected",
            reason: authorization.auditReason,
            requestId,
            scope: REQUIRED_SCOPE,
        });
        return createErrorResponse(requestId, generatedAt, rateLimit, authorization.code);
    }

    const localManifest = createLocalNodeManifestResponse(generatedAt);
    emitAudit({
        durationMs: Date.now() - startedAt,
        keyId: authorization.principal.keyId,
        nodeId: authorization.principal.nodeId,
        outcome: "accepted",
        reason: "federation_authorized",
        requestId,
        scope: REQUIRED_SCOPE,
    });

    return {
        data: localManifest.data,
        meta: {
            authenticatedNodeId: authorization.principal.nodeId,
            grantedScopes: authorization.principal.scopes,
            generatedAt,
            keyId: authorization.principal.keyId,
            rateLimit,
            requestId,
        },
        errors: [],
    };
});

function createErrorResponse(
    requestId: string,
    generatedAt: number,
    rateLimit: DownstreamNodeManifestResponse["meta"]["rateLimit"],
    code: DownstreamNodeManifestResponse["errors"][number]["code"]
): DownstreamNodeManifestResponse {
    return {
        data: null,
        meta: {
            generatedAt,
            rateLimit,
            requestId,
        },
        errors: [
            {
                code,
                message: getFederationErrorMessage(code),
                retriable: code === "federation_rate_limited",
            },
        ],
    };
}

function getFederationErrorMessage(code: DownstreamNodeManifestResponse["errors"][number]["code"]) {
    if (code === "federation_auth_required") return "A federation bearer credential is required.";
    if (code === "federation_access_denied") return "Federation credential is not allowed for this node or scope.";
    return "Federation request rate limit exceeded.";
}

function setRateLimitHeaders(
    event: Parameters<typeof setHeader>[0],
    requestId: string,
    rateLimit: DownstreamNodeManifestResponse["meta"]["rateLimit"]
) {
    setHeader(event, "x-request-id", requestId);
    setHeader(event, "x-ratelimit-limit", String(rateLimit.limit));
    setHeader(event, "x-ratelimit-remaining", String(rateLimit.remaining));
    setHeader(event, "x-ratelimit-reset", String(rateLimit.resetAt));
}

function emitAudit(options: {
    durationMs: number;
    keyId?: string;
    nodeId?: string;
    outcome: "accepted" | "rejected" | "rate_limited";
    reason: string;
    requestId: string;
    scope?: string;
}) {
    emitFederationAuditEvent({
        durationMs: Math.max(0, options.durationMs),
        ...(options.keyId && { keyId: options.keyId }),
        ...(options.nodeId && { nodeId: options.nodeId }),
        occurredAt: Date.now(),
        outcome: options.outcome,
        reason: options.reason,
        requestId: options.requestId,
        route: downstreamNodeManifestPath,
        ...(options.scope && { scope: options.scope }),
    });
}
