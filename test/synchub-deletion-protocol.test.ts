import { it, expect, describe } from "vitest";

import { mergeSyncHubFavorites } from "../shared/synchub-merge";
import { visibleUrls, DeletionProtocolModel, operationFromSnapshot } from "./fixtures/synchub-deletion-model";

const a = "https://example.com/a";
const b = "https://example.com/b";

describe("proposed SyncHub v2 deletion contract (reference model only)", () => {
    it("reproduces A07 in v1 and prevents stale resurrection in v2", () => {
        expect(mergeSyncHubFavorites([], [{ url: a, updatedAt: 1 }])).toHaveLength(1);
        const server = new DeletionProtocolModel("account-a/favorites", "epoch-1");
        server.write(operationFromSnapshot(server.read(), "add", { kind: "put", url: a, title: "A" }));
        const offlineDevice = server.read();
        const removal = operationFromSnapshot(server.read(), "delete", { kind: "remove", url: a + "?utm_source=feed" });
        expect(server.write(removal).status).toBe("applied");
        const stale = operationFromSnapshot(offlineDevice, "old-write", { kind: "put", url: a, title: "A" });
        expect(server.write(stale).status).toBe("conflict");
        expect(visibleUrls(server.read())).toEqual([]);
        expect(server.read().records[a].deleted).toBe(true);
    });

    it("does not let a stale delete erase a new explicit re-add", () => {
        const server = new DeletionProtocolModel("account-a/favorites", "epoch-1");
        server.write(operationFromSnapshot(server.read(), "add", { kind: "put", url: a, title: "A" }));
        const stale = operationFromSnapshot(server.read(), "stale-delete", { kind: "remove", url: a });
        server.write(operationFromSnapshot(server.read(), "delete", { kind: "remove", url: a }));
        server.write(operationFromSnapshot(server.read(), "readd", { kind: "put", url: a, title: "Updated" }));
        expect(server.write(stale).status).toBe("conflict");
        expect(visibleUrls(server.read())).toEqual([a]);
        expect(server.read().records[a].title).toBe("Updated");
    });

    it("retains clear-history semantics across an offline device", () => {
        const server = new DeletionProtocolModel("account-a/reading-history", "epoch-1");
        for (const url of [a, b])
            server.write(operationFromSnapshot(server.read(), url, { kind: "put", url, title: url }));
        const offline = server.read();
        expect(server.write(operationFromSnapshot(server.read(), "clear", { kind: "clear" })).status).toBe("applied");
        expect(
            server.write(operationFromSnapshot(offline, "offline-put", { kind: "put", url: a, title: "A" })).status
        ).toBe("conflict");
        expect(visibleUrls(server.read())).toEqual([]);
        expect(
            server.write(operationFromSnapshot(server.read(), "new-read", { kind: "put", url: b, title: "New" })).status
        ).toBe("applied");
        expect(visibleUrls(server.read())).toEqual([b]);
    });

    it("replays an identical persisted pending request after a lost acknowledgement", () => {
        const server = new DeletionProtocolModel("account-a/favorites", "epoch-1");
        const request = operationFromSnapshot(server.read(), "client-operation-1", { kind: "put", url: a, title: "A" });
        expect(server.write(request).status).toBe("applied");
        server.write(operationFromSnapshot(server.read(), "newer", { kind: "remove", url: a }));
        const retry = JSON.parse(JSON.stringify(request)) as typeof request;
        expect(server.write(retry)).toMatchObject({
            status: "replayed",
            committedVersion: 1,
            snapshot: { version: 2 },
        });
        expect(visibleUrls(server.read())).toEqual([]);
        expect(server.write({ ...request, operation: { kind: "remove", url: a } }).status).toBe("invalid");
        expect(server.read().version).toBe(2);
    });

    it("isolates account, collection and server epoch", () => {
        const server = new DeletionProtocolModel("account-a/favorites", "epoch-1");
        const pending = operationFromSnapshot(server.read(), "pending", { kind: "clear" });
        for (const scope of ["account-b/favorites", "account-a/reading-history"]) {
            const other = new DeletionProtocolModel(scope, "epoch-1");
            expect(other.write(pending)).toEqual({ status: "scope-mismatch" });
            expect(other.read().version).toBe(0);
        }
        const replacement = new DeletionProtocolModel("account-a/favorites", "epoch-2");
        expect(replacement.write(pending)).toEqual({ status: "scope-mismatch" });
    });

    it("does not interpret list truncation as deletion, and rejects unsafe URLs", () => {
        const server = new DeletionProtocolModel("account-a/favorites", "epoch-1");
        for (const url of [a, b])
            server.write(operationFromSnapshot(server.read(), url, { kind: "put", url, title: url }));
        expect(visibleUrls(server.read(), 1)).toEqual([b]);
        expect(visibleUrls(server.read())).toEqual([b, a]);
        expect(
            server.write(
                operationFromSnapshot(server.read(), "unsafe", {
                    kind: "put",
                    url: "javascript:alert(1)",
                    title: "bad",
                })
            ).status
        ).toBe("invalid");
        expect(server.read().version).toBe(2);
    });
});
