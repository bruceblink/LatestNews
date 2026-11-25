import { safeNewsUrl } from "../../shared/news-url-policy";
import { normalizeReadingStateUrl } from "../../shared/reading-state";

// Reference model for a proposed server contract. Never imported by the production client.
export type Operation =
    { kind: "put"; url: string; title: string } | { kind: "remove"; url: string } | { kind: "clear" };
export interface Snapshot {
    scope: string;
    epoch: string;
    version: number;
    records: Record<string, { title: string; revision: number; deleted: boolean }>;
}
export interface Request {
    protocol: 2;
    scope: string;
    epoch: string;
    expectedVersion: number;
    operationId: string;
    operation: Operation;
}
export type Reply =
    | { status: "applied" | "replayed"; committedVersion: number; snapshot: Snapshot }
    | { status: "conflict" | "scope-mismatch" | "invalid"; snapshot?: Snapshot };

export class DeletionProtocolModel {
    private document: Snapshot;
    private readonly receipts = new Map<string, { request: string; version: number }>();

    constructor(scope: string, epoch: string) {
        this.document = { scope, epoch, version: 0, records: {} };
    }

    read(): Snapshot {
        return structuredClone(this.document);
    }

    write(request: Request): Reply {
        if (
            request.protocol !== 2 ||
            !request.operationId ||
            !Number.isSafeInteger(request.expectedVersion) ||
            request.expectedVersion < 0
        ) {
            return { status: "invalid" };
        }
        if (request.scope !== this.document.scope || request.epoch !== this.document.epoch) {
            return { status: "scope-mismatch" };
        }
        const encoded = JSON.stringify(request);
        const receipt = this.receipts.get(request.operationId);
        if (receipt) {
            return receipt.request === encoded
                ? { status: "replayed", committedVersion: receipt.version, snapshot: this.read() }
                : { status: "invalid" };
        }
        if (request.expectedVersion !== this.document.version) {
            return { status: "conflict", snapshot: this.read() };
        }
        const next = this.read();
        next.version++;
        const operation = request.operation;
        if (operation.kind === "clear") {
            for (const url of Object.keys(next.records)) {
                next.records[url] = { title: "", revision: next.version, deleted: true };
            }
        } else {
            const safe = safeNewsUrl(operation.url);
            if (!safe) return { status: "invalid" };
            const key = normalizeReadingStateUrl(safe);
            if (!key) return { status: "invalid" };
            next.records[key] =
                operation.kind === "remove"
                    ? { title: "", revision: next.version, deleted: true }
                    : { title: operation.title, revision: next.version, deleted: false };
        }
        this.document = next;
        this.receipts.set(request.operationId, { request: encoded, version: next.version });
        return { status: "applied", committedVersion: next.version, snapshot: this.read() };
    }
}

export function operationFromSnapshot(snapshot: Snapshot, operationId: string, operation: Operation): Request {
    return {
        protocol: 2,
        scope: snapshot.scope,
        epoch: snapshot.epoch,
        expectedVersion: snapshot.version,
        operationId,
        operation,
    };
}

export function visibleUrls(snapshot: Snapshot, limit = Infinity): string[] {
    return Object.entries(snapshot.records)
        .filter(([, record]) => !record.deleted)
        .sort(([leftUrl, left], [rightUrl, right]) => right.revision - left.revision || leftUrl.localeCompare(rightUrl))
        .slice(0, limit)
        .map(([url]) => url);
}
