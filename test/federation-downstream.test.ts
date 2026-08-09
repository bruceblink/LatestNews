import { it, expect, describe } from "vitest";

import { parseFederationDownstreamConfig } from "../shared/federation-downstream";
import { createFederationRateLimiter } from "../server/utils/federation-rate-limit";
import {
    emitFederationAuditEvent,
    clearFederationAuditEvents,
    getRecentFederationAuditEvents,
} from "../server/utils/federation-audit";
import {
    hashFederationToken,
    createFederationCredential,
    authorizeDownstreamFederationRequest,
} from "../server/utils/federation-credentials";

const NODE_ID = "partner-a";
const SECRET = "a".repeat(43);
const TOKEN = `lnf_partner-a_${SECRET}`;

async function createConfig(overrides: Record<string, unknown> = {}) {
    return JSON.stringify([
        {
            id: "partner-a",
            verifier: await hashFederationToken(TOKEN),
            nodeIds: [NODE_ID],
            scopes: ["node:read", "source-health:read"],
            ...overrides,
        },
    ]);
}

describe("federation downstream credential contract", () => {
    it("accepts a dedicated lnf credential and returns only an auditable principal", async () => {
        const parsed = parseFederationDownstreamConfig(await createConfig());
        const result = await authorizeDownstreamFederationRequest({
            authorizationHeader: `Bearer ${TOKEN}`,
            config: parsed,
            nodeIdHeader: NODE_ID,
            requiredScope: "node:read",
        });

        expect(parsed).toMatchObject({ configured: true, valid: true });
        expect(result).toEqual({
            ok: true,
            principal: {
                keyId: "partner-a",
                nodeId: NODE_ID,
                scopes: ["node:read", "source-health:read"],
            },
        });
        expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    it("fails closed when an operator config contains an unknown scope or malformed verifier", async () => {
        expect(
            parseFederationDownstreamConfig(await createConfig({ scopes: ["node:read", "admin:write"] }))
        ).toMatchObject({ configured: true, valid: false, keys: [] });
        expect(parseFederationDownstreamConfig(await createConfig({ verifier: "plain-text-secret" }))).toMatchObject({
            configured: true,
            valid: false,
            keys: [],
        });
    });

    it("rejects missing credentials, SyncHub namespaces, unknown keys, nodes, and scopes", async () => {
        const config = parseFederationDownstreamConfig(await createConfig());
        const cases = [
            {
                authorizationHeader: undefined,
                nodeIdHeader: NODE_ID,
                code: "federation_auth_required",
            },
            {
                authorizationHeader: "Bearer shk_not_a_federation_key",
                nodeIdHeader: NODE_ID,
                code: "federation_access_denied",
            },
            {
                authorizationHeader: `Bearer lnf_unknown_${SECRET}`,
                nodeIdHeader: NODE_ID,
                code: "federation_access_denied",
            },
            {
                authorizationHeader: `Bearer ${TOKEN}`,
                nodeIdHeader: "other-node",
                code: "federation_access_denied",
            },
        ] as const;

        for (const input of cases) {
            await expect(
                authorizeDownstreamFederationRequest({
                    ...input,
                    config,
                    requiredScope: "node:read",
                })
            ).resolves.toMatchObject({ ok: false, code: input.code });
        }

        await expect(
            authorizeDownstreamFederationRequest({
                authorizationHeader: `Bearer ${TOKEN}`,
                config,
                nodeIdHeader: NODE_ID,
                requiredScope: "source-items:read",
            })
        ).resolves.toMatchObject({ ok: false, code: "federation_access_denied", auditReason: "scope_denied" });
    });

    it("supports rotation by accepting a new key while rejecting revoked or expired records", async () => {
        const rotatedToken = `lnf_partner-b_${"b".repeat(43)}`;
        const config = parseFederationDownstreamConfig(
            JSON.stringify([
                {
                    id: "partner-a",
                    verifier: await hashFederationToken(TOKEN),
                    nodeIds: [NODE_ID],
                    scopes: ["node:read"],
                    revokedAt: 1,
                },
                {
                    id: "partner-b",
                    verifier: await hashFederationToken(rotatedToken),
                    nodeIds: [NODE_ID],
                    scopes: ["node:read"],
                    expiresAt: 20_000,
                },
            ])
        );

        await expect(
            authorizeDownstreamFederationRequest({
                authorizationHeader: `Bearer ${TOKEN}`,
                config,
                nodeIdHeader: NODE_ID,
                requiredScope: "node:read",
                now: 2_000,
            })
        ).resolves.toMatchObject({ ok: false, auditReason: "revoked_or_expired_key" });
        await expect(
            authorizeDownstreamFederationRequest({
                authorizationHeader: `Bearer ${rotatedToken}`,
                config,
                nodeIdHeader: NODE_ID,
                requiredScope: "node:read",
                now: 2_000,
            })
        ).resolves.toMatchObject({ ok: true, principal: { keyId: "partner-b" } });
    });

    it("creates a verifier-only credential with a dedicated namespace", async () => {
        const created = await createFederationCredential("partner-a", (bytes) => bytes.fill(7));
        expect(created.token).toMatch(/^lnf_partner-a_[A-Za-z0-9_-]{43}$/);
        expect(created.verifier).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(created.token).not.toBe(created.verifier);
    });
});

describe("federation rate limit", () => {
    it("allows a bounded window and resets it deterministically", () => {
        let now = 0;
        const limiter = createFederationRateLimiter({ limit: 2, now: () => now, windowMs: 1_000 });

        expect(limiter.check("node:partner-a")).toMatchObject({ allowed: true, remaining: 1, resetAt: 1_000 });
        expect(limiter.check("node:partner-a")).toMatchObject({ allowed: true, remaining: 0 });
        expect(limiter.check("node:partner-a")).toMatchObject({ allowed: false, remaining: 0 });

        now = 1_000;
        expect(limiter.check("node:partner-a")).toMatchObject({ allowed: true, remaining: 1, resetAt: 2_000 });
    });
});

describe("federation audit events", () => {
    it("keeps safe identifiers and never accepts a bearer token field", () => {
        clearFederationAuditEvents();
        emitFederationAuditEvent({
            durationMs: 4,
            keyId: "partner-a",
            nodeId: NODE_ID,
            occurredAt: 10,
            outcome: "accepted",
            reason: "federation_authorized",
            requestId: "request-1",
            route: "/api/v1/federation/downstream/node",
            scope: "node:read",
        });

        expect(getRecentFederationAuditEvents()).toEqual([
            expect.objectContaining({
                keyId: "partner-a",
                nodeId: NODE_ID,
                outcome: "accepted",
                requestId: "request-1",
            }),
        ]);
        expect(JSON.stringify(getRecentFederationAuditEvents())).not.toContain(SECRET);
    });
});
