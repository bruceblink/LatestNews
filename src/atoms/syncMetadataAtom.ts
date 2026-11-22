import type { PrimitiveMetadata } from "@shared/types";
import type { MetadataSyncTransitionSource } from "@shared/metadata-sync-types";

import { atom } from "jotai";
import { userAtom, authStatusAtom } from "~/auth/authAtoms";
import { mergePrimitiveMetadata } from "@shared/metadata-merge";
import { uploadMetadata, downloadMetadata, getSyncErrorMessage } from "~/services/metadata.service";
import { toErrorStatus, toQueuedStatus, toSuccessStatus, toSyncingStatus } from "@shared/metadata-sync-flow";

import { metadataSyncStatusAtom } from "./syncStatusAtom";
import { preprocessMetadata, primitiveMetadataAtom, pendingLayoutAccountIdAtom } from "./primitiveMetadataAtom";

type SyncSource = Exclude<MetadataSyncTransitionSource, "auth-feedback">;
type SyncResult = "synced" | "pending" | "empty" | "skipped";
const syncTailAtom = atom<Promise<unknown>>(Promise.resolve());

/** Serialize account layout requests. Only apply a result to the same local layout and account. */
export const syncMetadataAtom = atom(null, async (get, set, source: SyncSource) => {
    const user = get(userAtom);
    if (!user) return "skipped" as const;
    const sameAccount = () => get(userAtom) === user && get(authStatusAtom) === "authenticated";
    const operation = get(syncTailAtom).then(async (): Promise<SyncResult> => {
        if (!sameAccount()) return "skipped";
        const snapshot = get(primitiveMetadataAtom);
        if (source === "auto-upload" && (snapshot.action !== "manual" || get(pendingLayoutAccountIdAtom) !== user.id)) {
            return "skipped";
        }
        if (source === "login-sync" && snapshot.action === "manual") return "pending";

        set(metadataSyncStatusAtom, (prev) => toSyncingStatus(prev, source));
        try {
            const shouldUpload =
                source === "auto-upload" ||
                source === "manual-sync" ||
                source === "restore-to-remote" ||
                (source === "retry-sync" && snapshot.action === "manual");
            let remote: PrimitiveMetadata | undefined;
            if (shouldUpload) await uploadMetadata(snapshot);
            else remote = await downloadMetadata();

            if (!sameAccount()) return "skipped";
            const current = get(primitiveMetadataAtom);
            if (current !== snapshot) {
                set(metadataSyncStatusAtom, (prev) =>
                    current.action === "manual" ? toQueuedStatus(prev, source) : { ...prev, phase: "idle" }
                );
                return "pending";
            }

            if (shouldUpload) {
                set(primitiveMetadataAtom, { ...snapshot, action: "sync" });
            } else if (remote) {
                // An explicit restore replaces the layout even if the cloud timestamp is older.
                const layout =
                    source === "restore-from-remote"
                        ? { ...remote, updatedTime: Math.max(Date.now(), remote.updatedTime, snapshot.updatedTime + 1) }
                        : mergePrimitiveMetadata(snapshot, remote);
                set(primitiveMetadataAtom, preprocessMetadata(layout));
            } else if (source === "restore-from-remote") {
                set(metadataSyncStatusAtom, (prev) => ({ ...prev, phase: "idle" }));
                return "empty";
            }

            set(metadataSyncStatusAtom, (prev) => toSuccessStatus(prev, source));
            return "synced";
        } catch (error) {
            if (!sameAccount()) return "skipped";
            set(metadataSyncStatusAtom, (prev) => toErrorStatus(prev, source, getSyncErrorMessage(error)));
            throw error;
        }
    });
    // A failed request must not block a queued retry.
    set(
        syncTailAtom,
        operation.catch(() => undefined)
    );
    return operation;
});
