import { logger } from "#/utils/logger";

export type FederationAuditOutcome = "accepted" | "rejected" | "rate_limited";

export interface FederationAuditEvent {
    durationMs: number;
    keyId?: string;
    nodeId?: string;
    outcome: FederationAuditOutcome;
    reason: string;
    requestId: string;
    route: string;
    scope?: string;
    occurredAt: number;
}

const RECENT_AUDIT_LIMIT = 200;
const recentEvents: FederationAuditEvent[] = [];

/**
 * Emits a redacted federation audit event and keeps a small local diagnostic ring.
 * Callers provide validated IDs and static reasons; bearer credentials are never accepted here.
 */
export function emitFederationAuditEvent(event: FederationAuditEvent) {
    recentEvents.unshift({ ...event });
    recentEvents.length = Math.min(recentEvents.length, RECENT_AUDIT_LIMIT);
    logger.info(`federation audit ${JSON.stringify(event)}`);
}

export function getRecentFederationAuditEvents() {
    return recentEvents.map((event) => ({ ...event }));
}

export function clearFederationAuditEvents() {
    recentEvents.length = 0;
}
